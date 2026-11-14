import * as THREE from 'three'
import type { EmotionLabel } from '@mochimon/core'
import type { Rig } from '../build/creature'

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
}

export const defaultAnimInput = (): AnimInput => ({
  speed: 0,
  emotion: 'content',
  asleep: false,
  lookX: 0,
  lookY: 0,
  flying: false,
  held: false,
})

interface Mood {
  tailAmp: number
  tailSpeed: number
  /** หัวตก (เรเดียน) */
  droop: number
  /** หูลู่ */
  earDroop: number
  /** ตาเปิด (คูณกับค่าพื้นฐานของชนิดตา) */
  eyes: number
  /** เด้งดึ๋ง */
  hop: number
  shiver: number
}

const MOODS: Record<EmotionLabel, Mood> = {
  joyful: { tailAmp: 0.5, tailSpeed: 9, droop: -0.05, earDroop: 0, eyes: 1, hop: 0.25, shiver: 0 },
  excited: {
    tailAmp: 0.65,
    tailSpeed: 13,
    droop: -0.08,
    earDroop: -0.1,
    eyes: 1.1,
    hop: 1,
    shiver: 0,
  },
  content: { tailAmp: 0.25, tailSpeed: 3, droop: 0, earDroop: 0, eyes: 1, hop: 0, shiver: 0 },
  sleepy: {
    tailAmp: 0.06,
    tailSpeed: 1.5,
    droop: 0.18,
    earDroop: 0.25,
    eyes: 0.45,
    hop: 0,
    shiver: 0,
  },
  hungry: {
    tailAmp: 0.15,
    tailSpeed: 2.5,
    droop: 0.08,
    earDroop: 0.15,
    eyes: 0.9,
    hop: 0,
    shiver: 0,
  },
  lonely: {
    tailAmp: 0.05,
    tailSpeed: 1,
    droop: 0.25,
    earDroop: 0.45,
    eyes: 0.8,
    hop: 0,
    shiver: 0,
  },
  bored: { tailAmp: 0.1, tailSpeed: 1.5, droop: 0.12, earDroop: 0.2, eyes: 0.7, hop: 0, shiver: 0 },
  grumpy: { tailAmp: 0.35, tailSpeed: 7, droop: 0.1, earDroop: 0.5, eyes: 0.6, hop: 0, shiver: 0 },
  sad: { tailAmp: 0.04, tailSpeed: 1, droop: 0.3, earDroop: 0.5, eyes: 0.75, hop: 0, shiver: 0 },
  scared: {
    tailAmp: 0.08,
    tailSpeed: 16,
    droop: 0.15,
    earDroop: 0.6,
    eyes: 1.2,
    hop: 0,
    shiver: 1,
  },
}

const damp = (current: number, target: number, rate: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt))

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
  private mood: Mood = { ...MOODS.content }

  constructor(private readonly rig: Rig) {}

  update(dt: number, input: AnimInput): void {
    const rig = this.rig
    dt = Math.min(dt, 0.1)
    this.t += dt
    const t = this.t
    const target = MOODS[input.emotion]
    for (const key of Object.keys(this.mood) as (keyof Mood)[]) {
      this.mood[key] = damp(this.mood[key], target[key], 4, dt)
    }
    const mood = this.mood
    this.sleep = damp(this.sleep, input.asleep ? 1 : 0, 3, dt)
    this.held = damp(this.held, input.held ? 1 : 0, 10, dt)
    this.fly = damp(this.fly, input.flying && rig.canFly ? 1 : 0, 4, dt)
    this.walk = damp(this.walk, input.asleep ? 0 : input.speed, 8, dt)
    const awake = 1 - this.sleep
    const walk = this.walk
    this.gait += dt * (5 + walk * 7) * (walk > 0.02 ? 1 : 0)
    const floating = rig.posture === 'float'

    // ── ลำตัว: หายใจ, เด้งตามก้าว, หมอบตอนนอน ──
    const breatheSpeed = THREE.MathUtils.lerp(2.2, 1.1, this.sleep)
    const breathe = Math.sin(t * breatheSpeed) * THREE.MathUtils.lerp(0.012, 0.03, this.sleep)
    const hop = mood.hop * awake * Math.abs(Math.sin(t * 6)) * 0.06 * (1 - this.held)
    const bob = floating ? Math.sin(t * 1.6) * 0.035 : Math.abs(Math.sin(this.gait)) * 0.03 * walk
    const crouch = rig.crouch * this.sleep * (1 - this.held)
    rig.body.position.y = rig.bodyRestY - crouch + bob + hop
    rig.body.position.x = mood.shiver * Math.sin(t * 55) * 0.006
    rig.body.scale.set(1 + breathe * 0.6, 1 + breathe, 1 + breathe * 0.6)
    rig.body.rotation.z = Math.sin(this.gait) * 0.045 * walk
    rig.body.rotation.x = floating ? Math.sin(t * 1.6 + 1) * 0.05 : 0

    // ── หัว: มองตาม, ผงก, ตกตอนเศร้า/หลับ ──
    const idleTilt = Math.sin(t * 0.7) * 0.04
    rig.head.rotation.y = damp(rig.head.rotation.y, input.lookX * 0.55 * awake, 8, dt)
    rig.head.rotation.x = damp(
      rig.head.rotation.x,
      -input.lookY * 0.3 * awake + mood.droop * awake + this.sleep * 0.3,
      8,
      dt,
    )
    rig.head.rotation.z = idleTilt * awake + Math.sin(this.gait) * 0.03 * walk

    // ── ขา ──
    for (const leg of rig.legs) {
      const swing = Math.sin(this.gait + leg.phase) * 0.55 * walk
      const dangle = this.held * (0.25 + Math.sin(t * 9 + leg.phase) * 0.25)
      const foldAngle = rig.posture === 'quad' ? -1.35 * leg.fold : -1.2
      leg.pivot.rotation.x =
        swing + dangle * leg.fold * -1 + foldAngle * this.sleep * (1 - this.held)
      leg.pivot.position.y = leg.restY - crouch + hop + (this.held > 0.5 ? 0 : 0)
    }
    for (const arm of rig.arms) {
      const sway = Math.sin(this.gait + (arm.side > 0 ? Math.PI : 0)) * 0.5 * walk
      const paddle = floating ? Math.sin(t * 3 + arm.side) * 0.25 : 0
      arm.pivot.rotation.x = arm.rest.x + sway + paddle
      arm.pivot.rotation.z = arm.rest.z + this.held * 0.6 + mood.hop * awake * 0.5
    }

    // ── หาง: คลื่นไล่ตามข้อ ──
    for (const tail of rig.tails) {
      const n = tail.joints.length
      tail.joints.forEach((joint, i) => {
        const lag = i * 0.55
        const amp = (mood.tailAmp * awake + 0.03) / Math.sqrt(n)
        const sway = Math.sin(t * mood.tailSpeed - lag) * amp * (0.6 + i / n)
        joint.rotation.y =
          (i === 0 ? tail.yaw : 0) + sway + (floating ? Math.sin(t * 4 - lag) * 0.12 : 0)
        joint.rotation.x =
          (tail.rest[i] ?? 0) * (1 - mood.shiver * 1.6) + Math.sin(t * 1.3 - lag) * 0.02
      })
    }

    // ── หู: ลู่ตามอารมณ์ + กระตุกเป็นครั้งคราว ──
    this.twitchIn -= dt
    if (this.twitchIn <= 0) {
      this.twitch = 1
      this.twitchIn = 2.5 + Math.random() * 5
    }
    this.twitch = Math.max(0, this.twitch - dt * 5)
    const flick = Math.sin(this.twitch * Math.PI * 2) * 0.22 * awake
    for (const ear of rig.ears) {
      ear.pivot.rotation.z = ear.rest.z - (mood.earDroop + this.sleep * 0.3) * 0.9 + flick
      ear.pivot.rotation.x =
        ear.rest.x - mood.earDroop * 0.3 + Math.sin(this.gait * 2) * 0.05 * walk
    }

    // ── ปีก: ขยับเบาๆ ตอนพัก กระพือแรงตอนบิน/ตื่นเต้น ──
    const flapAmp = 0.07 + this.fly * 0.6 + mood.hop * 0.25 * awake + this.held * 0.35
    const flapSpeed = 2.5 + this.fly * 11 + mood.hop * 8 + this.held * 10
    for (const wing of rig.wings) {
      wing.pivot.rotation.z = wing.rest.z + Math.sin(t * flapSpeed) * flapAmp - this.sleep * 0.5
      wing.pivot.rotation.y = wing.rest.y - this.sleep * 0.4
    }

    // ── กะพริบตา ──
    this.blinkIn -= dt
    if (this.blinkIn <= 0) {
      this.blink = 1
      this.blinkIn = 2 + Math.random() * 4
    }
    this.blink = Math.max(0, this.blink - dt * 7)
    const blinkClose = Math.sin(this.blink * Math.PI)
    for (const eye of rig.eyes) {
      const open = eye.baseOpen * Math.min(mood.eyes, 1.25)
      const closed = Math.max(blinkClose, this.sleep)
      eye.group.scale.y = THREE.MathUtils.lerp(open, 0.07, closed)
      eye.group.scale.x = 1 + closed * 0.08
    }
  }
}
