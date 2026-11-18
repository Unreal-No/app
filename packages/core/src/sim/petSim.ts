import { geneDb, type GeneDb } from '@mochimon/data'
import { chooseBehavior, type Behavior } from '../behavior/utility'
import { DEFAULT_NURTURE, LIFE_STAGES, type LifeStage, type Nurture } from '../body/composition'
import { breed } from '../genetics/breed'
import { serializeGenome } from '../genetics/genome'
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
import { hashString, type Rng } from '../rng'

/** สถานะทั้งหมดของสัตว์ 1 ตัว (ส่วนที่ต้องเซฟ) */
export interface PetState {
  /** รหัสประจำตัว (ไม่ซ้ำกันในเซฟเดียวกัน) */
  id: string
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
  /** อายุสะสมหลังฟัก (วินาทีที่ผู้ใช้อยู่หน้าจอ) — ใช้กำหนดช่วงวัย */
  ageSeconds: number
  /** รหัสของพ่อแม่ (ถ้าเกิดจากการผสมพันธุ์) */
  parents?: [string, string]
  /** เวลาที่ได้ไข่/เกิด (ms) — ใช้แสดงวันเกิด */
  bornAt?: number
  /** ที่มาของสัตว์ตัวนี้ */
  origin?: PetOrigin
  /** ลักษณะที่ได้จากการกลายพันธุ์ตอนเกิด (รหัส allele ชิ้นส่วน) */
  mutations?: string[]
}

export const ORIGIN_KINDS = ['starter', 'summon', 'bred', 'wild', 'expedition', 'gift'] as const
export type OriginKind = (typeof ORIGIN_KINDS)[number]

export interface PetOrigin {
  kind: OriginKind
  /** ชนิดไฟล์ที่ใช้อัญเชิญ (เฉพาะ summon) */
  fileKind?: string
  /** ไข่ฟอสซิล */
  fossil?: boolean
  /** จุดหมายที่ไปสำรวจมา (เฉพาะ expedition) */
  place?: string
}

export interface WorldContext {
  hour: number
  cursorNear: boolean
  userActive: boolean
  quiet: boolean
}

/**
 * อายุสะสม (วินาที) ที่เริ่มเข้าสู่แต่ละช่วงวัย — ปรับความเร็วการเติบโตได้ที่นี่ที่เดียว
 * เบบี้ → เด็ก 20 นาที → วัยรุ่น 2 ชม. → โตเต็มวัย 6 ชม. → ผู้อาวุโส 60 ชม.
 */
export const STAGE_START_SECONDS: Record<Exclude<LifeStage, 'egg'>, number> = {
  baby: 0,
  child: 20 * 60,
  teen: 2 * 3600,
  adult: 6 * 3600,
  elder: 60 * 3600,
}

/** ช่วงวัยที่ควรเป็นเมื่ออายุสะสมเท่านี้ */
export function stageForAge(ageSeconds: number): Exclude<LifeStage, 'egg'> {
  let stage: Exclude<LifeStage, 'egg'> = 'baby'
  for (const [name, start] of Object.entries(STAGE_START_SECONDS) as [
    Exclude<LifeStage, 'egg'>,
    number,
  ][]) {
    if (ageSeconds >= start) stage = name
  }
  return stage
}

/** รหัสประจำตัวจากเมล็ดสุ่ม (ให้ผู้เรียกส่ง Rng มาเพื่อให้ทำซ้ำได้ในการทดสอบ) */
export function newPetId(rng: Rng): string {
  return `pet-${Math.floor(rng.next() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}${Math.floor(rng.next() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`
}

export function createPet(
  name: string,
  genome: Genome,
  nurture: Nurture = DEFAULT_NURTURE,
  id = `pet-${hashString(serializeGenome(genome) + name).toString(36)}`,
): PetState {
  return {
    id,
    // เริ่มที่อายุขั้นต่ำของช่วงวัยที่ระบุ: สัตว์ที่สร้างเป็น "เด็ก" จะไม่ถอยกลับเป็นเบบี้
    ageSeconds: nurture.stage === 'egg' ? 0 : STAGE_START_SECONDS[nurture.stage],
    name,
    genome,
    nurture: { ...nurture },
    needs: fullNeeds(),
    emotion: neutralEmotion(),
    experience: noExperience(),
    behavior: 'idle',
    behaviorTimer: 0,
    ...(nurture.stage === 'egg' ? { incubation: 0 } : {}),
  }
}

/** หลับจนพลังเต็มแล้วยังงีบต่อได้อีกเท่านี้ (วินาที) */
export const NAP_AFTER_FULL = 45

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
  fly: [8, 22],
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
  // ตื่นเองเมื่อพักพอแล้ว — งีบต่ออีกไม่เกิน 45 วินาที (สั่งนอนตอนพลังเกือบเต็มก็ยังได้งีบ)
  if (asleep && needs.energy > 0.95) behaviorTimer = Math.min(behaviorTimer, NAP_AFTER_FULL)
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
        canFly: phenotype.habitat === 'sky' && pet.nurture.stage !== 'baby',
      },
      rng,
    )
    const [min, max] = BEHAVIOR_DURATION[behavior]
    behaviorTimer = rng.range(min, max)
  }
  // เติบโตตามเวลาที่ผู้ใช้อยู่ด้วย (ไม่มีการถอยวัย)
  const ageSeconds = pet.ageSeconds + (world.userActive ? dtSec : 0)
  const grown = stageForAge(ageSeconds)
  const nurture =
    LIFE_STAGES.indexOf(grown) > LIFE_STAGES.indexOf(pet.nurture.stage)
      ? { ...pet.nurture, stage: grown }
      : pet.nurture
  return { ...pet, needs, emotion, behavior, behaviorTimer, ageSeconds, nurture }
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
    ageSeconds: 0,
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

/** ช่วงวัยที่ผสมพันธุ์ได้ */
export const canBreed = (pet: PetState): boolean =>
  pet.nurture.stage === 'teen' || pet.nurture.stage === 'adult' || pet.nurture.stage === 'elder'

/**
 * ผสมพันธุ์สัตว์ 2 ตัว → ไข่ใบใหม่ (ยังไม่ฟัก) ที่จำพ่อแม่ได้
 * คืน null ถ้าจับคู่ไม่ได้ (ตัวเดียวกัน หรือยังเด็กเกินไป)
 */
export function breedPets(
  a: PetState,
  b: PetState,
  name: string,
  rng: Rng,
  db: GeneDb = geneDb,
): PetState | null {
  if (a.id === b.id || !canBreed(a) || !canBreed(b)) return null
  const { genome, mutations } = breed(a.genome, b.genome, rng, { db })
  const egg = createPet(name, genome, { stage: 'egg', fat: 0.35, fitness: 0.4 }, newPetId(rng))
  // จำเฉพาะการกลายพันธุ์ที่เห็นได้ (ชิ้นส่วนเปลี่ยนชนิด) — การขยับค่าตัวเลขเล็กน้อยไม่นับ
  const changed = [
    ...new Set(mutations.flatMap((m) => (m.to.k === 'p' && m.kind !== 'shift' ? [m.to.id] : []))),
  ]
  return {
    ...egg,
    parents: [a.id, b.id],
    origin: { kind: 'bred' },
    ...(changed.length > 0 ? { mutations: changed } : {}),
  }
}
