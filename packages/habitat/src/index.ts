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

/** ห้องหนึ่งชั้นของคอนโดตู้ปลา (หน่วยเดียวกับ root ก่อน scale) */
export interface CondoRoom {
  /** ระดับพื้นทรายด้านใน */
  floorY: number
  /** ความสูงช่องน้ำ */
  height: number
}

/**
 * คอนโดตู้ปลา: ตู้กระจกสี่เหลี่ยมซ้อนกันเป็นชั้น (1 ชั้นต่อสัตว์น้ำ 1 ตัว) มีคานสีพาสเทลคั่น หลังคาทรงบ้าน
 * และท่อฟองอากาศด้านข้าง — ฐานอยู่ที่ y = 0, กว้าง `width` หน่วย
 */
export interface AquariumCondo {
  root: THREE.Group
  floors: number
  width: number
  /** ครึ่งความกว้างด้านในที่ว่ายได้ */
  halfWidth: number
  rooms: CondoRoom[]
  /** ความสูงทั้งหลังรวมหลังคา */
  height: number
  update(dt: number): void
  dispose(): void
}

const CONDO_W = 3.0
const CONDO_D = 1.1
const ROOM_H = 1.15
const SLAB = 0.14
const BASE = 0.18
const FRAME_COLORS = ['#f6c6d8', '#c9e4f6', '#d8f0c8', '#f6e2b5']

export function createAquariumCondo(floors: number): AquariumCondo {
  const k = new Kit()
  const n = Math.max(1, Math.min(4, Math.round(floors)))
  const rooms: CondoRoom[] = []
  // ฐาน
  k.add(
    new THREE.BoxGeometry(CONDO_W + 0.2, BASE, CONDO_D + 0.2),
    soft('#c9a6e8', { top: '#e3ccff', span: BASE }),
    [0, BASE / 2, 0],
  )
  const decor: ((g: THREE.Group, floor: number) => void)[] = [
    // ปะการัง
    (g) => {
      for (let i = 0; i < 4; i++) {
        const c = k.add(
          new THREE.CapsuleGeometry(0.04, 0.22, 4, 8),
          soft('#ff8fb3', { top: '#ffd0df', span: 0.3 }),
          [-0.9 + i * 0.06, 0.16, -0.25],
          g,
        )
        c.rotation.z = (i - 1.5) * 0.4
      }
      k.add(k.ball(0.1, 1.2, 0.7, 1), soft('#b9a6d8'), [0.85, 0.07, -0.2], g)
    },
    // ปราสาทเล็ก
    (g) => {
      k.add(
        new THREE.CylinderGeometry(0.14, 0.16, 0.36, 10),
        soft('#f3e2b5', { top: '#fff3d6', span: 0.36 }),
        [0.85, 0.18, -0.25],
        g,
      )
      k.add(new THREE.ConeGeometry(0.17, 0.2, 10), soft('#ff9fbe'), [0.85, 0.46, -0.25], g)
      k.add(k.ball(0.08, 1.3, 0.6, 1), soft('#9ad7c8'), [-0.8, 0.05, -0.15], g)
    },
    // หินกับดาวทะเล
    (g) => {
      k.add(
        k.ball(0.16, 1.3, 0.7, 1),
        soft('#cfd6e6', { top: '#eef2fa', span: 0.2 }),
        [-0.85, 0.09, -0.22],
        g,
      )
      const star = k.add(
        new THREE.CylinderGeometry(0.1, 0.1, 0.03, 5),
        soft('#ffb07a'),
        [0.7, 0.04, 0.1],
        g,
      )
      star.rotation.y = 0.3
    },
    // หอยกับเปลือก
    (g) => {
      k.add(
        k.ball(0.11, 1, 0.6, 1.2),
        soft('#ffd0df', { top: '#fff0f5', span: 0.1 }),
        [0.8, 0.06, -0.2],
        g,
      )
      k.add(k.ball(0.07, 1, 0.8, 1), soft('#f6e2b5'), [-0.75, 0.05, 0.05], g)
    },
  ]
  let y = BASE
  for (let i = 0; i < n; i++) {
    const room = k.group([0, y, 0])
    // ทรายก้นตู้
    k.add(
      new THREE.BoxGeometry(CONDO_W - 0.08, 0.1, CONDO_D - 0.08),
      soft('#f3e2b5', { top: '#fff3d6', span: 0.1 }),
      [0, 0.05, 0],
      room,
    )
    decor[i % decor.length]!(room, i)
    // สาหร่ายไหว
    for (let j = 0; j < 2; j++) {
      const weed = k.group([-0.55 + j * 1.15, 0.1, -0.35], room)
      const h = 0.4 + j * 0.15
      const blade = k.add(
        new THREE.ConeGeometry(0.035, h, 6),
        soft('#4fbf8a', { top: '#9be6b8', span: h }),
        [0, h / 2, 0],
        weed,
      )
      blade.scale.z = 0.4
      k.anims.push((t) => {
        weed.rotation.z = Math.sin(t * 1.3 + i * 1.7 + j) * 0.18
      })
    }
    // เนื้อน้ำ + กระจก
    k.add(
      new THREE.BoxGeometry(CONDO_W - 0.04, ROOM_H - 0.04, CONDO_D - 0.04),
      soft('#6fc3f0', { opacity: 0.2, side: THREE.BackSide }),
      [0, ROOM_H / 2, 0],
      room,
    )
    k.add(
      new THREE.BoxGeometry(CONDO_W, ROOM_H, CONDO_D),
      soft('#d8f2ff', { glass: true, opacity: 0.22 }),
      [0, ROOM_H / 2, 0],
      room,
    ).renderOrder = 5
    rooms.push({ floorY: y + 0.1, height: ROOM_H - 0.12 })
    y += ROOM_H
    // คานคั่นชั้น/ขอบบน
    k.add(
      new THREE.BoxGeometry(CONDO_W + 0.16, SLAB, CONDO_D + 0.16),
      soft(FRAME_COLORS[i % FRAME_COLORS.length]!, { top: '#ffffff', span: SLAB * 3 }),
      [0, y + SLAB / 2, 0],
    )
    y += SLAB
  }
  // เสามุม
  const pillar = soft('#ffffff', { top: '#f3e9f7', span: 1 })
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      k.add(new THREE.BoxGeometry(0.08, y - BASE, 0.08), pillar, [
        sx * (CONDO_W / 2 + 0.02),
        BASE + (y - BASE) / 2,
        sz * (CONDO_D / 2 + 0.02),
      ])
  // หลังคาทรงบ้าน + ปล่องไฟ
  const roof = k.add(
    new THREE.ConeGeometry((CONDO_W + 0.4) * 0.72, 0.7, 4),
    soft('#ff9fb5', { top: '#ffd0dc', span: 0.7 }),
    [0, y + 0.35, 0],
  )
  roof.rotation.y = Math.PI / 4
  roof.scale.z = 0.55
  k.add(new THREE.BoxGeometry(0.18, 0.32, 0.18), soft('#f6e2b5'), [0.65, y + 0.5, 0])
  // ท่อฟองอากาศด้านข้าง
  const pipeX = CONDO_W / 2 + 0.16
  k.add(
    new THREE.CylinderGeometry(0.05, 0.05, y - BASE, 10),
    soft('#e6f6ff', { glass: true, opacity: 0.45 }),
    [pipeX, BASE + (y - BASE) / 2, 0.2],
  ).renderOrder = 5
  const bubbles = Array.from({ length: 4 + n * 2 }, (_, i) => ({
    b: k.add(k.ball(0.03 + k.rand() * 0.015), soft('#e6f6ff', { glass: true, opacity: 0.6 })),
    phase: i / (4 + n * 2),
  }))
  const top = y
  k.anims.push((t) => {
    for (const { b, phase } of bubbles) {
      const p = (t * 0.12 + phase) % 1
      b.position.set(pipeX + Math.sin(t * 3 + phase * 9) * 0.01, BASE + p * (top - BASE), 0.2)
    }
  })
  let time = 0
  return {
    root: k.root,
    floors: n,
    width: CONDO_W,
    halfWidth: CONDO_W / 2 - 0.12,
    rooms,
    height: y + 0.7,
    update(dt) {
      time += dt
      for (const anim of k.anims) anim(time)
    },
    dispose: () => k.dispose(),
  }
}
