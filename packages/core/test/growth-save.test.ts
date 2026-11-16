import { describe, expect, it } from 'vitest'
import {
  breedPets,
  canBreed,
  createFounder,
  createMochi,
  createPet,
  createSave,
  DEFAULT_NURTURE,
  DEFAULT_SETTINGS,
  firstValidSave,
  INCUBATION_SECONDS,
  newPetId,
  parseSave,
  Rng,
  serializeSave,
  STAGE_START_SECONDS,
  stageForAge,
  tickPet,
  validateGenome,
  type PetState,
  type WorldContext,
} from '../src'

const world = (over: Partial<WorldContext> = {}): WorldContext => ({
  hour: 14,
  cursorNear: false,
  userActive: true,
  quiet: false,
  ...over,
})

const adult = (name: string, species: string, seed: string): PetState =>
  createPet(name, createFounder(species, new Rng(seed)), { ...DEFAULT_NURTURE, stage: 'adult' })

describe('การเติบโตตามอายุ', () => {
  it('stageForAge ตรงตามเกณฑ์ของแต่ละช่วงวัย', () => {
    expect(stageForAge(0)).toBe('baby')
    expect(stageForAge(STAGE_START_SECONDS.child - 1)).toBe('baby')
    expect(stageForAge(STAGE_START_SECONDS.child)).toBe('child')
    expect(stageForAge(STAGE_START_SECONDS.teen)).toBe('teen')
    expect(stageForAge(STAGE_START_SECONDS.adult)).toBe('adult')
    expect(stageForAge(STAGE_START_SECONDS.elder + 1)).toBe('elder')
  })

  it('สัตว์ที่สร้างในช่วงวัยใดเริ่มที่อายุขั้นต่ำของช่วงวัยนั้น (ไม่ถอยวัย)', () => {
    const pet = createPet('โมจิ', createMochi(), { ...DEFAULT_NURTURE, stage: 'child' })
    expect(pet.ageSeconds).toBe(STAGE_START_SECONDS.child)
    const next = tickPet(pet, 1, world(), new Rng('age'))
    expect(next.nurture.stage).toBe('child')
  })

  it('เบบี้โตเป็นเด็กเมื่ออยู่กับผู้ใช้ครบเวลา และไม่โตตอนผู้ใช้ไม่อยู่', () => {
    const rng = new Rng('grow')
    const baby = createPet('หนู', createFounder('cat', rng), { ...DEFAULT_NURTURE, stage: 'baby' })
    let away = baby
    for (let t = 0; t < STAGE_START_SECONDS.child + 60; t += 30)
      away = tickPet(away, 30, world({ userActive: false }), rng)
    expect(away.nurture.stage).toBe('baby')
    expect(away.ageSeconds).toBe(0)

    let here = baby
    for (let t = 0; t < STAGE_START_SECONDS.child + 60; t += 30)
      here = tickPet(here, 30, world(), rng)
    expect(here.nurture.stage).toBe('child')
    expect(here.ageSeconds).toBeGreaterThanOrEqual(STAGE_START_SECONDS.child)
  })

  it('ไข่ที่ฟักแล้วเริ่มนับอายุจากศูนย์', () => {
    const rng = new Rng('hatch')
    let egg = createPet('ไข่', createFounder('bunny', rng), { ...DEFAULT_NURTURE, stage: 'egg' })
    for (let t = 0; t <= INCUBATION_SECONDS; t += 10) egg = tickPet(egg, 10, world(), rng)
    expect(egg.nurture.stage).toBe('baby')
    expect(egg.ageSeconds).toBeLessThan(30)
  })
})

describe('ผสมพันธุ์บนจอ', () => {
  it('ได้ไข่ที่จำพ่อแม่ได้ มีรหัสใหม่ และ genome ถูกต้อง', () => {
    const a = adult('แม่', 'cat', 'a')
    const b = adult('พ่อ', 'dragon', 'b')
    const egg = breedPets(a, b, 'ลูก', new Rng('breed'))
    expect(egg).not.toBeNull()
    expect(egg!.nurture.stage).toBe('egg')
    expect(egg!.parents).toEqual([a.id, b.id])
    expect(egg!.id).not.toBe(a.id)
    expect(egg!.id).not.toBe(b.id)
    expect(validateGenome(egg!.genome)).toEqual([])
  })

  it('ผสมไม่ได้ถ้ายังเด็ก เป็นไข่ หรือเป็นตัวเดียวกัน', () => {
    const a = adult('แม่', 'cat', 'a')
    const child = createPet('เด็ก', createFounder('cat', new Rng('c')), {
      ...DEFAULT_NURTURE,
      stage: 'child',
    })
    const egg = createPet('ไข่', createFounder('cat', new Rng('e')), {
      ...DEFAULT_NURTURE,
      stage: 'egg',
    })
    expect(canBreed(a)).toBe(true)
    expect(canBreed(child)).toBe(false)
    expect(breedPets(a, child, 'x', new Rng(1))).toBeNull()
    expect(breedPets(a, egg, 'x', new Rng(1))).toBeNull()
    expect(breedPets(a, a, 'x', new Rng(1))).toBeNull()
  })

  it('เมล็ดสุ่มเดียวกันได้ไข่เหมือนกัน และรหัสไม่ซ้ำกันเมื่อผสมหลายครั้ง', () => {
    const a = adult('แม่', 'cat', 'a')
    const b = adult('พ่อ', 'unicorn', 'b')
    expect(breedPets(a, b, 'ลูก', new Rng(7))).toEqual(breedPets(a, b, 'ลูก', new Rng(7)))
    const rng = new Rng('many')
    const ids = new Set(Array.from({ length: 200 }, () => newPetId(rng)))
    expect(ids.size).toBe(200)
  })
})

describe('ไฟล์เซฟ', () => {
  const mochi = () => createPet('โมจิ', createMochi(), { ...DEFAULT_NURTURE, stage: 'child' })

  it('เซฟรุ่น 2 เขียนแล้วอ่านกลับได้เหมือนเดิม', () => {
    const egg = breedPets(adult('แม่', 'cat', 'a'), adult('พ่อ', 'koi', 'b'), 'ไข่', new Rng(3))!
    const save = createSave([mochi(), egg], 'meadow', { quiet: true, perching: false }, 1234)
    const loaded = parseSave(serializeSave(save))
    expect(loaded).toEqual(save)
  })

  it('ย้ายเซฟรุ่น 1 (สัตว์ตัวเดียว ไม่มี id/อายุ) ได้โดยสัตว์ไม่หายและไม่ถอยวัย', () => {
    const {
      id: _id,
      ageSeconds: _age,
      ...old
    } = {
      ...mochi(),
      nurture: { stage: 'teen' as const, fat: 0.6, fitness: 0.2 },
    }
    const loaded = parseSave(JSON.stringify({ v: 1, pet: old }))
    expect(loaded).not.toBeNull()
    expect(loaded!.v).toBe(2)
    expect(loaded!.pets).toHaveLength(1)
    const pet = loaded!.pets[0]!
    expect(pet.name).toBe('โมจิ')
    expect(pet.id).toBeTruthy()
    expect(pet.nurture).toEqual({ stage: 'teen', fat: 0.6, fitness: 0.2 })
    expect(pet.ageSeconds).toBe(STAGE_START_SECONDS.teen)
    expect(loaded!.habitat).toBeNull()
    expect(loaded!.settings).toEqual(DEFAULT_SETTINGS)
    // ใช้ต่อได้ทันที
    expect(() => tickPet(pet, 1, world(), new Rng(1))).not.toThrow()
  })

  it('ข้อความที่ไม่ใช่เซฟคืน null', () => {
    for (const bad of [
      '',
      'not json',
      '[]',
      'null',
      '{}',
      '{"v":3,"pets":[]}',
      '{"v":2,"pets":[]}',
    ])
      expect(parseSave(bad)).toBeNull()
  })

  it('ทิ้งสัตว์ที่ genome เสีย แต่เก็บตัวที่ดีไว้', () => {
    const good = mochi()
    const broken = {
      ...mochi(),
      id: 'pet-broken',
      genome: { v: 1, genes: { 'head.type': 'nope' } },
    }
    const loaded = parseSave(JSON.stringify({ v: 2, pets: [broken, good, 42, null] }))
    expect(loaded!.pets.map((p) => p.id)).toEqual([good.id])
    expect(parseSave(JSON.stringify({ v: 2, pets: [broken] }))).toBeNull()
  })

  it('ซ่อมค่าที่หาย/เพี้ยนให้อยู่ในช่วงที่ใช้ได้', () => {
    const raw = {
      ...mochi(),
      name: '   ',
      needs: { hunger: 9, energy: 'x', fun: -3 },
      emotion: null,
      experience: { affection: 99 },
      behavior: 'fly-to-the-moon',
      behaviorTimer: Number.NaN,
      ageSeconds: -50,
      parents: ['only-one'],
    }
    const pet = parseSave(JSON.stringify({ v: 2, pets: [raw] }))!.pets[0]!
    expect(pet.name).toBe('โมจิ')
    for (const value of Object.values(pet.needs)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(pet.needs.hunger).toBe(1)
    expect(pet.needs.fun).toBe(0)
    expect(Number.isFinite(pet.emotion.valence)).toBe(true)
    expect(pet.experience.affection).toBeLessThanOrEqual(0.25)
    expect(pet.behavior).toBe('idle')
    expect(pet.behaviorTimer).toBe(0)
    expect(pet.ageSeconds).toBe(0)
    expect(pet.parents).toBeUndefined()
    expect(() => tickPet(pet, 1, world(), new Rng(1))).not.toThrow()
  })

  it('รหัสซ้ำถูกแก้ให้ไม่ซ้ำ', () => {
    const a = mochi()
    const loaded = parseSave(JSON.stringify({ v: 2, pets: [a, a, a] }))!
    expect(new Set(loaded.pets.map((p) => p.id)).size).toBe(3)
  })

  it('firstValidSave ข้ามไฟล์ที่เสียไปใช้สำเนาสำรองที่อ่านได้', () => {
    const backup = serializeSave(createSave([mochi()], 'snow', DEFAULT_SETTINGS, 99))
    const save = firstValidSave(['{"v":2,"pets":[', '', backup])
    expect(save?.habitat).toBe('snow')
    expect(save?.savedAt).toBe(99)
    expect(firstValidSave(['x', ''])).toBeNull()
  })
})
