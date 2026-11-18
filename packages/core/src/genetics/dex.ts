import { geneDb, type GeneDb, type PartAlleleDef, type Rarity, type Slot } from '@mochimon/data'
import { express } from './express'
import { ancestryRanking } from './naming'
import type { Genome } from './types'

/**
 * สมุดสะสม (Monsterpedia): ลักษณะและสายพันธุ์ที่ผู้เล่นเคยพบ
 * เก็บแค่เวลาที่พบครั้งแรก — ข้อมูลรายละเอียดอ่านจาก Gene DB
 */
export interface Dex {
  /** รหัส allele ชิ้นส่วน → เวลาที่พบครั้งแรก (ms) */
  alleles: Record<string, number>
  /** รหัสสายพันธุ์ → เวลาที่พบครั้งแรก */
  species: Record<string, number>
}

export const createDex = (): Dex => ({ alleles: {}, species: {} })

/** สายเลือดที่นับว่า "พบ" สายพันธุ์นั้นแล้ว */
const SPECIES_SHARE = 0.25

/**
 * ลักษณะที่มองเห็นได้ของสัตว์ 1 ตัว: ชิ้นส่วนที่แสดงออก + ยีนส์แฝง (ถ้าเปิดเผยแล้ว)
 * ไข่ยังไม่นับ (ยังไม่เห็นตัว)
 */
export function visibleAlleles(
  genome: Genome,
  revealHidden: boolean,
  db: GeneDb = geneDb,
): string[] {
  const phenotype = express(genome, db)
  const ids = new Set<string>()
  for (const part of Object.values(phenotype.parts)) {
    ids.add(part.def.id)
    if (revealHidden && part.hidden) ids.add(part.hidden.id)
  }
  return [...ids]
}

export interface Discovery {
  dex: Dex
  /** ลักษณะที่พบครั้งแรก */
  alleles: PartAlleleDef[]
  /** สายพันธุ์ที่พบครั้งแรก */
  species: string[]
}

/** บันทึกสิ่งที่เห็นจากสัตว์ 1 ตัว → คืนสมุดใหม่ + รายการที่เพิ่งค้นพบ */
export function discover(
  dex: Dex,
  genome: Genome,
  revealHidden: boolean,
  now: number,
  db: GeneDb = geneDb,
): Discovery {
  const found: PartAlleleDef[] = []
  const alleles = { ...dex.alleles }
  for (const id of visibleAlleles(genome, revealHidden, db)) {
    const def = db.alleles[id]
    if (!def || alleles[id] !== undefined) continue
    alleles[id] = now
    found.push(def)
  }
  const species = { ...dex.species }
  const newSpecies: string[] = []
  for (const [id, share] of ancestryRanking(genome)) {
    if (share < SPECIES_SHARE || !db.species[id] || species[id] !== undefined) continue
    species[id] = now
    newSpecies.push(id)
  }
  return { dex: { alleles, species }, alleles: found, species: newSpecies }
}

export interface DexSlot {
  slot: Slot
  /** ชื่อไทยของตำแหน่งยีนส์ */
  name: string
  alleles: PartAlleleDef[]
}

/** รายการลักษณะทั้งหมดแยกตามส่วนของร่างกาย (เรียงจากพบง่ายไปหายาก) */
export function dexSlots(db: GeneDb = geneDb): DexSlot[] {
  const order: Rarity[] = ['common', 'uncommon', 'rare', 'legendary']
  const slots: DexSlot[] = []
  for (const locus of db.loci) {
    if (locus.kind !== 'part') continue
    const alleles = [...(db.allelesByLocus[locus.id] ?? [])].sort(
      (a, b) =>
        order.indexOf(a.rarity) - order.indexOf(b.rarity) ||
        Number(a.mutationOnly ?? false) - Number(b.mutationOnly ?? false) ||
        a.id.localeCompare(b.id),
    )
    slots.push({ slot: locus.slot, name: locus.name.th, alleles })
  }
  return slots
}

export interface DexProgress {
  found: number
  total: number
  byRarity: Record<Rarity, { found: number; total: number }>
  species: { found: number; total: number }
}

export function dexProgress(dex: Dex, db: GeneDb = geneDb): DexProgress {
  const byRarity: DexProgress['byRarity'] = {
    common: { found: 0, total: 0 },
    uncommon: { found: 0, total: 0 },
    rare: { found: 0, total: 0 },
    legendary: { found: 0, total: 0 },
  }
  let found = 0
  const all = Object.values(db.alleles)
  for (const def of all) {
    byRarity[def.rarity].total++
    if (dex.alleles[def.id] !== undefined) {
      byRarity[def.rarity].found++
      found++
    }
  }
  const speciesIds = Object.keys(db.species)
  return {
    found,
    total: all.length,
    byRarity,
    species: {
      found: speciesIds.filter((id) => dex.species[id] !== undefined).length,
      total: speciesIds.length,
    },
  }
}

/** ซ่อมสมุดจากเซฟ: เก็บเฉพาะรหัสที่ยังมีอยู่ใน Gene DB */
export function repairDex(raw: unknown, db: GeneDb = geneDb): Dex {
  const dex = createDex()
  if (typeof raw !== 'object' || raw === null) return dex
  const r = raw as Record<string, unknown>
  const copy = (from: unknown, into: Record<string, number>, valid: (id: string) => boolean) => {
    if (typeof from !== 'object' || from === null) return
    for (const [id, at] of Object.entries(from as Record<string, unknown>)) {
      if (valid(id) && typeof at === 'number' && Number.isFinite(at)) into[id] = at
    }
  }
  copy(r.alleles, dex.alleles, (id) => Boolean(db.alleles[id]))
  copy(r.species, dex.species, (id) => Boolean(db.species[id]))
  return dex
}
