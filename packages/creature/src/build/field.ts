import * as THREE from 'three'

interface Prim {
  /** แปลงจากพิกัดตัวสัตว์ → พิกัดทรงกลมหน่วยของชิ้นนี้ */
  inv: THREE.Matrix4
  minR: number
}

const _q = new THREE.Vector3()

/**
 * สนามระยะ (SDF) ของกลุ่มชิ้นส่วนที่ "หลอมเป็นเนื้อเดียว" เช่น กะโหลก+จมูก+แก้ม
 *
 * ชิ้นส่วนยังเป็น mesh แยกกัน (ขยับด้วย rig เดิมได้) แต่ตรงรอยต่อ:
 * - vertex ถูกดันออกไปอยู่บนผิวโค้งมนของ smooth-union → เกิดเนื้อเชื่อมแทนร่องคม
 * - normal ใช้ gradient ของสนามรวม → แสงเงาต่อเนื่องข้ามชิ้น
 */
export class FieldGroup {
  private readonly prims: Prim[] = []

  /** @param k รัศมีการหลอม (หน่วยของโมเดล) */
  constructor(readonly k: number) {}

  /** @param matrix แปลงทรงกลมหน่วย → ทรงรีในพิกัดตัวสัตว์ */
  addEllipsoid(matrix: THREE.Matrix4): void {
    const e = matrix.elements
    const sx = Math.hypot(e[0]!, e[1]!, e[2]!)
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!)
    const sz = Math.hypot(e[8]!, e[9]!, e[10]!)
    this.prims.push({ inv: matrix.clone().invert(), minR: Math.min(sx, sy, sz) })
  }

  /** คืน [ระยะแบบหลอม, ระยะแบบไม่หลอม] */
  private eval(x: number, y: number, z: number): [number, number] {
    let soft = Infinity
    let hard = Infinity
    const k = this.k
    for (const prim of this.prims) {
      _q.set(x, y, z).applyMatrix4(prim.inv)
      const d = (_q.length() - 1) * prim.minR
      if (d < hard) hard = d
      if (soft === Infinity) soft = d
      else {
        const h = Math.max(k - Math.abs(soft - d), 0) / k
        soft = Math.min(soft, d) - h * h * k * 0.25
      }
    }
    return [soft, hard]
  }

  /**
   * @returns ความหนาของเนื้อเชื่อม ณ จุด p (0 = ไกลจากรอยต่อ) และเขียนทิศ gradient ลง outNormal
   */
  sample(p: THREE.Vector3, outNormal: THREE.Vector3): number {
    if (this.prims.length < 2) return 0
    const [soft, hard] = this.eval(p.x, p.y, p.z)
    const fillet = hard - soft
    if (fillet < 1e-5) return 0
    const e = 0.004
    outNormal
      .set(
        this.eval(p.x + e, p.y, p.z)[0] - this.eval(p.x - e, p.y, p.z)[0],
        this.eval(p.x, p.y + e, p.z)[0] - this.eval(p.x, p.y - e, p.z)[0],
        this.eval(p.x, p.y, p.z + e)[0] - this.eval(p.x, p.y, p.z - e)[0],
      )
      .normalize()
    return fillet
  }
}
