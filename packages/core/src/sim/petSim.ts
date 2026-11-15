import { geneDb, type GeneDb } from '@mochimon/data'
import { chooseBehavior, type Behavior } from '../behavior/utility'
import { DEFAULT_NURTURE, type Nurture } from '../body/composition'
import { express } from '../genetics/express'
import type { Genome, Phenotype, Temperament } from '../genetics/types'
import {
  applyEvent,
  labelEmotion,
  neutralEmotion,
  tickEmotion,
  type EmotionEvent,
  type EmotionLabel,
  type EmotionState,
} from '../mind/emotion'
import { applyCare, decayNeeds, fullNeeds, type CareAction, type Needs } from '../mind/needs'
import {
  derivePersonality,
  noExperience,
  shapeExperience,
  type Experience,
} from '../mind/personality'
import type { Rng } from '../rng'

/** สถานะทั้งหมดของสัตว์ 1 ตัว (ส่วนที่ต้องเซฟ) */
export interface PetState {
  name: string
  genome: Genome
  nurture: Nurture
  needs: Needs
  emotion: EmotionState
  experience: Experience
  behavior: Behavior
  /** เวลาที่เหลือ (วินาที) ก่อนตัดสินใจพฤติกรรมใหม่ */
  behaviorTimer: number
  /** ความคืบหน้าการฟัก 0..1 (ใช้เฉพาะช่วงวัย 'egg') */
  incubation?: number
}

export interface WorldContext {
  hour: number
  cursorNear: boolean
  userActive: boolean
  quiet: boolean
}

export function createPet(
  name: string,
  genome: Genome,
  nurture: Nurture = DEFAULT_NURTURE,
): PetState {
  return {
    name,
    genome,
    nurture: { ...nurture },
    needs: fullNeeds(),
    emotion: neutralEmotion(),
    experience: noExperience(),
    behavior: 'idle',
    behaviorTimer: 0,
  }
}

/** เวลาฟักไข่พื้นฐาน (วินาทีที่ผู้ใช้อยู่หน้าจอ) */
export const INCUBATION_SECONDS = 600

const PLASTICITY: Record<Nurture['stage'], number> = {
  egg: 0,
  baby: 3,
  child: 2.2,
  teen: 1.5,
  adult: 1,
  elder: 0.6,
}

const BEHAVIOR_DURATION: Record<Behavior, [number, number]> = {
  idle: [3, 8],
  sit: [8, 25],
  wander: [5, 14],
  sleep: [60, 240],
  followCursor: [6, 15],
  seekAttention: [5, 10],
  zoomies: [3, 6],
  hide: [5, 12],
  beg: [5, 10],
  groom: [5, 10],
}

/** ผลต่อ needs ต่อวินาทีของพฤติกรรมที่สัตว์ทำเอง */
const SELF_CARE: Partial<Record<Behavior, Partial<Needs>>> = {
  groom: { hygiene: 0.02, comfort: 0.004 },
  zoomies: { fun: 0.03, energy: -0.004 },
  wander: { fun: 0.002 },
  sit: { comfort: 0.004 },
}

/** มุมมองที่คำนวณจากสถานะ (ไม่ต้องเซฟ) */
export interface PetView {
  phenotype: Phenotype
  personality: Temperament
  emotionLabel: EmotionLabel
}

export function viewPet(pet: PetState, db: GeneDb = geneDb): PetView {
  const phenotype = express(pet.genome, db)
  return {
    phenotype,
    personality: derivePersonality(phenotype.temperament, pet.experience),
    emotionLabel: labelEmotion(pet.emotion, pet.needs),
  }
}

/** เดินเวลาจำลอง dtSec วินาที — คืนสถานะใหม่ (ไม่แก้ของเดิม) */
export function tickPet(
  pet: PetState,
  dtSec: number,
  world: WorldContext,
  rng: Rng,
  db: GeneDb = geneDb,
): PetState {
  if (pet.nurture.stage === 'egg')
    return incubate(pet, world.userActive ? dtSec / INCUBATION_SECONDS : 0)
  const phenotype = express(pet.genome, db)
  const personality = derivePersonality(phenotype.temperament, pet.experience)
  const asleep = pet.behavior === 'sleep'
  const needs = decayNeeds(pet.needs, dtSec / 3600, personality, {
    asleep,
    userPresent: world.userActive,
    metabolism: phenotype.nums['meta.metabolism'],
  })
  // ดูแลตัวเองได้บางส่วน: เลียขนเอง วิ่งเล่นเอง — ผู้ใช้ไม่ต้องคอยประคบประหงมตลอดเวลา
  // (ความหิวและความเหงายังต้องพึ่งผู้ใช้ แต่ไม่มีบทลงโทษถ้าปล่อยไว้)
  const self = SELF_CARE[pet.behavior]
  if (self) {
    for (const [key, perSec] of Object.entries(self) as [keyof Needs, number][]) {
      needs[key] = Math.min(1, Math.max(0, needs[key] + perSec * dtSec))
    }
  }
  const emotion = tickEmotion(pet.emotion, needs, personality, dtSec)

  let behavior = pet.behavior
  let behaviorTimer = pet.behaviorTimer - dtSec
  // ตื่นเองเมื่อพักพอแล้ว
  if (asleep && needs.energy > 0.95) behaviorTimer = 0
  if (behaviorTimer <= 0) {
    behavior = chooseBehavior(
      {
        needs,
        emotion,
        personality,
        hour: world.hour,
        chronotype: phenotype.nums['meta.chronotype'] ?? 0.5,
        cursorNear: world.cursorNear,
        userActive: world.userActive,
        quiet: world.quiet,
      },
      rng,
    )
    const [min, max] = BEHAVIOR_DURATION[behavior]
    behaviorTimer = rng.range(min, max)
  }
  return { ...pet, needs, emotion, behavior, behaviorTimer }
}

/**
 * เพิ่มความคืบหน้าการฟัก — ครบ 1 แล้วฟักเป็นเบบี้ทันที
 * (เวลาโฟกัสงาน/ความอบอุ่นจะเรียกฟังก์ชันนี้เพื่อเร่งการฟักในอนาคต)
 */
export function incubate(pet: PetState, amount: number): PetState {
  if (pet.nurture.stage !== 'egg') return pet
  const incubation = Math.min(1, (pet.incubation ?? 0) + Math.max(0, amount))
  if (incubation < 1) return { ...pet, incubation }
  return {
    ...pet,
    incubation: 1,
    nurture: { ...pet.nurture, stage: 'baby' },
    needs: fullNeeds(),
    emotion: { valence: 0.7, arousal: 0.7, mood: 0.4 },
    behavior: 'idle',
    behaviorTimer: 4,
  }
}

/** เหตุการณ์จากผู้ใช้/โลก → กระทบอารมณ์และหล่อหลอมนิสัย */
export function petEvent(pet: PetState, event: EmotionEvent, db: GeneDb = geneDb): PetState {
  if (pet.nurture.stage === 'egg') return pet
  const { personality } = viewPet(pet, db)
  const wakes = event === 'pickedUp' || event === 'startled' || event === 'dropped'
  return {
    ...pet,
    emotion: applyEvent(pet.emotion, event, personality),
    experience: shapeExperience(pet.experience, event, PLASTICITY[pet.nurture.stage]),
    behavior: wakes && pet.behavior === 'sleep' ? 'idle' : pet.behavior,
    behaviorTimer: wakes ? Math.min(pet.behaviorTimer, 1.5) : pet.behaviorTimer,
  }
}

const CARE_EVENT: Record<CareAction, EmotionEvent | null> = {
  feed: 'fed',
  treat: 'treat',
  pet: 'petted',
  play: 'played',
  bathe: 'bathed',
  rest: null,
}

/** การดูแล: ปรับ needs + รูปร่าง แล้วส่งเหตุการณ์อารมณ์ที่เกี่ยวข้อง */
export function carePet(pet: PetState, action: CareAction, db: GeneDb = geneDb): PetState {
  // ลูบไข่ = ให้ความอบอุ่น ช่วยให้ฟักเร็วขึ้นเล็กน้อย
  if (pet.nurture.stage === 'egg') return action === 'pet' ? incubate(pet, 0.02) : pet
  const metabolism = express(pet.genome, db).nums['meta.metabolism']
  const { needs, nurture } = applyCare(pet.needs, pet.nurture, action, metabolism)
  const next = { ...pet, needs, nurture }
  const event = CARE_EVENT[action]
  return event ? petEvent(next, event, db) : next
}
