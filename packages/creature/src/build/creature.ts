import * as THREE from 'three'
import type { BodySpec, Phenotype } from '@mochimon/core'
import { Emote } from '../fx/emote'
import { createFaceMaterials, type FaceMaterials } from '../material/face'
import { createPlushMaterials, type PlushMaterials } from '../material/plush'
import { projectedCap } from './face'
import { FieldGroup } from './field'
import {
  ball,
  batWingShape,
  bentCone,
  deformedBall,
  fanShape,
  finShape,
  fishTailShape,
  hangingCapsule,
  heartShape,
  petalShape,
  slab,
  spadeShape,
  standingCapsule,
} from './shapes'

/** น้ำหนักสีของ vertex: [สีท้อง/หน้า, ลายแต้ม] จากตำแหน่งในท่าพัก (พิกัดตัวสัตว์) */
type PaintFn = (pos: THREE.Vector3) => [number, number]

interface PartOpts {
  /** กลุ่มที่หลอมเป็นเนื้อเดียวกัน + ครึ่งแกนของทรงรี (ถ้าชิ้นนี้เป็นทรงรี) */
  group?: FieldGroup
  radii?: [number, number, number]
  paint?: PaintFn
  /** ตัวคูณความยาวขน (0 = ไม่มีขน) หรือฟังก์ชันตามตำแหน่ง */
  fur?: number | ((pos: THREE.Vector3) => number)
  /** ระยะโคน→ปลาย 0..1 จากตำแหน่งใน local ของ mesh (ใช้กับชิ้นเรืองแสง) */
  tip?: (local: THREE.Vector3) => number
}

type BasePose = 'stand' | 'sit' | 'lie' | 'curl'
/** play = ก้มเล่นลูกบอล, love = นั่งกอดหัวใจ (อ้อน) */
export type PoseName = BasePose | 'play' | 'love'

export interface LegPose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
}
/** ท่าทางของทั้งตัว — Animator จะค่อยๆ ผสมจากท่าหนึ่งไปอีกท่า */
export interface PoseDef {
  bodyY: number
  bodyZ: number
  bodyPitch: number
  headPitch: number
  headYaw: number
  headRoll: number
  headDrop: number
  tailPitch: number
  tailYaw: number
  legs: LegPose[]
}

export interface LegRig {
  pivot: THREE.Group
  phase: number
}
export interface PairRig {
  pivot: THREE.Group
  side: 1 | -1
  rest: THREE.Euler
}
export interface TailRig {
  base: THREE.Group
  joints: THREE.Group[]
  rest: number[]
  yaw: number
}

export interface Rig {
  posture: BodySpec['posture']
  body: THREE.Group
  head: THREE.Group
  headRest: THREE.Vector3
  legs: LegRig[]
  arms: PairRig[]
  ears: PairRig[]
  wings: PairRig[]
  tails: TailRig[]
  eyes: THREE.Mesh[]
  face: FaceMaterials
  /** ค่าตาเปิดพื้นฐานของชนิดตา (ตาปรือ < 1) */
  eyeOpenBase: number
  /** ไอคอนอารมณ์ลอยข้างหัว */
  emote: Emote
  poses: Record<PoseName, PoseDef>
  /** ของประกอบท่า: โผล่มาเมื่อเข้าท่านั้น */
  props: { ball: THREE.Object3D; heart: THREE.Object3D }
  canFly: boolean
}

export interface BuildOptions {
  /** คุณภาพขน: ปิด / กลาง (6 ชั้น) / สูง (12 ชั้น) */
  fur?: 'off' | 'medium' | 'high'
  /** ใส่ปลอกคอ + กระดิ่ง (เครื่องประดับ ไม่ใช่ยีนส์) */
  collar?: boolean
}

export interface BuiltCreature {
  root: THREE.Group
  rig: Rig
  materials: PlushMaterials
  /** ขนาดกล่องขอบเขตในท่ายืน (หลังคูณ scale แล้ว) */
  size: THREE.Vector3
  /** รัศมีฐานลำตัวโดยประมาณ (ไม่รวมปีก/หาง) — ใช้กับเงาและพื้นที่คลิก */
  footprint: number
  dispose(): void
}

const SHELLS = { off: 0, medium: 6, high: 16 }

/** smoothstep ที่รองรับขอบกลับด้าน (a > b) */
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const lerp = THREE.MathUtils.lerp

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, opts: PartOpts = {}) {
  const m = new THREE.Mesh(geometry, material)
  m.userData.part = opts
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
export function buildCreature(p: Phenotype, s: BodySpec, opts: BuildOptions = {}): BuiltCreature {
  const root = new THREE.Group()
  const { rx, ry, rz } = s.torso
  const R = s.headR
  const quad = s.posture === 'quad'
  const upright = s.posture === 'upright'
  const floating = s.posture === 'float'
  const legTop = floating ? 0 : s.legLen + ry * (quad ? 0.35 : 0.3)
  const standY = floating ? ry + 0.16 : s.legLen + ry * 0.93
  const headRest = quad
    ? new THREE.Vector3(0, ry * 0.36 + R * 0.76, rz * 0.5 + R * 0.34)
    : upright
      ? new THREE.Vector3(0, ry * 0.72 + R * 0.72, rz * 0.12)
      : new THREE.Vector3(0, ry * 0.12, rz * 0.62 + R * 0.3)
  const bodyCenter = new THREE.Vector3(0, standY, 0)
  const headCenter = bodyCenter.clone().add(headRest)
  const totalHeight = headCenter.y + R * 1.5

  const mats = createPlushMaterials(p, {
    height: totalHeight,
    shells: SHELLS[opts.fur ?? 'medium'],
    symbolPos: new THREE.Vector3(rx * 0.9, standY - ry * 0.05, -rz * 0.42),
    symbolSize: Math.min(ry, rz) * 0.5,
  })
  const furGene = p.nums['fur.length'] ?? 0.5
  const furry = mats.furLength > 0
  const extraMaterials: THREE.Material[] = []
  const tint = (hex: string) => {
    const m = mats.accent.clone()
    m.uniforms.uBase = { value: new THREE.Color(hex) }
    m.uniforms.uTipColor = { value: new THREE.Color(hex) }
    m.uniforms.uGlow = { value: 0 }
    extraMaterials.push(m)
    return m
  }

  const rig: Rig = {
    posture: s.posture,
    body: group(0, standY, 0),
    head: group(headRest.x, headRest.y, headRest.z),
    headRest,
    legs: [],
    arms: [],
    ears: [],
    wings: [],
    tails: [],
    eyes: [],
    face: createFaceMaterials(p.colors.eye.hex, p.parts.eyes.shape),
    eyeOpenBase: p.parts.eyes.shape === 'sleepy' ? 0.6 : 1,
    emote: new Emote(R * 0.62),
    poses: {} as Record<PoseName, PoseDef>,
    props: { ball: group(), heart: group() },
    canFly: p.habitat === 'sky',
  }
  root.add(rig.body)
  rig.body.add(rig.head)
  rig.emote.sprite.position.set(R * 0.95, R * 0.95, R * 0.2)
  rig.head.add(rig.emote.sprite)

  const mask = p.parts.mask.shape
  const socks = p.parts.socks.shape
  const tailmark = p.parts.tailmark.shape

  // ═════════ ลำตัว ═════════
  const bodyField = new FieldGroup(Math.min(rx, ry) * 0.5)
  const bodyPaint: PaintFn = (pos) => {
    const d = pos.clone().sub(bodyCenter)
    d.set(d.x / rx, d.y / ry, d.z / rz).normalize()
    const belly = upright
      ? smooth(0.42, 0.7, d.z - d.y * 0.2 - Math.abs(d.x) * 0.35)
      : smooth(0.25, 0.6, -d.y * 0.85 + d.z * 0.4)
    // ผ้าคลุมหลัง: ด้านบนและท้ายลำตัว ขอบหยักเล็กน้อยแบบขน
    const wobble = 0.07 * Math.sin(d.x * 9 + d.z * 7)
    const saddle = upright
      ? smooth(0.05, 0.45, -d.z * 0.9 + d.y * 0.25 + wobble)
      : smooth(0.1, 0.45, d.y * 0.9 - d.z * 0.45 + wobble)
    return [belly, mask === 'cape' ? saddle : 0]
  }
  const torsoGeo = deformedBall(rx, ry, rz, (v) => {
    if (upright) {
      const w = 1 + 0.16 * -v.y
      v.x *= w
      v.z *= w
      if (v.z > 0 && v.y < 0.3) v.z *= 1 + s.belly * 0.25 * (0.3 - v.y)
    } else if (v.y < 0) {
      const sag = s.belly * -v.y
      v.x *= 1 + 0.2 * sag
      v.z *= 1 + 0.1 * sag
      v.y *= 1 + 0.22 * s.belly
    }
  })
  rig.body.add(
    mesh(torsoGeo, mats.skin, { group: bodyField, radii: [rx, ry, rz], paint: bodyPaint, fur: 1 }),
  )
  // ขนฟูที่อก
  if (furry && !floating) {
    const chest = mesh(ball(rx * 0.62, ry * 0.5, rz * 0.3), mats.skin, {
      group: bodyField,
      radii: [rx * 0.62, ry * 0.5, rz * 0.3],
      paint: () => [1, 0],
      fur: 1.5,
    })
    chest.position.set(0, quad ? ry * 0.05 : ry * 0.25, quad ? rz * 0.82 : rz * 0.78)
    rig.body.add(chest)
  }

  // ═════════ หัว ═════════
  const hp = p.parts.head.params
  const snout = hp.snout ?? 0.12
  const wide = hp.wide ?? 1
  const tall = hp.tall ?? 1
  const cheeks = hp.cheeks ?? 0.4
  const longFace = snout > 0.3
  const headShape = p.parts.head.shape
  const skull = new THREE.Vector3(R * wide, R * tall, R * 0.94)
  const skullDeform = (v: THREE.Vector3) => {
    if (v.y < 0.1) v.x *= 1 + cheeks * 0.2 * smooth(0.1, -0.6, v.y)
  }
  const headField = new FieldGroup(R * 0.3)

  const sw = hp.snoutW ?? 0.46
  const muzzleR = new THREE.Vector3(
    R * sw * (longFace ? 0.74 : 0.66),
    R * sw * (longFace ? 0.6 : 0.46),
    R * (0.2 + snout * 1.15),
  )
  const muzzleC = new THREE.Vector3(
    0,
    -R * (longFace ? 0.14 : 0.27),
    R * (longFace ? 0.5 : 0.7) + (longFace ? muzzleR.z * 0.5 : 0),
  )
  const hasMuzzle = snout > 0
  const eyeDir = longFace
    ? new THREE.Vector3(0.52, 0.22, 0.82)
    : headShape === 'fish'
      ? new THREE.Vector3(0.62, 0.08, 0.76)
      : new THREE.Vector3(0.4, -0.04, 0.92)

  const headPaint: PaintFn = (pos) => {
    const u = pos.clone().sub(headCenter).divideScalar(R)
    // สีท้อง = บริเวณจมูก/ปาก
    let belly = 0
    if (hasMuzzle) {
      const m = u.clone().multiplyScalar(R).sub(muzzleC).divide(muzzleR).length()
      belly = longFace
        ? smooth(1.25, 0.9, m) * smooth(0.02, -0.12, u.y - muzzleC.y / R)
        : smooth(1.3, 0.95, m)
    }
    let mark = 0
    if (mask === 'cap' || mask === 'cape') {
      // หมวก: คลุมกระหม่อม หู ท้ายทอย เว้นหน้าไว้ มีแฉกขาวขึ้นกลางหน้าผาก
      const blaze = 0.2 + 0.3 * Math.exp(-(u.x * u.x) / 0.06)
      const edge = lerp(-0.25, blaze, smooth(-0.3, 0.5, u.z))
      const fuzz = 0.05 * Math.sin(u.x * 21) * Math.sin(u.y * 17 + u.z * 13)
      mark = smooth(edge - 0.07, edge + 0.07, u.y + fuzz)
    } else if (mask === 'bandit') {
      const d = new THREE.Vector3(Math.abs(u.x), u.y, u.z).distanceTo(eyeDir.clone().normalize())
      mark = smooth(0.52, 0.36, d)
    } else if (mask === 'points') {
      mark = Math.max(belly, smooth(0.55, 0.85, u.y + Math.abs(u.x) * 0.5))
      belly = 0
    }
    return [belly, mark]
  }
  const headFur = (pos: THREE.Vector3) => {
    const u = pos.clone().sub(headCenter).divideScalar(R)
    // หน้าขนสั้น แก้ม/ท้ายทอยขนยาว
    return (
      lerp(0.95, 0.3, smooth(0.25, 0.8, u.z)) +
      0.35 * smooth(-0.1, -0.6, u.y) * smooth(0.9, 0.4, u.z)
    )
  }

  rig.head.add(
    mesh(deformedBall(skull.x, skull.y, skull.z, skullDeform), mats.skin, {
      group: headField,
      radii: [skull.x, skull.y, skull.z],
      paint: headPaint,
      fur: headFur,
    }),
  )

  if (hasMuzzle) {
    const muzzle = group(muzzleC.x, muzzleC.y, muzzleC.z)
    muzzle.rotation.x = (hp.snoutDrop ?? 0) * 0.7
    muzzle.add(
      mesh(ball(muzzleR.x, muzzleR.y, muzzleR.z), mats.skin, {
        group: headField,
        radii: [muzzleR.x, muzzleR.y, muzzleR.z],
        paint: headPaint,
        fur: 0.08,
      }),
    )
    rig.head.add(muzzle)
    if (!longFace && headShape !== 'fish') {
      // จมูกสามเหลี่ยมมน
      const nose = mesh(ball(R * 0.075, R * 0.05, R * 0.045), mats.nose)
      nose.position.set(0, muzzleR.y * 0.42, muzzleR.z * 0.93)
      muzzle.add(nose)
    } else if (longFace) {
      for (const side of [1, -1]) {
        const nostril = mesh(ball(R * 0.035), mats.nose)
        nostril.position.set(side * muzzleR.x * 0.42, muzzleR.y * 0.5, muzzleR.z * 0.8)
        muzzle.add(nostril)
      }
    }
  }
  if (hp.beak) {
    const beak = mesh(bentCone(R * 0.22, R * (0.26 + hp.beak), 0, 12), mats.accent, {
      tip: () => 0,
    })
    beak.scale.set(1, 1, 0.72)
    beak.rotation.x = Math.PI / 2
    beak.position.set(0, -R * 0.2, R * 0.8)
    rig.head.add(beak)
  }

  // ปอยขนที่แก้ม (เฉพาะสายพันธุ์ขนฟู หน้าสั้น)
  if (furry && !longFace && headShape !== 'fish' && headShape !== 'bird') {
    const tuftLen = R * lerp(0.24, 0.52, furGene)
    for (const [dy, angle, len] of [
      [-0.16, -0.25, 1],
      [-0.34, -0.6, 0.85],
      [-0.5, -0.95, 0.6],
    ] as const) {
      mirrored(
        () => {
          const g = group()
          g.rotation.set(0, 0, -Math.PI / 2 + angle)
          const tuft = mesh(bentCone(R * 0.15, tuftLen * len, -0.25, 10), mats.skin, {
            paint: headPaint,
            fur: 1.2,
          })
          tuft.scale.z = 0.6
          g.add(tuft)
          return g
        },
        rig.head,
        skull.x * (0.86 + dy * 0.25),
        skull.y * dy,
        R * 0.08,
      )
    }
  }

  // ═════════ ดวงตา + ปาก + แก้มแดง ═════════
  const eyeW = R * (longFace ? 0.17 : 0.235) * s.eyeScale
  const eyeH = eyeW * 1.26
  const faceLift = R * 0.014 + mats.furLength * 0.45
  const face = rig.face
  extraMaterials.push(...face.all)
  ;([1, -1] as const).forEach((side, i) => {
    const dir = eyeDir
      .clone()
      .setX(eyeDir.x * side)
      .normalize()
    const eye = new THREE.Mesh(
      projectedCap({
        dir,
        halfW: eyeW,
        halfH: eyeH,
        ell: skull,
        lift: faceLift,
        deform: skullDeform,
      }),
      face.eyes[i] as THREE.ShaderMaterial,
    )
    eye.renderOrder = 3
    rig.head.add(eye)
    rig.eyes.push(eye)

    const blushDir = new THREE.Vector3(eyeDir.x * 1.5 * side, eyeDir.y - 0.4, eyeDir.z).normalize()
    const blush = new THREE.Mesh(
      projectedCap({
        dir: blushDir,
        halfW: R * 0.15,
        halfH: R * 0.09,
        ell: skull,
        lift: faceLift,
        deform: skullDeform,
      }),
      face.blush,
    )
    blush.renderOrder = 2
    rig.head.add(blush)
  })
  if (hasMuzzle && !longFace && headShape !== 'fish') {
    const mouth = new THREE.Mesh(
      projectedCap({
        dir: new THREE.Vector3(0, -0.5, 1),
        halfW: muzzleR.x * 0.78,
        halfH: muzzleR.x * 0.78,
        ell: muzzleR,
        lift: R * 0.01 + mats.furLength * 0.24,
      }),
      face.mouth,
    )
    mouth.position.copy(muzzleC)
    mouth.renderOrder = 3
    rig.head.add(mouth)
  }

  // ═════════ หู ═════════
  const ep = p.parts.ears.params
  const earLen = R * (ep.len ?? 0.5) * s.earScale
  const earW = R * (ep.width ?? 0.4)
  const earPaint: PaintFn = () => [0, mask === 'none' || mask === 'bandit' ? 0 : 1]
  const addEars = (
    x: number,
    y: number,
    z: number,
    rest: [number, number, number],
    build: () => THREE.Object3D[],
  ) => {
    for (const { pivot, side } of mirrored(
      () => {
        const g = group()
        g.rotation.set(...rest)
        g.add(...build())
        return g
      },
      rig.head,
      x * skull.x,
      y * skull.y,
      z * R,
    )) {
      rig.ears.push({ pivot, side, rest: pivot.rotation.clone() })
    }
  }
  /** หู = ด้านนอก (สีตัว) + ด้านใน (สีชมพู) ซ้อนเยื้องมาข้างหน้า */
  const earPair = (outer: THREE.BufferGeometry, inner: THREE.BufferGeometry, flat: number) => {
    const out = mesh(outer, mats.skin, { paint: earPaint, fur: 0.22 })
    out.scale.z = flat
    const inn = mesh(inner, mats.inner)
    inn.scale.set(0.66, 0.74, flat * 0.7)
    inn.position.set(0, earLen * 0.04, earW * 0.2 * flat + 0.012 + mats.furLength * 0.25)
    return [out, inn]
  }
  switch (p.parts.ears.shape) {
    case 'point':
      addEars(0.56, 0.66, 0.02, [-0.08, 0.15, -0.42], () =>
        earPair(
          bentCone(earW * 0.82, earLen * 1.25, 0.06),
          bentCone(earW * 0.82, earLen * 1.25, 0.06),
          0.42,
        ),
      )
      break
    case 'long':
      addEars(0.34, 0.8, -0.05, [-0.12, 0.1, -0.16], () =>
        earPair(standingCapsule(earW * 0.85, earLen), standingCapsule(earW * 0.85, earLen), 0.42),
      )
      break
    case 'round':
      addEars(0.66, 0.66, 0, [0, 0.1, 0], () =>
        earPair(ball(earW * 0.78 * s.earScale), ball(earW * 0.78 * s.earScale), 0.5),
      )
      break
    case 'floppy':
      addEars(0.8, 0.5, 0, [0.1, 0, -0.28], () =>
        earPair(hangingCapsule(earW * 0.8, earLen), hangingCapsule(earW * 0.8, earLen), 0.42),
      )
      break
    case 'fin':
      addEars(0.8, 0.28, -0.1, [0, -0.5, 0.5], () => [
        mesh(slab(finShape(), earLen, R * 0.06), mats.membrane, { tip: (l) => l.x / earLen }),
      ])
      break
    case 'tuft':
      addEars(0.2, 0.9, -0.05, [-0.5, 0, -0.3], () => [
        mesh(bentCone(earW * 0.5, earLen, 0.3, 8), mats.skin, { paint: earPaint, fur: 1 }),
      ])
      break
  }

  // ═════════ เขา ═════════
  const hs = s.hornScale
  const horn = (r: number, h: number, bend: number) =>
    mesh(bentCone(R * r * hs, R * h * hs, bend, 16), mats.accent, {
      tip: (l) => l.y / (R * h * hs),
    })
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
      x * skull.x,
      y * skull.y,
      z * R,
    )
  switch (p.parts.horns.shape) {
    case 'nub':
      hornPair(0.3, 0.88, 0.2, [0.2, 0, -0.25], () => horn(0.12, 0.22, 0))
      break
    case 'spiral': {
      const h = horn(0.1, 0.95, -0.06)
      h.position.set(0, skull.y * 0.86, R * 0.42)
      h.rotation.x = 0.5
      rig.head.add(h)
      break
    }
    case 'crystal': {
      const g = new THREE.OctahedronGeometry(R * 0.2 * hs)
      g.scale(0.7, 1.9, 0.7)
      const h = mesh(g, mats.accent, { tip: (l) => l.y / (R * 0.4 * hs) })
      h.position.set(0, skull.y * 1.1, R * 0.34)
      h.rotation.x = 0.35
      rig.head.add(h)
      break
    }
    case 'curved':
      // เขาโค้งเรียบชี้ขึ้น-เข้าหากันเล็กน้อย
      hornPair(0.28, 0.84, 0.12, [-0.25, 0, -0.5], () => {
        const h = horn(0.2, 0.62, 0.5)
        h.rotation.y = Math.PI / 2
        return h
      })
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
      const frill = mesh(ball(skull.x * 1.2, R * 1.1, R * 0.2), mats.skin, {
        paint: () => [0.35, mask === 'cape' ? 1 : 0],
        fur: 0,
      })
      frill.position.set(0, R * 0.3, -R * 0.5)
      frill.rotation.x = -0.35
      rig.head.add(frill)
      break
    }
  }

  // ═════════ ปีก / ครีบข้าง ═════════
  const span = (p.parts.wings.params.span ?? 1) * s.wingScale * (rx + ry) * 1.15
  const wingAnchor: [number, number, number] = upright
    ? [rx * 0.8, ry * 0.3, -rz * 0.3]
    : floating
      ? [rx * 0.86, -ry * 0.15, rz * 0.2]
      : [rx * 0.8, ry * 0.5, -rz * 0.1]
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
  /** ปีกขนนก: ขนปีกเรียงเป็นพัด 2 ชั้น */
  const featherWing = (): THREE.Object3D[] => {
    const out: THREE.Object3D[] = []
    const rows: [number, number, number, number][] = [
      // [มุม, ความยาว, ระยะเยื้องหน้า-หลัง, ความกว้าง]
      [0.62, 1.0, 0, 0.17],
      [0.3, 0.96, 0, 0.17],
      [-0.02, 0.86, 0, 0.17],
      [-0.34, 0.72, 0, 0.17],
      [-0.66, 0.56, 0, 0.17],
      [0.45, 0.6, 0.02, 0.2],
      [0.1, 0.56, 0.02, 0.2],
      [-0.28, 0.46, 0.02, 0.2],
    ]
    for (const [angle, length, zOff, width] of rows) {
      const len = span * length
      const feather = mesh(slab(petalShape(0.5, 0, 0.5, width, 0), len, 0.03), mats.membrane, {
        tip: (l) => l.x / len,
      })
      feather.rotation.z = angle
      feather.position.z = zOff
      out.push(feather)
    }
    return out
  }
  switch (p.parts.wings.shape) {
    case 'feather':
      addWings(upright ? [0.1, -0.5, -0.2] : [0.25, -0.25, 0.5], featherWing)
      break
    case 'bat':
      addWings(upright ? [0, -0.75, 0.1] : [0, -0.7, 0.4], () => [
        mesh(slab(batWingShape(), span * (upright ? 0.85 : 1.05), 0.035), mats.membrane, {
          tip: (l) => l.x / span,
        }),
      ])
      break
    case 'fairy':
      addWings(upright ? [0, -0.6, 0.15] : [0, -0.55, 0.3], () => [
        mesh(slab(petalShape(0.5, 0.3, 0.5, 0.22, 0.4), span, 0.012), mats.membrane, {
          tip: (l) => l.x / span,
        }),
        mesh(slab(petalShape(0.36, -0.16, 0.36, 0.15, -0.35), span, 0.012), mats.membrane, {
          tip: (l) => l.x / span,
        }),
      ])
      break
    case 'fin':
      addWings([0.3, -0.7, -0.35], () => [
        mesh(slab(finShape(), span * 0.8, 0.04), mats.membrane, { tip: (l) => l.x / span }),
      ])
      break
  }

  // ═════════ หาง ═════════
  const tp = p.parts.tail.params
  const tailLen = (tp.len ?? 0.5) * s.tailScale * (rz + ry) * 0.95
  const tailBase = group(
    ...((upright ? [0, -ry * 0.5, -rz * 0.84] : [0, ry * 0.15, -rz * 0.86]) as [
      number,
      number,
      number,
    ]),
  )
  rig.body.add(tailBase)
  const tailStart = bodyCenter.clone().add(tailBase.position)
  const tailPaint: PaintFn = (pos) => {
    const t = THREE.MathUtils.clamp(pos.distanceTo(tailStart) / Math.max(tailLen, 0.01), 0, 1)
    if (tailmark === 'tip') return [0, smooth(0.25, 0.7, t)]
    if (tailmark === 'rings') return [0, smooth(0.25, 0.5, Math.sin(t * 16))]
    return [0, mask === 'points' ? 1 : 0]
  }
  /** หางเป็นโซ่ข้อต่อ: แต่ละข้อเป็นลูกกลมซ้อนกัน ยื่นไปทาง -Z */
  const chain = (
    count: number,
    radius: (t: number) => number,
    curl: number,
    yaw = 0,
    cfg: { mat?: THREE.Material; fur?: number; belly?: number } = {},
  ): THREE.Group => {
    const joints: THREE.Group[] = []
    const step = tailLen / count
    const field = new FieldGroup(step * 0.6)
    let parent: THREE.Object3D = tailBase
    for (let i = 0; i < count; i++) {
      const joint = group(0, 0, i === 0 ? 0 : -step)
      joint.rotation.x = curl
      if (i === 0) joint.rotation.y = yaw
      const r = radius(i / Math.max(1, count - 1))
      const rzSeg = Math.max(r, step)
      const skinMat = !cfg.mat || cfg.mat === mats.skin
      const seg = mesh(ball(r, r, rzSeg), cfg.mat ?? mats.skin, {
        group: skinMat ? field : undefined,
        radii: [r, r, rzSeg],
        paint: cfg.belly ? () => [cfg.belly as number, 0] : tailPaint,
        fur: cfg.fur ?? 0.8,
        tip: () => i / Math.max(1, count - 1),
      })
      seg.position.z = -step * 0.5
      joint.add(seg)
      parent.add(joint)
      parent = joint
      joints.push(joint)
    }
    rig.tails.push({ base: tailBase, joints, rest: joints.map((j) => j.rotation.x), yaw })
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
      chain(7, (t) => lerp(0.055, 0.042, t), 0.24, 0, { fur: 0.6 })
      break
    case 'fluffy':
      // หางฟูทรงหยดน้ำ: โคนเรียว กลางป่อง ปลายมน
      chain(6, (t) => baseR * (0.8 + 1.75 * Math.sin(Math.PI * Math.pow(t, 0.7) * 0.9)), 0.1, 0, {
        fur: 2.1,
      })
      break
    case 'twin':
      chain(7, (t) => lerp(0.05, 0.038, t), 0.24, 0.38, { fur: 0.6 })
      chain(7, (t) => lerp(0.05, 0.038, t), 0.24, -0.38, { fur: 0.6 })
      break
    case 'pom':
      chain(1, () => 0.12 * s.tailScale, 0.2, 0, { belly: 1, fur: 1.8 })
      break
    case 'thick':
      chain(6, (t) => lerp(baseR * 0.95, 0.035, t), 0.07, 0, { fur: 0.5 })
      break
    case 'spade': {
      const tip = chain(7, (t) => lerp(baseR * 0.7, 0.03, t), 0.12, 0, { fur: 0.4 })
      const spade = mesh(slab(spadeShape(), 0.2 * s.tailScale, 0.04), mats.accent, {
        tip: (l) => l.x / 0.2,
      })
      spade.rotation.set(0, Math.PI / 2, 0)
      spade.position.z = 0.03
      tip.add(spade)
      break
    }
    case 'flowy':
      chain(5, (t) => 0.05 + Math.sin(t * Math.PI * 0.85) * 0.075, -0.2, 0, { mat: mats.accent })
      break
    case 'fan': {
      const tip = chain(1, () => baseR * 0.35, 0.5)
      const fan = mesh(slab(fanShape(), tailLen * 1.1, 0.04), mats.skin, {
        paint: tailPaint,
        fur: 0,
      })
      fan.rotation.x = -Math.PI / 2 + 0.2
      fan.position.z = tailLen * 0.7
      tip.add(fan)
      break
    }
    case 'fish': {
      const tip = chain(3, (t) => lerp(baseR * 0.75, baseR * 0.28, t), 0, 0, { fur: 0 })
      const fin = mesh(slab(fishTailShape(), tailLen * 0.85, 0.035), mats.membrane, {
        tip: (l) => l.x / (tailLen * 0.85),
      })
      fin.rotation.y = Math.PI / 2
      fin.position.z = tailLen * 0.12
      tip.add(fin)
      break
    }
  }

  // ═════════ ขา / แขน / ครีบ ═════════
  const limb = p.parts.limbs.shape
  const legPaint: PaintFn = (pos) => {
    if (socks === 'socks') return [0, smooth(legTop * 0.55, legTop * 0.3, pos.y)]
    if (socks === 'gloves') return [0, smooth(legTop * 1.0, legTop * 0.75, pos.y)]
    return [0, mask === 'points' ? smooth(legTop * 0.7, legTop * 0.3, pos.y) : 0]
  }
  const addLeg = (
    x: number,
    z: number,
    phase: number,
    r: number,
    cfg: { foot: () => THREE.Object3D; haunch?: number; mat?: THREE.Material },
  ) => {
    const pivot = group(x, legTop, z)
    const skinMat = !cfg.mat
    pivot.add(
      mesh(hangingCapsule(r, legTop), cfg.mat ?? mats.skin, {
        paint: legPaint,
        fur: skinMat ? 0.6 : 0,
      }),
    )
    const foot = cfg.foot()
    foot.position.y = -legTop
    pivot.add(foot)
    if (cfg.haunch) {
      // โคนขาหลังอวบๆ — เห็นชัดตอนนั่ง
      const h = cfg.haunch
      pivot.add(
        mesh(ball(h * 0.8, h, h * 0.95), mats.skin, {
          radii: [h * 0.8, h, h * 0.95],
          paint: bodyPaint,
          fur: 0.9,
        }),
      )
    }
    root.add(pivot)
    rig.legs.push({ pivot, phase })
  }
  const lx = rx * 0.6
  const lz = rz * 0.5
  if (quad) {
    const hoof = limb === 'hoof'
    const r = s.legR * (hoof ? 0.85 : 1.08)
    const foot = () => {
      const g = group()
      if (hoof) {
        const h = mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.12, r * 1.3, 14), mats.accent, {
          tip: () => 0,
        })
        h.position.y = r * 0.65
        g.add(h)
      } else {
        const paw = mesh(ball(r * 1.22, r * 0.82, r * 1.5), mats.skin, {
          radii: [r * 1.22, r * 0.82, r * 1.5],
          paint: legPaint,
          fur: 0.45,
        })
        paw.position.set(0, r * 0.75, r * 0.4)
        g.add(paw)
      }
      return g
    }
    addLeg(lx, lz, 0, r, { foot })
    addLeg(-lx, lz, Math.PI, r, { foot })
    addLeg(lx, -lz, Math.PI, r, { foot, haunch: ry * 0.62 })
    addLeg(-lx, -lz, 0, r, { foot, haunch: ry * 0.62 })
  } else if (upright) {
    const bird = limb === 'biped'
    const r = s.legR * (bird ? 0.8 : 1.25)
    const foot = () => {
      const g = group()
      const f = mesh(ball(r * 1.5, r * 0.6, r * 2.1), bird ? mats.accent : mats.skin, {
        paint: legPaint,
        fur: bird ? 0 : 0.4,
        tip: () => 0,
      })
      f.position.set(0, r * 0.55, r * 0.9)
      g.add(f)
      return g
    }
    addLeg(rx * 0.48, 0, 0, r, { foot, mat: bird ? mats.accent : undefined })
    addLeg(-rx * 0.48, 0, Math.PI, r, { foot, mat: bird ? mats.accent : undefined })
    if (rig.wings.length === 0) {
      for (const { pivot, side } of mirrored(
        () => {
          const g = group()
          g.rotation.set(0.25, 0, 0.5)
          g.add(
            mesh(hangingCapsule(s.legR * 0.95, ry * 0.85), mats.skin, {
              paint: legPaint,
              fur: 0.6,
            }),
          )
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
        const f = mesh(ball(rx * 0.26, rx * 0.5, rx * 0.12), mats.skin, {
          paint: () => [0.3, 0],
          fur: 0,
        })
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

  // ═════════ ปลอกคอ + กระดิ่ง ═════════
  if (opts.collar && !floating) {
    const axis = headRest.clone().normalize()
    const neckR = Math.min(rx * 1.02, R * 0.66) + mats.furLength * 1.5
    const collar = group()
    collar.position.copy(headRest).multiplyScalar(quad ? 0.4 : 0.5)
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
    const band = mesh(new THREE.TorusGeometry(neckR, 0.05, 10, 40), tint('#d8455c'), {
      tip: () => 0,
    })
    collar.add(band)
    const bell = mesh(ball(0.068), tint('#f2c14e'), { tip: () => 0.6 })
    // จุดต่ำสุดด้านหน้าของห่วง
    const down = new THREE.Vector3(0, -axis.z, axis.y).normalize()
    bell.position
      .copy(down.applyQuaternion(collar.quaternion.clone().invert()))
      .multiplyScalar(neckR + 0.035)
    collar.add(bell)
    rig.body.add(collar)
  }

  // ═════════ ท่าทาง ═════════
  const zeroHead = { headPitch: 0, headYaw: 0, headRoll: 0, headDrop: 0, tailPitch: 0, tailYaw: 0 }
  const legAt = (x: number, y: number, z: number, rxAngle = 0, ryAngle = 0): LegPose => ({
    x,
    y,
    z,
    rx: rxAngle,
    ry: ryAngle,
  })
  let basePoses: Record<BasePose, PoseDef>
  if (quad) {
    const pitch = -0.82
    const sitY = Math.hypot(ry * Math.cos(pitch), rz * Math.sin(pitch)) * 0.98
    const low = s.legR * 1.15
    basePoses = {
      stand: {
        bodyY: standY,
        bodyZ: 0,
        bodyPitch: 0,
        ...zeroHead,
        legs: [
          legAt(lx, legTop, lz),
          legAt(-lx, legTop, lz),
          legAt(lx, legTop, -lz),
          legAt(-lx, legTop, -lz),
        ],
      },
      sit: {
        bodyY: sitY,
        bodyZ: -rz * 0.12,
        bodyPitch: pitch,
        ...zeroHead,
        tailPitch: -pitch + 0.36,
        tailYaw: 2.2,
        legs: [
          legAt(rx * 0.44, legTop, rz * 0.34),
          legAt(-rx * 0.44, legTop, rz * 0.34),
          legAt(rx * 0.92, low, -rz * 0.2, -1.42, 0.38),
          legAt(-rx * 0.92, low, -rz * 0.2, -1.42, -0.38),
        ],
      },
      lie: {
        bodyY: ry * 0.94,
        bodyZ: 0,
        bodyPitch: 0,
        ...zeroHead,
        headPitch: 0.08,
        headDrop: R * 0.3,
        tailYaw: 0.9,
        legs: [
          legAt(rx * 0.5, low, rz * 0.55, -1.45, 0.1),
          legAt(-rx * 0.5, low, rz * 0.55, -1.45, -0.1),
          legAt(rx * 0.85, low, -rz * 0.3, -1.45, 0.4),
          legAt(-rx * 0.85, low, -rz * 0.3, -1.45, -0.4),
        ],
      },
      curl: {
        bodyY: ry * 0.94,
        bodyZ: 0,
        bodyPitch: 0,
        ...zeroHead,
        headPitch: 0.16,
        headYaw: 0.5,
        headRoll: 0.28,
        headDrop: R * 0.36,
        tailYaw: 1.7,
        legs: [
          legAt(rx * 0.5, low, rz * 0.5, -1.45, 0.5),
          legAt(-rx * 0.4, low, rz * 0.5, -1.45, 0.3),
          legAt(rx * 0.85, low, -rz * 0.3, -1.45, 0.5),
          legAt(-rx * 0.8, low, -rz * 0.3, -1.45, -0.2),
        ],
      },
    }
  } else if (upright) {
    const legs = [legAt(rx * 0.48, legTop, 0), legAt(-rx * 0.48, legTop, 0)]
    const squat = s.legLen * 0.75
    const sitLegs = [
      legAt(rx * 0.52, legTop - squat, rz * 0.1, -1.1, 0.2),
      legAt(-rx * 0.52, legTop - squat, rz * 0.1, -1.1, -0.2),
    ]
    const stand = { bodyY: standY, bodyZ: 0, bodyPitch: 0, ...zeroHead, legs }
    basePoses = {
      stand,
      sit: stand,
      lie: { ...stand, bodyY: standY - squat, headDrop: R * 0.1, headPitch: 0.1, legs: sitLegs },
      curl: {
        ...stand,
        bodyY: standY - squat,
        headDrop: R * 0.16,
        headPitch: 0.22,
        headRoll: 0.15,
        legs: sitLegs,
      },
    }
  } else {
    const swim = { bodyY: standY, bodyZ: 0, bodyPitch: 0, ...zeroHead, legs: [] }
    basePoses = {
      stand: swim,
      sit: swim,
      lie: { ...swim, bodyY: ry + 0.05 },
      curl: { ...swim, bodyY: ry + 0.05 },
    }
  }

  // ท่าเล่น (ก้มหน้า ก้นโด่ง หางชี้) และท่าอ้อน (นั่งกอดหัวใจ) ต่อยอดจากท่าพื้นฐาน
  const hindStand = basePoses.stand.legs.slice(2)
  const hindSit = basePoses.sit.legs.slice(2)
  const chestY = basePoses.sit.bodyY + ry * 0.2
  rig.poses = {
    ...basePoses,
    play: quad
      ? {
          ...basePoses.stand,
          bodyY: standY - legTop * 0.22,
          bodyPitch: 0.36,
          headPitch: -0.12,
          tailPitch: 0.55,
          legs: [
            legAt(lx, legTop * 0.6, lz + rz * 0.3, -0.95, 0.25),
            legAt(-lx, legTop * 0.6, lz + rz * 0.3, -0.95, -0.25),
            ...hindStand,
          ],
        }
      : { ...basePoses.stand, headPitch: 0.12 },
    love: quad
      ? {
          ...basePoses.sit,
          headRoll: 0.14,
          legs: [
            legAt(rx * 0.8, chestY, rz * 0.12, -1.25, -0.6),
            legAt(-rx * 0.8, chestY, rz * 0.12, -1.25, 0.6),
            ...hindSit,
          ],
        }
      : { ...basePoses.stand, headRoll: 0.14 },
  }
  // ของประกอบ: ลูกบอล (วางบนพื้นหน้าตัว) และหัวใจ (กอดไว้ที่อก)
  const ballR = 0.1
  const ball3d = mesh(ball(ballR), tint('#7fb2ff'), { tip: (l) => (l.y / ballR + 1) / 2 })
  rig.props.ball.add(ball3d)
  rig.props.ball.position.set(0, ballR, (quad ? rz : rz * 0.6) + R * 1.15)
  const heartSize = Math.min(rx, R * 0.6) * 1.15
  rig.props.heart.add(
    mesh(slab(heartShape(), heartSize, heartSize * 0.42), tint('#ff7d9c'), { tip: () => 0.3 }),
  )
  rig.props.heart.position.set(
    0,
    quad ? chestY - ry * 0.05 : standY + ry * 0.1,
    (quad ? rz * 0.2 : rz) + legTop * (quad ? 1.05 : 0.5),
  )
  for (const prop of Object.values(rig.props)) {
    prop.visible = false
    root.add(prop)
  }

  // ═════════ อบข้อมูลต่อ vertex: หลอมรอยต่อ + สี + ขน ═════════
  root.updateMatrixWorld(true)
  const rootInv = root.matrixWorld.clone().invert()
  const meshes: THREE.Mesh[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) meshes.push(obj)
  })
  const toCreature = new Map<THREE.Mesh, THREE.Matrix4>()
  /** ทรงรีทุกชิ้น: ใช้ทำเงาซอกมุมข้ามชิ้นส่วน (ใต้คาง โคนขา ฯลฯ) */
  const occluders: { inv: THREE.Matrix4; minR: number; owner: unknown }[] = []
  for (const m of meshes) {
    const matrix = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld)
    toCreature.set(m, matrix)
    const part = m.userData.part as PartOpts | undefined
    if (!part?.radii) continue
    const ell = matrix.clone().multiply(new THREE.Matrix4().makeScale(...part.radii))
    part.group?.addEllipsoid(ell)
    occluders.push({
      inv: ell.clone().invert(),
      minR: Math.min(...part.radii),
      owner: part.group ?? m,
    })
  }
  const q = new THREE.Vector3()
  const occlusion = (pos: THREE.Vector3, owner: unknown): number => {
    let nearest = Infinity
    for (const o of occluders) {
      if (o.owner === owner) continue
      const d = (q.copy(pos).applyMatrix4(o.inv).length() - 1) * o.minR
      if (d < nearest) nearest = d
    }
    return lerp(0.35, 1, smooth(-0.03, 0.17, nearest))
  }

  const geometries = new Set<THREE.BufferGeometry>()
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  const g = new THREE.Vector3()
  const local = new THREE.Vector3()
  for (const m of meshes) {
    const geo = m.geometry as THREE.BufferGeometry
    geometries.add(geo)
    const part = m.userData.part as PartOpts | undefined
    if (!part || !(m.material instanceof THREE.ShaderMaterial)) continue
    const matrix = toCreature.get(m) as THREE.Matrix4
    const inverse = matrix.clone().invert()
    const normalToCreature = new THREE.Matrix3().getNormalMatrix(matrix)
    const normalToLocal = new THREE.Matrix3().setFromMatrix4(matrix).transpose()
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute
    const aPat = new Float32Array(pos.count * 3)
    const aPaint = new Float32Array(pos.count * 4)
    const aFur = new Float32Array(pos.count)

    for (let i = 0; i < pos.count; i++) {
      local.fromBufferAttribute(pos, i)
      v.copy(local).applyMatrix4(matrix)
      n.fromBufferAttribute(nor, i).applyMatrix3(normalToCreature).normalize()
      let ao = occlusion(v, part.group ?? m)
      if (part.group) {
        const fillet = part.group.sample(v, g)
        if (fillet > 0) {
          const k = part.group.k
          // ดัน vertex ออกไปบนผิวที่หลอมแล้ว + ใช้ normal ของสนามรวมตรงรอยต่อ
          v.addScaledVector(g, fillet)
          const w = Math.min(1, (fillet / (k * 0.25)) * 1.6)
          n.lerp(g, w).normalize()
          ao *= 1 - 0.3 * Math.min(1, fillet / (k * 0.25))
          pos.setXYZ(i, ...v.clone().applyMatrix4(inverse).toArray())
          nor.setXYZ(i, ...n.clone().applyMatrix3(normalToLocal).normalize().toArray())
        }
      }
      aPat.set([v.x, v.y, v.z], i * 3)
      const [belly, mark] = part.paint ? part.paint(v) : [0, 0]
      aPaint.set(
        [belly, mark, part.tip ? THREE.MathUtils.clamp(part.tip(local), 0, 1) : 0, ao],
        i * 4,
      )
      aFur[i] = typeof part.fur === 'function' ? part.fur(v) : (part.fur ?? 0)
    }
    pos.needsUpdate = true
    nor.needsUpdate = true
    geo.setAttribute('aPat', new THREE.BufferAttribute(aPat, 3))
    geo.setAttribute('aPaint', new THREE.BufferAttribute(aPaint, 4))
    geo.setAttribute('aFur', new THREE.BufferAttribute(aFur, 1))

    if (mats.shell && m.material === mats.skin && part.fur) {
      const fur = new THREE.InstancedMesh(geo, mats.shell, mats.shells)
      fur.frustumCulled = false
      fur.userData.isFur = true
      m.add(fur)
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
      for (const geo of geometries) geo.dispose()
      for (const m of mats.all) m.dispose()
      for (const m of extraMaterials) m.dispose()
      rig.emote.dispose()
    },
  }
}
