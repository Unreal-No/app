import { geneDb, type GeneDb } from '@mochimon/data'
import { BEHAVIORS } from '../behavior/utility'
import { createCompanion, repairCompanion, type CompanionState } from '../companion/companion'
import { LIFE_STAGES } from '../body/composition'
import { createDex, repairDex, type Dex } from '../genetics/dex'
import { repairFamily, type FamilyBook } from '../genetics/family'
import { validateGenome } from '../genetics/genome'
import { neutralEmotion } from '../mind/emotion'
import { fullNeeds, NEED_KEYS } from '../mind/needs'
import { noExperience, TRAIT_KEYS } from '../mind/personality'
import { clamp } from '../rng'
import { ORIGIN_KINDS, STAGE_START_SECONDS, type PetOrigin, type PetState } from '../sim/petSim'
import { createSummonLog, repairSummonLog, type SummonLog } from '../summon/registry'
import { repairRelations, type Relations } from '../mind/relations'
import { PLACES, type Expedition, type PlaceId } from '../world/expedition'
import { createInventory, repairInventory, type Inventory } from '../world/items'

export interface SaveSettings {
  /** โหมดเงียบ (ไม่รบกวน) */
  quiet: boolean
  /** ให้สัตว์ปีนไปเกาะขอบหน้าต่างโปรแกรมอื่น */
  perching: boolean
  /** ซ่อนสัตว์เองเมื่อมีแอป/เกมเต็มจอ */
  hideOnFullscreen: boolean
  /** แสงและบรรยากาศตามเวลาจริง (กลางวัน/กลางคืน ฤดู เทศกาล) */
  daylight: boolean
}

/** รูปแบบไฟล์เซฟรุ่นปัจจุบัน */
export interface SaveData {
  v: 3
  /** สัตว์ที่อยู่บนจอ (ไม่เกิน MAX_ACTIVE_PETS) */
  pets: PetState[]
  /** สัตว์ที่ฝากไว้ที่ฟาร์ม (ไม่ได้อยู่บนจอ เวลาของพวกมันหยุดนิ่ง) */
  farm: PetState[]
  /** ฉากมุมพักผ่อนที่เลือก (null = โหมดกลมกลืน) */
  habitat: string | null
  settings: SaveSettings
  /** ผู้ช่วยทำงาน: นัด งาน จับเวลาโฟกัส สุขภาพ (ตั้งแต่รุ่น 3) */
  companion: CompanionState
  /** สมุดสะสมลักษณะ/สายพันธุ์ที่พบ */
  dex: Dex
  /** ไฟล์ที่เคยอัญเชิญ (hash) + โควตาต่อวัน */
  summons: SummonLog
  /** บันทึกเครือญาติ */
  family: FamilyBook
  /** ของพิเศษและชิ้นฟอสซิล */
  inventory: Inventory
  /** สัตว์ที่ออกสำรวจอยู่ (ไม่อยู่บนจอ/ฟาร์ม) */
  expeditions: Expedition[]
  /** ความสัมพันธ์ระหว่างสัตว์ */
  relations: Relations
  /** เวลาที่แขกป่าตัวถัดไปจะมา (0 = ยังไม่กำหนด) */
  visitorAt: number
  savedAt: number
}

/** ส่วนของเซฟที่เพิ่มทีหลัง (มีค่าเริ่มต้นเสมอ) */
export type SaveExtras = Partial<
  Pick<
    SaveData,
    'dex' | 'summons' | 'family' | 'inventory' | 'expeditions' | 'relations' | 'visitorAt'
  >
>

/** จำนวนสัตว์สูงสุดที่เดินบนจอพร้อมกัน (ที่เหลืออยู่ฟาร์ม) */
export const MAX_ACTIVE_PETS = 4
/** จำนวนสัตว์สูงสุดในฟาร์ม (เกินแล้วรับตัวใหม่เพิ่มไม่ได้ — ตัวที่มีอยู่ไม่หาย) */
export const MAX_FARM_PETS = 60

export const DEFAULT_SETTINGS: SaveSettings = {
  quiet: false,
  perching: true,
  hideOnFullscreen: true,
  daylight: true,
}

export function createSave(
  pets: PetState[],
  habitat: string | null = null,
  settings: SaveSettings = DEFAULT_SETTINGS,
  savedAt = 0,
  farm: PetState[] = [],
  companion: CompanionState = createCompanion(savedAt),
  extras: SaveExtras = {},
): SaveData {
  return {
    v: 3,
    pets,
    farm,
    habitat,
    settings: { ...settings },
    companion,
    dex: extras.dex ?? createDex(),
    summons: extras.summons ?? createSummonLog(),
    family: extras.family ?? {},
    inventory: extras.inventory ?? createInventory(),
    expeditions: extras.expeditions ?? [],
    relations: extras.relations ?? {},
    visitorAt: extras.visitorAt ?? 0,
    savedAt,
  }
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
  const originRaw = isObject(raw.origin) ? raw.origin : null
  const origin: PetOrigin | undefined =
    originRaw && ORIGIN_KINDS.includes(originRaw.kind as never)
      ? {
          kind: originRaw.kind as PetOrigin['kind'],
          ...(typeof originRaw.fileKind === 'string'
            ? { fileKind: originRaw.fileKind.slice(0, 16) }
            : {}),
          ...(originRaw.fossil === true ? { fossil: true } : {}),
          ...(typeof originRaw.place === 'string' ? { place: originRaw.place.slice(0, 24) } : {}),
        }
      : undefined
  const mutations = Array.isArray(raw.mutations)
    ? raw.mutations.filter((m): m is string => typeof m === 'string' && Boolean(db.alleles[m]))
    : []

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
    ...(typeof raw.bornAt === 'number' && Number.isFinite(raw.bornAt)
      ? { bornAt: raw.bornAt }
      : {}),
    ...(origin ? { origin } : {}),
    ...(mutations.length > 0 ? { mutations } : {}),
  }
}

/**
 * อ่านเซฟจากข้อความ JSON — รองรับรุ่น 1 (สัตว์ตัวเดียว), รุ่น 2 และรุ่น 3 (มีข้อมูลผู้ช่วย)
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
  const rawPets =
    raw.v === 1
      ? [raw.pet]
      : (raw.v === 2 || raw.v === 3) && Array.isArray(raw.pets)
        ? raw.pets
        : null
  if (!rawPets) return null

  const seen = new Set<string>()
  const repairAll = (entries: unknown[], offset: number): PetState[] => {
    const list: PetState[] = []
    entries.forEach((entry, index) => {
      const pet = repairPet(entry, offset + index, db)
      if (!pet) return
      // รหัสซ้ำ (เซฟถูกแก้มือ/เสีย) → ตั้งใหม่ให้ไม่ซ้ำ
      while (seen.has(pet.id)) pet.id = `${pet.id}-x`
      seen.add(pet.id)
      list.push(pet)
    })
    return list
  }
  const pets = repairAll(rawPets, 0)
  const farm = repairAll(Array.isArray(raw.farm) ? raw.farm : [], rawPets.length)
  const expeditions: Expedition[] = []
  for (const entry of Array.isArray(raw.expeditions) ? raw.expeditions : []) {
    if (!isObject(entry)) continue
    const pet = repairAll([entry.pet], 1000 + expeditions.length)[0]
    const trip = pet ? repairExpedition(entry, pet) : null
    if (trip) expeditions.push(trip)
  }
  // บนจอว่างแต่ฟาร์มมีสัตว์ → พาตัวแรกกลับมา; บนจอเกินโควตา → ส่วนเกินไปฟาร์ม (ไม่มีตัวไหนหาย)
  if (pets.length === 0 && farm.length > 0) pets.push(farm.shift()!)
  if (pets.length === 0) return null
  farm.unshift(...pets.splice(MAX_ACTIVE_PETS))

  // ค่าตั้งที่หาย/ผิดชนิด (เช่น เซฟจากรุ่นเก่า) ใช้ค่าเริ่มต้น
  const settingsRaw = isObject(raw.settings) ? raw.settings : {}
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(settings) as (keyof SaveSettings)[]) {
    if (typeof settingsRaw[key] === 'boolean') settings[key] = settingsRaw[key]
  }
  return {
    v: 3,
    pets,
    farm,
    habitat: typeof raw.habitat === 'string' ? raw.habitat : null,
    settings,
    // รุ่นเก่าไม่มีข้อมูลผู้ช่วย → เริ่มว่าง; รายการที่เสียถูกทิ้งทีละรายการ
    companion: repairCompanion(raw.companion, Date.now()),
    dex: repairDex(raw.dex, db),
    summons: repairSummonLog(raw.summons),
    family: repairFamily(raw.family),
    inventory: repairInventory(raw.inventory),
    expeditions,
    relations: repairRelations(raw.relations),
    visitorAt: num(raw.visitorAt, 0, 0, Number.MAX_SAFE_INTEGER),
    savedAt: num(raw.savedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

/** ซ่อมการสำรวจ 1 รายการ (สัตว์ซ่อมแล้ว) — ข้อมูลเสียจนใช้ไม่ได้ → ให้สัตว์กลับบ้านทันทีพร้อมของเล็กน้อย */
function repairExpedition(raw: Record<string, unknown>, pet: PetState): Expedition {
  const place = (Object.keys(PLACES) as PlaceId[]).includes(raw.place as PlaceId)
    ? (raw.place as PlaceId)
    : 'meadow'
  const startedAt = num(raw.startedAt, 0, 0, Number.MAX_SAFE_INTEGER)
  const endsAt = num(raw.endsAt, startedAt, startedAt, Number.MAX_SAFE_INTEGER)
  const lootRaw = isObject(raw.loot) ? raw.loot : {}
  const bag = repairInventory({ items: lootRaw.items, fossils: lootRaw.fossils })
  const eggRaw = isObject(lootRaw.egg) ? lootRaw.egg : null
  const egg =
    eggRaw &&
    Array.isArray(eggRaw.species) &&
    eggRaw.species.length === 2 &&
    eggRaw.species.every((x) => typeof x === 'string') &&
    typeof eggRaw.seed === 'string'
      ? {
          species: eggRaw.species as [string, string],
          seed: eggRaw.seed,
          mythical: eggRaw.mythical === true,
        }
      : undefined
  return {
    pet,
    place,
    startedAt,
    endsAt,
    loot: {
      items: bag.items,
      fossils: bag.fossils,
      ...(egg ? { egg } : {}),
      story: typeof lootRaw.story === 'string' ? lootRaw.story.slice(0, 120) : '',
    },
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

/**
 * เลือกเซฟที่จะใช้ตอนเริ่มแอป: เซฟจากไฟล์ (หลัก → สำรอง) เทียบกับสำเนาอีกที่หนึ่ง (เช่น localStorage)
 * แล้วใช้อัน**ใหม่กว่า** — ถ้าการเขียนไฟล์ครั้งล่าสุดไม่สำเร็จ สำเนาอีกที่จะยังมีความคืบหน้าล่าสุดอยู่
 */
export function newestSave(
  files: string[],
  other: string | null,
  db: GeneDb = geneDb,
): SaveData | null {
  const fromFiles = firstValidSave(files, db)
  const fromOther = other ? parseSave(other, db) : null
  if (!fromFiles) return fromOther
  if (!fromOther) return fromFiles
  return fromOther.savedAt > fromFiles.savedAt ? fromOther : fromFiles
}
