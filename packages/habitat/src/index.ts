import * as THREE from 'three'
import { soft } from './material'

export { setSceneTint } from './material'

export type HabitatKind = 'meadow' | 'cloud' | 'underwater' | 'snow'
export const HABITAT_KINDS: HabitatKind[] = ['meadow', 'cloud', 'underwater', 'snow']
export const HABITAT_NAME_TH: Record<HabitatKind, string> = {
  meadow: 'ทุ่งหญ้า',
  cloud: 'เกาะเมฆ',
  underwater: 'ใต้น้ำ',
  snow: 'หิมะ',
}

/** ฉากไดโอรามาบนแท่นกลม รัศมี ≈ 1 หน่วย ฐานอยู่ที่ y = 0 */
export interface Habitat {
  kind: HabitatKind
  root: THREE.Group
  radius: number
  /** ความสูงของพื้นที่สัตว์ยืนได้ */
  surfaceY: number
  update(dt: number): void
  dispose(): void
}

type Animate = (t: number) => void

/** ตัวช่วยสร้างฉาก: เก็บ mesh/วัสดุ/animation ไว้ให้ dispose ได้ครบ */
class Kit {
  readonly root = new THREE.Group()
  readonly anims: Animate[] = []
  private readonly owned: { dispose(): void }[] = []
  private seed = 7

  /** สุ่มแบบคงที่ (ฉากเดิมหน้าตาเดิมทุกครั้ง) */
  rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    parent: THREE.Object3D = this.root,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...pos)
    parent.add(mesh)
    this.owned.push(geometry, material)
    return mesh
  }

  group(
    pos: [number, number, number] = [0, 0, 0],
    parent: THREE.Object3D = this.root,
  ): THREE.Group {
    const g = new THREE.Group()
    g.position.set(...pos)
    parent.add(g)
    return g
  }

  ball(r: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
    const g = new THREE.SphereGeometry(r, 20, 14)
    g.scale(sx, sy, sz)
    return g
  }

  /** แท่นฐาน: ดิน/หิน + ผิวบน */
  platform(soil: string, soilDark: string, top: string, r = 1, h = 0.24, y = 0): void {
    this.add(
      new THREE.CylinderGeometry(r, r * 0.86, h, 40),
      soft(soilDark, { top: soil, span: h }),
      [0, y + h / 2, 0],
    )
    this.add(new THREE.CylinderGeometry(r * 1.04, r * 1.02, 0.07, 40), soft(top), [
      0,
      y + h + 0.02,
      0,
    ])
  }

  /** กลุ่มก้อนกลมซ้อนกัน (พุ่มไม้ เมฆ กองหิมะ) */
  puff(
    color: string,
    pos: [number, number, number],
    size: number,
    count = 4,
    flat = 0.75,
  ): THREE.Group {
    const g = this.group(pos)
    const material = soft(color)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const r = size * (0.55 + this.rand() * 0.35)
      this.add(
        this.ball(r, 1, flat, 1),
        material,
        [Math.cos(a) * size * 0.55, r * flat * 0.5, Math.sin(a) * size * 0.4],
        g,
      )
    }
    this.add(this.ball(size * 0.8, 1, flat, 1), material, [0, size * 0.45, 0], g)
    return g
  }

  dispose(): void {
    this.root.removeFromParent()
    for (const item of new Set(this.owned)) item.dispose()
  }
}

function meadow(k: Kit): number {
  k.platform('#c59a6b', '#8f6846', '#a6e07e')
  const top = 0.29
  // ต้นไม้ทรงพุ่ม
  for (const [x, z, s] of [
    [-0.55, -0.35, 1],
    [0.5, -0.5, 0.8],
  ] as const) {
    const tree = k.group([x, top, z])
    k.add(
      new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.4 * s, 10),
      soft('#9a6b45'),
      [0, 0.2 * s, 0],
      tree,
    )
    const crown = k.group([0, 0.42 * s, 0], tree)
    k.add(k.ball(0.26 * s), soft('#5fbf6e', { top: '#8fe08a', span: 0.5 }), [0, 0.05, 0], crown)
    k.add(k.ball(0.19 * s), soft('#7fd67f'), [0.15 * s, 0.16 * s, 0.05], crown)
    k.add(k.ball(0.17 * s), soft('#6fca76'), [-0.14 * s, 0.14 * s, 0.08], crown)
    const phase = x * 3
    k.anims.push((t) => {
      crown.rotation.z = Math.sin(t * 1.3 + phase) * 0.05
    })
  }
  k.puff('#7ccf74', [0.7, top, 0.1], 0.16)
  k.puff('#8bd97f', [-0.75, top, 0.25], 0.13)
  // ดอกไม้
  const petals = ['#ff9fc0', '#ffe27a', '#ffffff', '#c9a6ff']
  for (let i = 0; i < 9; i++) {
    const a = k.rand() * Math.PI * 2
    const r = 0.25 + k.rand() * 0.6
    const flower = k.group([Math.cos(a) * r, top, Math.sin(a) * r * 0.9 + 0.1])
    k.add(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5), soft('#5fae5a'), [0, 0.05, 0], flower)
    k.add(k.ball(0.035), soft(petals[i % petals.length] as string), [0, 0.11, 0], flower)
    const phase = i
    k.anims.push((t) => {
      flower.rotation.z = Math.sin(t * 2 + phase) * 0.12
    })
  }
  k.add(k.ball(0.12, 1.2, 0.7, 1), soft('#b9b4c9'), [0.25, top + 0.05, 0.62])
  k.add(k.ball(0.07, 1.2, 0.7, 1), soft('#c9c5d6'), [0.42, top + 0.03, 0.7])
  return top
}

function cloud(k: Kit): number {
  // เมฆก้อนใหญ่เป็นฐาน
  const base = k.puff('#ffffff', [0, 0.02, 0], 0.62, 7, 0.55)
  // เกาะลอย: หญ้าด้านบน หินทรงกรวยกลับหัวด้านล่าง
  const island = k.group([0, 0.52, 0])
  const rock = k.add(
    new THREE.ConeGeometry(0.62, 0.5, 18),
    soft('#b08a66', { top: '#d2b08a', span: 0.5 }),
    [0, -0.25, 0],
    island,
  )
  rock.rotation.x = Math.PI
  k.add(new THREE.CylinderGeometry(0.66, 0.62, 0.08, 30), soft('#a6e07e'), [0, 0.03, 0], island)
  const tree = k.group([-0.3, 0.07, -0.15], island)
  k.add(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), soft('#9a6b45'), [0, 0.1, 0], tree)
  k.add(k.ball(0.15), soft('#6fca76', { top: '#9be693', span: 0.3 }), [0, 0.27, 0], tree)
  k.add(k.ball(0.06, 1.2, 0.7, 1), soft('#c9c5d6'), [0.32, 0.1, 0.25], island)
  // เมฆลอยรอบๆ
  const drifting = [
    k.puff('#ffffff', [-0.85, 0.75, 0.1], 0.2, 4, 0.6),
    k.puff('#f4f8ff', [0.8, 0.95, -0.2], 0.24, 4, 0.6),
    k.puff('#ffffff', [0.55, 0.3, 0.55], 0.16, 4, 0.6),
  ]
  // ฟองอากาศใส
  const bubble = k.add(k.ball(0.17), soft('#bfe6ff', { glass: true, opacity: 0.4 }), [0.1, 1.25, 0])
  k.anims.push((t) => {
    island.position.y = 0.52 + Math.sin(t * 1.1) * 0.035
    base.scale.setScalar(1 + Math.sin(t * 0.9) * 0.015)
    drifting.forEach((c, i) => {
      c.position.y += Math.sin(t * 1.2 + i * 2) * 0.0006
      c.position.x += Math.cos(t * 0.5 + i) * 0.0004
    })
    bubble.position.y = 1.25 + Math.sin(t * 1.6) * 0.05
  })
  return 0.6
}

function underwater(k: Kit): number {
  k.platform('#7fb6d9', '#4f86b3', '#f3e2b5', 1, 0.2)
  const top = 0.25
  // ปะการังกิ่ง
  const coral = (x: number, z: number, color: string, tip: string, s: number) => {
    const g = k.group([x, top, z])
    const material = soft(color, { top: tip, span: 0.4 * s })
    for (let i = 0; i < 5; i++) {
      const branch = k.add(
        new THREE.CapsuleGeometry(0.035 * s, 0.22 * s, 4, 8),
        material,
        [0, 0.13 * s, 0],
        g,
      )
      branch.rotation.z = (i - 2) * 0.38
      branch.rotation.y = i * 1.3
      branch.position.x = (i - 2) * 0.05 * s
    }
    return g
  }
  coral(-0.5, -0.2, '#ff8fb3', '#ffd0df', 1.1)
  coral(0.55, -0.35, '#b98cf0', '#e3ccff', 1.3)
  coral(0.25, 0.5, '#ffb07a', '#ffe0c2', 0.8)
  k.add(k.ball(0.16, 1, 0.75, 1), soft('#c79af5', { top: '#e7d3ff', span: 0.3 }), [
    -0.3,
    top + 0.08,
    0.45,
  ])
  k.add(k.ball(0.09, 1.2, 0.7, 1), soft('#d9d2e6'), [0.62, top + 0.04, 0.2])
  // สาหร่ายไหว
  for (let i = 0; i < 5; i++) {
    const a = 2.2 + i * 0.5
    const weed = k.group([Math.cos(a) * 0.7, top, Math.sin(a) * 0.55])
    const h = 0.35 + k.rand() * 0.3
    const blade = k.add(
      new THREE.ConeGeometry(0.035, h, 6),
      soft('#4fbf8a', { top: '#9be6b8', span: h }),
      [0, h / 2, 0],
      weed,
    )
    blade.scale.z = 0.4
    k.anims.push((t) => {
      weed.rotation.z = Math.sin(t * 1.4 + i * 1.7) * 0.16
    })
  }
  // ฟองอากาศลอยขึ้นวนไป
  const bubbles = Array.from({ length: 7 }, (_, i) => {
    const b = k.add(
      k.ball(0.022 + k.rand() * 0.025),
      soft('#e6f6ff', { glass: true, opacity: 0.55 }),
    )
    return {
      b,
      x: (k.rand() - 0.5) * 1.2,
      z: (k.rand() - 0.5) * 1.0,
      phase: i / 7,
      speed: 0.1 + k.rand() * 0.08,
    }
  })
  k.anims.push((t) => {
    for (const { b, x, z, phase, speed } of bubbles) {
      const p = (t * speed + phase) % 1
      b.position.set(x + Math.sin(t * 2 + phase * 9) * 0.03, top + p * 0.85, z)
      b.scale.setScalar(Math.sin(p * Math.PI) * 0.9 + 0.2)
    }
  })
  // โดมแก้ว + เนื้อน้ำสีฟ้าข้างใน
  const dome = new THREE.SphereGeometry(1.02, 36, 20, 0, Math.PI * 2, 0, Math.PI / 2)
  k.add(dome.clone(), soft('#6fc3f0', { opacity: 0.16, side: THREE.BackSide }), [0, top - 0.02, 0])
  k.add(dome, soft('#d8f2ff', { glass: true, opacity: 0.3 }), [0, top - 0.02, 0]).renderOrder = 5
  return top
}

function snow(k: Kit): number {
  k.platform('#cfe3f5', '#9dbbd8', '#ffffff')
  const top = 0.29
  k.add(k.ball(0.75, 1, 0.22, 0.9), soft('#ffffff', { top: '#f2f8ff', span: 0.3 }), [
    0.05,
    top,
    0.1,
  ])
  k.puff('#ffffff', [0.62, top, 0.45], 0.14, 3, 0.6)
  // ผลึกน้ำแข็งเรืองแสง
  const crystals: THREE.Mesh[] = []
  for (const [x, z, h, tilt] of [
    [-0.45, -0.25, 0.75, 0.1],
    [-0.62, -0.1, 0.45, -0.3],
    [-0.28, -0.42, 0.5, 0.35],
    [0.5, -0.45, 0.4, 0.2],
  ] as const) {
    const g = new THREE.OctahedronGeometry(0.11)
    g.scale(1, h / 0.22, 1)
    const c = k.add(g, soft('#9fd8ff', { top: '#e8f7ff', span: h, glow: 0.55, opacity: 0.88 }), [
      x,
      top + h * 0.42,
      z,
    ])
    c.rotation.z = tilt
    crystals.push(c)
  }
  // ต้นสนหิมะ
  for (const [x, z, s] of [
    [0.48, 0.0, 1],
    [0.15, -0.6, 0.75],
  ] as const) {
    const pine = k.group([x, top, z])
    k.add(
      new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.14 * s, 8),
      soft('#8f6846'),
      [0, 0.07 * s, 0],
      pine,
    )
    for (let i = 0; i < 3; i++) {
      const r = (0.22 - i * 0.055) * s
      const y = (0.2 + i * 0.15) * s
      k.add(
        new THREE.ConeGeometry(r, 0.22 * s, 12),
        soft('#5fae9a', { top: '#ffffff', span: 0.2 * s }),
        [0, y, 0],
        pine,
      )
    }
  }
  // เกล็ดหิมะร่วง
  const flakes = Array.from({ length: 10 }, (_, i) => ({
    f: k.add(k.ball(0.014), soft('#ffffff')),
    x: (k.rand() - 0.5) * 1.6,
    z: (k.rand() - 0.5) * 1.3,
    phase: i / 10,
  }))
  k.anims.push((t) => {
    crystals.forEach((c, i) => {
      const u = (c.material as THREE.ShaderMaterial).uniforms.uGlow
      if (u) u.value = 0.5 + 0.2 * Math.sin(t * 1.5 + i)
    })
    for (const { f, x, z, phase } of flakes) {
      const p = (t * 0.12 + phase) % 1
      f.position.set(x + Math.sin(t + phase * 20) * 0.05, top + 1.1 * (1 - p), z)
    }
  })
  return top + 0.12
}

const BUILDERS: Record<HabitatKind, (k: Kit) => number> = { meadow, cloud, underwater, snow }

export function createHabitat(kind: HabitatKind): Habitat {
  const kit = new Kit()
  const surfaceY = BUILDERS[kind](kit)
  let time = 0
  return {
    kind,
    root: kit.root,
    radius: 1.05,
    surfaceY,
    update(dt) {
      time += dt
      for (const anim of kit.anims) anim(time)
    },
    dispose: () => kit.dispose(),
  }
}

/**
 * โหลแก้วลอยน้ำสำหรับสัตว์น้ำบนจอ — รัศมี 1 หน่วย ก้นโหลอยู่ที่ y = 0
 * สัตว์ว่ายอยู่ข้างใน (ระดับ `floorY`..`waterTop`)
 */
export interface Bowl {
  root: THREE.Group
  radius: number
  /** ระดับพื้นทรายในโหล */
  floorY: number
  /** ระดับผิวน้ำ */
  waterTop: number
  update(dt: number): void
  dispose(): void
}

export function createBowl(): Bowl {
  const k = new Kit()
  const center = 0.92
  const opening = 0.42
  // ทรายก้นโหล + กรวด + สาหร่าย
  k.add(k.ball(0.62, 1, 0.16, 1), soft('#f3e2b5', { top: '#fff3d6', span: 0.15 }), [0, 0.1, 0])
  k.add(k.ball(0.09, 1.2, 0.7, 1), soft('#b9a6d8'), [0.32, 0.17, 0.18])
  k.add(k.ball(0.07, 1, 0.7, 1.2), soft('#ff9fbe'), [-0.28, 0.16, 0.24])
  for (let i = 0; i < 3; i++) {
    const weed = k.group([-0.42 + i * 0.12, 0.14, -0.25 + i * 0.05])
    const h = 0.32 + i * 0.08
    const blade = k.add(
      new THREE.ConeGeometry(0.03, h, 6),
      soft('#4fbf8a', { top: '#9be6b8', span: h }),
      [0, h / 2, 0],
      weed,
    )
    blade.scale.z = 0.4
    k.anims.push((t) => {
      weed.rotation.z = Math.sin(t * 1.3 + i * 1.9) * 0.18
    })
  }
  // ฟองอากาศ
  const bubbles = Array.from({ length: 5 }, (_, i) => ({
    b: k.add(k.ball(0.025 + k.rand() * 0.02), soft('#e6f6ff', { glass: true, opacity: 0.55 })),
    x: (k.rand() - 0.5) * 0.9,
    z: (k.rand() - 0.5) * 0.6,
    phase: i / 5,
    speed: 0.12 + k.rand() * 0.08,
  }))
  const waterTop = center + Math.cos(opening) * 0.98 - 0.08
  k.anims.push((t) => {
    for (const { b, x, z, phase, speed } of bubbles) {
      const p = (t * speed + phase) % 1
      b.position.set(x + Math.sin(t * 2 + phase * 9) * 0.03, 0.2 + p * (waterTop - 0.25), z)
      b.scale.setScalar(Math.sin(p * Math.PI) * 0.9 + 0.2)
    }
  })
  // เนื้อน้ำ (ด้านใน) + แก้ว (เปิดปากด้านบน) + ขอบปากโหล
  const shell = (r: number) =>
    new THREE.SphereGeometry(r, 36, 22, 0, Math.PI * 2, opening, Math.PI - opening)
  k.add(shell(0.97), soft('#6fc3f0', { opacity: 0.22, side: THREE.BackSide }), [0, center, 0])
  k.add(shell(1), soft('#d8f2ff', { glass: true, opacity: 0.32 }), [0, center, 0]).renderOrder = 5
  const rimR = Math.sin(opening)
  const rim = k.add(
    new THREE.TorusGeometry(rimR, 0.035, 8, 40),
    soft('#eaf8ff', { glass: true, opacity: 0.6 }),
    [0, center + Math.cos(opening), 0],
  )
  rim.rotation.x = Math.PI / 2
  rim.renderOrder = 6
  let time = 0
  return {
    root: k.root,
    radius: 1,
    floorY: 0.2,
    waterTop,
    update(dt) {
      time += dt
      for (const anim of k.anims) anim(time)
    },
    dispose: () => k.dispose(),
  }
}
