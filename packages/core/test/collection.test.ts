import { describe, expect, it } from 'vitest'
import {
  areFamily,
  breedPets,
  canSummon,
  childrenOf,
  createDex,
  createFounder,
  createPet,
  createSave,
  createSummonLog,
  DEFAULT_NURTURE,
  dexProgress,
  dexSlots,
  discover,
  geneDb,
  paletteFromPixels,
  parseSave,
  pedigree,
  recordFamily,
  recordSummon,
  Rng,
  serializeSave,
  siblingsOf,
  SUMMONS_PER_DAY,
  summonsLeft,
  visibleAlleles,
  type FamilyBook,
  type PetState,
} from '../src'

const adult = (name: string, species: string, seed: string): PetState =>
  createPet(name, createFounder(species, new Rng(seed)), { ...DEFAULT_NURTURE, stage: 'adult' })

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime()

describe('บันทึกการอัญเชิญ', () => {
  it('ไฟล์เดียวอัญเชิญได้ครั้งเดียว', () => {
    let log = createSummonLog()
    expect(canSummon(log, HASH_A, at(1))).toEqual({ ok: true, left: SUMMONS_PER_DAY })
    log = recordSummon(log, HASH_A, { at: at(1), petId: 'p1', name: 'โมจิ', kind: 'image' })
    const again = canSummon(log, HASH_A, at(5))
    expect(again.ok).toBe(false)
    expect(again.ok === false && again.reason === 'used' && again.record.name).toBe('โมจิ')
  })

  it('โควตาต่อวันหมดแล้วรอพรุ่งนี้', () => {
    let log = createSummonLog()
    for (let i = 0; i < SUMMONS_PER_DAY; i++) {
      const hash = String(i).repeat(64)
      log = recordSummon(log, hash, { at: at(1, 9 + i), petId: `p${i}`, name: '', kind: 'other' })
    }
    expect(summonsLeft(log, at(1, 20))).toBe(0)
    expect(canSummon(log, HASH_B, at(1, 20))).toEqual({ ok: false, reason: 'quota' })
    // ข้ามเที่ยงคืน → นับใหม่
    expect(summonsLeft(log, at(2, 0))).toBe(SUMMONS_PER_DAY)
    log = recordSummon(log, HASH_B, { at: at(2), petId: 'x', name: '', kind: 'audio' })
    expect(summonsLeft(log, at(2))).toBe(SUMMONS_PER_DAY - 1)
  })

  it('เซฟ/โหลดแล้วข้อมูลครบ และรายการเสียถูกทิ้ง', () => {
    const pet = adult('ก', 'cat', 's1')
    const summons = recordSummon(createSummonLog(), HASH_A, {
      at: at(1),
      petId: pet.id,
      name: 'ก',
      kind: 'code',
    })
    const raw = JSON.parse(
      serializeSave(createSave([pet], null, undefined, 1, [], undefined, { summons })),
    )
    raw.summons.files['not-a-hash'] = { at: 1, petId: 'x' }
    raw.summons.files[HASH_B] = { petId: 3 }
    const loaded = parseSave(JSON.stringify(raw))!
    expect(Object.keys(loaded.summons.files)).toEqual([HASH_A])
    expect(loaded.summons.used).toBe(1)
  })
})

describe('สีจากพิกเซล', () => {
  const fill = (n: number, rgba: number[]) => Array.from({ length: n }, () => rgba).flat()

  it('รูปสีแดงล้วน → สีแรกเป็นเฉดแดง', () => {
    const [first] = paletteFromPixels(fill(64, [230, 30, 40, 255]))
    expect(first!.h < 40 || first!.h > 340).toBe(true)
    expect(first!.c).toBeGreaterThan(0.1)
  })

  it('สีสดชนะสีเทาที่มีจำนวนพอกัน และข้ามพิกเซลโปร่งใส', () => {
    const pixels = [
      ...fill(40, [128, 128, 128, 255]),
      ...fill(40, [40, 90, 230, 255]),
      ...fill(200, [0, 255, 0, 0]),
    ]
    const palette = paletteFromPixels(pixels)
    expect(palette).toHaveLength(2)
    expect(palette[0]!.h).toBeGreaterThan(220)
    expect(palette[0]!.h).toBeLessThan(290)
  })

  it('ไม่มีพิกเซลทึบ → ไม่มีสี', () => {
    expect(paletteFromPixels(fill(10, [1, 2, 3, 0]))).toEqual([])
  })
})

describe('สมุดสะสม', () => {
  it('พบลักษณะที่แสดงออกและสายพันธุ์ ไม่นับซ้ำ', () => {
    const cat = adult('เหมียว', 'cat', 'c1')
    const first = discover(createDex(), cat.genome, false, 100)
    expect(first.alleles.length).toBeGreaterThanOrEqual(10)
    expect(first.species).toEqual(['cat'])
    const second = discover(first.dex, cat.genome, false, 200)
    expect(second.alleles).toEqual([])
    expect(second.species).toEqual([])
    expect(second.dex.alleles[first.alleles[0]!.id]).toBe(100)
  })

  it('ยีนส์แฝงนับเมื่อเปิดเผยแล้วเท่านั้น', () => {
    // หาแมวที่มียีนส์แฝงอย่างน้อย 1 ตำแหน่ง
    let seed = 0
    let cat = adult('a', 'cat', 'h0')
    while (visibleAlleles(cat.genome, true).length === visibleAlleles(cat.genome, false).length) {
      cat = adult('a', 'cat', `h${++seed}`)
    }
    expect(visibleAlleles(cat.genome, true).length).toBeGreaterThan(
      visibleAlleles(cat.genome, false).length,
    )
  })

  it('ความคืบหน้านับครบทุก allele และแยกตามความหายาก', () => {
    const empty = dexProgress(createDex())
    expect(empty.found).toBe(0)
    expect(empty.total).toBe(Object.keys(geneDb.alleles).length)
    const sum = Object.values(empty.byRarity).reduce((n, r) => n + r.total, 0)
    expect(sum).toBe(empty.total)
    expect(empty.species.total).toBe(Object.keys(geneDb.species).length)
    const slots = dexSlots()
    expect(slots.reduce((n, s) => n + s.alleles.length, 0)).toBe(empty.total)
    // ลักษณะที่ได้จากการกลายพันธุ์อยู่ท้ายกลุ่มความหายากเดียวกัน
    expect(slots.every((s) => s.alleles.length > 0)).toBe(true)
  })

  it('เซฟสมุดแล้วโหลดได้ รหัสที่ไม่มีใน Gene DB ถูกทิ้ง', () => {
    const pet = adult('ก', 'dragon', 'd1')
    const { dex } = discover(createDex(), pet.genome, true, 5)
    const raw = JSON.parse(
      serializeSave(createSave([pet], null, undefined, 1, [], undefined, { dex })),
    )
    raw.dex.alleles['wing.unknown'] = 3
    raw.dex.species.ghost = 3
    const loaded = parseSave(JSON.stringify(raw))!
    expect(loaded.dex).toEqual(dex)
  })
})

describe('เครือญาติ', () => {
  const mom = adult('แม่', 'cat', 'm')
  const dad = adult('พ่อ', 'bunny', 'd')
  const rng = new Rng('fam')
  const kid1 = breedPets(mom, dad, 'ลูก1', rng)!
  const kid2 = breedPets(mom, dad, 'ลูก2', rng)!
  let book: FamilyBook = {}
  for (const pet of [mom, dad, { ...kid1, bornAt: 1 }, { ...kid2, bornAt: 2 }])
    book = recordFamily(book, pet)

  it('ลูกจากการผสมจำที่มาและพ่อแม่', () => {
    expect(kid1.origin).toEqual({ kind: 'bred' })
    expect(kid1.parents).toEqual([mom.id, dad.id])
  })

  it('ผังบรรพบุรุษ + ลูก + พี่น้อง', () => {
    const tree = pedigree(book, kid1.id)
    expect(tree.record?.name).toBe('ลูก1')
    expect(tree.parents?.map((p) => p.record?.name)).toEqual(['แม่', 'พ่อ'])
    expect(tree.parents?.[0].parents).toBeUndefined()
    expect(childrenOf(book, mom.id).map((r) => r.name)).toEqual(['ลูก1', 'ลูก2'])
    expect(siblingsOf(book, kid1.id).map((r) => r.name)).toEqual(['ลูก2'])
    expect(areFamily(book, kid1.id, mom.id)).toBe(true)
    expect(areFamily(book, kid1.id, kid2.id)).toBe(true)
    expect(areFamily(book, mom.id, dad.id)).toBe(false)
  })

  it('บรรพบุรุษที่ไม่มีบันทึกแสดงเป็นช่องว่าง และข้อมูลวนซ้ำไม่ทำให้ค้าง', () => {
    const loop: FamilyBook = {
      a: { id: 'a', name: 'A', species: '', generation: 1, parents: ['b', 'zz'] },
      b: { id: 'b', name: 'B', species: '', generation: 1, parents: ['a', 'a'] },
    }
    const tree = pedigree(loop, 'a', 5)
    expect(tree.parents?.[1].record).toBeNull()
    let depth = 0
    let node = tree
    while (node.parents) {
      node = node.parents[0]
      depth++
    }
    expect(depth).toBeLessThanOrEqual(5)
  })

  it('เปลี่ยนชื่อแล้วบันทึกตาม; ไม่เปลี่ยนอะไรคืนสมุดเดิม', () => {
    expect(recordFamily(book, mom)).toBe(book)
    expect(recordFamily(book, { ...mom, name: 'แม่ใหญ่' })[mom.id]!.name).toBe('แม่ใหญ่')
  })

  it('เซฟ/โหลดเครือญาติ ที่มา วันเกิด และการกลายพันธุ์', () => {
    const egg = { ...kid1, bornAt: 123, mutations: ['tail.twin', 'nope'] }
    const save = createSave([mom, egg], null, undefined, 1, [], undefined, { family: book })
    const loaded = parseSave(serializeSave(save))!
    expect(loaded.family).toEqual(book)
    const back = loaded.pets[1]!
    expect(back.origin).toEqual({ kind: 'bred' })
    expect(back.bornAt).toBe(123)
    expect(back.mutations).toEqual(['tail.twin'])
  })

  it('การกลายพันธุ์ที่เห็นได้ถูกจำไว้ในไข่', () => {
    const r = new Rng('mut')
    let found: PetState | null = null
    for (let i = 0; i < 400 && !found; i++) {
      const egg = breedPets(mom, dad, 'x', r)!
      if (egg.mutations?.length) found = egg
    }
    expect(found).not.toBeNull()
    for (const id of found!.mutations!) expect(geneDb.alleles[id]).toBeDefined()
  })
})
