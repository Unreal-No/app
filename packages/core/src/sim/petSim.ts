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

const PLASTICITY: Record<Nurture['stage'], number> = {
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
  const phenotype = express(pet.genome, db)
  const personality = derivePersonality(phenotype.temperament, pet.experience)
  const asleep = pet.behavior === 'sleep'
  const needs = decayNeeds(pet.needs, dtSec / 3600, personality, {
    asleep,
    userPresent: world.userActive,
    metabolism: phenotype.nums['meta.metabolism'],
  })
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

/** เหตุการณ์จากผู้ใช้/โลก → กระทบอารมณ์และหล่อหลอมนิสัย */
export function petEvent(pet: PetState, event: EmotionEvent, db: GeneDb = geneDb): PetState {
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
  const metabolism = express(pet.genome, db).nums['meta.metabolism']
  const { needs, nurture } = applyCare(pet.needs, pet.nurture, action, metabolism)
  const next = { ...pet, needs, nurture }
  const event = CARE_EVENT[action]
  return event ? petEvent(next, event, db) : next
}
