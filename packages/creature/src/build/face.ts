import * as THREE from 'three'

export interface CapOptions {
  /** ทิศที่แผ่นหันออก (พิกัดของทรงรี) */
  dir: THREE.Vector3
  /** ครึ่งความกว้าง/สูงของแผ่น */
  halfW: number
  halfH: number
  /** ครึ่งแกนของทรงรีที่แผ่นแนบ */
  ell: THREE.Vector3
  /** ระยะยกเหนือผิว (กันจมในขน) */
  lift: number
  /** การดัดรูปเดียวกับที่ใช้กับทรงรีต้นแบบ (รับพิกัดบนทรงกลมหน่วย) */
  deform?: (unit: THREE.Vector3) => void
}

/**
 * แผ่นโค้งที่แนบไปกับผิวทรงรี — ใช้วาดตา/ปากด้วย shader
 * มี attribute `aUv` (-1..1) เป็นพิกัดในกรอบของแผ่น
 */
export function projectedCap(o: CapOptions): THREE.BufferGeometry {
  const N = 14
  const dir = o.dir.clone().normalize()
  const ax = new THREE.Vector3(0, 1, 0).cross(dir).normalize()
  const ay = dir.clone().cross(ax).normalize()
  const invEll = new THREE.Vector3(1 / o.ell.x, 1 / o.ell.y, 1 / o.ell.z)

  // จุดกึ่งกลางแผ่นบนผิวทรงรี
  const tCenter = 1 / dir.clone().multiply(invEll).length()
  const center = dir.clone().multiplyScalar(tCenter)
  const reach = Math.max(o.ell.x, o.ell.y, o.ell.z) * 3
  const D = dir.clone().negate()
  const De = D.clone().multiply(invEll)
  const A = De.lengthSq()

  const positions: number[] = []
  const uvs: number[] = []
  const origin = new THREE.Vector3()
  const hit = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2 - 1
      const v = (j / N) * 2 - 1
      origin
        .copy(center)
        .addScaledVector(ax, u * o.halfW)
        .addScaledVector(ay, v * o.halfH)
        .addScaledVector(dir, reach)
      // ยิงรังสีกลับเข้าหาทรงรีตามทิศ -dir
      const Oe = origin.clone().multiply(invEll)
      const B = 2 * Oe.dot(De)
      const C = Oe.lengthSq() - 1
      const disc = Math.max(0, B * B - 4 * A * C)
      const s = (-B - Math.sqrt(disc)) / (2 * A)
      hit.copy(origin).addScaledVector(D, s)
      const unit = hit.clone().multiply(invEll)
      normal.copy(unit).multiply(invEll).normalize()
      if (o.deform) {
        o.deform(unit)
        hit.copy(unit).multiply(o.ell)
      }
      hit.addScaledVector(normal, o.lift)
      positions.push(hit.x, hit.y, hit.z)
      uvs.push(u, v)
    }
  }
  const index: number[] = []
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i
      const b = a + 1
      const c = a + N + 1
      const d = c + 1
      index.push(a, b, d, a, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}
