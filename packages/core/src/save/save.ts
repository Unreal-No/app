import { geneDb, type GeneDb } from '@mochimon/data'
import { BEHAVIORS } from '../behavior/utility'
import { LIFE_STAGES } from '../body/composition'
import { validateGenome } from '../genetics/genome'
import { neutralEmotion } from '../mind/emotion'
import { fullNeeds, NEED_KEYS } from '../mind/needs'
import { noExperience, TRAIT_KEYS } from '../mind/personality'
import { clamp } from '../rng'
import { STAGE_START_SECONDS, type PetState } from '../sim/petSim'

export interface SaveSettings {
  /** โหมดเงียบ (ไม่รบกวน) */
  quiet: boolean
  /** ให้สัตว์ปีนไปเกาะขอบหน้าต่างโปรแกรมอื่น */
  perching: boolean
}

/** รูปแบบไฟล์เซฟรุ่นปัจจุบัน */
export interface SaveData {
  v: 2
  pets: PetState[]
  /** ฉากมุมพักผ่อนที่เลือก (null = โหมดกลมกลืน) */
  habitat: string | null
  settings: SaveSettings
  savedAt: number
}

export const DEFAULT_SETTINGS: SaveSettings = { quiet: false, perching: true }

export function createSave(
  pets: PetState[],
  habitat: string | null = null,
  settings: SaveSettings = DEFAULT_SETTINGS,
  savedAt = 0,
): SaveData {
  return { v: 2, pets, habitat, settings: { ...settings }, savedAt }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown, fallback: number, min = 0, max = 1): number =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback

/**
 * ตรวจและซ่อมสัตว์ 1 ตัวจากข้อมูลดิบ: genome ต้องถูกต้อง (ไม่งั้นทิ้ง) ส่วนค่าที่หาย/เพี้ยนจะถูกเติมค่าเริ่มต้น
 * — เซฟจากรุ่นเก่าที่ยังไม่มี id/อายุ จึงโหลดได้โดยสัตว์ไม่หาย
 */
function repairPet(raw: unknown, index: number, db: GeneDb): PetState | null {
  if (!isObject(raw) || !isObject(raw.genome)) return null
  const genome = raw.genome as unknown as PetState['genome']
  try {
    if (genome.v !== 1 || !isObject(genome.genes) || validateGenome(genome, db).length > 0)
      return null
  } catch {
    return null
  }
  const nurtureRaw = isObject(raw.nurture) ? raw.nurture : {}
  const stage = LIFE_STAGES.includes(nurtureRaw.stage as never)
    ? (nurtureRaw.stage as PetState['nurture']['stage'])
    : 'child'
  const needsRaw = isObject(raw.needs) ? raw.needs : {}
  const needs = fullNeeds()
  for (const key of NEED_KEYS) needs[key] = num(needsRaw[key], needs[key])
  const emotionRaw = isObject(raw.emotion) ? raw.emotion : {}
  const calm = neutralEmotion()
  const experienceRaw = isObject(raw.experience) ? raw.experience : {}
  const experience = noExperience()
  for (const key of TRAIT_KEYS) experience[key] = num(experienceRaw[key], 0, -0.25, 0.25)
  const parents =
    Array.isArray(raw.parents) &&
    raw.parents.length === 2 &&
    raw.parents.every((p) => typeof p === 'string')
      ? (raw.parents as [string, string])
      : undefined

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `pet-migrated-${index}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 24) : 'โมจิ',
    genome,
    nurture: { stage, fat: num(nurtureRaw.fat, 0.35), fitness: num(nurtureRaw.fitness, 0.4) },
    needs,
    emotion: {
      valence: num(emotionRaw.valence, calm.valence, -1, 1),
      arousal: num(emotionRaw.arousal, calm.arousal),
      mood: num(emotionRaw.mood, calm.mood, -1, 1),
    },
    experience,
    behavior: BEHAVIORS.includes(raw.behavior as never)
      ? (raw.behavior as PetState['behavior'])
      : 'idle',
    behaviorTimer: num(raw.behaviorTimer, 0, 0, 3600),
    ageSeconds: num(
      raw.ageSeconds,
      stage === 'egg' ? 0 : STAGE_START_SECONDS[stage],
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    ...(stage === 'egg' ? { incubation: num(raw.incubation, 0) } : {}),
    ...(parents ? { parents } : {}),
  }
}

/**
 * อ่านเซฟจากข้อความ JSON — รองรับรุ่น 1 (สัตว์ตัวเดียว) และรุ่น 2
 * คืน null ถ้าอ่านไม่ได้หรือไม่เหลือสัตว์ที่ถูกต้องเลย (ผู้เรียกควรลองสำเนาสำรองถัดไป)
 */
export function parseSave(json: string, db: GeneDb = geneDb): SaveData | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  const rawPets = raw.v === 1 ? [raw.pet] : raw.v === 2 && Array.isArray(raw.pets) ? raw.pets : null
  if (!rawPets) return null

  const pets: PetState[] = []
  const seen = new Set<string>()
  rawPets.forEach((entry, index) => {
    const pet = repairPet(entry, index, db)
    if (!pet) return
    // รหัสซ้ำ (เซฟถูกแก้มือ/เสีย) → ตั้งใหม่ให้ไม่ซ้ำ
    while (seen.has(pet.id)) pet.id = `${pet.id}-x`
    seen.add(pet.id)
    pets.push(pet)
  })
  if (pets.length === 0) return null

  const settingsRaw = isObject(raw.settings) ? raw.settings : {}
  return {
    v: 2,
    pets,
    habitat: typeof raw.habitat === 'string' ? raw.habitat : null,
    settings: {
      quiet: typeof settingsRaw.quiet === 'boolean' ? settingsRaw.quiet : DEFAULT_SETTINGS.quiet,
      perching:
        typeof settingsRaw.perching === 'boolean'
          ? settingsRaw.perching
          : DEFAULT_SETTINGS.perching,
    },
    savedAt: num(raw.savedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

export const serializeSave = (save: SaveData): string => JSON.stringify(save)

/** เลือกเซฟแรกที่อ่านได้จากรายการผู้สมัคร (ไฟล์หลักก่อน แล้วสำเนาสำรองจากใหม่ไปเก่า) */
export function firstValidSave(candidates: string[], db: GeneDb = geneDb): SaveData | null {
  for (const json of candidates) {
    const save = parseSave(json, db)
    if (save) return save
  }
  return null
}
