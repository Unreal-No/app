import { geneDb, type GeneDb } from '@mochimon/data'
import { breed } from '../genetics/breed'
import { express } from '../genetics/express'
import { createFounder } from '../genetics/genome'
import type { Genome, Habitat } from '../genetics/types'
import { hashString, Rng } from '../rng'
import type { PetState } from '../sim/petSim'
import type { SpecialItem } from './items'

/**
 * ส่งสัตว์ออกสำรวจ: นับเวลาจริง (แม้ปิดแอป) — ระหว่างนั้นสัตว์ไม่อยู่บนจอ ไม่มีอะไรลดลง และไม่มีล้มเหลว
 * ของที่ได้ถูกกำหนดตอนออกเดินทาง (ทำซ้ำได้ ทดสอบได้) ถิ่นที่เหมาะกับสัตว์ได้ของมากขึ้น
 */
export type PlaceId = 'meadow' | 'sky' | 'reef' | 'snow' | 'ruins'

export interface Place {
  id: PlaceId
  name: string
  icon: string
  /** ถิ่นของสัตว์ที่เหมาะกับที่นี่ */
  suits: Habitat[]
  /** สายพันธุ์ของไข่ที่อาจเจอ */
  eggs: string[]
  /** ของพิเศษประจำที่ */
  item: SpecialItem
  stories: string[]
}

export const PLACES: Record<PlaceId, Place> = {
  meadow: {
    id: 'meadow',
    name: 'ทุ่งดอกไม้',
    icon: '🌼',
    suits: ['land', 'amphibious'],
    eggs: ['cat', 'bunny'],
    item: 'berry',
    stories: ['วิ่งไล่ผีเสื้อสีรุ้งทั้งบ่าย', 'นอนกลิ้งบนดอกไม้จนหอมไปทั้งตัว', 'เจอกระต่ายป่าชวนเล่นซ่อนหา'],
  },
  sky: {
    id: 'sky',
    name: 'เกาะเมฆ',
    icon: '☁️',
    suits: ['sky'],
    eggs: ['chick', 'dragon'],
    item: 'cloudcandy',
    stories: ['กระโดดบนก้อนเมฆนุ่มๆ', 'นั่งดูพระอาทิตย์ตกจากบนเมฆ', 'แข่งบินกับนกฝูงใหญ่'],
  },
  reef: {
    id: 'reef',
    name: 'แนวปะการัง',
    icon: '🪸',
    suits: ['water', 'amphibious'],
    eggs: ['koi'],
    item: 'seaweed',
    stories: ['ว่ายตามฝูงปลาเล็กๆ', 'เจอเปลือกหอยสีชมพู', 'แอบดูเต่าทะเลกินสาหร่าย'],
  },
  snow: {
    id: 'snow',
    name: 'ทุ่งหิมะ',
    icon: '❄️',
    suits: ['land', 'sky'],
    eggs: ['bunny', 'unicorn'],
    item: 'snowberry',
    stories: ['ปั้นตุ๊กตาหิมะตัวเล็ก', 'ไถลบนเนินหิมะ', 'เห็นแสงเหนือระยิบระยับ'],
  },
  ruins: {
    id: 'ruins',
    name: 'ซากโบราณ',
    icon: '🏛️',
    suits: ['land', 'sky', 'water', 'amphibious'],
    eggs: ['trike'],
    item: 'amber',
    stories: ['ขุดเจอกระดูกแปลกๆ', 'เดินสำรวจถ้ำที่มีภาพวาดโบราณ', 'เจออำพันใสมีใบไม้ข้างใน'],
  },
}
export const PLACE_IDS = Object.keys(PLACES) as PlaceId[]

/** ระยะเวลาที่เลือกได้ (นาที) */
export const EXPEDITION_MINUTES = [15, 60, 240, 480] as const
/** ส่งไปพร้อมกันได้สูงสุด */
export const MAX_EXPEDITIONS = 3

const EGG_CHANCE: Record<number, number> = { 15: 0.08, 60: 0.25, 240: 0.55, 480: 0.8 }

export interface Loot {
  items: Partial<Record<SpecialItem, number>>
  fossils: number
  /** ไข่ที่เจอ: สายพันธุ์ + seed (genome สร้างตอนกลับมา) */
  egg?: { species: [string, string]; seed: string; mythical: boolean }
  story: string
}

export interface Expedition {
  pet: PetState
  place: PlaceId
  startedAt: number
  endsAt: number
  loot: Loot
}

export interface ExpeditionOptions {
  /** คืนวันเพ็ญ: เกาะเมฆ/ทุ่งหิมะมีโอกาสเจอไข่เทพนิยาย */
  fullMoon?: boolean
}

/** สัตว์ตัวนี้เหมาะกับที่นี่ไหม */
export function suited(pet: PetState, place: PlaceId, db: GeneDb = geneDb): boolean {
  return PLACES[place].suits.includes(express(pet.genome, db).habitat)
}

/** ส่งออกสำรวจ: กำหนดของที่จะได้ตั้งแต่ตอนนี้ */
export function startExpedition(
  pet: PetState,
  place: PlaceId,
  minutes: number,
  now: number,
  opts: ExpeditionOptions = {},
  db: GeneDb = geneDb,
): Expedition {
  const rng = new Rng(`exp:${pet.id}:${place}:${now}`)
  const spot = PLACES[place]
  const good = suited(pet, place, db)
  const hours = minutes / 60
  const items: Loot['items'] = {
    [spot.item]: Math.max(1, Math.round(1 + hours * 0.75 + (good ? 1 : 0))),
  }
  // ของแถมจากที่อื่นบ้าง (สำรวจนานเจอของหลากหลาย)
  if (minutes >= 240 && rng.chance(0.5)) {
    const other = PLACES[rng.pick(PLACE_IDS.filter((p) => p !== place))].item
    items[other] = (items[other] ?? 0) + 1
  }
  const fossils = place === 'ruins' ? Math.max(minutes >= 60 ? 1 : 0, Math.floor(hours)) : 0
  const base = EGG_CHANCE[minutes] ?? Math.min(0.85, hours * 0.12)
  let egg: Loot['egg']
  const mythicalChance =
    opts.fullMoon && (place === 'sky' || place === 'snow') && minutes >= 240 ? 0.45 : 0
  if (rng.chance(mythicalChance)) {
    const species = place === 'sky' ? 'dragon' : 'unicorn'
    egg = { species: [species, species], seed: `${pet.id}:${now}:egg`, mythical: true }
  } else if (place !== 'ruins' && rng.chance(Math.min(0.95, base * (good ? 1.3 : 1)))) {
    const a = rng.pick(spot.eggs)
    const b = rng.chance(0.3) ? rng.pick(Object.keys(db.species)) : a
    egg = { species: [a, b], seed: `${pet.id}:${now}:egg`, mythical: false }
  }
  return {
    pet,
    place,
    startedAt: now,
    endsAt: now + minutes * 60_000,
    loot: { items, fossils, ...(egg ? { egg } : {}), story: rng.pick(spot.stories) },
  }
}

export const expeditionDone = (exp: Expedition, now: number): boolean => now >= exp.endsAt
export const expeditionLeft = (exp: Expedition, now: number): number =>
  Math.max(0, exp.endsAt - now)

/** genome ของไข่ที่เจอระหว่างสำรวจ */
export function lootEgg(egg: NonNullable<Loot['egg']>, db: GeneDb = geneDb): Genome {
  const rng = new Rng(egg.seed)
  const [a, b] = egg.species
  const first = createFounder(db.species[a] ? a : 'cat', rng, db)
  if (a === b || !db.species[b]) return first
  return { ...breed(first, createFounder(b, rng, db), rng, { db }).genome, generation: 0 }
}

/** ไข่ฟอสซิลจากชิ้นฟอสซิลที่ประกอบครบ */
export function fossilGenome(seed: string, db: GeneDb = geneDb): Genome {
  const rng = new Rng(`fossil:${seed}:${hashString(seed)}`)
  const prehistoric = Object.values(db.species).filter((s) => s.lineage === 'prehistoric')
  return createFounder(
    rng.pick(prehistoric.length ? prehistoric : Object.values(db.species)).id,
    rng,
    db,
  )
}
