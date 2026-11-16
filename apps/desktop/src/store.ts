import {
  breed,
  createFounder,
  createMochi,
  createPet,
  firstValidSave,
  geneDb,
  newPetId,
  parseSave,
  serializeSave,
  type PetState,
  type Rng,
  type SaveData,
} from '@mochimon/core'
import { readSaveFiles, writeSaveFile } from './bridge'

/**
 * ที่เก็บเซฟ
 * - ในแอปจริง: ไฟล์ JSON ในโฟลเดอร์ข้อมูลของแอป (ฝั่ง Rust เขียนแบบ atomic + เก็บสำเนาสำรองหมุนเวียน)
 *   และเขียนสำเนาลง localStorage ไว้อีกชั้น
 * - ในเบราว์เซอร์ (ตอนพัฒนา/ทดสอบ): localStorage อย่างเดียว
 */
const KEY = 'mochimon.save.v2'
/** เซฟของรุ่นแรก (สัตว์ตัวเดียว) — อ่านเพื่อย้ายข้อมูล ไม่ลบทิ้ง */
const LEGACY_KEY = 'mochimon.save.v1'
const LEGACY_HABITAT_KEY = 'mochimon.habitat.v1'

const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** โหลดเซฟล่าสุดที่อ่านได้: ไฟล์หลัก → สำเนาสำรอง → localStorage → เซฟรุ่นเก่า */
export async function loadSave(): Promise<SaveData | null> {
  const files = await readSaveFiles()
  const local = readLocal(KEY)
  const current = firstValidSave([...files, ...(local ? [local] : [])])
  if (current) return current

  const legacy = readLocal(LEGACY_KEY)
  const migrated = legacy ? parseSave(legacy) : null
  if (migrated) migrated.habitat = readLocal(LEGACY_HABITAT_KEY)
  return migrated
}

export function storeSave(save: SaveData): void {
  const json = serializeSave(save)
  writeSaveFile(json)
  try {
    localStorage.setItem(KEY, json)
  } catch {
    // เซฟลง localStorage ไม่ได้ (เช่น เต็ม) — ไม่ให้เกมล่ม
  }
}

const NAMES = [
  'โมจิ',
  'ดังโงะ',
  'ถั่วแดง',
  'ปุยนุ่น',
  'ข้าวปั้น',
  'บัวลอย',
  'ทองหยิบ',
  'ลูกชุบ',
  'ขนมชั้น',
  'ฝอยทอง',
  'เต้าฮวย',
  'สาคู',
]

/** ชื่อที่ยังไม่ซ้ำกับสัตว์ที่มีอยู่ (ถ้าหมดก็ยอมซ้ำ) */
export function pickName(rng: Rng, taken: string[]): string {
  const free = NAMES.filter((name) => !taken.includes(name))
  return rng.pick(free.length > 0 ? free : NAMES)
}

/** สัตว์ตัวแรกของผู้เล่น: "โมจิ" ตัวเอกแมว×มังกร */
export function firstPet(): PetState {
  return createPet('โมจิ', createMochi(), { stage: 'child', fat: 0.38, fitness: 0.4 })
}

/** ไข่ใบใหม่จากเมนู: สุ่มสายพันธุ์ มีโอกาสเป็นลูกผสมข้ามสายพันธุ์ — ต้องรอฟัก */
export function newEgg(rng: Rng, taken: string[]): PetState {
  const ids = Object.keys(geneDb.species)
  let genome = createFounder(rng.pick(ids), rng)
  if (rng.chance(0.4)) genome = breed(genome, createFounder(rng.pick(ids), rng), rng).genome
  return createPet(
    pickName(rng, taken),
    genome,
    { stage: 'egg', fat: 0.35, fitness: 0.4 },
    newPetId(rng),
  )
}
