import * as THREE from 'three'

/** ทรงรี (ครึ่งแกน rx, ry, rz) */
export function ball(rx: number, ry = rx, rz = rx, w = 28, h = 18): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h)
  g.scale(rx, ry, rz)
  return g
}

/** ทรงรีที่ดัดรูปก่อนขยาย: fn แก้พิกัดบนทรงกลมหน่วย */
export function deformedBall(
  rx: number,
  ry: number,
  rz: number,
  fn: (v: THREE.Vector3) => void,
  w = 32,
  h = 22,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    fn(v)
    pos.setXYZ(i, v.x * rx, v.y * ry, v.z * rz)
  }
  g.computeVertexNormals()
  // SphereGeometry มี vertex ซ้ำที่ตะเข็บ — normal ที่คำนวณใหม่อาจไม่ต่อเนื่องเล็กน้อย ยอมรับได้กับ cel shading
  return g
}

/** แคปซูลตั้งตามแกน Y โดยปลายบนอยู่ที่จุดกำเนิดและยื่นลง (-Y) ยาว length */
export function hangingCapsule(r: number, length: number): THREE.BufferGeometry {
  const body = Math.max(0.001, length - r * 2)
  const g = new THREE.CapsuleGeometry(r, body, 6, 14)
  g.translate(0, -length / 2, 0)
  return g
}

/** แคปซูลตั้งขึ้น (+Y) จากจุดกำเนิด */
export function standingCapsule(r: number, length: number): THREE.BufferGeometry {
  const g = hangingCapsule(r, length)
  g.rotateX(Math.PI)
  return g
}

/** กรวยปลายมนตั้งขึ้น (+Y) จากฐานที่จุดกำเนิด โค้งไปทาง -Z ตาม bend */
export function bentCone(r: number, h: number, bend = 0, radial = 14): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, radial, 8)
  g.translate(0, h / 2, 0)
  if (bend !== 0) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / h
      pos.setZ(i, pos.getZ(i) - bend * h * t * t)
    }
    g.computeVertexNormals()
  }
  return g
}

/** แผ่นหนา ขอบมน จากรูปร่าง 2 มิติ (อยู่ในระนาบ XY กึ่งกลางความหนาที่ z=0) */
export function slab(shape: THREE.Shape, scale: number, thickness: number): THREE.BufferGeometry {
  const bevel = thickness * 0.45
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, thickness / scale - (bevel / scale) * 2),
    bevelEnabled: true,
    bevelThickness: bevel / scale,
    bevelSize: bevel / scale,
    bevelSegments: 2,
    curveSegments: 10,
  })
  g.translate(0, 0, -thickness / scale / 2 + bevel / scale)
  g.scale(scale, scale, scale)
  return g
}

export function featherWingShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0.1)
  s.bezierCurveTo(0.3, 0.44, 0.8, 0.52, 1.0, 0.22)
  s.quadraticCurveTo(0.96, 0.02, 0.78, -0.02)
  s.quadraticCurveTo(0.74, -0.17, 0.56, -0.14)
  s.quadraticCurveTo(0.5, -0.27, 0.32, -0.22)
  s.quadraticCurveTo(0.18, -0.28, 0, -0.14)
  s.closePath()
  return s
}

export function batWingShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0.06)
  s.quadraticCurveTo(0.2, 0.56, 0.44, 0.62)
  s.lineTo(1.0, 0.44)
  s.quadraticCurveTo(0.82, 0.2, 0.8, -0.08)
  s.quadraticCurveTo(0.64, 0.1, 0.52, -0.2)
  s.quadraticCurveTo(0.38, 0.0, 0.24, -0.22)
  s.quadraticCurveTo(0.14, -0.04, 0, -0.12)
  s.closePath()
  return s
}

export function finShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0.14)
  s.quadraticCurveTo(0.6, 0.34, 1.0, 0.08)
  s.quadraticCurveTo(0.7, -0.26, 0, -0.14)
  s.closePath()
  return s
}

export function petalShape(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
): THREE.Shape {
  const s = new THREE.Shape()
  s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, rot)
  return s
}

export function fanShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-0.1, 0)
  s.lineTo(-0.5, 0.72)
  s.quadraticCurveTo(-0.42, 1.0, -0.2, 0.9)
  s.quadraticCurveTo(0, 1.1, 0.2, 0.9)
  s.quadraticCurveTo(0.42, 1.0, 0.5, 0.72)
  s.lineTo(0.1, 0)
  s.closePath()
  return s
}

/** หางปลาแฉก: โคนอยู่ที่จุดกำเนิด ยื่นไปทาง +X */
export function fishTailShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0.1)
  s.quadraticCurveTo(0.5, 0.3, 1.0, 0.62)
  s.quadraticCurveTo(0.72, 0, 1.0, -0.62)
  s.quadraticCurveTo(0.5, -0.3, 0, -0.1)
  s.closePath()
  return s
}

export function spadeShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.quadraticCurveTo(0.2, 0.5, 0.5, 0.42)
  s.quadraticCurveTo(0.8, 0.3, 1.0, 0)
  s.quadraticCurveTo(0.8, -0.3, 0.5, -0.42)
  s.quadraticCurveTo(0.2, -0.5, 0, 0)
  return s
}
