import express from "express";
import cors from "cors";
import net from "net";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawn, execFileSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

try {
  process.loadEnvFile(path.join(PROJECT_ROOT, ".env"));
} catch {
  // no .env file present — rely on variables already set in the environment
}

const BLENDER_HOST = process.env.BLENDER_HOST || "localhost";
const BLENDER_PORT = Number(process.env.BLENDER_PORT || 9876);
const WEB_PORT = Number(process.env.WEB_PORT || 3001);

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

function sendToBlenderRaw(type, params = {}) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const chunks = [];
    let settled = false;

    client.setTimeout(30000);

    client.connect(BLENDER_PORT, BLENDER_HOST, () => {
      client.write(JSON.stringify({ type, params }));
    });

    client.on("data", (chunk) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf-8");
      try {
        const parsed = JSON.parse(text);
        settled = true;
        client.destroy();
        resolve(parsed);
      } catch {
        // wait for more data until the JSON is complete
      }
    });

    client.on("error", (err) => {
      if (!settled) reject(err);
    });

    client.on("timeout", () => {
      if (!settled) {
        client.destroy();
        reject(new Error("Blender no respondio a tiempo (timeout)"));
      }
    });

    client.on("close", () => {
      if (!settled) reject(new Error("Conexion cerrada sin respuesta de Blender"));
    });
  });
}

// El addon de Blender atiende una sola conexión a la vez. Serializamos todas
// las llamadas en una cola para que no choquen (status, export, execute_code…),
// lo que evita cuelgues/502 cuando el navegador consulta mientras se genera.
let _blenderQueue = Promise.resolve();
function sendToBlender(type, params = {}) {
  const run = () => sendToBlenderRaw(type, params);
  const result = _blenderQueue.then(run, run);
  _blenderQueue = result.then(() => {}, () => {}); // la cola sigue pase lo que pase
  return result;
}

// ---------------------------------------------------------------------------
// Motores de IA "enchufables": cada motor es un programa de terminal ya
// instalado (Claude Code, OpenCode, Hermes...). La web detecta cuáles están
// disponibles y, al elegir uno, este servidor llama al programa correspondiente,
// le pide que traduzca la instrucción a código bpy y lo ejecuta en Blender.
// No usa API keys: usa la sesión que cada programa ya tiene iniciada.
// ---------------------------------------------------------------------------
const ENGINES_FILE = path.join(__dirname, "ai-engines.json");
let ENGINES = [];
try {
  ENGINES = JSON.parse(fs.readFileSync(ENGINES_FILE, "utf-8")).engines || [];
} catch (err) {
  console.error(`[web] No se pudo leer ai-engines.json: ${err.message}`);
}

// Directorio de trabajo neutro para lanzar los CLIs (evita que husmeen el repo).
const AI_SCRATCH_DIR = path.join(os.tmpdir(), "blender-mcp-ai");
fs.mkdirSync(AI_SCRATCH_DIR, { recursive: true });

// Busca un comando en el PATH del sistema (o null si no está).
// En Windows `where` puede devolver varias rutas (p. ej. el shim de Bash sin
// extensión y el `.cmd`): preferimos un ejecutable de Windows (.cmd/.exe/.bat).
function whichCommand(cmd) {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, [cmd], { encoding: "utf-8" });
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    if (process.platform === "win32") {
      return lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) || lines[0];
    }
    return lines[0];
  } catch {
    return null;
  }
}

// Expande ~, %USERPROFILE% y ${HOME} a la carpeta del usuario.
function expandHome(p) {
  const home = os.homedir();
  return p
    .replace(/^~(?=[/\\])/, home)
    .replace(/%USERPROFILE%/gi, home)
    .replace(/\$\{HOME\}/g, home);
}

// Expande un patrón con un comodín `*` en un segmento de ruta y devuelve las
// coincidencias existentes (para localizar el binario de una extensión de VS Code
// cuya versión cambia con el tiempo).
function expandGlob(pattern) {
  const norm = expandHome(pattern).replace(/\\/g, "/");
  if (!norm.includes("*")) return fs.existsSync(norm) ? [norm] : [];
  try {
    const out = fs.globSync(norm);
    if (out && out.length) return out.map((p) => path.resolve(p)).filter(fs.existsSync);
  } catch {
    /* cae al método manual */
  }
  const star = norm.indexOf("*");
  const base = norm.slice(0, norm.lastIndexOf("/", star));
  const rest = norm.slice(base.length + 1);
  const seg = rest.split("/")[0];
  const tail = rest.slice(seg.length + 1);
  const re = new RegExp("^" + seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  const matches = [];
  try {
    for (const name of fs.readdirSync(base)) {
      if (!re.test(name)) continue;
      const full = tail ? path.join(base, name, tail) : path.join(base, name);
      if (fs.existsSync(full)) matches.push(full);
    }
  } catch {
    /* base inexistente */
  }
  return matches;
}

// Resuelve la ruta ejecutable de un motor: primero el PATH, luego sus
// fallbackPaths (con comodines). Cachea unos segundos. Devuelve null si no existe.
const _resolveCache = new Map();
function resolveEngineCommand(engine) {
  const cached = _resolveCache.get(engine.id);
  if (cached && Date.now() - cached.at < 5000) return cached.path;
  let resolved = whichCommand(engine.command);
  if (!resolved && Array.isArray(engine.fallbackPaths)) {
    for (const raw of engine.fallbackPaths) {
      const matches = expandGlob(raw);
      if (matches.length) { resolved = matches.sort().at(-1); break; }
    }
  }
  _resolveCache.set(engine.id, { path: resolved, at: Date.now() });
  return resolved;
}

// Instrucción base que se antepone a la petición del usuario para cualquier motor.
const BLENDER_CLI_INSTRUCTION = `Eres un traductor de instrucciones a código Python para la API bpy de Blender.
Reglas ESTRICTAS:
1. Responde ÚNICAMENTE con un único bloque de código Python dentro de \`\`\`python ... \`\`\`. Nada de explicaciones, ni texto antes o después.
2. 'bpy' ya está importado en el entorno de ejecución (puedes volver a importarlo sin problema).
3. Para limpiar/borrar la escena usa: bpy.ops.object.select_all(action='SELECT') seguido de bpy.ops.object.delete().
4. Prefiere operadores bpy.ops.mesh.primitive_* para formas simples; usa geometría/materiales para cosas más elaboradas.
5. Si la instrucción es ambigua, elige una interpretación razonable con tamaños/posiciones en el rango ~1-3.
6. Nunca borres la escena salvo que te lo pidan explícitamente.`;

function buildCliPrompt(userText) {
  return `${BLENDER_CLI_INSTRUCTION}\n\n---\nInstrucción del usuario:\n${userText}\n\nRecuerda: responde SOLO con el bloque \`\`\`python.`;
}

// Extrae el código Python de la salida (posiblemente parlanchina) de un agente.
function extractCodeFromOutput(out) {
  if (!out) return "";
  const fence = /```(?:python|py)?\s*\n?([\s\S]*?)```/gi;
  let m;
  let last = null;
  while ((m = fence.exec(out)) !== null) last = m[1];
  return (last !== null ? last : out).trim();
}

// Lanza el programa de un motor, le pasa el prompt y devuelve su salida cruda.
function runCliEngine(engine, prompt, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const full = resolveEngineCommand(engine);
    if (!full) {
      return reject(new Error(`El programa "${engine.command}" no está instalado o no está en el PATH.`));
    }
    const promptViaArg = engine.promptMode === "arg";
    const args = [...(engine.args || [])];
    if (promptViaArg) args.push(prompt);

    // En Windows los binarios instalados por npm son shims .cmd, que requieren
    // shell. Con argumentos estáticos (banderas) esto es seguro; el prompt del
    // usuario viaja por stdin (o como último argv ya separado, sin interpolar).
    const isShim = /\.(cmd|bat|ps1)$/i.test(full);
    const spawnCmd = isShim ? `"${full}"` : full;

    // Variables de entorno extra del motor (p. ej. un bundle de CA para
    // superar el escaneo SSL de un antivirus). Se expande ~ a la carpeta home.
    const extraEnv = {};
    if (engine.env) {
      for (const [k, v] of Object.entries(engine.env)) extraEnv[k] = expandHome(String(v));
    }

    const child = spawn(spawnCmd, args, {
      cwd: AI_SCRATCH_DIR,
      shell: isShim,
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error("El programa tardó demasiado en responder (timeout)."));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return finish(reject, new Error(stderr.trim() || `El programa terminó con código ${code}.`));
      }
      finish(resolve, stdout);
    });

    if (!promptViaArg) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

function enginePublicView(e) {
  return {
    id: e.id,
    label: e.label,
    type: e.type,
    badge: e.badge || null,
    icon: e.icon || null,
    description: e.description || "",
    install: e.install || null,
    installUrl: e.installUrl || null,
    unverified: !!e.unverified,
    installed: e.type === "builtin" ? true : !!resolveEngineCommand(e),
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  console.log(`[req] ${req.method} ${req.path}`);
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { etag: false, lastModified: false }));

const SCREENSHOTS_DIR = path.join(__dirname, "public", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const RENDER_FILEPATH = path.join(SCREENSHOTS_DIR, "render.png");

// Renderiza la escena a un archivo PNG. Usa render offline (no captura de
// pantalla) para no depender de que la ventana de Blender este visible.
function renderSceneCode(outputPath) {
  const pyPath = outputPath.replace(/\\/g, "/");
  return `
import bpy
import mathutils

def _ensure_camera_and_light():
    cam = bpy.data.objects.get('WebPreviewCam')
    if cam is None:
        cam_data = bpy.data.cameras.new('WebPreviewCamData')
        cam = bpy.data.objects.new('WebPreviewCam', cam_data)
        bpy.context.collection.objects.link(cam)
    sun = bpy.data.objects.get('WebPreviewSun')
    if sun is None:
        sun_data = bpy.data.lights.new('WebPreviewSunData', type='SUN')
        sun_data.energy = 3.0
        sun = bpy.data.objects.new('WebPreviewSun', sun_data)
        bpy.context.collection.objects.link(sun)
        sun.rotation_euler = (0.9, 0, 0.6)
    return cam, sun

def _frame_camera(cam):
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        cam.location = (5, -5, 4)
        cam.rotation_euler = (1.1, 0, 0.78)
        return
    min_v = None
    max_v = None
    for o in meshes:
        for corner in o.bound_box:
            world_co = o.matrix_world @ mathutils.Vector(corner)
            if min_v is None:
                min_v = world_co.copy()
                max_v = world_co.copy()
            else:
                min_v.x = min(min_v.x, world_co.x)
                min_v.y = min(min_v.y, world_co.y)
                min_v.z = min(min_v.z, world_co.z)
                max_v.x = max(max_v.x, world_co.x)
                max_v.y = max(max_v.y, world_co.y)
                max_v.z = max(max_v.z, world_co.z)
    center = (min_v + max_v) / 2
    size = max((max_v - min_v).length, 1.0)
    cam.location = center + mathutils.Vector((size * 1.4, -size * 1.4, size * 1.0))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

cam, sun = _ensure_camera_and_light()
_frame_camera(cam)
bpy.context.scene.camera = cam

scene = bpy.context.scene
# Motor Workbench: render de vista sólida, muy rápido (~1s) en vez de EEVEE/Cycles
# que pueden tardar decenas de segundos. Suficiente para una vista previa.
try:
    scene.render.engine = 'BLENDER_WORKBENCH'
except Exception:
    pass
scene.render.resolution_x = 640
scene.render.resolution_y = 420
scene.render.resolution_percentage = 100
scene.render.filepath = "${pyPath}"
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('render_ok')
`;
}

app.post("/api/screenshot", async (_req, res) => {
  try {
    const result = await sendToBlender("execute_code", { code: renderSceneCode(RENDER_FILEPATH) });
    if (result.status !== "success") {
      return res.status(502).json(result);
    }
    res.json({ status: "success", url: "/screenshots/render.png" });
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

const MODELS_DIR = path.join(__dirname, "public", "models");
fs.mkdirSync(MODELS_DIR, { recursive: true });
const GLB_FILEPATH = path.join(MODELS_DIR, "scene.glb");

function exportGlbCode(outputPath) {
  const pyPath = outputPath.replace(/\\/g, "/");
  return `
import bpy
bpy.ops.export_scene.gltf(filepath="${pyPath}", export_format='GLB', use_selection=False)
print('export_ok')
`;
}

app.post("/api/model", async (_req, res) => {
  try {
    const result = await sendToBlender("execute_code", { code: exportGlbCode(GLB_FILEPATH) });
    if (result.status !== "success") {
      return res.status(502).json(result);
    }
    res.json({ status: "success", url: "/models/scene.glb" });
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const result = await sendToBlender("get_scene_info", {});
    res.json({ connected: true, result });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.get("/api/scene", async (_req, res) => {
  try {
    const result = await sendToBlender("get_scene_info", {});
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

// --- CRUD sobre objetos individuales de la escena ---
function pyStr(s) {
  // JSON.stringify produce comillas dobles + escapes validos como literal de Python
  return JSON.stringify(String(s));
}

function extractLastJsonLine(stdout) {
  const lines = (stdout || "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  return last ? JSON.parse(last) : null;
}

app.get("/api/objects/:name", async (req, res) => {
  const code = `
import bpy, json, math
obj = bpy.data.objects.get(${pyStr(req.params.name)})
if obj is None:
    print(json.dumps({"found": False}))
else:
    print(json.dumps({
        "found": True,
        "name": obj.name,
        "type": obj.type,
        "location": [obj.location.x, obj.location.y, obj.location.z],
        "rotation_degrees": [math.degrees(obj.rotation_euler.x), math.degrees(obj.rotation_euler.y), math.degrees(obj.rotation_euler.z)],
        "scale": [obj.scale.x, obj.scale.y, obj.scale.z],
    }))
`;
  try {
    const result = await sendToBlender("execute_code", { code });
    if (result.status !== "success") return res.status(502).json(result);
    const parsed = extractLastJsonLine(result.result?.result);
    if (!parsed || !parsed.found) {
      return res.status(404).json({ status: "error", message: "Objeto no encontrado" });
    }
    res.json({ status: "success", object: parsed });
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

app.post("/api/objects/:name/update", async (req, res) => {
  const { location, rotation_degrees, scale } = req.body || {};
  const [lx, ly, lz] = location || [0, 0, 0];
  const [rx, ry, rz] = rotation_degrees || [0, 0, 0];
  const [sx, sy, sz] = scale || [1, 1, 1];
  const code = `
import bpy, math, json
obj = bpy.data.objects.get(${pyStr(req.params.name)})
if obj is None:
    print(json.dumps({"found": False}))
else:
    obj.location = (${Number(lx)}, ${Number(ly)}, ${Number(lz)})
    obj.rotation_euler = (math.radians(${Number(rx)}), math.radians(${Number(ry)}), math.radians(${Number(rz)}))
    obj.scale = (${Number(sx)}, ${Number(sy)}, ${Number(sz)})
    print(json.dumps({"found": True}))
`;
  try {
    const result = await sendToBlender("execute_code", { code });
    if (result.status !== "success") return res.status(502).json(result);
    const parsed = extractLastJsonLine(result.result?.result);
    if (!parsed || !parsed.found) {
      return res.status(404).json({ status: "error", message: "Objeto no encontrado" });
    }
    res.json({ status: "success" });
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

app.post("/api/objects/:name/delete", async (req, res) => {
  const code = `
import bpy, json
obj = bpy.data.objects.get(${pyStr(req.params.name)})
if obj is None:
    print(json.dumps({"found": False}))
else:
    bpy.data.objects.remove(obj, do_unlink=True)
    print(json.dumps({"found": True}))
`;
  try {
    const result = await sendToBlender("execute_code", { code });
    if (result.status !== "success") return res.status(502).json(result);
    const parsed = extractLastJsonLine(result.result?.result);
    if (!parsed || !parsed.found) {
      return res.status(404).json({ status: "error", message: "Objeto no encontrado" });
    }
    res.json({ status: "success" });
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

app.post("/api/execute", async (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ status: "error", message: "Falta el campo 'code'" });
  }
  try {
    const result = await sendToBlender("execute_code", { code });
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

app.post("/api/command", async (req, res) => {
  const { type, params } = req.body || {};
  if (typeof type !== "string" || !type.trim()) {
    return res.status(400).json({ status: "error", message: "Falta el campo 'type'" });
  }
  try {
    const result = await sendToBlender(type, params || {});
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

// Scripts locales del proyecto que se pueden lanzar con un click desde la web
const SCRIPTS = {
  shrimp_detailed: "make_shrimp_detailed.py",
  shrimp: "make_shrimp.py",
  butterfly: "make_butterfly.py",
};

app.get("/api/scripts", (_req, res) => {
  res.json(Object.keys(SCRIPTS));
});

app.post("/api/scripts/:name/run", async (req, res) => {
  const filename = SCRIPTS[req.params.name];
  if (!filename) {
    return res.status(404).json({ status: "error", message: "Script desconocido" });
  }
  const filepath = path.join(PROJECT_ROOT, filename);
  try {
    const code = fs.readFileSync(filepath, "utf-8");
    const result = await sendToBlender("execute_code", { code });
    res.json(result);
  } catch (err) {
    res.status(502).json({ status: "error", message: err.message });
  }
});

function runScript(scriptKey) {
  const filepath = path.join(PROJECT_ROOT, SCRIPTS[scriptKey]);
  const code = fs.readFileSync(filepath, "utf-8");
  return sendToBlender("execute_code", { code });
}

// --- Modo "reglas": interpretación por palabras clave, 100% local y sin costo ---
const SCRIPT_KEYWORDS = {
  barco: "shrimp_detailed",
  velero: "shrimp_detailed",
  camaron: "shrimp",
  "camarón": "shrimp",
  mariposa: "butterfly",
};

function rulesToAction(text) {
  const t = text.toLowerCase();

  if (/\b(limpia|limpiar|borra|borrar|vaci[ae]|vaciar)\b.*\b(escena|todo)\b/.test(t)) {
    return { label: "limpiar escena", code: "bpy.ops.object.select_all(action='SELECT')\nbpy.ops.object.delete()" };
  }

  for (const [keyword, scriptKey] of Object.entries(SCRIPT_KEYWORDS)) {
    if (t.includes(keyword)) {
      return { label: `script:${scriptKey}`, scriptKey };
    }
  }

  const locMatch = t.match(/en\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
  const loc = locMatch ? `(${locMatch[1]},${locMatch[2]},${locMatch[3]})` : "(0,0,0)";
  const sizeMatch = t.match(/(?:tama[ñn]o|radio)\s*(?:de\s*)?(\d+(?:\.\d+)?)/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : null;

  if (/\bcubo\b/.test(t)) {
    return { label: "crear cubo", code: `bpy.ops.mesh.primitive_cube_add(size=${size ?? 2}, location=${loc})` };
  }
  if (/\besfera\b/.test(t)) {
    return { label: "crear esfera", code: `bpy.ops.mesh.primitive_uv_sphere_add(radius=${size ?? 1}, location=${loc})` };
  }
  if (/\bcilindro\b/.test(t)) {
    return { label: "crear cilindro", code: `bpy.ops.mesh.primitive_cylinder_add(radius=${size ?? 1}, depth=2, location=${loc})` };
  }
  if (/\bcono\b/.test(t)) {
    return { label: "crear cono", code: `bpy.ops.mesh.primitive_cone_add(radius1=${size ?? 1}, depth=2, location=${loc})` };
  }
  if (/\bplano\b/.test(t)) {
    return { label: "crear plano", code: `bpy.ops.mesh.primitive_plane_add(size=${size ?? 2}, location=${loc})` };
  }

  return null;
}

// --- Modo "IA": Claude convierte la frase en código bpy ---
const BLENDER_CODEGEN_SYSTEM = `Convierte instrucciones en español (o cualquier idioma) en código Python para la API bpy de Blender.
Reglas estrictas:
1. Responde UNICAMENTE con codigo Python ejecutable. Nunca incluyas explicaciones, texto adicional ni bloques de markdown (nada de \`\`\`).
2. 'bpy' ya esta importado; no repitas 'import bpy'.
3. Si piden limpiar/borrar la escena usa: bpy.ops.object.select_all(action='SELECT') seguido de bpy.ops.object.delete().
4. Prefiere operadores de bpy.ops.mesh.primitive_* para formas simples.
5. Si la instruccion es ambigua, elige una interpretacion razonable y razonable en tamaño/posicion (unidades ~1-3).
6. Nunca borres la escena a menos que te lo pidan explicitamente.`;

async function naturalToCodeAI(text) {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system: BLENDER_CODEGEN_SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  const block = message.content.find((b) => b.type === "text");
  let code = block ? block.text : "";
  code = code.trim();
  if (code.startsWith("```")) {
    code = code.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return code;
}

const DELETE_INTENT = /\b(elimina|eliminar|borra|borrar|quita|quitar|remueve|remover)\b/i;

function findObjectNameInText(text, names) {
  const lower = text.toLowerCase();
  // nombres mas largos primero para evitar que "Cube" gane sobre "Cube.001"
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (name && lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

// Lista de motores disponibles + si están instalados (para poblar el selector).
app.get("/api/engines", (_req, res) => {
  res.json({ engines: ENGINES.map(enginePublicView) });
});

app.post("/api/natural", async (req, res) => {
  const { text, mode } = req.body || {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ status: "error", message: "Falta el campo 'text'" });
  }

  try {
    // Motor CLI enchufable (Claude Code, OpenCode, Hermes, ...)
    const engine = ENGINES.find((e) => e.id === mode && e.type === "cli");
    if (engine) {
      if (!resolveEngineCommand(engine)) {
        return res.status(400).json({
          status: "error",
          mode: engine.id,
          message: `El programa "${engine.command}" (${engine.label}) no está instalado o no está en el PATH. ${engine.install || ""}`,
        });
      }
      const t0 = Date.now();
      const raw = await runCliEngine(engine, buildCliPrompt(text));
      const code = extractCodeFromOutput(raw);
      if (!code) {
        return res.status(502).json({
          status: "error",
          mode: engine.id,
          message: "El motor no devolvió código utilizable.",
          raw: raw.slice(0, 4000),
        });
      }
      const result = await sendToBlender("execute_code", { code });
      const durationMs = Date.now() - t0;
      return res.json({ status: "success", mode: engine.id, code, result, durationMs });
    }

    if (mode === "rules") {
      // Borrado de un objeto puntual por nombre exacto, ej. "elimina Cube.001"
      if (DELETE_INTENT.test(text)) {
        const sceneInfo = await sendToBlender("get_scene_info", {});
        const names = (sceneInfo.result?.objects || []).map((o) => o.name);
        const match = findObjectNameInText(text, names);
        if (match) {
          const deleteCode = `import bpy\nobj = bpy.data.objects.get(${pyStr(match)})\nif obj is not None:\n    bpy.data.objects.remove(obj, do_unlink=True)\nprint('deleted')`;
          const result = await sendToBlender("execute_code", { code: deleteCode });
          return res.json({ status: "success", mode: "rules", action: `eliminar objeto: ${match}`, result });
        }
      }

      const action = rulesToAction(text);
      if (!action) {
        return res.json({
          status: "error",
          mode: "rules",
          message: "No reconoci esa instruccion con el modo de reglas. Proba con palabras como 'cubo', 'esfera', 'cilindro', 'barco', 'mariposa' o 'limpiar escena'.",
        });
      }
      const result = action.scriptKey ? await runScript(action.scriptKey) : await sendToBlender("execute_code", { code: action.code });
      return res.json({ status: "success", mode: "rules", action: action.label, code: action.code, result });
    }

    // mode === "ai" (default)
    if (!anthropic) {
      return res.status(400).json({
        status: "error",
        mode: "ai",
        message: "Falta configurar ANTHROPIC_API_KEY (variable de entorno o archivo .env) para usar el modo IA.",
      });
    }
    const code = await naturalToCodeAI(text);
    const result = await sendToBlender("execute_code", { code });
    res.json({ status: "success", mode: "ai", code, result });
  } catch (err) {
    console.error("[natural] error:", err);
    res.status(502).json({ status: "error", message: err.message || String(err) });
  }
});

app.listen(WEB_PORT, () => {
  console.log(`[web] Interfaz disponible en http://localhost:${WEB_PORT}`);
  console.log(`[web] Puente hacia Blender en ${BLENDER_HOST}:${BLENDER_PORT}`);
});
