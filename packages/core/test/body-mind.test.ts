import { describe, expect, it } from 'vitest'
import {
  applyCare,
  applyEvent,
  approxHeight,
  carePet,
  chooseBehavior,
  circadianSleepiness,
  composeBody,
  createFounder,
  createPet,
  decayNeeds,
  DEFAULT_NURTURE,
  derivePersonality,
  express,
  fullNeeds,
  labelEmotion,
  LIFE_STAGES,
  mixOklch,
  neutralEmotion,
  noExperience,
  oklchToHex,
  oklchToRgb,
  petEvent,
  rgbToOklch,
  Rng,
  scoreBehaviors,
  shapeExperience,
  tickPet,
  viewPet,
  type BehaviorContext,
  type Temperament,
} from '../src'

const temper = (over: Partial<Temperament> = {}): Temperament => ({
  affection: 0.5,
  mischief: 0.5,
  playful: 0.5,
  sleepy: 0.5,
  shy: 0.5,
  curious: 0.5,
  appetite: 0.5,
  ...over,
})

describe('color', () => {
  it('OKLCH ↔ sRGB ไปกลับได้ค่าเดิม', () => {
    const src = { l: 0.8, c: 0.1, h: 150 }
    const back = rgbToOklch(oklchToRgb(src))
    expect(back.l).toBeCloseTo(src.l, 3)
    expect(back.c).toBeCloseTo(src.c, 3)
    expect(back.h).toBeCloseTo(src.h, 1)
  })

  it('ขาว/ดำ และสีนอก gamut ถูกบีบให้เป็น hex ที่ใช้ได้', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff')
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000')
    expect(oklchToHex({ l: 0.9, c: 0.4, h: 140 })).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('ผสมสีกับสีเทา (ไม่มี hue) ใช้ hue ของอีกฝั่ง', () => {
    const grey = { l: 0.9, c: 0, h: 0 }
    const pink = { l: 0.8, c: 0.1, h: 350 }
    expect(mixOklch(grey, pink, 0.5).h).toBe(350)
    expect(mixOklch(pink, grey, 0.5).h).toBe(350)
  })
})

describe('composeBody', () => {
  const pheno = express(createFounder('cat', new Rng('body')))

  it('อ้วนขึ้น → ลำตัวกว้างขึ้นและพุงย้อยขึ้น', () => {
    const thin = composeBody(pheno, { ...DEFAULT_NURTURE, fat: 0.05 })
    const mid = composeBody(pheno, { ...DEFAULT_NURTURE, fat: 0.35 })
    const fat = composeBody(pheno, { ...DEFAULT_NURTURE, fat: 0.9 })
    expect(thin.torso.rx).toBeLessThan(mid.torso.rx)
    expect(mid.torso.rx).toBeLessThan(fat.torso.rx)
    expect(fat.belly).toBeGreaterThan(mid.belly)
    expect(thin.build).toBe('thin')
    expect(fat.build).toBe('round')
  })

  it('โตตามวัย: ตัวใหญ่ขึ้น แต่เบบี้หัวโตกว่าตามสัดส่วน', () => {
    const heights = LIFE_STAGES.slice(0, 4).map((stage) =>
      approxHeight(composeBody(pheno, { ...DEFAULT_NURTURE, stage })),
    )
    expect([...heights].sort((a, b) => a - b)).toEqual(heights)
    const baby = composeBody(pheno, { ...DEFAULT_NURTURE, stage: 'baby' })
    const adult = composeBody(pheno, DEFAULT_NURTURE)
    expect(baby.headR / baby.torso.rz).toBeGreaterThan(adult.headR / adult.torso.rz)
  })

  it('ท่าทางตามชนิดขา: ปลาลอย, นกยืนตัวตรง, แมวสี่ขา', () => {
    expect(composeBody(express(createFounder('koi', new Rng(1)))).posture).toBe('float')
    expect(composeBody(express(createFounder('chick', new Rng(1)))).posture).toBe('upright')
    expect(composeBody(pheno).posture).toBe('quad')
    expect(composeBody(express(createFounder('koi', new Rng(1)))).legLen).toBe(0)
  })
})

describe('needs', () => {
  it('ผู้ใช้ไม่อยู่ → เวลาหยุด ไม่มีอะไรลดลง', () => {
    const start = fullNeeds()
    const after = decayNeeds(start, 48, temper(), { asleep: false, userPresent: false })
    expect(after).toEqual(start)
  })

  it('ลดลงตามเวลาแต่ไม่ต่ำกว่าพื้น (ไม่มีการอดตาย)', () => {
    const after = decayNeeds(fullNeeds(), 1000, temper(), { asleep: false, userPresent: true })
    for (const value of Object.values(after)) {
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThan(0.2)
    }
  })

  it('นิสัยตะกละหิวเร็วกว่า และการนอนฟื้นพลังงาน', () => {
    const ctx = { asleep: false, userPresent: true }
    const greedy = decayNeeds(fullNeeds(), 2, temper({ appetite: 1 }), ctx)
    const dainty = decayNeeds(fullNeeds(), 2, temper({ appetite: 0 }), ctx)
    expect(greedy.hunger).toBeLessThan(dainty.hunger)
    const tired = { ...fullNeeds(), energy: 0.2 }
    expect(
      decayNeeds(tired, 1, temper(), { asleep: true, userPresent: true }).energy,
    ).toBeGreaterThan(0.5)
  })

  it('ขนมทำให้อ้วน การเล่นทำให้ฟิตและผอมลง', () => {
    let state = { needs: fullNeeds(), nurture: { ...DEFAULT_NURTURE } }
    for (let i = 0; i < 10; i++) state = applyCare(state.needs, state.nurture, 'treat')
    expect(state.nurture.fat).toBeGreaterThan(DEFAULT_NURTURE.fat + 0.2)
    const fatBefore = state.nurture.fat
    for (let i = 0; i < 10; i++) state = applyCare(state.needs, state.nurture, 'play')
    expect(state.nurture.fat).toBeLessThan(fatBefore)
    expect(state.nurture.fitness).toBeGreaterThan(DEFAULT_NURTURE.fitness)
  })
})

describe('emotion & personality', () => {
  it('เหตุการณ์เดียวกัน นิสัยต่างกันรู้สึกต่างกัน', () => {
    const cuddly = applyEvent(neutralEmotion(), 'pickedUp', temper({ affection: 1, shy: 0 }))
    const timid = applyEvent(neutralEmotion(), 'pickedUp', temper({ affection: 0, shy: 1 }))
    expect(cuddly.valence).toBeGreaterThan(neutralEmotion().valence)
    expect(timid.valence).toBeLessThan(neutralEmotion().valence)
    expect(timid.arousal).toBeGreaterThan(cuddly.arousal)
  })

  it('ป้ายอารมณ์สะท้อน needs', () => {
    const calm = neutralEmotion()
    expect(labelEmotion(calm, { ...fullNeeds(), energy: 0.1 })).toBe('sleepy')
    expect(labelEmotion(calm, { ...fullNeeds(), hunger: 0.1 })).toBe('hungry')
    expect(labelEmotion({ ...calm, valence: 0.8, arousal: 0.3 }, fullNeeds())).toBe('joyful')
    expect(labelEmotion({ ...calm, valence: -0.6, arousal: 0.9 }, fullNeeds())).toBe('scared')
  })

  it('การเลี้ยงดูหล่อหลอมนิสัยได้ แต่ไม่เกินขอบเขตจากยีนส์', () => {
    let exp = noExperience()
    for (let i = 0; i < 1000; i++) exp = shapeExperience(exp, 'petted', 3)
    const genes = temper({ affection: 0.5, shy: 0.5 })
    const shaped = derivePersonality(genes, exp)
    expect(shaped.affection).toBeCloseTo(0.75)
    expect(shaped.shy).toBeCloseTo(0.25)
  })
})

describe('behavior', () => {
  const ctx = (over: Partial<BehaviorContext> = {}): BehaviorContext => ({
    needs: fullNeeds(),
    emotion: neutralEmotion(),
    personality: temper(),
    hour: 14,
    chronotype: 0.5,
    cursorNear: false,
    userActive: true,
    quiet: false,
    ...over,
  })

  it('นาฬิกาชีวิต: ง่วงสุดกลางดึก และนกฮูกง่วงช้ากว่า', () => {
    expect(circadianSleepiness(3.5, 0.5)).toBeCloseTo(1)
    expect(circadianSleepiness(15.5, 0.5)).toBeCloseTo(0)
    expect(circadianSleepiness(23, 0)).toBeGreaterThan(circadianSleepiness(23, 1))
  })

  it('เหนื่อยมากตอนดึก → เลือกนอนเป็นหลัก', () => {
    const rng = new Rng('sleep')
    const tired = ctx({ needs: { ...fullNeeds(), energy: 0.05 }, hour: 3 })
    const picks = Array.from({ length: 100 }, () => chooseBehavior(tired, rng))
    expect(picks.filter((b) => b === 'sleep').length).toBeGreaterThan(90)
  })

  it('นิสัยกำหนดพฤติกรรม: ขี้อ้อนตามเคอร์เซอร์ ขี้อายหลบ', () => {
    const clingy = scoreBehaviors(
      ctx({ personality: temper({ affection: 1, shy: 0 }), cursorNear: true }),
    )
    const timid = scoreBehaviors(
      ctx({ personality: temper({ affection: 0, shy: 1 }), cursorNear: true }),
    )
    expect(clingy.followCursor).toBeGreaterThan(timid.followCursor)
    expect(timid.hide).toBeGreaterThan(clingy.hide)
  })

  it('โหมดเงียบ → ไม่เรียกร้องความสนใจ', () => {
    const lonely = { ...fullNeeds(), social: 0.1 }
    const normal = scoreBehaviors(ctx({ needs: lonely }))
    const quiet = scoreBehaviors(ctx({ needs: lonely, quiet: true }))
    expect(quiet.seekAttention).toBeLessThan(normal.seekAttention * 0.3)
    expect(quiet.sit).toBeGreaterThan(normal.sit)
  })
})

describe('petSim', () => {
  const world = { hour: 14, cursorNear: false, userActive: true, quiet: false }

  it('จำลองเวลา 1 วัน: ค่าทุกอย่างอยู่ในช่วง และมีพฤติกรรมหลากหลาย', () => {
    const rng = new Rng('sim')
    let pet = createPet('โมจิ', createFounder('cat', rng))
    const seen = new Set<string>()
    for (let i = 0; i < 24 * 360; i++) {
      pet = tickPet(pet, 10, { ...world, hour: (i / 360) % 24 }, rng)
      seen.add(pet.behavior)
      for (const v of Object.values(pet.needs)) expect(v >= 0 && v <= 1).toBe(true)
      expect(pet.emotion.valence >= -1 && pet.emotion.valence <= 1).toBe(true)
    }
    expect(seen.size).toBeGreaterThanOrEqual(4)
    expect(seen.has('sleep')).toBe(true)
  })

  it('ไม่มีใครดูแลทั้งวัน: ไม่เรียกร้องเกินครึ่งของเวลา และดูแลความสะอาด/ความสนุกเองได้', () => {
    for (const seed of ['alone-1', 'alone-2', 'alone-3', 'alone-4']) {
      const rng = new Rng(seed)
      let pet = createPet('โมจิ', createFounder('cat', rng))
      let nagging = 0
      const ticks = 24 * 360
      for (let i = 0; i < ticks; i++) {
        pet = tickPet(pet, 10, { ...world, hour: (i / 360) % 24 }, rng)
        if (pet.behavior === 'beg' || pet.behavior === 'seekAttention') nagging++
      }
      expect(nagging / ticks, seed).toBeLessThan(0.5)
      expect(pet.needs.hygiene, seed).toBeGreaterThan(0.15)
      expect(pet.needs.fun, seed).toBeGreaterThan(0.15)
    }
  })

  it('ให้อาหารแล้วหายหิว ลูบแล้วอารมณ์ดีขึ้น และปลุกได้เมื่อถูกอุ้ม', () => {
    const rng = new Rng('care')
    let pet = createPet('โมจิ', createFounder('bunny', rng))
    pet = { ...pet, needs: { ...pet.needs, hunger: 0.1 } }
    expect(viewPet(pet).emotionLabel).toBe('hungry')
    pet = carePet(pet, 'feed')
    expect(pet.needs.hunger).toBeGreaterThan(0.5)
    const before = pet.emotion.valence
    pet = carePet(pet, 'pet')
    expect(pet.emotion.valence).toBeGreaterThan(before)
    pet = petEvent({ ...pet, behavior: 'sleep', behaviorTimer: 100 }, 'pickedUp')
    expect(pet.behavior).toBe('idle')
  })
})
