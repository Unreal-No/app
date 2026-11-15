"""
ทดลองความเป็นไปได้ของ "โรงอบโมเดล" ด้วย Blender แบบไม่มีหน้าจอ (ดู docs/ART_PIPELINE.md)

สร้างหัว+ลำตัว+ขาของสัตว์สี่ขาท่านั่งจากทรงรี แล้วหลอมเป็น mesh เดียวด้วย voxel remesh
จากนั้นทำให้เนียน ลดจำนวนโพลิกอน และส่งออกเป็น GLB

ใช้งาน:  pip install bpy  แล้ว  python fuse_spike.py out.glb
(จะได้ภาพตัวอย่าง out.png ที่เรนเดอร์ด้วย Cycles บน CPU มาด้วย)
"""
import math
import sys
import time

import bpy

out_path = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "fused.glb"
started = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)


def ellipsoid(name, center, radii, rot_x=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=1.0, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = radii
    obj.rotation_euler = (rot_x, 0.0, 0.0)
    return obj


# สัดส่วนโดยประมาณของตัวเอกในท่านั่ง (หน่วยเดียวกับ packages/creature; Blender ใช้แกน Z ชี้ขึ้น)
R = 0.44
parts = [
    ellipsoid("skull", (0, 0.02, 0.86), (R * 1.15, R * 0.94, R * 0.92)),
    ellipsoid("muzzle", (0, -0.33, 0.74), (0.15, 0.12, 0.1)),
    ellipsoid("torso", (0, 0.06, 0.3), (0.25, 0.3, 0.26), rot_x=math.radians(-45)),
    ellipsoid("chest", (0, -0.14, 0.34), (0.16, 0.1, 0.13)),
]
for side in (-1, 1):
    parts.append(ellipsoid(f"cheek{side}", (side * 0.4, -0.05, 0.72), (0.17, 0.2, 0.17)))
    parts.append(ellipsoid(f"haunch{side}", (side * 0.23, 0.08, 0.14), (0.13, 0.17, 0.15)))
    parts.append(ellipsoid(f"hindpaw{side}", (side * 0.27, -0.2, 0.06), (0.09, 0.14, 0.06)))
    parts.append(ellipsoid(f"foreleg{side}", (side * 0.11, -0.2, 0.16), (0.08, 0.085, 0.17)))
    parts.append(ellipsoid(f"forepaw{side}", (side * 0.11, -0.25, 0.05), (0.095, 0.13, 0.06)))

bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "mochi_fused"

# หลอมเป็นเนื้อเดียว: voxel remesh → เกลี่ยให้เนียน → ลดโพลิกอน
remesh = body.modifiers.new("remesh", "REMESH")
remesh.mode = "VOXEL"
remesh.voxel_size = 0.016
remesh.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier=remesh.name)

smooth = body.modifiers.new("smooth", "SMOOTH")
smooth.factor = 0.8
smooth.iterations = 12
bpy.ops.object.modifier_apply(modifier=smooth.name)
voxel_tris = sum(len(p.vertices) - 2 for p in body.data.polygons)

decimate = body.modifiers.new("decimate", "DECIMATE")
decimate.ratio = 0.12
bpy.ops.object.modifier_apply(modifier=decimate.name)
bpy.ops.object.shade_smooth()

tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_yup=True, export_apply=True)
print(
    f"RESULT blender={bpy.app.version_string} voxel_tris={voxel_tris} final_tris={tris} "
    f"verts={len(body.data.vertices)} seconds={time.time() - started:.1f} out={out_path}"
)


def preview(path):
    """เรนเดอร์ภาพตัวอย่างด้วย Cycles (ใช้ CPU ได้ ไม่ต้องมี GPU/จอ)"""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.render.resolution_x = scene.render.resolution_y = 480
    scene.render.film_transparent = True
    material = bpy.data.materials.new("plush")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.93, 0.92, 0.98, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    body.data.materials.append(material)
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.82, 0.8, 0.95, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world
    bpy.ops.object.light_add(type="AREA", location=(-1.2, -2.0, 2.4))
    light = bpy.context.active_object
    light.data.energy = 220
    light.data.size = 2.5
    light.rotation_euler = (math.radians(50), 0, math.radians(-30))
    bpy.ops.object.camera_add(location=(1.3, -3.3, 1.0), rotation=(math.radians(83), 0, math.radians(21)))
    scene.camera = bpy.context.active_object
    scene.camera.data.lens = 70
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


render_started = time.time()
preview(out_path.replace(".glb", ".png"))
print(f"RENDER seconds={time.time() - render_started:.1f}")
