import { geneDb, type GeneDb } from '@mochimon/data'
import { speciesLabel } from './naming'
import type { Genome } from './types'

/**
 * บันทึกเครือญาติ: ข้อมูลย่อของทุกตัวที่เคยเกิดในบ้านนี้
 * แยกจากตัวสัตว์ เพื่อให้ผังยังครบแม้ข้อมูลตัวเต็มถูกย้าย/เปลี่ยน
 */
export interface FamilyRecord {
  id: string
  name: string
  /** ชื่อสายพันธุ์ภาษาไทย ณ ตอนบันทึก */
  species: string
  generation: number
  parents?: [string, string]
  bornAt?: number
}

export type FamilyBook = Record<string, FamilyRecord>

export interface FamilyMember {
  id: string
  name: string
  genome: Genome
  parents?: [string, string]
  bornAt?: number
}

/** บันทึก/อัปเดตข้อมูลของสัตว์ 1 ตัว (ชื่อเปลี่ยนได้) — คืนสมุดใหม่ */
export function recordFamily(book: FamilyBook, pet: FamilyMember, db: GeneDb = geneDb): FamilyBook {
  const old = book[pet.id]
  const record: FamilyRecord = {
    id: pet.id,
    name: pet.name,
    species: speciesLabel(pet.genome, db).th,
    generation: pet.genome.generation,
    ...(pet.parents ? { parents: pet.parents } : {}),
    ...((pet.bornAt ?? old?.bornAt) !== undefined ? { bornAt: pet.bornAt ?? old?.bornAt } : {}),
  }
  if (
    old &&
    old.name === record.name &&
    old.species === record.species &&
    old.bornAt === record.bornAt &&
    old.generation === record.generation
  )
    return book
  return { ...book, [pet.id]: record }
}

export interface PedigreeNode {
  id: string
  /** null = ไม่มีข้อมูล (เช่น บรรพบุรุษจากรุ่นก่อนบันทึก) */
  record: FamilyRecord | null
  parents?: [PedigreeNode, PedigreeNode]
}

/** ผังบรรพบุรุษย้อนหลัง depth รุ่น (ตัวเอง = รุ่น 0) */
export function pedigree(book: FamilyBook, id: string, depth = 2): PedigreeNode {
  const walk = (current: string, level: number, seen: Set<string>): PedigreeNode => {
    const record = book[current] ?? null
    const node: PedigreeNode = { id: current, record }
    // กันข้อมูลวนซ้ำ (เซฟเสีย) ด้วย seen
    if (record?.parents && level < depth && !seen.has(current)) {
      const next = new Set(seen).add(current)
      node.parents = [
        walk(record.parents[0], level + 1, next),
        walk(record.parents[1], level + 1, next),
      ]
    }
    return node
  }
  return walk(id, 0, new Set())
}

/** ลูกทั้งหมดของตัวนี้ (เรียงจากเกิดก่อน) */
export function childrenOf(book: FamilyBook, id: string): FamilyRecord[] {
  return Object.values(book)
    .filter((r) => r.parents?.includes(id))
    .sort((a, b) => (a.bornAt ?? 0) - (b.bornAt ?? 0))
}

/** พี่น้อง (มีพ่อหรือแม่ร่วมกันอย่างน้อย 1 ตัว) */
export function siblingsOf(book: FamilyBook, id: string): FamilyRecord[] {
  const parents = book[id]?.parents
  if (!parents) return []
  return Object.values(book).filter(
    (r) => r.id !== id && r.parents?.some((p) => parents.includes(p)),
  )
}

/** สองตัวเป็นญาติสายตรง (พ่อแม่-ลูก หรือพี่น้อง) ไหม */
export function areFamily(book: FamilyBook, a: string, b: string): boolean {
  const ra = book[a]
  const rb = book[b]
  if (ra?.parents?.includes(b) || rb?.parents?.includes(a)) return true
  return Boolean(ra?.parents && rb?.parents?.some((p) => ra.parents!.includes(p)))
}

/** ซ่อมสมุดจากเซฟ: ทิ้งรายการที่เสียทีละรายการ */
export function repairFamily(raw: unknown): FamilyBook {
  const book: FamilyBook = {}
  if (typeof raw !== 'object' || raw === null) return book
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const v = value as Record<string, unknown>
    if (typeof v.name !== 'string') continue
    const parents =
      Array.isArray(v.parents) &&
      v.parents.length === 2 &&
      v.parents.every((p) => typeof p === 'string')
        ? (v.parents as [string, string])
        : undefined
    book[id] = {
      id,
      name: v.name.slice(0, 24),
      species: typeof v.species === 'string' ? v.species.slice(0, 80) : '',
      generation: typeof v.generation === 'number' ? Math.max(0, Math.floor(v.generation)) : 0,
      ...(parents ? { parents } : {}),
      ...(typeof v.bornAt === 'number' ? { bornAt: v.bornAt } : {}),
    }
  }
  return book
}
