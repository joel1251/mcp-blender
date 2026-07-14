# IMPLEMENTATION_PLAN

## Objetivo general
Estabilizar, documentar y dejar ejecutable el workspace completo `mcp-blender` sin cambiar funcionalidades de producto no existentes.

## Tareas

### 1. Definir arquitectura oficial (principal vs legacy)
- Objetivo: decidir si el flujo soportado sera `blender-mcp/` (Python) y/o flujo Node de raiz.
- Archivos involucrados: `README.md`, `server.mjs`, `blender-mcp/README.md`.
- Dificultad: Media.
- Dependencias: ninguna.
- Criterio de exito: existe una decision explicita y documentada; no hay ambiguedad para nuevos devs.

### 2. Normalizar documentacion de arranque
- Objetivo: asegurar que comandos y puertos documentados coincidan con el codigo real.
- Archivos involucrados: `README.md`, `config.json`, `blender-mcp/README.md`.
- Dificultad: Baja.
- Dependencias: Tarea 1.
- Criterio de exito: un desarrollador nuevo puede arrancar de cero sin adivinar valores.

### 3. Corregir ruta local hardcodeada
- Objetivo: eliminar ruta fija de otra maquina en `config.json`.
- Archivos involucrados: `config.json`.
- Dificultad: Baja.
- Dependencias: Tarea 1.
- Criterio de exito: la configuracion funciona en cualquier maquina sin editar paths de terceros.

### 4. Declarar dependencia Node faltante
- Objetivo: agregar dependencias directas usadas por el codigo (`zod`).
- Archivos involucrados: `package.json`, `package-lock.json`.
- Dificultad: Baja.
- Dependencias: ninguna.
- Criterio de exito: `node server.mjs` no falla por modulo faltante.

### 5. Unificar puertos entre componentes
- Objetivo: evitar desalineacion entre `9999` y `9876` segun arquitectura elegida.
- Archivos involucrados: `server.mjs`, `blender_socket_server.py`, `blender-mcp/addon.py`, `README.md`.
- Dificultad: Media.
- Dependencias: Tarea 1.
- Criterio de exito: cliente MCP, servidor y Blender se conectan sin cambios manuales de puerto en cada intento.

### 6. Corregir error de sintaxis en script de ejemplo
- Objetivo: reparar `make_shrimp_detailed.py` para que ejecute en Blender.
- Archivos involucrados: `make_shrimp_detailed.py`.
- Dificultad: Baja.
- Dependencias: ninguna.
- Criterio de exito: el script corre en Blender sin SyntaxError.

### 7. Resolver modulo de configuracion de telemetria faltante
- Objetivo: definir estrategia para `src/blender_mcp/config.py` (crear plantilla local, fallback robusto o desactivar).
- Archivos involucrados: `blender-mcp/src/blender_mcp/telemetry.py`, `blender-mcp/.gitignore`, documentacion.
- Dificultad: Media.
- Dependencias: Tarea 1.
- Criterio de exito: herramientas con `@telemetry_tool` no generan errores internos por import faltante.

### 8. Alinear versionado interno
- Objetivo: sincronizar version en `__init__.py` con `pyproject.toml`.
- Archivos involucrados: `blender-mcp/src/blender_mcp/__init__.py`, `blender-mcp/pyproject.toml`.
- Dificultad: Baja.
- Dependencias: ninguna.
- Criterio de exito: una sola version fuente consistente.

### 9. Limpiar metadata placeholder
- Objetivo: reemplazar autor y URLs placeholder por metadatos reales o marcarlos como pendientes.
- Archivos involucrados: `blender-mcp/pyproject.toml`.
- Dificultad: Baja.
- Dependencias: confirmacion del owner/proyecto.
- Criterio de exito: metadatos no confunden ni apuntan a repos inexistentes.

### 10. Definir estrategia de dependencias Python
- Objetivo: decidir si se provee `requirements.txt` complementario o se estandariza en `uv`.
- Archivos involucrados: `blender-mcp/pyproject.toml`, `blender-mcp/uv.lock`, posible `requirements.txt`.
- Dificultad: Baja.
- Dependencias: Tarea 1.
- Criterio de exito: instalacion Python repetible en entornos limpios.

### 11. Crear verificacion minima de entorno
- Objetivo: agregar checklist/script de smoke para validar Blender abierto, puerto y conexion MCP.
- Archivos involucrados: scripts de raiz o `blender-mcp/`, `README.md`.
- Dificultad: Media.
- Dependencias: Tareas 3, 4, 5.
- Criterio de exito: diagnostico rapido de problemas de setup en menos de 2 minutos.

### 12. Revisar seguridad de ejecucion de codigo
- Objetivo: documentar y/o limitar riesgos de `execute_code`/`execute_blender_code`.
- Archivos involucrados: `blender_socket_server.py`, `blender-mcp/addon.py`, `blender-mcp/src/blender_mcp/server.py`, `README.md`.
- Dificultad: Alta.
- Dependencias: Tarea 1.
- Criterio de exito: riesgos y mitigaciones explicitados; comportamiento esperado definido.

### 13. Estandarizar configuraciones MCP de clientes
- Objetivo: proveer ejemplos validados para Claude Desktop, Cursor y VS Code.
- Archivos involucrados: `README.md`, `config.json`.
- Dificultad: Baja.
- Dependencias: Tareas 1, 3.
- Criterio de exito: configuraciones copiables y funcionales en Windows/macOS/Linux (con notas cuando aplique).

### 14. Eliminar ruido en raiz del repo
- Objetivo: clasificar o remover archivos vacios (`cd`, `mkdir`, `pip`) y definir si son artefactos accidentales.
- Archivos involucrados: `cd`, `mkdir`, `pip`, `README.md`.
- Dificultad: Baja.
- Dependencias: confirmacion del equipo.
- Criterio de exito: raiz limpia y sin archivos ambiguos.

### 15. Preparar fase de pruebas de integracion
- Objetivo: ejecutar pruebas manuales guiadas end-to-end (cliente MCP -> Blender) para ambos flujos soportados.
- Archivos involucrados: documentacion de pruebas, `README.md`.
- Dificultad: Media.
- Dependencias: Tareas 3 a 13.
- Criterio de exito: evidencia de casos felices y errores esperados con pasos reproducibles.
