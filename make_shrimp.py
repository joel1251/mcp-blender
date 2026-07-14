
import bpy
import math
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# ---------- helpers ----------
def make_mesh(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob

def tube_between_points(pts, r=0.05, segs=8, name='tube'):
    if len(pts) < 2:
        return None
    verts, faces = [], []
    for p in pts:
        idx = len(verts)
        for j in range(segs):
            a = j / segs * 2 * math.pi
            verts.append((p.x + r*math.cos(a),
                          p.y + r*math.sin(a),
                          p.z))
        if idx > 0:
            for j in range(segs):
                j1 = (j + 1) % segs
                faces.append((idx+j, idx+j1, idx-segs+j1, idx-segs+j))
    ob = make_mesh(name, verts, faces)
    return ob

# ---------- body (axis along X) ----------
# Shrimp body: thicker at head, tapers across segments toward tail
body_radius = 0.09
head_radius = 0.12
segments = 8
length = 1.2
step = length / segments

verts = []
FACES_PER_SEG = 10  # radial resolution

# Build body centerline points (profile from head to tail)
profile = []
for i in range(segments + 1):
    t = i / segments
    z = -length/2 + t * length
    if t < 0.25:
        r = head_radius
    elif t < 0.7:
        r = body_radius * (1 - (t - 0.25) * 0.6)
    else:
        r = body_radius * (1 - (t - 0.25) * 0.6) * 0.7
    profile.append(Vector((0, 0, z + 0.1)))  # shift so head area is at front

# Build mesh
verts = []
faces = []
for p in profile:
    idx = len(verts)
    for j in range(FACES_PER_SEG):
        a = j / FACES_PER_SEG * 2 * math.pi
        verts.append((p.x + r*math.cos(a),
                      p.y + r*math.sin(a),
                      p.z))
    if idx > 0:
        for j in range(FACES_PER_SEG):
            j1 = (j + 1) % FACES_PER_SEG
            faces.append((idx+j, idx+j1, idx-FACES_PER_SEG+j1, idx-FACES_PER_SEG+j))

# caps
faces.append(tuple(range(FACES_PER_SEG-1, -1, -1)))
faces.append(tuple(range(len(verts)-FACES_PER_SEG, len(verts))))
body = make_mesh('body', verts, faces)

# ---------- tail fan ----------
# Three triangular tail segments in XY at the rear
tail_base = 0.3  # z
tail_pts = [
    Vector((0, 0, tail_base)),
    Vector((0.35, 0, tail_base - 0.05)),
    Vector((0.28, 0.28, tail_base + 0.08)),
    Vector((0, 0, tail_base + 0.15)),
    Vector((0, 0.22, tail_base + 0.12)),
    Vector((0, 0.18, tail_base + 0.05)),
    Vector((0, 0, tail_base - 0.05)),
    Vector((-0.22, 0.18, tail_base + 0.05)),
    Vector((-0.28, 0.28, tail_base + 0.08)),
]
# Build fan as triangle fan (single-sided fan shape extruded thin)
fan_verts, fan_faces = [], []
zf, zb = 0.01, -0.01
for p in tail_pts:
    fan_verts.append((p.x, p.y, zf))
    fan_verts.append((p.x, p.y, zb))
n = len(tail_pts)
for i in range(1, n-1):
    fan_faces.append((0, i, i+1))
    fan_faces.append((1, n+1, n+i+1, n+i))
    fan_faces.append((i, i+1, n+i+1, n+i))
tail = make_mesh('tail', fan_verts, fan_faces)

# ---------- head ----------
head = make_mesh('head', [], [])
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, location=(0, 0, -0.5))
head = bpy.context.active_object
head.scale = (0.8, 0.8, 0.7)
bpy.ops.object.transform_apply(scale=True)

# ---------- eyes (two tiny spheres) ----------
eyes = []
for sx in [0.08, -0.08]:
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(sx, 0.02, -0.55))
    eyes.append(bpy.context.active_object)

# ---------- legs (small tubes along body) ----------
legs = []
leg_y = 0.09  # offset from body axis
leg_z_start = -0.35
leg_z_end = 0.15
leg_r = 0.012
spacing = 0.18

# Right legs
z = leg_z_start
while z >= leg_z_end:
    pts = [Vector((0, -leg_y*0.3, z)), Vector((0, -leg_y, z)), Vector((0.08, -0.14, z-0.04))]
    tub = tube_between_points(pts, r=leg_r, segs=6, name='leg_r')
    if tub:
        legs.append(tub)
    z -= spacing

# Left legs
z = leg_z_start
while z >= leg_z_end:
    pts = [Vector((0, leg_y*0.3, z)), Vector((0, leg_y, z)), Vector((0.08, 0.14, z-0.04))]
    tub = tube_between_points(pts, r=leg_r, segs=6, name='leg_l')
    if tub:
        legs.append(tub)
    z -= spacing

# ---------- antennae ----------
ant_r = 0.012
# Right antenna (curving up and out)
antR_pts = [
    Vector((0.08, 0, -0.55)),
    Vector((0.12, 0.04, -0.7)),
    Vector((0.22, 0.15, -0.85)),
    Vector((0.38, 0.32, -1.0)),
    Vector((0.55, 0.5, -1.05)),
]
antR = tube_between_points(antR_pts, r=ant_r, segs=8, name='antenna_R')

# Left antenna
antL_pts = [
    Vector((-0.08, 0, -0.55)),
    Vector((-0.12, 0.04, -0.7)),
    Vector((-0.22, 0.15, -0.85)),
    Vector((-0.38, 0.32, -1.0)),
    Vector((-0.55, 0.5, -1.05)),
]
antL = tube_between_points(antL_pts, r=ant_r, segs=8, name='antenna_L')

# ---------- join ----------
all_objs = [body, tail, head] + eyes + legs + [antR, antL]
bpy.ops.object.select_all(action='DESELECT')
for o in all_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()

shrimp = bpy.context.active_object
shrimp.name = 'shrimp'

# Center at origin
import bmesh
from mathutils import Matrix

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
for v in bm.verts:
    v.co -= center
bm.to_mesh(shrimp.data)
bm.free()

shrimp.location = (0, 0, 0)
shrimp.rotation_euler = (0, 0, 0)

print('Shrimp created:', shrimp.name)
print('Dimensions:', [round(d,4) for d in shrimp.dimensions])
print('Vertices:', len(shrimp.data.vertices))
print('Polys:', len(shrimp.data.polygons))
