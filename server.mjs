import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import net from "net";

const server = new McpServer({ name: "blender-mcp", version: "1.0.0" });

function sendToBlender(code) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(9999, "localhost", () => {
      client.write(JSON.stringify({ code }));
      client.end();
    });
    let data = "";
    client.on("data", (chunk) => { data += chunk; });
    client.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({ status: "ok" }); }
    });
    client.on("error", (e) => reject(e));
  });
}

server.tool("crear_cubo",
  { x: z.number().default(0), y: z.number().default(0), z: z.number().default(0), size: z.number().default(2) },
  async ({ x, y, z: zv, size }) => {
    const r = await sendToBlender(`bpy.ops.mesh.primitive_cube_add(size=${size}, location=(${x},${y},${zv}))`);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
);

server.tool("crear_esfera",
  { x: z.number().default(0), y: z.number().default(0), z: z.number().default(0), radio: z.number().default(1) },
  async ({ x, y, z: zv, radio }) => {
    const r = await sendToBlender(`bpy.ops.mesh.primitive_uv_sphere_add(radius=${radio}, location=(${x},${y},${zv}))`);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
);

server.tool("crear_cilindro",
  { x: z.number().default(0), y: z.number().default(0), z: z.number().default(0), radio: z.number().default(1), altura: z.number().default(2) },
  async ({ x, y, z: zv, radio, altura }) => {
    const r = await sendToBlender(`bpy.ops.mesh.primitive_cylinder_add(radius=${radio}, depth=${altura}, location=(${x},${y},${zv}))`);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
);

server.tool("limpiar_escena", {},
  async () => {
    const r = await sendToBlender(`bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()`);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
);

server.tool("ejecutar_python",
  { codigo: z.string() },
  async ({ codigo }) => {
    const r = await sendToBlender(codigo);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);