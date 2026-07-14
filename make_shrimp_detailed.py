
import bpy
import math
from mathutils import Vector, Matrix
import bmesh

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def deg(r):
    return math.radians(r)

def mesh_from_pydata(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob

def solid_cylinder(name, radius=0.1, depth=1.0, segments=16, loc=(0, 0, 0)):
    h = depth
    cx, cy, cz = loc
    half = h / 2

    verts = []
    faces = []

    # bottom cap (z = -half)
    center_bot = len(verts)
    verts.append((cx, cy, cz - half))
    for i in range(segments):
        a = i / segments * 2 * math.pi
        verts.append((cx + radius * math.cos(a), cy + radius * math.sin(a), cz - half))

    # top cap (z = +half)
    center_top = len(verts)
    verts.append((cx, cy, cz + half))
    for i in range(segments):
        a = i / segments * 2 * math.pi
        verts.append((cx + radius * math.cos(a), cy + radius * math.sin(a), cz + half))

    # bottom fan faces
    for i in range(segments):
        nxt = (i + 1) % segments
        faces.append((center_bot, 1 + nxt, 1 + i))

    # side quads
    for i in range(segments):
        nxt = (i + 1) % segments
        faces.append((1 + i, 1 + nxt, 1 + segments + nxt, 1 + segments + i))

    # top fan faces
    for i in range(segments):
        nxt = (i + 1) % segments
        faces.append((center_top, 1 + segments + i, 1 + segments + nxt))

    return mesh_from_pydata(name, verts, faces)

def add_segment(name, radius, depth, location, rotation):
    obj = solid_cylinder(name, radius=radius, depth=depth, segments=12, loc=location)
    obj.rotation_euler = rotation
    return obj

# === HEAD (CEPHALOTHORAX) ===
head = mesh_from_pydata('head', [], [])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(0, 0, 0))
head = bpy.context.active_object
head.name = 'head'
head.scale = (1.4, 1.0, 0.8)
bpy.context.view_layer.objects.active = head
bpy.ops.object.transform_apply(scale=True)

# === ROSTRUM ===
rostrum = solid_cylinder('rostrum', radius=0.03, depth=0.8, segments=8, loc=(0.7, 0, 0.1))
rostrum.rotation_euler = (0, deg(90), 0)

# === EYES ===
left_eye = mesh_from_pydata('left_eye', [], [])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, location=(0.25, 0.25, 0.15))
left_eye = bpy.context.active_object
left_eye.name = 'left_eye'

right_eye = mesh_from_pydata('right_eye', [], [])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, location=(0.25, -0.25, 0.15))
right_eye = bpy.context.active_object
right_eye.name = 'right_eye'

# === BODY SEGMENTS ===
segments = [
    ('seg1', 0.22, 0.25, (0.35, 0, 0), (0, deg(90), 0)),
    ('seg2', 0.20, 0.25, (0.6, 0, -0.05), (0, deg(85), 0)),
    ('seg3', 0.18, 0.25, (0.83, 0, -0.12), (0, deg(80), 0)),
    ('seg4', 0.15, 0.25, (1.04, 0, -0.22), (0, deg(75), 0)),
    ('seg5', 0.12, 0.25, (1.22, 0, -0.35), (0, deg(70), 0)),
    ('seg6', 0.09, 0.25, (1.36, 0, -0.5), (0, deg(65), 0)),
]

segment_objs = []
for name, r, d, loc, rot in segments:
    obj = add_segment(name, r, d, loc, rot)
    segment_objs.append(obj)

# === TAIL FAN ===
tails = [
    ('tail_center', (0.3, 0.08, 0.15), (1.55, 0, -0.62), (0, deg(60), 0)),
    ('tail_left1', (0.28, 0.07, 0.13), (1.53, 0.15, -0.63), (0, deg(60), deg(10))),
    ('tail_right1', (0.28, 0.07, 0.13), (1.53, -0.15, -0.63), (0, deg(60), deg(-10))),
    ('tail_left2', (0.22, 0.06, 0.11), (1.50, 0.28, -0.64), (0, deg(60), deg(20))),
    ('tail_right2', (0.22, 0.06, 0.11), (1.50, -0.28, -0.64), (0, deg(60), deg(-20))),
]

tail_objs = []
for name, scl, loc, rot in tails:
    obj = mesh_from_pydata(name, [], [])
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scl
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)
    # Extrude for thickness
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={"value": (0, 0, 0.02)})
    bpy.ops.object.mode_set(mode='OBJECT')
    tail_objs.append(obj)

# === WALKING LEGS ===
legs = []
leg_data = [
    (0.2, 0.22, -0.2, deg(40)),
    (0.2, -0.22, -0.2, deg(-40)),
    (0.4, 0.22, -0.22, deg(45)),
    (0.4, -0.22, -0.22, deg(-45)),
    (0.6, 0.22, -0.24, deg(50)),
    (0.6, -0.22, -0.24, deg(-50)),
    (0.78, 0.22, -0.26, deg(55)),
    (0.78, -0.22, -0.26, deg(-55)),
    (0.95, 0.22, -0.28, deg(60)),
    (0.95, -0.22, -0.28, deg(-60)),
]

for i, (x, y, z, angle_z) in enumerate(leg_data):
    obj = solid_cylinder(f'leg_{i}', radius=0.015, depth=0.4, segments=8, loc=(x, y, z))
    obj.rotation_euler = (0, deg(30), angle_z)
    legs.append(obj)

# === ANTENNAE ===
antenna_data = [
    ('ant_long_L', 0.012, 1.8, (0.6, 0.15, 0.2), (deg(-20), 0, deg(-30))),
    ('ant_long_R', 0.012, 1.8, (0.6, -0.15, 0.2), (deg(-20), 0, deg(30))),
    ('ant_short_L', 0.018, 0.6, (0.55, 0.12, 0.18), (deg(-10), 0, deg(-20))),
    ('ant_short_R', 0.018, 0.6, (0.55, -0.12, 0.18), (deg(-10), 0, deg(20))),
]

ant_objs = []
for name, r, d, loc, rot in antenna_data:
    obj = solid_cylinder(name, radius=r, depth=d, segments=8, loc=loc)
    obj.rotation_euler = rot
    ant_objs.append(obj)

# === JOIN ALL ===
all_objs = [head, rostrum, left_eye, right_eye] + segment_objs + tail_objs + legs + ant_objs
bpy.ops.object.select_all(action='DESELECT')
for o in all_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.join()

shrimp = bpy.context.active_object
shrimp.name = 'shrimp_detailed'

# Center at world origin
shrimp.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

bm = bmesh.new()
bm.from_mesh(shrimp.data)
min_v = Vector((min(v.co.x for v in bm.verts),
                min(v.co.y for v in bm.verts),
                min(v.co.z for v in bm.verts)))
max_v = Vector((max(v.co.x for v in bm.verts),
                max(v.co.y for v in bm.verts),
                max(v.co.z for v in bm.verts)))
center = (min_v + max_v) * 0.5
print('Center:', [round(c, 4) for c in center])
for v in bm.verts:
    v.co -= center
bm.to_mesh(shrimp.data)
bm.free()

shrimp.location = (0, 0, 0)
shrimp.rotation_euler = (0, 0, 0)

print('Shrimp created:', shrimp.name)
print('Vertices:', len(shrimp.data.vertices))
print('Polys:', len(shrimp.data.polygons))
print('Dimensions:', [round(d,4) for d in shrimp.dimensions])
