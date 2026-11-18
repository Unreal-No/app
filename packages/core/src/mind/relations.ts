import type { Temperament } from '../genetics/types'
import { clamp } from '../rng'

/**
 * ความสัมพันธ์ระหว่างสัตว์: ค่าความชอบพอต่อคู่ (−1..1) โตขึ้นจากเวลาที่อยู่ใกล้กันและเล่นด้วยกัน
 * ทิศทางขึ้นกับความเข้ากันของนิสัย — เข้ากันได้ดี → เพื่อนซี้/แอบชอบ, ขัดกัน → คู่กัด
 */
export type Relations = Record<string, number>
export type RelationLabel = 'bestie' | 'crush' | 'rival' | 'friend' | 'neutral'

export const RELATION_TH: Record<RelationLabel, string> = {
  bestie: 'เพื่อนซี้',
  crush: 'แอบชอบ',
  rival: 'คู่กัด',
  friend: 'เพื่อน',
  neutral: 'รู้จักกัน',
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** ความเข้ากันของนิสัย −1..1 */
export function compatibility(a: Temperament, b: Temperament): number {
  const similar =
    1 -
    (Math.abs(a.playful - b.playful) +
      Math.abs(a.curious - b.curious) +
      Math.abs(a.sleepy - b.sleepy)) /
      3
  const warmth = (a.affection + b.affection) / 2
  // ซนทั้งคู่ = แย่งของเล่นกัน; ขี้อายเจอตัวซน = อึดอัด
  const clash =
    a.mischief * b.mischief + Math.abs(a.shy - b.mischief) * 0.25 * (a.shy > 0.6 ? 1 : 0)
  return clamp(similar * 0.9 + warmth * 0.6 - clash * 1.1 - 0.45, -1, 1)
}

export interface RelationMember {
  id: string
  temperament: Temperament
  /** ตำแหน่งบนจอ (px) */
  x: number
  y: number
  awake: boolean
}

/** เวลาที่อยู่ใกล้กัน (ระยะ px) */
export const NEAR_PX = 170

/** อัปเดตทุกคู่ที่อยู่ใกล้กัน dtSec วินาที */
export function tickRelations(
  rel: Relations,
  members: RelationMember[],
  dtSec: number,
  family: (a: string, b: string) => boolean = () => false,
): Relations {
  let next: Relations | null = null
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!
      const b = members[j]!
      if (!a.awake || !b.awake) continue
      if (Math.hypot(a.x - b.x, a.y - b.y) > NEAR_PX) continue
      const key = pairKey(a.id, b.id)
      const compat = compatibility(a.temperament, b.temperament) + (family(a.id, b.id) ? 0.5 : 0)
      const current = rel[key] ?? 0
      // ค่อยๆ เข้าใกล้ค่าที่นิสัยพาไป (ราว 1 ชั่วโมงที่อยู่ใกล้กันจึงสนิท)
      const target = clamp(compat * 1.2, -1, 1)
      const value = clamp(current + (target - current) * Math.min(1, dtSec / 2400), -1, 1)
      ;(next ??= { ...rel })[key] = value
    }
  }
  return next ?? rel
}

/** เหตุการณ์ร่วมกัน (เล่นด้วยกัน จับคู่) ทำให้สนิทขึ้น */
export function shareMoment(rel: Relations, a: string, b: string, amount = 0.08): Relations {
  const key = pairKey(a, b)
  return { ...rel, [key]: clamp((rel[key] ?? 0) + amount, -1, 1) }
}

/** ป้ายความสัมพันธ์ — "แอบชอบ" เฉพาะวัยรุ่นขึ้นไปและไม่ใช่ญาติกัน */
export function relationLabel(
  affinity: number,
  opts: { grownUp: boolean; family: boolean; pairSeed: number },
): RelationLabel {
  if (affinity <= -0.3) return 'rival'
  if (affinity >= 0.55)
    return opts.grownUp && !opts.family && opts.pairSeed % 3 === 0 ? 'crush' : 'bestie'
  if (affinity >= 0.2) return 'friend'
  return 'neutral'
}

/** ลบความสัมพันธ์ของตัวที่ไม่อยู่แล้ว + ซ่อมค่าจากเซฟ */
export function repairRelations(raw: unknown, ids?: Set<string>): Relations {
  const rel: Relations = {}
  if (typeof raw !== 'object' || raw === null) return rel
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parts = key.split('|')
    if (parts.length !== 2 || typeof value !== 'number' || !Number.isFinite(value)) continue
    if (ids && !(ids.has(parts[0]!) && ids.has(parts[1]!))) continue
    rel[pairKey(parts[0]!, parts[1]!)] = clamp(value, -1, 1)
  }
  return rel
}
