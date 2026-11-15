import {
  createFounder,
  createMochi,
  createPet,
  breed,
  geneDb,
  validateGenome,
  type PetState,
  type Rng,
} from '@mochimon/core'

/**
 * เซฟชั่วคราวของ M0: เก็บสถานะสัตว์ลง localStorage ของ webview
 * (M1 จะย้ายไป SQLite พร้อมระบบ migration — ดู docs/ARCHITECTURE.md)
 */
const KEY = 'mochimon.save.v1'

interface SaveFile {
  v: 1
  pet: PetState
  savedAt: number
}

export function loadPet(): PetState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveFile
    if (data?.v !== 1 || !data.pet?.genome) return null
    if (validateGenome(data.pet.genome).length > 0) return null
    return data.pet
  } catch {
    return null
  }
}

export function savePet(pet: PetState): void {
  try {
    const data: SaveFile = { v: 1, pet, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // เซฟไม่ได้ (เช่น storage เต็ม) — ไม่ให้เกมล่ม
  }
}

const NAMES = ['โมจิ', 'ดังโงะ', 'ถั่วแดง', 'ปุยนุ่น', 'ข้าวปั้น', 'บัวลอย', 'ทองหยิบ', 'ลูกชุบ']

/** สัตว์ตัวแรกของผู้เล่น: "โมจิ" ตัวเอกแมว×มังกร */
export function firstPet(): PetState {
  return createPet('โมจิ', createMochi(), { stage: 'child', fat: 0.38, fitness: 0.4 })
}

/** ไข่ใบใหม่ (เมนูทดลอง): สุ่มสายพันธุ์ มีโอกาสเป็นลูกผสมข้ามสายพันธุ์ — ต้องรอฟัก */
export function newPet(rng: Rng): PetState {
  const ids = Object.keys(geneDb.species)
  let genome = createFounder(rng.pick(ids), rng)
  if (rng.chance(0.4)) genome = breed(genome, createFounder(rng.pick(ids), rng), rng).genome
  return createPet(rng.pick(NAMES), genome, { stage: 'egg', fat: 0.35, fitness: 0.4 })
}

const HABITAT_KEY = 'mochimon.habitat.v1'

/** ฉากมุมพักผ่อนที่เลือกไว้ (null = โหมดกลมกลืน ไม่มีฉาก) */
export function loadHabitat(): string | null {
  try {
    return localStorage.getItem(HABITAT_KEY)
  } catch {
    return null
  }
}

export function saveHabitat(kind: string | null): void {
  try {
    if (kind) localStorage.setItem(HABITAT_KEY, kind)
    else localStorage.removeItem(HABITAT_KEY)
  } catch {
    // ไม่ให้เกมล่มถ้าเซฟไม่ได้
  }
}
