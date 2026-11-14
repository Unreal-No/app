import * as THREE from 'three'
import type { EmotionLabel } from '@mochimon/core'
import type { LegPose, PoseDef, PoseName, Rig } from '../build/creature'
import { FACES, type FacePose } from './expression'

export interface AnimInput {
  /** ความเร็วการเดิน 0..1 (0 = ยืนนิ่ง) */
  speed: number
  emotion: EmotionLabel
  asleep: boolean
  /** ทิศที่มอง -1..1 (x: ซ้าย-ขวา, y: ล่าง-บน) */
  lookX: number
  lookY: number
  flying: boolean
  /** ถูกอุ้ม/ลากอยู่ → ขาห้อย ดิ้นเบาๆ */
  held: boolean
  /** ท่าทาง: 'auto' = นั่งตอนพัก ยืนตอนเดิน นอนขดตอนหลับ */
  pose: PoseName | 'auto'
}

export const defaultAnimInput = (): AnimInput => ({
  speed: 0,
  emotion: 'content',
  asleep: false,
  lookX: 0,
  lookY: 0,
  flying: false,
  held: false,
  pose: 'auto',
})

interface Mood {
  tailAmp: number
  tailSpeed: number
  /** หัวตก (เรเดียน) */
  droop: number
  /** หูลู่ */
  earDroop: number
  /** เด้งดึ๋ง */
  hop: number
  shiver: number
  /** เอียงคอ */
  tilt: number
}

const mood = (over: Partial<Mood>): Mood => ({
  tailAmp: 0.2,
  tailSpeed: 3,
  droop: 0,
  earDroop: 0,
  hop: 0,
  shiver: 0,
  tilt: 0,
  ...over,
})

const MOODS: Record<EmotionLabel, Mood> = {
  joyful: mood({ tailAmp: 0.5, tailSpeed: 9, droop: -0.05, hop: 0.25 }),
  excited: mood({ tailAmp: 0.65, tailSpeed: 13, droop: -0.08, earDroop: -0.1, hop: 1 }),
  content: mood({ tailAmp: 0.22, tailSpeed: 3 }),
  curious: mood({ tailAmp: 0.3, tailSpeed: 5, earDroop: -0.15, tilt: 0.3 }),
  shy: mood({ tailAmp: 0.12, tailSpeed: 4, droop: 0.14, earDroop: 0.3, tilt: -0.12 }),
  sleepy: mood({ tailAmp: 0.06, tailSpeed: 1.5, droop: 0.18, earDroop: 0.25 }),
  hungry: mood({ tailAmp: 0.15, tailSpeed: 2.5, droop: 0.08, earDroop: 0.15 }),
  lonely: mood({ tailAmp: 0.05, tailSpeed: 1, droop: 0.25, earDroop: 0.45 }),
  bored: mood({ tailAmp: 0.1, tailSpeed: 1.5, droop: 0.12, earDroop: 0.2 }),
  grumpy: mood({ tailAmp: 0.35, tailSpeed: 7, droop: 0.1, earDroop: 0.5 }),
  sad: mood({ tailAmp: 0.04, tailSpeed: 1, droop: 0.3, earDroop: 0.5 }),
  scared: mood({ tailAmp: 0.08, tailSpeed: 16, droop: 0.15, earDroop: 0.6, shiver: 1 }),
}

const damp = (current: number, target: number, rate: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt))

const clonePose = (pose: PoseDef): PoseDef => ({ ...pose, legs: pose.legs.map((l) => ({ ...l })) })

const POSE_KEYS = [
  'bodyY',
  'bodyZ',
  'bodyPitch',
  'headPitch',
  'headYaw',
  'headRoll',
  'headDrop',
  'tailPitch',
  'tailYaw',
] as const
const LEG_KEYS = ['x', 'y', 'z', 'rx', 'ry'] as const satisfies readonly (keyof LegPose)[]

/** สถานะ animation ที่สะสมข้ามเฟรม */
export class Animator {
  private t = Math.random() * 10
  private gait = 0
  private sleep = 0
  private held = 0
  private fly = 0
  private walk = 0
  private blinkIn = 1 + Math.random() * 3
  private blink = 0
  private twitchIn = 2 + Math.random() * 4
  private twitch = 0
  private lookPitch = 0
  private mood: Mood = { ...MOODS.content }
  private pose: PoseDef
  private face: FacePose = { ...FACES.content }

  constructor(private readonly rig: Rig) {
    this.pose = clonePose(rig.poses[rig.posture === 'quad' ? 'sit' : 'stand'])
  }

  /** ข้ามการค่อยๆ เปลี่ยน: เข้าท่า/สีหน้าเป้าหมายทันที (ใช้ตอนจับภาพนิ่ง) */
  snap(input: AnimInput): void {
    for (let i = 0; i < 40; i++) this.update(0.1, input)
  }

  private targetPose(input: AnimInput): PoseName {
    if (input.pose !== 'auto') return input.pose
    if (input.held || input.speed > 0.02) return 'stand'
    if (input.asleep) return 'curl'
    return this.rig.posture === 'quad' ? 'sit' : 'stand'
  }

  update(dt: number, input: AnimInput): void {
    const rig = this.rig
    dt = Math.min(dt, 0.1)
    this.t += dt
    const t = this.t
    const target = MOODS[input.emotion]
    for (const key of Object.keys(this.mood) as (keyof Mood)[]) {
      this.mood[key] = damp(this.mood[key], target[key], 4, dt)
    }
    const m = this.mood
    this.sleep = damp(this.sleep, input.asleep ? 1 : 0, 3, dt)
    this.held = damp(this.held, input.held ? 1 : 0, 10, dt)
    this.fly = damp(this.fly, input.flying && rig.canFly ? 1 : 0, 4, dt)
    this.walk = damp(this.walk, input.asleep ? 0 : input.speed, 8, dt)
    const awake = 1 - this.sleep
    const walk = this.walk
    this.gait += dt * (5 + walk * 7) * (walk > 0.02 ? 1 : 0)
    const floating = rig.posture === 'float'

    // ── ผสมท่าทาง ──
    const goal = rig.poses[this.targetPose(input)]
    const pose = this.pose
    for (const key of POSE_KEYS) pose[key] = damp(pose[key], goal[key], 7, dt)
    pose.legs.forEach((leg, i) => {
      const to = goal.legs[i]
      if (to) for (const key of LEG_KEYS) leg[key] = damp(leg[key], to[key], 7, dt)
    })

    // ── ลำตัว: หายใจ, เด้งตามก้าว ──
    const breatheSpeed = lerp(2.2, 1.1, this.sleep)
    const breathe = Math.sin(t * breatheSpeed) * lerp(0.012, 0.03, this.sleep)
    const hop = m.hop * awake * Math.abs(Math.sin(t * 6)) * 0.06 * (1 - this.held)
    const bob = floating ? Math.sin(t * 1.6) * 0.035 : Math.abs(Math.sin(this.gait)) * 0.03 * walk
    rig.body.position.set(m.shiver * Math.sin(t * 55) * 0.006, pose.bodyY + bob + hop, pose.bodyZ)
    rig.body.scale.set(1 + breathe * 0.6, 1 + breathe, 1 + breathe * 0.6)
    rig.body.rotation.x = pose.bodyPitch + (floating ? Math.sin(t * 1.6 + 1) * 0.05 : 0)
    rig.body.rotation.z = Math.sin(this.gait) * 0.045 * walk

    // ── หัว: ตั้งตรงเสมอแม้ลำตัวเอน, มองตาม, เอียงคอ ──
    const idleTilt = Math.sin(t * 0.7) * 0.04
    const lookYaw = input.lookX * 0.5 * awake
    const lookPitch = -input.lookY * 0.28 * awake + m.droop * awake
    rig.head.position.set(
      rig.headRest.x,
      rig.headRest.y - pose.headDrop,
      rig.headRest.z + pose.headDrop * 0.4,
    )
    this.lookPitch = damp(this.lookPitch, lookPitch, 8, dt)
    rig.head.rotation.x = -pose.bodyPitch + pose.headPitch + this.lookPitch
    rig.head.rotation.y = damp(rig.head.rotation.y, pose.headYaw + lookYaw, 8, dt)
    rig.head.rotation.z =
      pose.headRoll + (idleTilt + m.tilt) * awake + Math.sin(this.gait) * 0.03 * walk

    // ── ขา ──
    rig.legs.forEach((leg, i) => {
      const p = pose.legs[i]
      if (!p) return
      const swing = Math.sin(this.gait + leg.phase) * 0.55 * walk
      const dangle = this.held * (0.2 + Math.sin(t * 9 + leg.phase) * 0.25)
      leg.pivot.position.set(p.x, p.y + hop + bob, p.z)
      leg.pivot.rotation.set(p.rx + swing + dangle, p.ry, 0)
    })
    for (const arm of rig.arms) {
      const sway = Math.sin(this.gait + (arm.side > 0 ? Math.PI : 0)) * 0.5 * walk
      const paddle = floating ? Math.sin(t * 3 + arm.side) * 0.25 : 0
      arm.pivot.rotation.x = arm.rest.x + sway + paddle
      arm.pivot.rotation.z = arm.rest.z + this.held * 0.6 + m.hop * awake * 0.5
    }

    // ── หาง: คลื่นไล่ตามข้อ ──
    for (const tail of rig.tails) {
      const count = tail.joints.length
      tail.base.rotation.x = pose.tailPitch
      tail.joints.forEach((joint, i) => {
        const lag = i * 0.55
        const amp = (m.tailAmp * awake + 0.03) / Math.sqrt(count)
        const sway = Math.sin(t * m.tailSpeed - lag) * amp * (0.6 + i / count)
        const wrap = pose.tailYaw / count
        joint.rotation.y =
          (i === 0 ? tail.yaw : 0) + wrap + sway + (floating ? Math.sin(t * 4 - lag) * 0.12 : 0)
        joint.rotation.x =
          (tail.rest[i] ?? 0) * (1 - m.shiver * 1.6) + Math.sin(t * 1.3 - lag) * 0.02
      })
    }

    // ── หู: ลู่ตามอารมณ์ + กระตุกเป็นครั้งคราว ──
    this.twitchIn -= dt
    if (this.twitchIn <= 0) {
      this.twitch = 1
      this.twitchIn = 2.5 + Math.random() * 5
    }
    this.twitch = Math.max(0, this.twitch - dt * 5)
    const flick = Math.sin(this.twitch * Math.PI * 2) * 0.2 * awake
    for (const ear of rig.ears) {
      ear.pivot.rotation.z = ear.rest.z - (m.earDroop + this.sleep * 0.3) * 0.9 + flick
      ear.pivot.rotation.x = ear.rest.x - m.earDroop * 0.3 + Math.sin(this.gait * 2) * 0.05 * walk
    }

    // ── ปีก ──
    const flapAmp = 0.07 + this.fly * 0.6 + m.hop * 0.25 * awake + this.held * 0.35
    const flapSpeed = 2.5 + this.fly * 11 + m.hop * 8 + this.held * 10
    for (const wing of rig.wings) {
      wing.pivot.rotation.z = wing.rest.z + Math.sin(t * flapSpeed) * flapAmp - this.sleep * 0.4
      wing.pivot.rotation.y = wing.rest.y - this.sleep * 0.3
    }

    // ── ใบหน้า ──
    const face = this.face
    const want = FACES[input.asleep ? 'sleepy' : input.emotion]
    face.open = damp(face.open, want.open, 12, dt)
    face.slant = damp(face.slant, want.slant, 10, dt)
    face.wide = damp(face.wide, want.wide, 10, dt)
    face.mouthOpen = damp(face.mouthOpen, want.mouthOpen, 12, dt)
    face.blush = damp(face.blush, want.blush, 6, dt)
    face.smile = want.smile
    face.mouth = want.mouth

    this.blinkIn -= dt
    if (this.blinkIn <= 0) {
      this.blink = 1
      this.blinkIn = 2 + Math.random() * 4
    }
    this.blink = Math.max(0, this.blink - dt * 7)
    const open = face.open * rig.eyeOpenBase * (1 - Math.sin(this.blink * Math.PI))
    const eyeUniforms = rig.face.eyes[0].uniforms
    ;(eyeUniforms.uOpen as THREE.IUniform<number>).value = open
    ;(eyeUniforms.uSmile as THREE.IUniform<number>).value = face.smile ? 1 : 0
    ;(eyeUniforms.uSlant as THREE.IUniform<number>).value = face.slant
    ;(eyeUniforms.uLook as THREE.IUniform<THREE.Vector2>).value.set(input.lookX, input.lookY)
    const mouthUniforms = rig.face.mouth.uniforms
    ;(mouthUniforms.uShape as THREE.IUniform<number>).value = face.mouth
    ;(mouthUniforms.uOpen as THREE.IUniform<number>).value = face.mouthOpen
    ;(rig.face.blush.uniforms.uStrength as THREE.IUniform<number>).value = face.blush
  }
}

const lerp = THREE.MathUtils.lerp
