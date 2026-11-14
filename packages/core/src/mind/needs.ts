import type { Nurture } from '../body/composition'
import type { Temperament } from '../genetics/types'
import { clamp } from '../rng'

/** ความต้องการพื้นฐาน 0..1 (1 = อิ่ม/พอใจเต็มที่) */
export interface Needs {
  hunger: number
  energy: number
  hygiene: number
  fun: number
  social: number
  comfort: number
}
export type NeedKey = keyof Needs
export const NEED_KEYS: NeedKey[] = ['hunger', 'energy', 'hygiene', 'fun', 'social', 'comfort']

export const fullNeeds = (): Needs => ({
  hunger: 0.8,
  energy: 0.8,
  hygiene: 0.9,
  fun: 0.7,
  social: 0.7,
  comfort: 0.8,
})

/** อัตราลดต่อชั่วโมง (ตอนตื่นและผู้ใช้อยู่หน้าจอ) */
const DECAY_PER_HOUR: Needs = {
  hunger: 0.14,
  energy: 0.1,
  hygiene: 0.04,
  fun: 0.12,
  social: 0.1,
  comfort: 0.05,
}
/** ค่าต่ำสุดที่ need จะลดลงไปถึงได้ — ไม่มีการอดตาย/ลงโทษ */
const FLOOR = 0.08

export interface NeedContext {
  asleep: boolean
  /** ผู้ใช้ไม่อยู่ → หยุดเวลา (ไม่สร้างความรู้สึกผิดเมื่อกลับมา) */
  userPresent: boolean
  /** 0..1 จากยีนส์ meta.metabolism: สูง = หิวเร็ว */
  metabolism?: number
}

export function decayNeeds(
  needs: Needs,
  dtHours: number,
  temper: Temperament,
  ctx: NeedContext,
): Needs {
  if (!ctx.userPresent && !ctx.asleep) return { ...needs }
  const next = { ...needs }
  if (ctx.asleep) {
    next.energy = clamp(next.energy + 0.35 * dtHours)
    next.comfort = clamp(next.comfort + 0.1 * dtHours)
    if (!ctx.userPresent) return next
  }
  const rate: Needs = {
    hunger: DECAY_PER_HOUR.hunger * (0.7 + (ctx.metabolism ?? 0.5) * 0.6 + temper.appetite * 0.3),
    energy: ctx.asleep ? 0 : DECAY_PER_HOUR.energy * (0.7 + temper.sleepy * 0.8),
    hygiene: DECAY_PER_HOUR.hygiene * (0.8 + temper.mischief * 0.5),
    fun: DECAY_PER_HOUR.fun * (0.6 + temper.playful * 0.8) * (ctx.asleep ? 0.2 : 1),
    social: DECAY_PER_HOUR.social * (0.5 + temper.affection * 1.0) * (ctx.asleep ? 0.2 : 1),
    comfort: ctx.asleep ? 0 : DECAY_PER_HOUR.comfort,
  }
  for (const key of NEED_KEYS) {
    if (rate[key] > 0)
      next[key] = Math.max(Math.min(next[key], FLOOR), next[key] - rate[key] * dtHours)
  }
  return next
}

export type CareAction = 'feed' | 'treat' | 'pet' | 'play' | 'bathe' | 'rest'

const CARE_EFFECT: Record<CareAction, Partial<Needs>> = {
  feed: { hunger: 0.45, comfort: 0.05 },
  treat: { hunger: 0.15, fun: 0.1, social: 0.05 },
  pet: { social: 0.25, comfort: 0.1 },
  play: { fun: 0.4, social: 0.15, energy: -0.12, hygiene: -0.05 },
  bathe: { hygiene: 0.7, comfort: 0.05 },
  rest: { energy: 0.3, comfort: 0.15 },
}

/** ผลของการดูแลต่อ needs และรูปร่าง (ไขมัน/ความฟิต) */
export function applyCare(
  needs: Needs,
  nurture: Nurture,
  action: CareAction,
  metabolism = 0.5,
): { needs: Needs; nurture: Nurture } {
  const next = { ...needs }
  for (const [key, delta] of Object.entries(CARE_EFFECT[action]) as [NeedKey, number][]) {
    next[key] = clamp(next[key] + delta)
  }
  const body = { ...nurture }
  // กินตอนอิ่มแล้ว / ขนม → สะสมไขมัน (เผาผลาญสูงสะสมน้อยกว่า)
  const gainFactor = 1.3 - metabolism * 0.6
  if (action === 'feed' && needs.hunger > 0.75) body.fat = clamp(body.fat + 0.02 * gainFactor)
  if (action === 'treat') body.fat = clamp(body.fat + 0.03 * gainFactor)
  if (action === 'play') {
    body.fat = clamp(body.fat - 0.015)
    body.fitness = clamp(body.fitness + 0.03)
  }
  return { needs: next, nurture: body }
}

/** need ที่เร่งด่วนที่สุด (ค่าต่ำสุด) */
export function mostUrgentNeed(needs: Needs): NeedKey {
  let worst: NeedKey = 'hunger'
  for (const key of NEED_KEYS) if (needs[key] < needs[worst]) worst = key
  return worst
}
