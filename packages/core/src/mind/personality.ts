import type { Temperament } from '../genetics/types'
import { clamp } from '../rng'
import type { EmotionEvent } from './emotion'

export type TraitKey = keyof Temperament
export const TRAIT_KEYS: TraitKey[] = [
  'affection',
  'mischief',
  'playful',
  'sleepy',
  'shy',
  'curious',
  'appetite',
]

export const TRAIT_NAME_TH: Record<TraitKey, string> = {
  affection: 'ขี้อ้อน',
  mischief: 'ดื้อ/ซน',
  playful: 'ขี้เล่น',
  sleepy: 'ขี้เซา',
  shy: 'ขี้อาย',
  curious: 'อยากรู้อยากเห็น',
  appetite: 'ตะกละ',
}

/** ผลสะสมจากการเลี้ยงดู: ค่าเบี่ยงเบนจากนิสัยตามยีนส์ แต่ละแกนอยู่ใน ±MAX_SHIFT */
export type Experience = Record<TraitKey, number>
export const MAX_SHIFT = 0.25

export const noExperience = (): Experience => ({
  affection: 0,
  mischief: 0,
  playful: 0,
  sleepy: 0,
  shy: 0,
  curious: 0,
  appetite: 0,
})

const EVENT_SHAPING: Partial<Record<EmotionEvent, Partial<Experience>>> = {
  petted: { affection: 0.004, shy: -0.003 },
  greeted: { affection: 0.002, shy: -0.002 },
  played: { playful: 0.004, sleepy: -0.002, curious: 0.002 },
  treat: { appetite: 0.004, mischief: 0.001 },
  fed: { appetite: 0.001 },
  startled: { shy: 0.004 },
  dropped: { shy: 0.005, affection: -0.002 },
  ignored: { shy: 0.002, affection: -0.002, mischief: 0.002 },
  scolded: { mischief: -0.004, shy: 0.003 },
}

/**
 * ประสบการณ์หล่อหลอมนิสัย — วัยเด็กไวต่อการเปลี่ยนแปลงมากกว่า (plasticity สูง)
 */
export function shapeExperience(exp: Experience, event: EmotionEvent, plasticity = 1): Experience {
  const shaping = EVENT_SHAPING[event]
  if (!shaping) return exp
  const next = { ...exp }
  for (const [key, delta] of Object.entries(shaping) as [TraitKey, number][]) {
    next[key] = clamp(next[key] + delta * plasticity, -MAX_SHIFT, MAX_SHIFT)
  }
  return next
}

/** นิสัยจริง = นิสัยตามยีนส์ + ผลจากการเลี้ยงดู */
export function derivePersonality(genes: Temperament, exp: Experience): Temperament {
  const out = { ...genes }
  for (const key of TRAIT_KEYS) out[key] = clamp(genes[key] + exp[key])
  return out
}

/** นิสัยเด่น n อันดับแรก (เรียงจากค่าที่ห่างจากค่ากลางมากสุดทางบวก) */
export function dominantTraits(p: Temperament, count = 2): TraitKey[] {
  return [...TRAIT_KEYS].sort((a, b) => p[b] - p[a] || a.localeCompare(b)).slice(0, count)
}
