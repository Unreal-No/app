import { geneDb, type GeneDb } from '@mochimon/data'
import { express } from '../genetics/express'
import type { Habitat } from '../genetics/types'
import type { Needs } from '../mind/needs'
import { clamp } from '../rng'
import { petEvent, type PetState } from '../sim/petSim'

/**
 * ของกิน: อาหารพื้นฐาน (มีไม่จำกัด ใช้ผูกมิตรแขกป่า) และของพิเศษที่ได้จากการสำรวจ (มีจำนวน)
 */
export const BASIC_FOODS = ['apple', 'fish', 'carrot'] as const
export const SPECIAL_ITEMS = ['berry', 'cloudcandy', 'seaweed', 'snowberry', 'amber'] as const
export type BasicFood = (typeof BASIC_FOODS)[number]
export type SpecialItem = (typeof SPECIAL_ITEMS)[number]
export type FoodId = BasicFood | SpecialItem

export interface ItemDef {
  name: string
  icon: string
  /** ผลต่อ needs เมื่อกิน */
  care: Partial<Needs>
  /** ถิ่นที่ชอบของชนิดนี้เป็นพิเศษ */
  loved?: Habitat[]
}

export const ITEMS: Record<FoodId, ItemDef> = {
  apple: { name: 'แอปเปิล', icon: '🍎', care: { hunger: 0.25 } },
  fish: { name: 'ปลาย่าง', icon: '🐟', care: { hunger: 0.3 } },
  carrot: { name: 'แครอท', icon: '🥕', care: { hunger: 0.22, comfort: 0.03 } },
  berry: {
    name: 'เบอร์รีทุ่งดอกไม้',
    icon: '🍓',
    care: { hunger: 0.3, fun: 0.2 },
    loved: ['land'],
  },
  cloudcandy: {
    name: 'ลูกอมเมฆ',
    icon: '🍬',
    care: { hunger: 0.2, fun: 0.3, energy: 0.1 },
    loved: ['sky'],
  },
  seaweed: {
    name: 'สาหร่ายหวาน',
    icon: '🌿',
    care: { hunger: 0.3, comfort: 0.15 },
    loved: ['water', 'amphibious'],
  },
  snowberry: {
    name: 'ผลไม้หิมะ',
    icon: '🫐',
    care: { hunger: 0.25, energy: 0.2 },
    loved: ['land', 'sky'],
  },
  amber: { name: 'ลูกกวาดอำพัน', icon: '🍯', care: { hunger: 0.2, fun: 0.25, social: 0.15 } },
}

/** กระเป๋า: ของพิเศษ (จำนวน) + ชิ้นฟอสซิล */
export interface Inventory {
  items: Partial<Record<SpecialItem, number>>
  fossils: number
}
export const createInventory = (): Inventory => ({ items: {}, fossils: 0 })
/** ชิ้นฟอสซิลที่ใช้ประกอบไข่ 1 ใบ */
export const FOSSILS_PER_EGG = 3

export const isSpecial = (id: string): id is SpecialItem =>
  (SPECIAL_ITEMS as readonly string[]).includes(id)

export function addItems(
  inv: Inventory,
  items: Partial<Record<SpecialItem, number>>,
  fossils = 0,
): Inventory {
  const next = { ...inv.items }
  for (const [id, n] of Object.entries(items) as [SpecialItem, number][])
    next[id] = Math.min(99, (next[id] ?? 0) + n)
  return { items: next, fossils: Math.min(99, inv.fossils + fossils) }
}

/** ใช้ของพิเศษ 1 ชิ้น — คืน null ถ้าไม่มี */
export function takeItem(inv: Inventory, id: SpecialItem): Inventory | null {
  const have = inv.items[id] ?? 0
  if (have <= 0) return null
  const items = { ...inv.items, [id]: have - 1 }
  if (items[id] === 0) delete items[id]
  return { ...inv, items }
}

/** ให้สัตว์กินของ: ของที่ถิ่นของมันชอบได้ผลแรงขึ้นและดีใจเป็นพิเศษ */
export function feedItem(
  pet: PetState,
  id: FoodId,
  db: GeneDb = geneDb,
): { pet: PetState; loved: boolean } {
  if (pet.nurture.stage === 'egg') return { pet, loved: false }
  const def = ITEMS[id]
  const habitat = express(pet.genome, db).habitat
  const loved = Boolean(def.loved?.includes(habitat))
  const needs = { ...pet.needs }
  for (const [key, delta] of Object.entries(def.care) as [keyof Needs, number][])
    needs[key] = clamp(needs[key] + delta * (loved ? 1.4 : 1))
  let next = petEvent({ ...pet, needs }, 'treat', db)
  if (loved) next = petEvent(next, 'treat', db)
  return { pet: next, loved }
}

export function repairInventory(raw: unknown): Inventory {
  const inv = createInventory()
  if (typeof raw !== 'object' || raw === null) return inv
  const r = raw as Record<string, unknown>
  if (typeof r.fossils === 'number' && Number.isFinite(r.fossils))
    inv.fossils = Math.max(0, Math.min(99, Math.floor(r.fossils)))
  if (typeof r.items === 'object' && r.items !== null) {
    for (const [id, n] of Object.entries(r.items as Record<string, unknown>)) {
      if (isSpecial(id) && typeof n === 'number' && n > 0)
        inv.items[id] = Math.min(99, Math.floor(n))
    }
  }
  return inv
}
