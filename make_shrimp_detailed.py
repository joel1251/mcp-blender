
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

def hull_loft(name, stations, bow_extra=0.3, stern_extra=0.3):
    """Builds a canoe-like hull by lofting triangular (keel + two gunwale) rings
    along X, then closing both ends with a pointed tip."""
    verts = []
    faces = []
    ring_start = []

    for (x, hw, bz, tz) in stations:
        ring_start.append(len(verts))
        verts.append((x, 0, bz))     # keel (bottom)
        verts.append((x, hw, tz))    # left gunwale (top)
        verts.append((x, -hw, tz))   # right gunwale (top)

    last = stations[-1]
    first = stations[0]
    bow_tip = len(verts)
    verts.append((last[0] + bow_extra, 0, (last[2] + last[3]) / 2))
    stern_tip = len(verts)
    verts.append((first[0] - stern_extra, 0, (first[2] + first[3]) / 2))

    for i in range(len(stations) - 1):
        a = ring_start[i]
        b = ring_start[i + 1]
        faces.append((a + 0, b + 0, b + 1, a + 1))  # bottom-left
        faces.append((a + 1, b + 1, b + 2, a + 2))  # deck/top
        faces.append((a + 2, b + 2, b + 0, a + 0))  # bottom-right

    a = ring_start[0]
    faces.append((stern_tip, a + 1, a + 0))
    faces.append((stern_tip, a + 2, a + 1))
    faces.append((stern_tip, a + 0, a + 2))

    a = ring_start[-1]
    faces.append((bow_tip, a + 0, a + 1))
    faces.append((bow_tip, a + 1, a + 2))
    faces.append((bow_tip, a + 2, a + 0))

    return mesh_from_pydata(name, verts, faces)

# === HULL ===
hull_stations = [
    (-1.0, 0.30, -0.35, 0.15),
    (-0.5, 0.45, -0.45, 0.20),
    (0.0, 0.50, -0.50, 0.22),
    (0.5, 0.42, -0.40, 0.20),
    (1.0, 0.25, -0.20, 0.15),
]
hull = hull_loft('hull', hull_stations, bow_extra=0.35, stern_extra=0.30)

# === CABIN ===
cabin = mesh_from_pydata('cabin', [], [])
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.25, 0, 0.42))
cabin = bpy.context.active_object
cabin.name = 'cabin'
cabin.scale = (0.45, 0.55, 0.22)
bpy.context.view_layer.objects.active = cabin
bpy.ops.object.transform_apply(scale=True)

# === MAST ===
mast_height = 1.6
mast = solid_cylinder('mast', radius=0.03, depth=mast_height, segments=10,
                       loc=(0.05, 0, 0.24 + mast_height / 2))

# === BOOM (horizontal spar near the deck) ===
boom = solid_cylinder('boom', radius=0.02, depth=0.55, segments=8, loc=(0.32, 0, 0.42))
boom.rotation_euler = (0, deg(90), 0)

# === MAIN SAIL (triangle) ===
sail_verts = [
    (0.06, 0, 0.42),
    (0.06, 0, 1.75),
    (0.85, 0, 0.45),
]
sail_faces = [(0, 1, 2), (0, 2, 1)]
sail = mesh_from_pydata('sail', sail_verts, sail_faces)

# === JIB (small foresail) ===
jib_verts = [
    (0.05, 0, 1.0),
    (0.05, 0, 1.6),
    (-0.9, 0, 0.28),
]
jib_faces = [(0, 1, 2), (0, 2, 1)]
jib = mesh_from_pydata('jib', jib_verts, jib_faces)

# === FLAG ===
flag_verts = [
    (0.05, 0, mast_height + 0.24),
    (0.05, 0, mast_height + 0.36),
    (0.28, 0, mast_height + 0.30),
]
flag_faces = [(0, 1, 2), (0, 2, 1)]
flag = mesh_from_pydata('flag', flag_verts, flag_faces)

# === JOIN ALL ===
all_objs = [hull, cabin, mast, boom, sail, jib, flag]
bpy.ops.object.select_all(action='DESELECT')
for o in all_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = hull
bpy.ops.object.join()

boat = bpy.context.active_object
boat.name = 'boat'

# Center at world origin
boat.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

bm = bmesh.new()
bm.from_mesh(boat.data)
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
bm.to_mesh(boat.data)
bm.free()

boat.location = (0, 0, 0)
boat.rotation_euler = (0, 0, 0)

print('Boat created:', boat.name)
print('Vertices:', len(boat.data.vertices))
print('Polys:', len(boat.data.polygons))
print('Dimensions:', [round(d, 4) for d in boat.dimensions])
