import * as THREE from 'three'
import type { BodySpec, Phenotype } from '@mochimon/core'
import { createCreatureMaterials, type CreatureMaterials } from '../material/toon'
import {
  ball,
  batWingShape,
  bentCone,
  deformedBall,
  fanShape,
  featherWingShape,
  finShape,
  fishTailShape,
  hangingCapsule,
  petalShape,
  slab,
  spadeShape,
  standingCapsule,
} from './shapes'

type BellyFn = (posInCreature: THREE.Vector3) => number

interface PartOpts {
  outline?: boolean
  belly?: number | BellyFn
}

export interface LegRig {
  pivot: THREE.Group
  /** เฟสของจังหวะก้าว */
  phase: number
  /** +1 = ขาหน้า (พับไปข้างหน้าตอนนอน), -1 = ขาหลัง */
  fold: number
  restY: number
}
export interface PairRig {
  pivot: THREE.Group
  side: 1 | -1
  rest: THREE.Euler
}
export interface TailRig {
  joints: THREE.Group[]
  rest: number[]
  yaw: number
}
export interface EyeRig {
  group: THREE.Group
  baseOpen: number
}

export interface Rig {
  posture: BodySpec['posture']
  body: THREE.Group
  bodyRestY: number
  /** ระยะที่ลำตัวลดลงตอนหมอบ/นอน */
  crouch: number
  head: THREE.Group
  legs: LegRig[]
  arms: PairRig[]
  ears: PairRig[]
  wings: PairRig[]
  tails: TailRig[]
  eyes: EyeRig[]
  canFly: boolean
}

export interface BuiltCreature {
  root: THREE.Group
  rig: Rig
  materials: CreatureMaterials
  /** ขนาดกล่องขอบเขตในท่าพัก (หลังคูณ scale แล้ว) */
  size: THREE.Vector3
  /** รัศมีฐานลำตัวโดยประมาณ (ไม่รวมปีก/หาง) — ใช้กับเงาและพื้นที่คลิก */
  footprint: number
  dispose(): void
}

/** smoothstep ที่รองรับขอบกลับด้าน (a > b) */
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  opts: PartOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material)
  m.userData.outline = opts.outline ?? true
  m.userData.belly = opts.belly ?? 0
  return m
}

function group(x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  return g
}

/** สร้างคู่ซ้าย-ขวาแบบสมมาตร: build ได้ pivot ของฝั่ง +X แล้วสะท้อนด้วย scale.x = -1 */
function mirrored(
  build: () => THREE.Group,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
) {
  const out: { pivot: THREE.Group; side: 1 | -1 }[] = []
  for (const side of [1, -1] as const) {
    const holder = group(x * side, y, z)
    holder.scale.x = side
    const pivot = build()
    holder.add(pivot)
    parent.add(holder)
    out.push({ pivot, side })
  }
  return out
}

/** ประกอบร่างสัตว์จาก phenotype + สัดส่วนร่างกาย (หันหน้าไปทาง +Z, ยืนบนระนาบ y=0) */
export function buildCreature(p: Phenotype, s: BodySpec): BuiltCreature {
  const root = new THREE.Group()
  const { rx, ry, rz } = s.torso
  const R = s.headR
  const hipY = s.posture === 'float' ? 0 : s.legLen
  const bodyRestY = s.posture === 'float' ? ry + 0.14 : hipY + ry * 0.92
  const totalHeight = bodyRestY + ry + R * 1.6
  const mats = createCreatureMaterials(p, totalHeight)

  const rig: Rig = {
    posture: s.posture,
    body: group(0, bodyRestY, 0),
    bodyRestY,
    crouch: s.posture === 'float' ? 0 : hipY * 0.85,
    head: group(),
    legs: [],
    arms: [],
    ears: [],
    wings: [],
    tails: [],
    eyes: [],
    canFly: p.habitat === 'sky',
  }
  root.add(rig.body)

  // ───────── ลำตัว ─────────
  const bodyCenter = new THREE.Vector3(0, bodyRestY, 0)
  const torsoBelly: BellyFn = (pos) => {
    const d = pos.clone().sub(bodyCenter)
    d.set(d.x / rx, d.y / ry, d.z / rz).normalize()
    return s.posture === 'upright'
      ? smooth(0.42, 0.7, d.z - d.y * 0.2 - Math.abs(d.x) * 0.35)
      : smooth(0.25, 0.6, -d.y * 0.85 + d.z * 0.4)
  }
  const torsoGeo = deformedBall(rx, ry, rz, (v) => {
    if (s.posture === 'upright') {
      // ทรงไข่: ก้นกว้าง ไหล่แคบ + พุงยื่นด้านหน้า
      const w = 1 + 0.16 * -v.y
      v.x *= w
      v.z *= w
      if (v.z > 0 && v.y < 0.3) v.z *= 1 + s.belly * 0.25 * (0.3 - v.y)
    } else if (v.y < 0) {
      // พุงย้อย: ด้านล่างป่องและหย่อน
      const sag = s.belly * -v.y
      v.x *= 1 + 0.2 * sag
      v.z *= 1 + 0.1 * sag
      v.y *= 1 + 0.22 * s.belly
    }
  })
  rig.body.add(mesh(torsoGeo, mats.body, { belly: torsoBelly }))

  // ───────── หัว ─────────
  const hp = p.parts.head.params
  const snout = hp.snout ?? 0.12
  const wide = hp.wide ?? 1
  const tall = hp.tall ?? 1
  const longFace = snout > 0.3
  if (s.posture === 'upright') rig.head.position.set(0, ry * 0.78 + R * 0.72, rz * 0.12)
  else if (s.posture === 'float') rig.head.position.set(0, ry * 0.12, rz * 0.7 + R * 0.25)
  else rig.head.position.set(0, ry * 0.5 + R * 0.6, rz * 0.78 + R * 0.12)
  rig.body.add(rig.head)

  const cheeks = hp.cheeks ?? 0.4
  const headGeo = deformedBall(R * wide, R * tall, R * 0.95, (v) => {
    if (v.y < 0.1) v.x *= 1 + cheeks * 0.2 * smooth(0.1, -0.6, v.y)
  })
  rig.head.add(mesh(headGeo, mats.body))

  // จมูก/ปาก (muzzle)
  if (snout > 0) {
    const sw = hp.snoutW ?? 0.46
    const muzzle = group(0, -R * (longFace ? 0.12 : 0.24), R * (longFace ? 0.5 : 0.66))
    muzzle.rotation.x = (hp.snoutDrop ?? 0) * 0.7
    const len = R * (0.26 + snout * 1.25)
    const mz = len * (longFace ? 0.55 : 0.2)
    const muzzleCenterY = () => rig.head.position.y + bodyRestY + muzzle.position.y
    const mm = mesh(ball(R * sw * 0.8, R * sw * (longFace ? 0.62 : 0.56), len), mats.body, {
      belly: longFace ? (pos) => smooth(0.0, -R * 0.2, pos.y - muzzleCenterY()) : 1,
    })
    mm.position.z = mz
    muzzle.add(mm)
    if (!longFace && p.parts.head.shape !== 'fish') {
      const nose = mesh(ball(R * 0.075, R * 0.055, R * 0.05), mats.nose, { outline: false })
      nose.position.set(0, R * sw * 0.2, mz + len * 0.94)
      muzzle.add(nose)
    } else if (longFace) {
      for (const side of [1, -1]) {
        const nostril = mesh(ball(R * 0.035), mats.nose, { outline: false })
        nostril.position.set(side * R * sw * 0.32, R * sw * 0.36, mz + len * 0.8)
        muzzle.add(nostril)
      }
    }
    rig.head.add(muzzle)
  }
  if (hp.beak) {
    const beak = mesh(bentCone(R * 0.24, R * (0.3 + hp.beak), 0, 12), mats.accent)
    beak.scale.set(1, 1, 0.72)
    beak.rotation.x = Math.PI / 2
    beak.position.set(0, -R * 0.14, R * 0.78)
    rig.head.add(beak)
  }

  // ───────── ดวงตา + แก้ม ─────────
  const eyeDir = longFace
    ? new THREE.Vector3(0.56, 0.3, 0.76)
    : p.parts.head.shape === 'fish'
      ? new THREE.Vector3(0.66, 0.12, 0.72)
      : new THREE.Vector3(0.42, 0.1, 0.9)
  const eyeR = R * 0.2 * s.eyeScale
  const eyeShape = p.parts.eyes.shape
  for (const side of [1, -1] as const) {
    const dir = eyeDir
      .clone()
      .setX(eyeDir.x * side)
      .normalize()
    const eye = group(dir.x * R * wide * 0.9, dir.y * R * tall * 0.9, dir.z * R * 0.95 * 0.9)
    eye.lookAt(eye.position.clone().add(dir.clone().add(new THREE.Vector3(0, 0, 0.9))))
    const lids = group()
    eye.add(lids)

    const colored = eyeShape === 'slit' || eyeShape === 'sparkle'
    lids.add(
      mesh(ball(eyeR, eyeR * 1.18, eyeR * 0.5), colored ? mats.eyeIris : mats.eyeDark, {
        outline: false,
      }),
    )
    if (eyeShape === 'slit') {
      const pupil = mesh(ball(eyeR * 0.24, eyeR * 0.92, eyeR * 0.3), mats.eyeDark, {
        outline: false,
      })
      pupil.position.z = eyeR * 0.3
      lids.add(pupil)
    } else if (eyeShape === 'sparkle') {
      const pupil = mesh(ball(eyeR * 0.68, eyeR * 0.84, eyeR * 0.3), mats.eyeDark, {
        outline: false,
      })
      pupil.position.set(0, eyeR * 0.08, eyeR * 0.3)
      lids.add(pupil)
    }
    const shines: [number, number, number][] =
      eyeShape === 'sparkle'
        ? [
            [-0.28, 0.42, 0.34],
            [0.3, -0.3, 0.2],
            [0.34, 0.28, 0.1],
          ]
        : [
            [-0.26, 0.4, 0.28],
            [0.26, -0.28, 0.13],
          ]
    for (const [sx, sy, sr] of shines) {
      const shine = mesh(ball(eyeR * sr, eyeR * sr, eyeR * 0.12), mats.eyeShine, { outline: false })
      shine.position.set(sx * eyeR * side, sy * eyeR, eyeR * 0.5)
      lids.add(shine)
    }
    rig.head.add(eye)
    rig.eyes.push({ group: lids, baseOpen: eyeShape === 'sleepy' ? 0.55 : 1 })

    const blushDir = new THREE.Vector3(
      eyeDir.x * 1.55 * side,
      eyeDir.y - 0.42,
      eyeDir.z,
    ).normalize()
    const blush = mesh(new THREE.CircleGeometry(R * 0.13, 20), mats.blush, { outline: false })
    blush.scale.set(1.25, 0.8, 1)
    blush.position.set(
      blushDir.x * R * wide * (1 + cheeks * 0.12) * 1.02,
      blushDir.y * R * tall * 1.02,
      blushDir.z * R * 0.95 * 1.02,
    )
    blush.lookAt(blush.position.clone().add(blushDir))
    blush.renderOrder = 2
    rig.head.add(blush)
  }

  // ───────── หู ─────────
  const ep = p.parts.ears.params
  const earLen = R * (ep.len ?? 0.5) * s.earScale
  const earW = R * (ep.width ?? 0.4)
  const addEars = (
    x: number,
    y: number,
    z: number,
    rest: [number, number, number],
    build: () => THREE.Object3D,
  ) => {
    for (const { pivot, side } of mirrored(
      () => {
        const g = group()
        g.rotation.set(...rest)
        g.add(build())
        return g
      },
      rig.head,
      x * R * wide,
      y * R * tall,
      z * R,
    )) {
      rig.ears.push({ pivot, side, rest: pivot.rotation.clone() })
    }
  }
  switch (p.parts.ears.shape) {
    case 'point':
      addEars(0.52, 0.7, 0, [-0.1, 0, -0.38], () => {
        const m = mesh(bentCone(earW * 0.62, earLen, 0.08), mats.body)
        m.scale.z = 0.5
        return m
      })
      break
    case 'long':
      addEars(0.34, 0.82, -0.05, [-0.12, 0, -0.16], () => {
        const m = mesh(standingCapsule(earW * 0.8, earLen), mats.body)
        m.scale.z = 0.45
        return m
      })
      break
    case 'round':
      addEars(0.66, 0.66, 0, [0, 0, 0], () => {
        const m = mesh(ball(earW * 0.72 * s.earScale), mats.body)
        m.scale.z = 0.5
        return m
      })
      break
    case 'floppy':
      addEars(0.78, 0.5, 0, [0.1, 0, -0.28], () => {
        const m = mesh(hangingCapsule(earW * 0.75, earLen), mats.body)
        m.scale.z = 0.45
        return m
      })
      break
    case 'fin':
      addEars(0.8, 0.28, -0.1, [0, -0.5, 0.5], () =>
        mesh(slab(finShape(), earLen, R * 0.06), mats.membrane),
      )
      break
    case 'tuft':
      addEars(0.2, 0.9, -0.05, [-0.5, 0, -0.3], () =>
        mesh(bentCone(earW * 0.5, earLen, 0.3, 8), mats.body),
      )
      break
  }

  // ───────── เขา ─────────
  const hs = s.hornScale
  const horn = (r: number, h: number, bend: number, mat: THREE.Material = mats.accent) =>
    mesh(bentCone(R * r * hs, R * h * hs, bend), mat)
  const hornPair = (
    x: number,
    y: number,
    z: number,
    rot: [number, number, number],
    make: () => THREE.Object3D,
  ) =>
    mirrored(
      () => {
        const g = group()
        g.rotation.set(...rot)
        g.add(make())
        return g
      },
      rig.head,
      x * R * wide,
      y * R * tall,
      z * R,
    )
  switch (p.parts.horns.shape) {
    case 'nub':
      hornPair(0.32, 0.86, 0.22, [0.2, 0, -0.25], () => horn(0.11, 0.2, 0))
      break
    case 'spiral': {
      const h = horn(0.1, 0.95, -0.06)
      h.position.set(0, R * tall * 0.86, R * 0.42)
      h.rotation.x = 0.5
      rig.head.add(h)
      break
    }
    case 'crystal': {
      const g = new THREE.OctahedronGeometry(R * 0.2 * hs)
      g.scale(0.7, 1.9, 0.7)
      const h = mesh(g, mats.accent)
      h.position.set(0, R * tall * 1.1, R * 0.34)
      h.rotation.x = 0.35
      rig.head.add(h)
      break
    }
    case 'curved':
      hornPair(0.4, 0.8, 0.05, [-0.5, 0, -0.45], () => horn(0.13, 0.72, 0.45))
      break
    case 'antler':
      hornPair(0.3, 0.84, 0.15, [-0.1, 0, -0.45], () => {
        const g = group()
        g.add(horn(0.1, 0.95, 0.15))
        const b1 = horn(0.075, 0.42, 0)
        b1.position.y = R * 0.32 * hs
        b1.rotation.z = -0.95
        const b2 = horn(0.07, 0.36, 0)
        b2.position.y = R * 0.58 * hs
        b2.rotation.z = 0.85
        g.add(b1, b2)
        return g
      })
      break
    case 'trike': {
      hornPair(0.36, 0.62, 0.5, [0.95, 0, -0.2], () => horn(0.1, 0.62, 0.25))
      const nose = horn(0.09, 0.3, 0)
      nose.position.set(0, R * 0.2, R * (0.9 + snout * 0.9))
      nose.rotation.x = 0.4
      rig.head.add(nose)
      const frill = mesh(ball(R * 1.22 * wide, R * 1.12, R * 0.2), mats.body, { belly: 0.35 })
      frill.position.set(0, R * 0.3, -R * 0.52)
      frill.rotation.x = -0.35
      rig.head.add(frill)
      break
    }
  }

  // ───────── ปีก / ครีบข้าง ─────────
  const span = (p.parts.wings.params.span ?? 1) * s.wingScale * (rx + ry) * 0.95
  const upright = s.posture === 'upright'
  const wingAnchor: [number, number, number] =
    s.posture === 'upright'
      ? [rx * 0.82, ry * 0.3, -rz * 0.25]
      : s.posture === 'float'
        ? [rx * 0.86, -ry * 0.15, rz * 0.2]
        : [rx * 0.5, ry * 0.72, -rz * 0.05]
  const addWings = (rest: [number, number, number], build: () => THREE.Object3D[]) => {
    for (const { pivot, side } of mirrored(
      () => {
        const g = group()
        g.rotation.set(...rest)
        g.add(...build())
        return g
      },
      rig.body,
      ...wingAnchor,
    )) {
      rig.wings.push({ pivot, side, rest: pivot.rotation.clone() })
    }
  }
  switch (p.parts.wings.shape) {
    case 'feather':
      addWings(upright ? [0.15, -0.35, -0.6] : [0, -0.6, 0.35], () => [
        mesh(slab(featherWingShape(), span, 0.05), mats.body),
      ])
      break
    case 'bat':
      addWings(upright ? [0, -0.75, 0.1] : [0, -0.7, 0.4], () => [
        mesh(slab(batWingShape(), span * (upright ? 0.8 : 1), 0.035), mats.membrane),
      ])
      break
    case 'fairy':
      addWings(upright ? [0, -0.6, 0.15] : [0, -0.55, 0.3], () => [
        mesh(slab(petalShape(0.5, 0.3, 0.5, 0.22, 0.4), span, 0.012), mats.sheer, {
          outline: false,
        }),
        mesh(slab(petalShape(0.36, -0.16, 0.36, 0.15, -0.35), span, 0.012), mats.sheer, {
          outline: false,
        }),
      ])
      break
    case 'fin':
      addWings([0.3, -0.7, -0.35], () => [mesh(slab(finShape(), span * 0.8, 0.04), mats.membrane)])
      break
  }

  // ───────── หาง ─────────
  const tp = p.parts.tail.params
  const tailLen = (tp.len ?? 0.5) * s.tailScale * (rz + ry) * 0.9
  const tailAnchor: [number, number, number] =
    s.posture === 'upright' ? [0, -ry * 0.5, -rz * 0.86] : [0, ry * 0.2, -rz * 0.9]
  const tailBase = group(...tailAnchor)
  rig.body.add(tailBase)
  /** หางเป็นโซ่ข้อต่อ: แต่ละข้อเป็นลูกกลมซ้อนกัน ยื่นไปทาง -Z */
  const chain = (
    count: number,
    radius: (t: number) => number,
    curl: number,
    yaw = 0,
    mat: THREE.Material = mats.body,
    belly = 0,
  ): THREE.Group => {
    const joints: THREE.Group[] = []
    const step = tailLen / count
    let parent: THREE.Object3D = tailBase
    for (let i = 0; i < count; i++) {
      const joint = group(0, 0, i === 0 ? 0 : -step)
      joint.rotation.x = curl
      if (i === 0) joint.rotation.y = yaw
      const r = radius(i / Math.max(1, count - 1))
      const seg = mesh(ball(r, r, Math.max(r, step)), mat, { belly })
      seg.position.z = -step * 0.5
      joint.add(seg)
      parent.add(joint)
      parent = joint
      joints.push(joint)
    }
    rig.tails.push({ joints, rest: joints.map((j) => j.rotation.x), yaw })
    const tip = group(0, 0, -step)
    parent.add(tip)
    return tip
  }
  const baseR = Math.min(ry, rx) * 0.5
  switch (p.parts.tail.shape) {
    case 'nub':
      chain(1, () => baseR * 0.4, 0.3)
      break
    case 'thin':
      chain(7, (t) => THREE.MathUtils.lerp(0.055, 0.04, t), 0.24)
      break
    case 'twin':
      chain(7, (t) => THREE.MathUtils.lerp(0.05, 0.038, t), 0.24, 0.38)
      chain(7, (t) => THREE.MathUtils.lerp(0.05, 0.038, t), 0.24, -0.38)
      break
    case 'pom':
      chain(1, () => 0.12 * s.tailScale, 0.2, 0, mats.body, 1)
      break
    case 'thick':
      chain(6, (t) => THREE.MathUtils.lerp(baseR * 0.95, 0.035, t), 0.07)
      break
    case 'spade': {
      const tip = chain(7, (t) => THREE.MathUtils.lerp(baseR * 0.7, 0.03, t), 0.12)
      const spade = mesh(slab(spadeShape(), 0.2 * s.tailScale, 0.04), mats.accent)
      spade.rotation.set(0, Math.PI / 2, 0)
      spade.position.z = 0.03
      tip.add(spade)
      break
    }
    case 'flowy':
      chain(5, (t) => 0.05 + Math.sin(t * Math.PI * 0.85) * 0.075, -0.2, 0, mats.accent)
      break
    case 'fan': {
      const tip = chain(1, () => baseR * 0.35, 0.5)
      const fan = mesh(slab(fanShape(), tailLen * 1.1, 0.04), mats.body)
      fan.rotation.x = -Math.PI / 2 + 0.2
      fan.position.z = tailLen * 0.7
      tip.add(fan)
      break
    }
    case 'fish': {
      const tip = chain(3, (t) => THREE.MathUtils.lerp(baseR * 0.75, baseR * 0.28, t), 0)
      const fin = mesh(slab(fishTailShape(), tailLen * 0.85, 0.035), mats.membrane)
      fin.rotation.y = Math.PI / 2
      fin.position.z = tailLen * 0.12
      tip.add(fin)
      break
    }
  }

  // ───────── ขา / แขน / ครีบ ─────────
  const limb = p.parts.limbs.shape
  const legTop = hipY + ry * 0.3
  const addLeg = (
    x: number,
    z: number,
    phase: number,
    fold: number,
    r: number,
    foot: () => THREE.Object3D,
  ) => {
    const pivot = group(x, legTop, z)
    pivot.add(mesh(hangingCapsule(r, legTop), mats.body))
    const f = foot()
    f.position.y = -legTop
    pivot.add(f)
    root.add(pivot)
    rig.legs.push({ pivot, phase, fold, restY: legTop })
  }
  if (s.posture === 'quad') {
    const hoof = limb === 'hoof'
    const r = s.legR * (hoof ? 0.85 : 1.05)
    const foot = () => {
      if (hoof) {
        const h = mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.12, r * 1.3, 14), mats.accent)
        h.position.y = r * 0.65
        const g = group()
        g.add(h)
        return g
      }
      const paw = mesh(ball(r * 1.2, r * 0.75, r * 1.45), mats.body, { belly: 0.6 })
      paw.position.set(0, r * 0.7, r * 0.35)
      const g = group()
      g.add(paw)
      return g
    }
    const lx = rx * 0.58
    const lz = rz * 0.55
    addLeg(lx, lz, 0, 1, r, foot)
    addLeg(-lx, lz, Math.PI, 1, r, foot)
    addLeg(lx, -lz, Math.PI, -1, r, foot)
    addLeg(-lx, -lz, 0, -1, r, foot)
  } else if (s.posture === 'upright') {
    const bird = limb === 'biped'
    const r = s.legR * (bird ? 0.8 : 1.25)
    const foot = () => {
      const f = mesh(ball(r * 1.5, r * 0.6, r * 2.1), bird ? mats.accent : mats.body, {
        belly: bird ? 0 : 0.6,
      })
      f.position.set(0, r * 0.55, r * 0.9)
      const g = group()
      g.add(f)
      return g
    }
    // ขานกเป็นสี accent
    const legMat = bird ? mats.accent : mats.body
    for (const [side, phase] of [
      [1, 0],
      [-1, Math.PI],
    ] as const) {
      const pivot = group(side * rx * 0.48, legTop, 0)
      pivot.add(mesh(hangingCapsule(r, legTop), legMat))
      const f = foot()
      f.position.y = -legTop
      pivot.add(f)
      root.add(pivot)
      rig.legs.push({ pivot, phase, fold: 1, restY: legTop })
    }
    if (rig.wings.length === 0) {
      for (const { pivot, side } of mirrored(
        () => {
          const g = group()
          g.rotation.set(0.25, 0, 0.5)
          g.add(mesh(hangingCapsule(s.legR * 0.95, ry * 0.85), mats.body))
          return g
        },
        rig.body,
        rx * 0.82,
        ry * 0.3,
        rz * 0.2,
      )) {
        rig.arms.push({ pivot, side, rest: pivot.rotation.clone() })
      }
    }
  } else {
    for (const { pivot, side } of mirrored(
      () => {
        const g = group()
        g.rotation.set(0.2, -0.5, -0.9)
        const f = mesh(ball(rx * 0.26, rx * 0.5, rx * 0.12), mats.body, { belly: 0.3 })
        f.position.y = -rx * 0.4
        g.add(f)
        return g
      },
      rig.body,
      rx * 0.7,
      -ry * 0.55,
      rz * 0.3,
    )) {
      rig.arms.push({ pivot, side, rest: pivot.rotation.clone() })
    }
  }

  // ───────── อบข้อมูลลาย + เส้นขอบ ─────────
  root.updateMatrixWorld(true)
  const rootInv = root.matrixWorld.clone().invert()
  const toCreature = new THREE.Matrix4()
  const v = new THREE.Vector3()
  const solids: THREE.Mesh[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) solids.push(obj)
  })
  const geometries = new Set<THREE.BufferGeometry>()
  for (const m of solids) {
    const geo = m.geometry as THREE.BufferGeometry
    geometries.add(geo)
    if (!(m.material instanceof THREE.ShaderMaterial)) continue
    const pos = geo.getAttribute('position')
    const aPat = new Float32Array(pos.count * 3)
    const aBelly = new Float32Array(pos.count)
    toCreature.multiplyMatrices(rootInv, m.matrixWorld)
    const belly = m.userData.belly as number | BellyFn
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toCreature)
      aPat.set([v.x, v.y, v.z], i * 3)
      aBelly[i] = typeof belly === 'function' ? belly(v) : belly
    }
    geo.setAttribute('aPat', new THREE.BufferAttribute(aPat, 3))
    geo.setAttribute('aBelly', new THREE.BufferAttribute(aBelly, 1))
    if (m.userData.outline) {
      const line = new THREE.Mesh(geo, mats.outline)
      line.userData.isOutline = true
      m.add(line)
    }
  }

  const box = new THREE.Box3().setFromObject(root)
  root.scale.setScalar(s.scale)
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(s.scale)

  return {
    root,
    rig,
    materials: mats,
    size,
    footprint: Math.max(rx, rz * 0.8) * s.scale * 1.25,
    dispose() {
      for (const g of geometries) g.dispose()
      for (const m of mats.all) m.dispose()
    },
  }
}
