"""
ตัวอย่างชุดชิ้นส่วน 3D สำหรับ Mochimon — รันใน Blender หรือ Python ที่มี bpy:

    blender --background --python example_parts.py -- ./example-parts.glb
    python example_parts.py ./example-parts.glb          (ถ้าติดตั้ง bpy ผ่าน pip)

ข้อกำหนดย่อ (ฉบับเต็ม: docs/PARTS_GUIDE.md) — พิกัดใน Blender (Z ชี้ขึ้น):
- node (Empty) ชื่อ `<ช่อง>.<รูปทรง>` เช่น ears.point, horns.spiral.center, wings.bat, tail.fluffy
- origin ของ node = จุดต่อกับตัว, ชิ้นคู่ทำเฉพาะฝั่งขวา (+X)
- หู/เขางอกขึ้น +Z · ปีกกางไปทาง +X · หางยื่นไปด้านหลัง +Y · หน้าสัตว์หันไปทาง −Y
- หน่วย: หู/เขา 1 = รัศมีหัว · ปีก 1 = ความยาวปีก · หาง 1 = ความยาวหาง
- ชื่อ material: skin / inner / accent / membrane / texture (+ `_nofur` = ไม่ใส่ขน)
"""
import math
import sys

import bpy
import bmesh


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgba=(1, 1, 1, 1)):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
    return m


def node(name):
    """Empty ที่เป็นจุดต่อของชิ้นส่วน"""
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    return empty


def mesh_object(name, bm, mat, parent):
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def star_prism(points, outer, inner, depth, height_axis="z"):
    """ดาวแบนหนา `depth` ตั้งอยู่บนระนาบ XZ (ยืนขึ้นตามแกน Z) ฐานแตะ origin"""
    bm = bmesh.new()
    verts_front, verts_back = [], []
    for i in range(points * 2):
        a = math.pi / 2 + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        x, z = math.cos(a) * r, math.sin(a) * r + outer
        verts_front.append(bm.verts.new((x, -depth / 2, z)))
        verts_back.append(bm.verts.new((x, depth / 2, z)))
    bm.faces.new(verts_front[::-1])
    bm.faces.new(verts_back)
    n = len(verts_front)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((verts_front[i], verts_front[j], verts_back[j], verts_back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def uv_sphere(radius, scale=(1, 1, 1), offset=(0, 0, 0), segments=24, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    for v in bm.verts:
        v.co.x = v.co.x * scale[0] + offset[0]
        v.co.y = v.co.y * scale[1] + offset[1]
        v.co.z = v.co.z * scale[2] + offset[2]
    return bm


def cylinder(r1, r2, height, offset=(0, 0, 0), segments=16):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r1, radius2=r2, depth=height)
    for v in bm.verts:
        v.co.z += height / 2 + offset[2]
        v.co.x += offset[0]
        v.co.y += offset[1]
    return bm


def wing_lobe(length, width, angle, thickness=0.02):
    """กลีบปีกผีเสื้อแบนในระนาบ XZ เริ่มจาก origin กางไปทาง +X"""
    bm = bmesh.new()
    front, back = [], []
    steps = 18
    for i in range(steps + 1):
        t = i / steps
        a = t * math.pi
        x = math.sin(a / 2) * length * (0.15 + 0.85 * math.sin(a))
        z = math.cos(a) * width * 0.5 + math.sin(a) * width * 0.3
        rx = x * math.cos(angle) - z * math.sin(angle)
        rz = x * math.sin(angle) + z * math.cos(angle)
        front.append(bm.verts.new((rx, -thickness / 2, rz)))
        back.append(bm.verts.new((rx, thickness / 2, rz)))
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    for i in range(len(front)):
        j = (i + 1) % len(front)
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build():
    skin = material("skin")
    inner = material("inner")
    accent = material("accent")
    membrane = material("membrane")
    cap = material("texture_mushroom", (0.93, 0.32, 0.36, 1))
    dots = material("texture_dots", (1, 0.97, 0.9, 1))

    # หูรูปดาว (แทน "หูแหลม") — ด้านนอกสีตัว ด้านในสีชมพู
    ears = node("ears.point")
    mesh_object("ear_star", star_prism(5, 0.42, 0.2, 0.12), skin, ears)
    inner_star = mesh_object("ear_star_inner", star_prism(5, 0.3, 0.14, 0.04), inner, ears)
    inner_star.location = (0, -0.07, 0.1)

    # เขาเห็ดเดี่ยวกลางหน้าผาก (แทน "เขาเกลียว") — ใช้สีจากไฟล์ (texture)
    horn = node("horns.spiral.center")
    mesh_object("stem", cylinder(0.09, 0.07, 0.3), accent, horn)
    mesh_object("cap", uv_sphere(0.24, (1, 1, 0.55), (0, 0, 0.32)), cap, horn)
    for i in range(5):
        a = i * 2 * math.pi / 5
        mesh_object(f"dot{i}", uv_sphere(0.045, offset=(math.cos(a) * 0.17, math.sin(a) * 0.17, 0.4), segments=8, rings=6), dots, horn)

    # ปีกผีเสื้อ (แทน "ปีกค้างคาว")
    wings = node("wings.bat")
    mesh_object("upper", wing_lobe(1.0, 0.7, 0.35), membrane, wings)
    mesh_object("lower", wing_lobe(0.65, 0.45, -0.55), membrane, wings)

    # หางกังหันดอกไม้ (แทน "หางฟู") — ก้านยื่นไปด้านหลัง (+Y) ปลายเป็นดาว
    tail = node("tail.fluffy")
    rod = cylinder(0.07, 0.05, 0.75)
    for v in rod.verts:
        v.co.y, v.co.z = v.co.z, -v.co.y  # หมุนให้ยื่นไปตามแกน Y
    mesh_object("rod", rod, skin, tail)
    flower = star_prism(6, 0.28, 0.16, 0.08)
    for v in flower.verts:
        v.co.z -= 0.28
        v.co.y += 0.82
    mesh_object("flower", flower, skin, tail)


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, use_selection=False)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    out = args[0] if args else "example-parts.glb"
    reset()
    build()
    export(out)
    print("wrote", out)
