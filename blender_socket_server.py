import bpy
import socket
import threading
import json

PORT = 9999

def execute_code(code: str):
    try:
        exec(compile(code, "<mcp>", "exec"), {"bpy": bpy})
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def handle_client(conn):
    with conn:
        data = b""
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk
        try:
            msg = json.loads(data.decode())
            result = execute_code(msg.get("code", ""))
        except Exception as e:
            result = {"status": "error", "message": str(e)}
        conn.sendall(json.dumps(result).encode())

def start_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("localhost", PORT))
    server.listen(5)
    print(f"[MCP] Blender escuchando en puerto {PORT}")
    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()

class MCP_OT_StartServer(bpy.types.Operator):
    bl_idname = "mcp.start_server"
    bl_label = "Iniciar Servidor MCP"

    def execute(self, context):
        t = threading.Thread(target=start_server, daemon=True)
        t.start()
        self.report({'INFO'}, "Servidor MCP iniciado en puerto 9999")
        return {'FINISHED'}

class MCP_PT_Panel(bpy.types.Panel):
    bl_label = "MCP Server"
    bl_idname = "MCP_PT_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'MCP'

    def draw(self, context):
        self.layout.operator("mcp.start_server")

def register():
    bpy.utils.register_class(MCP_OT_StartServer)
    bpy.utils.register_class(MCP_PT_Panel)

def unregister():
    bpy.utils.unregister_class(MCP_OT_StartServer)
    bpy.utils.unregister_class(MCP_PT_Panel)

if __name__ == "__main__":
    register()