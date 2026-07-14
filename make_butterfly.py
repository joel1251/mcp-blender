
import bpy
import math
import mathutils
from mathutils import Vector

# === CLEAR SCENE ===
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# === BODY ===
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, segments=12, location=(0, 0, 0))
body = bpy.context.active_object
body.name = 'body'
body.scale = (0.7, 0.7, 3.0)
bpy.ops.object.transform_apply(scale=True)
for v in body.data.vertices:
    f = abs(v.co.z) * 0.2
    v.co.x *= (1 - f)
    v.co.y *= (1 - f)

# === WINGS ===
def make_wing_shape(pts_2d):
    verts = []
    faces = []
    zf, zb = 0.025, -0.025
    for i, (x, y) in enumerate(pts_2d):
        verts.append((x, y, zf))
    for i, (x, y) in enumerate(pts_2d):
        verts.append((x, y, zb))
    n = len(pts_2d) - 1
    for i in range(1, n - 1):
        faces.append((0, i, i + 1))
        faces.append((n + 1, n + i + 1, n + i))
    for i in range(n):
        faces.append((i, i + 1, n + i + 1, n + i))
    return verts, faces

# Shape definitions
top_shape = [
    (0.05, 0.0),
    (0.18, 0.1),
    (0.45, 0.3),
    (0.75, 0.55),
    (0.95, 0.75),
    (0.9, 0.6),
    (0.7, 0.25),
    (0.4, 0.02),
]
bot_shape = [
    (0.05, 0.0),
    (0.16, -0.07),
    (0.4,  -0.28),
    (0.6,  -0.52),
    (0.55, -0.58),
    (0.48, -0.48),
    (0.3,  -0.2),
    (0.14, -0.02),
]

def add_wing_mesh(name, verts, faces, loc, rot):
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.collection.objects.link(obj)
    return obj

angle = math.radians(45)
wing_defs = [
    ("top_left",    top_shape, (-1, 0.0, 0.15), (0,  angle, 0)),
    ("top_right",   top_shape, ( 1, 0.0, 0.15), (0, -angle, 0)),
    ("bottom_left", bot_shape, (-1, 0.0,-0.1),  (0, -angle, 0)),
    ("bottom_right",bot_shape, ( 1, 0.0,-0.1),  (0,  angle, 0)),
]

wing_objs = []
for name, shape, loc, rot in wing_defs:
    v, f = make_wing_shape(shape)
    if "right" in name:
        v = [(-x, y, z) for (x, y, z) in v]
    obj = add_wing_mesh(name, v, f, loc, rot)
    wing_objs.append(obj)

# === ANTENNAE (poly-line -> mesh tube substitute) ===
# Build thin cylinder meshes along polyline points
def make_antenna(name, side):
    pts = [
        Vector((0.06*side, 0.0,  0.42)),
        Vector((0.1*side,  0.05, 0.55)),
        Vector((side*0.3,  0.12, 0.7)),
        Vector((side*0.5,  0.25, 0.82)),
        Vector((side*0.72, 0.38, 0.88)),
    ]
    # Build mesh as a series of short cylinders between points
    verts = []
    faces = []
    r = 0.012
    for p in pts:
        # small ring at point
        base_idx = len(verts)
        for j in range(8):
            a = j / 8 * 2 * math.pi
            verts.append((p.x + r*math.cos(a), p.y + r*math.sin(a), p.z))
        if base_idx > 0:
            for j in range(8):
                j2 = (j + 1) % 8
                faces.append((base_idx + j, base_idx + j2,
                              base_idx - 8 + j2, base_idx - 8 + j))
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

ant_l = make_antenna("left_antenna", -1)
ant_r = make_antenna("right_antenna", 1)

# === JOIN ALL MESH OBJECTS ===
bpy.ops.object.select_all(action='DESELECT')
for obj in [body] + wing_objs + [ant_l, ant_r]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()

butterfly = bpy.context.active_object
butterfly.name = "butterfly"

# Center geometry
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
butterfly.location = (0, 0, 0)

print("Done! Butterfly created:", butterfly.name)
print("Dimensions:", [round(d, 4) for d in butterfly.dimensions])
print("Location:", [round(c, 4) for c in butterfly.location])
