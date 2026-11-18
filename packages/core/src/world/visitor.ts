import { geneDb, type GeneDb } from '@mochimon/data'
import { createFounder } from '../genetics/genome'
import type { Rng } from '../rng'
import { createPet, newPetId, type PetState } from '../sim/petSim'
import { BASIC_FOODS, type FoodId } from './items'

/**
 * แขกป่า: สัตว์ป่าเดินผ่านจอเป็นครั้งคราว — ให้ของที่มันชอบแล้วจะผูกมิตรมาอยู่ด้วย
 * ไม่ตรงใจก็แค่เดินจากไป ไม่มีบทลงโทษ
 */
export interface Visitor {
  pet: PetState
  likes: FoodId
  /** ของที่ลองให้ไปแล้ว */
  tried: FoodId[]
  arrivedAt: number
  leavesAt: number
}

/** แขกอยู่บนจอนานเท่านี้ (ms) */
export const VISIT_MS = 3 * 60_000
/** ช่วงห่างระหว่างแขก (นาทีที่ผู้ใช้ใช้เครื่องอยู่) */
export const VISIT_GAP_MIN: [number, number] = [60, 120]
/** ให้ได้กี่ครั้งก่อนแขกเดินจากไป */
export const VISIT_TRIES = 2

export function nextVisitAt(now: number, rng: Rng): number {
  return now + rng.range(VISIT_GAP_MIN[0], VISIT_GAP_MIN[1]) * 60_000
}

/** สร้างแขก: ส่วนใหญ่เป็นสัตว์ทั่วไป สัตว์เทพนิยายหายาก */
export function createVisitor(rng: Rng, now: number, name: string, db: GeneDb = geneDb): Visitor {
  const species = Object.values(db.species)
  const id = rng.weighted(
    species.map(
      (s) =>
        [s.id, s.lineage === 'mythical' ? 0.25 : s.lineage === 'prehistoric' ? 0.6 : 1] as const,
    ),
  )
  const pet: PetState = {
    ...createPet(
      name,
      createFounder(id, rng, db),
      { stage: 'child', fat: 0.35, fitness: 0.45 },
      newPetId(rng),
    ),
    origin: { kind: 'wild' },
  }
  return { pet, likes: rng.pick(BASIC_FOODS), tried: [], arrivedAt: now, leavesAt: now + VISIT_MS }
}

export type OfferResult = 'befriended' | 'meh' | 'leaving'

/** ให้ของกับแขก */
export function offerFood(
  visitor: Visitor,
  food: FoodId,
): { visitor: Visitor; result: OfferResult } {
  const next = { ...visitor, tried: [...visitor.tried, food] }
  // ของพิเศษจากการสำรวจถูกใจแขกทุกตัว
  if (food === visitor.likes || !(BASIC_FOODS as readonly string[]).includes(food))
    return { visitor: next, result: 'befriended' }
  return { visitor: next, result: next.tried.length >= VISIT_TRIES ? 'leaving' : 'meh' }
}

/** คำใบ้ (ความคิดลอย): ส่วนใหญ่บอกตรง บางทีก็สับสน */
export function visitorHint(visitor: Visitor, rng: Rng): FoodId {
  return rng.chance(0.75) ? visitor.likes : rng.pick(BASIC_FOODS)
}
