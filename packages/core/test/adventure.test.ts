import { describe, expect, it } from 'vitest'
import {
  addItems,
  compatibility,
  createFounder,
  createInventory,
  createPet,
  createSave,
  createVisitor,
  DEFAULT_NURTURE,
  expeditionDone,
  expeditionLeft,
  express,
  feedItem,
  fossilGenome,
  geneDb,
  lootEgg,
  nextVisitAt,
  offerFood,
  pairKey,
  parseSave,
  PLACE_IDS,
  relationLabel,
  repairRelations,
  Rng,
  serializeSave,
  shareMoment,
  startExpedition,
  suited,
  takeItem,
  tickRelations,
  validateGenome,
  VISIT_MS,
  type PetState,
  type Temperament,
} from '../src'

const adult = (species: string, seed: string): PetState =>
  createPet(species, createFounder(species, new Rng(seed)), { ...DEFAULT_NURTURE, stage: 'adult' })
const NOW = Date.UTC(2026, 10, 18, 5)

describe('ส่งสำรวจ', () => {
  it('ผลกำหนดตอนออกเดินทาง ทำซ้ำได้ และนับเวลาจริง', () => {
    const cat = adult('cat', 'c')
    const a = startExpedition(cat, 'meadow', 60, NOW)
    const b = startExpedition(cat, 'meadow', 60, NOW)
    expect(a.loot).toEqual(b.loot)
    expect(a.endsAt - a.startedAt).toBe(60 * 60_000)
    expect(expeditionDone(a, NOW + 59 * 60_000)).toBe(false)
    expect(expeditionDone(a, NOW + 60 * 60_000)).toBe(true)
    // ปิดแอปข้ามคืนก็ยังกลับมาได้ (ไม่ติดลบ)
    expect(expeditionLeft(a, NOW + 10 * 3600_000)).toBe(0)
    expect(a.loot.items.berry).toBeGreaterThanOrEqual(1)
    expect(a.loot.story.length).toBeGreaterThan(0)
  })

  it('ไม่มีล้มเหลว: ทุกที่ ทุกเวลา ได้ของอย่างน้อย 1 ชิ้น', () => {
    const pet = adult('bunny', 'b')
    for (const place of PLACE_IDS)
      for (const minutes of [15, 60, 240, 480]) {
        const trip = startExpedition(pet, place, minutes, NOW + minutes)
        const count = Object.values(trip.loot.items).reduce((n, v) => n + (v ?? 0), 0)
        expect(count + trip.loot.fossils).toBeGreaterThanOrEqual(1)
      }
  })

  it('ถิ่นที่เหมาะได้ของมากกว่า และสำรวจนานเจอไข่บ่อยกว่า', () => {
    const koi = adult('koi', 'k')
    const chick = adult('chick', 'ch')
    expect(suited(koi, 'reef')).toBe(true)
    expect(suited(chick, 'reef')).toBe(false)
    expect(startExpedition(koi, 'reef', 60, NOW).loot.items.seaweed).toBeGreaterThan(
      startExpedition(chick, 'reef', 60, NOW).loot.items.seaweed!,
    )
    const eggs = (minutes: number) =>
      Array.from({ length: 200 }, (_, i) => startExpedition(koi, 'reef', minutes, NOW + i)).filter(
        (t) => t.loot.egg,
      ).length
    expect(eggs(480)).toBeGreaterThan(eggs(15) * 3)
  })

  it('ซากโบราณให้ชิ้นฟอสซิล ประกอบเป็นไข่สายดึกดำบรรพ์', () => {
    const trip = startExpedition(adult('cat', 'x'), 'ruins', 240, NOW)
    expect(trip.loot.fossils).toBeGreaterThanOrEqual(3)
    expect(trip.loot.egg).toBeUndefined()
    const genome = fossilGenome('seed-1')
    expect(validateGenome(genome)).toEqual([])
    expect(genome.ancestry.trike).toBe(1)
  })

  it('คืนวันเพ็ญมีโอกาสเจอไข่เทพนิยายที่เกาะเมฆ', () => {
    const bird = adult('chick', 'm')
    const mythic = Array.from({ length: 100 }, (_, i) =>
      startExpedition(bird, 'sky', 480, NOW + i, { fullMoon: true }),
    ).filter((t) => t.loot.egg?.mythical)
    expect(mythic.length).toBeGreaterThan(20)
    expect(mythic[0]!.loot.egg!.species).toEqual(['dragon', 'dragon'])
    const normal = Array.from({ length: 100 }, (_, i) => startExpedition(bird, 'sky', 480, NOW + i))
    expect(normal.some((t) => t.loot.egg?.mythical)).toBe(false)
  })

  it('ไข่จากการสำรวจมี genome ถูกต้องและคงที่ตาม seed', () => {
    const egg = { species: ['koi', 'cat'] as [string, string], seed: 'abc', mythical: false }
    const g = lootEgg(egg)
    expect(validateGenome(g)).toEqual([])
    expect(lootEgg(egg)).toEqual(g)
    expect(g.generation).toBe(0)
  })

  it('เซฟ/โหลดการสำรวจ กระเป๋า ความสัมพันธ์ และเวลาแขกป่า', () => {
    const home = adult('cat', 'h')
    const away = adult('dragon', 'd')
    const trip = startExpedition(away, 'sky', 240, NOW, { fullMoon: true })
    const inventory = addItems(createInventory(), { berry: 2 }, 2)
    const relations = { [pairKey(home.id, away.id)]: 0.7 }
    const save = createSave([home], null, undefined, 1, [], undefined, {
      expeditions: [trip],
      inventory,
      relations,
      visitorAt: NOW + 1000,
    })
    const loaded = parseSave(serializeSave(save))!
    expect(loaded.expeditions).toEqual([trip])
    expect(loaded.inventory).toEqual(inventory)
    expect(loaded.relations).toEqual(relations)
    expect(loaded.visitorAt).toBe(NOW + 1000)
    // ข้อมูลเสียทีละรายการ
    const raw = JSON.parse(serializeSave(save))
    raw.expeditions.push({ pet: { genome: 'bad' } }, 'x')
    raw.expeditions[0].place = 'moon'
    raw.inventory.items.gold = 5
    raw.relations['a|b|c'] = 1
    const fixed = parseSave(JSON.stringify(raw))!
    expect(fixed.expeditions).toHaveLength(1)
    expect(fixed.expeditions[0]!.place).toBe('meadow')
    expect(fixed.inventory.items).toEqual({ berry: 2 })
    expect(Object.keys(fixed.relations)).toHaveLength(1)
  })
})

describe('ของกินและกระเป๋า', () => {
  it('ใช้ของพิเศษได้เท่าที่มี', () => {
    let inv = addItems(createInventory(), { seaweed: 1 })
    inv = takeItem(inv, 'seaweed')!
    expect(inv.items.seaweed).toBeUndefined()
    expect(takeItem(inv, 'seaweed')).toBeNull()
    expect(addItems(createInventory(), { berry: 500 }).items.berry).toBe(99)
  })

  it('ของที่ถิ่นชอบได้ผลแรงกว่า', () => {
    const koi = { ...adult('koi', 'k2'), needs: { ...adult('koi', 'k2').needs, hunger: 0.2 } }
    const loved = feedItem(koi, 'seaweed')
    const plain = feedItem(koi, 'berry')
    expect(loved.loved).toBe(true)
    expect(plain.loved).toBe(false)
    expect(loved.pet.needs.hunger).toBeGreaterThan(plain.pet.needs.hunger)
    expect(loved.pet.emotion.valence).toBeGreaterThan(koi.emotion.valence)
  })
})

describe('แขกป่า', () => {
  it('มาเป็นระยะ อยู่ไม่กี่นาที เป็นวัยเด็กที่มาจากป่า', () => {
    const rng = new Rng('v')
    const at = nextVisitAt(NOW, rng)
    expect(at - NOW).toBeGreaterThanOrEqual(60 * 60_000)
    expect(at - NOW).toBeLessThanOrEqual(120 * 60_000)
    const v = createVisitor(rng, NOW, 'แขก')
    expect(v.leavesAt - v.arrivedAt).toBe(VISIT_MS)
    expect(v.pet.origin).toEqual({ kind: 'wild' })
    expect(v.pet.nurture.stage).toBe('child')
    expect(validateGenome(v.pet.genome)).toEqual([])
  })

  it('ให้ของที่ชอบ → ผูกมิตร; ผิด 2 ครั้ง → เดินจากไป; ของพิเศษถูกใจเสมอ', () => {
    const v = createVisitor(new Rng('w'), NOW, 'แขก')
    expect(offerFood(v, v.likes).result).toBe('befriended')
    const wrong = (['apple', 'fish', 'carrot'] as const).filter((f) => f !== v.likes)
    const first = offerFood(v, wrong[0]!)
    expect(first.result).toBe('meh')
    expect(offerFood(first.visitor, wrong[1]!).result).toBe('leaving')
    expect(offerFood(v, 'cloudcandy').result).toBe('befriended')
  })

  it('สัตว์เทพนิยายมาเป็นแขกได้แต่ไม่บ่อย', () => {
    const rng = new Rng('many')
    const visitors = Array.from({ length: 400 }, () => createVisitor(rng, NOW, 'x'))
    const mythical = visitors.filter((v) =>
      Object.keys(v.pet.genome.ancestry).some((id) => geneDb.species[id]?.lineage === 'mythical'),
    ).length
    expect(mythical).toBeGreaterThan(0)
    expect(mythical).toBeLessThan(visitors.length * 0.2)
  })
})

describe('ความสัมพันธ์', () => {
  const t = (over: Partial<Temperament>): Temperament => ({
    affection: 0.5,
    mischief: 0.3,
    playful: 0.5,
    sleepy: 0.5,
    shy: 0.3,
    curious: 0.5,
    appetite: 0.5,
    ...over,
  })
  const warm = t({ affection: 0.9, mischief: 0.1 })
  const brat = t({ mischief: 0.95, affection: 0.1, playful: 0.1, curious: 0.9 })

  it('นิสัยคล้ายและอบอุ่นเข้ากันดี ซนทั้งคู่ขัดกัน', () => {
    expect(compatibility(warm, warm)).toBeGreaterThan(0.4)
    expect(compatibility(brat, brat)).toBeLessThan(-0.3)
  })

  it('อยู่ใกล้กันนานๆ ค่อยๆ สนิท/ขัดกัน, อยู่ไกลกันไม่เปลี่ยน', () => {
    let rel = {}
    const near = [
      { id: 'a', temperament: warm, x: 100, y: 0, awake: true },
      { id: 'b', temperament: warm, x: 180, y: 0, awake: true },
      { id: 'c', temperament: brat, x: 900, y: 0, awake: true },
    ]
    for (let i = 0; i < 3600; i += 10) rel = tickRelations(rel, near, 10)
    expect((rel as Record<string, number>)[pairKey('a', 'b')]).toBeGreaterThan(0.5)
    expect((rel as Record<string, number>)[pairKey('a', 'c')]).toBeUndefined()
    let fight = {}
    const brats = [
      { id: 'x', temperament: brat, x: 0, y: 0, awake: true },
      { id: 'y', temperament: brat, x: 50, y: 0, awake: true },
    ]
    for (let i = 0; i < 3600; i += 10) fight = tickRelations(fight, brats, 10)
    expect((fight as Record<string, number>)[pairKey('x', 'y')]).toBeLessThan(-0.3)
  })

  it('ป้าย: เพื่อนซี้/แอบชอบ (โตแล้ว ไม่ใช่ญาติ)/คู่กัด', () => {
    expect(relationLabel(0.7, { grownUp: true, family: false, pairSeed: 3 })).toBe('crush')
    expect(relationLabel(0.7, { grownUp: true, family: true, pairSeed: 3 })).toBe('bestie')
    expect(relationLabel(0.7, { grownUp: false, family: false, pairSeed: 3 })).toBe('bestie')
    expect(relationLabel(0.3, { grownUp: true, family: false, pairSeed: 1 })).toBe('friend')
    expect(relationLabel(-0.5, { grownUp: true, family: false, pairSeed: 1 })).toBe('rival')
    expect(relationLabel(0, { grownUp: true, family: false, pairSeed: 1 })).toBe('neutral')
  })

  it('เล่นด้วยกันสนิทขึ้น และล้างคู่ของตัวที่ไม่อยู่แล้ว', () => {
    const rel = shareMoment({}, 'b', 'a', 0.2)
    expect(rel['a|b']).toBeCloseTo(0.2)
    expect(repairRelations({ 'a|b': 0.5, 'a|z': 0.4 }, new Set(['a', 'b']))).toEqual({ 'a|b': 0.5 })
  })
})

it('ถิ่นของสัตว์ที่ใช้เลือกที่สำรวจ', () => {
  expect(express(adult('koi', 'q').genome).habitat).toBe('water')
})
