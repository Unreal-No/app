import type { Temperament } from '../genetics/types'
import type { EmotionState } from '../mind/emotion'
import type { Needs } from '../mind/needs'
import type { Rng } from '../rng'

export type Behavior =
  | 'idle'
  | 'wander'
  | 'sit'
  | 'sleep'
  | 'followCursor'
  | 'seekAttention'
  | 'zoomies'
  | 'hide'
  | 'beg'
  | 'groom'
  /** บินเล่น (เฉพาะสัตว์ที่มีปีกบินได้) */
  | 'fly'

export const BEHAVIORS: Behavior[] = [
  'idle',
  'wander',
  'sit',
  'sleep',
  'followCursor',
  'seekAttention',
  'zoomies',
  'hide',
  'beg',
  'groom',
  'fly',
]

export interface BehaviorContext {
  needs: Needs
  emotion: EmotionState
  personality: Temperament
  /** ชั่วโมงตามเวลาท้องถิ่น 0..24 */
  hour: number
  /** 0..1 จากยีนส์ meta.chronotype: 0 = ตื่นเช้า, 1 = นกฮูก */
  chronotype: number
  cursorNear: boolean
  /** ผู้ใช้กำลังใช้งานเครื่องอยู่ */
  userActive: boolean
  /** โหมดเงียบ (ประชุม/โฟกัส) → ไม่รบกวน */
  quiet: boolean
  /** มีปีกที่บินได้และโตพอจะบิน */
  canFly?: boolean
}

/** ความง่วงตามนาฬิกาชีวิต 0..1 — จุดง่วงสุดเลื่อนตาม chronotype (ตี 2 สำหรับคนตื่นเช้า → ตี 5 สำหรับนกฮูก) */
export function circadianSleepiness(hour: number, chronotype: number): number {
  const trough = 2 + chronotype * 3
  const phase = ((hour - trough + 24) % 24) / 24
  return (Math.cos(phase * Math.PI * 2) + 1) / 2
}

/**
 * Utility AI: ให้คะแนนพฤติกรรมแต่ละอย่างจาก needs × นิสัย × บริบท
 * (คะแนนเป็นค่าสัมพัทธ์ ยิ่งสูงยิ่งอยากทำ)
 */
export function scoreBehaviors(ctx: BehaviorContext): Record<Behavior, number> {
  const { needs, emotion, personality: p } = ctx
  const tired = 1 - needs.energy
  const night = circadianSleepiness(ctx.hour, ctx.chronotype)
  const lonely = 1 - needs.social
  const bored = 1 - needs.fun
  const hungry = 1 - needs.hunger
  const calm = ctx.quiet ? 0.2 : 1

  return {
    idle: 0.3,
    sit: 0.25 + p.sleepy * 0.2 + (ctx.quiet ? 0.5 : 0),
    wander: 0.3 + p.curious * 0.4 + emotion.arousal * 0.2 - tired * 0.3,
    sleep: tired * tired * 1.6 + night * 0.5 * (0.5 + p.sleepy) + p.sleepy * 0.15,
    followCursor:
      (ctx.userActive ? 1 : 0) * calm * (p.affection * 0.5 + lonely * 0.4 + p.curious * 0.15) -
      p.shy * 0.25,
    seekAttention: calm * (ctx.userActive ? 1 : 0.3) * lonely * (0.3 + p.affection * 0.7),
    zoomies: calm * (bored * 0.6 + emotion.arousal * 0.3) * (0.4 + p.playful * 0.9) - tired * 0.5,
    hide: p.shy * (ctx.cursorNear ? 0.9 : 0.15) * (emotion.valence < 0 ? 1.4 : 0.8),
    // ขออาหารพอประมาณ: หิวแค่ไหนก็ไม่เรียกร้องจนกลบพฤติกรรมอื่น (ไม่กดดันผู้ใช้)
    beg: calm * hungry * hungry * (0.4 + p.appetite * 0.45),
    groom: (1 - needs.hygiene) * 0.75 * (1 - p.mischief * 0.4),
    // บินเล่นตอนสดชื่น (ระหว่างโหมดเงียบบินน้อยลงมาก — ไม่วนเวียนกลางจอตอนผู้ใช้ตั้งใจทำงาน)
    fly: ctx.canFly
      ? calm * calm * (0.3 + p.playful * 0.3 + p.curious * 0.3 + emotion.arousal * 0.25) -
        tired * 0.8 -
        night * 0.25
      : 0,
  }
}

/**
 * เลือกพฤติกรรมแบบสุ่มถ่วงน้ำหนักจากกลุ่มคะแนนสูง (ไม่เลือกสูงสุดตายตัว → ดูมีชีวิต ไม่เป็นหุ่นยนต์)
 */
export function chooseBehavior(ctx: BehaviorContext, rng: Rng): Behavior {
  const scores = scoreBehaviors(ctx)
  const entries = BEHAVIORS.map((b) => [b, Math.max(0, scores[b])] as const)
  const best = Math.max(...entries.map(([, s]) => s))
  if (best <= 0) return 'idle'
  const shortlist = entries.filter(([, s]) => s >= best * 0.6).map(([b, s]) => [b, s * s] as const)
  return rng.weighted(shortlist)
}
