import {
  breedPets,
  canBreed,
  carePet,
  createCompanion,
  createDex,
  createSave,
  createSummonLog,
  discover,
  recordFamily,
  incubate,
  INCUBATION_SECONDS,
  MAX_ACTIVE_PETS,
  MAX_FARM_PETS,
  tickPet,
  type Behavior,
  type CareAction,
  type CompanionState,
  type Dex,
  type FamilyBook,
  type PartAlleleDef,
  type PetState,
  type SaveData,
  type SummonLog,
} from '@mochimon/core'
import { PetActor } from './pet'
import { newEgg, pickName, storeSave } from './store'
import { cursor, habitatKind, hushed, layout, mode, rng, settings, userActive } from './world'

/**
 * สถานะของเกมบนจอ: สัตว์ที่เดินอยู่ (สูงสุด MAX_ACTIVE_PETS) สัตว์ที่ฝากฟาร์ม และคำสั่งดูแลทั้งหมด
 * (ส่วนติดต่อผู้ใช้ — เมาส์ เมนู tray แผงดูแล — เรียกผ่านโมดูลนี้)
 */
export const pets: PetActor[] = []
export let farm: PetState[] = []
/** ข้อมูลผู้ช่วยทำงาน (นัด งาน โฟกัส สุขภาพ) — แก้ผ่าน `setCompanion` เพื่อให้ถูกเซฟ */
export let companion: CompanionState = createCompanion(Date.now())
export function setCompanion(next: CompanionState): void {
  companion = next
}

/** สมุดสะสม บันทึกการอัญเชิญ และเครือญาติ (ส่วนที่เซฟ) */
export const collection: { dex: Dex; summons: SummonLog; family: FamilyBook } = {
  dex: createDex(),
  summons: createSummonLog(),
  family: {},
}

const reslot = (): void => pets.forEach((actor, index) => (actor.slot = index))

export const hasRoom = (): boolean => pets.length < MAX_ACTIVE_PETS
export const allNames = (): string[] => [
  ...pets.map((p) => p.state.name),
  ...farm.map((p) => p.name),
]
export const findPet = (id: string): PetActor | undefined => pets.find((p) => p.state.id === id)

/** ตำแหน่งว่างที่ใกล้ x ที่สุด (ไข่ขยับเองไม่ได้ จึงต้องวางให้ไม่ทับใครตั้งแต่แรก) */
function freeSpot(x: number): number {
  const taken = (at: number): boolean => pets.some((p) => Math.abs(p.x - at) < 80)
  for (const offset of [0, 90, -90, 180, -180, 270, -270]) {
    const at = Math.min(layout.width - 80, Math.max(80, x + offset))
    if (!taken(at)) return at
  }
  return x
}

export function addPet(state: PetState, x?: number): PetActor {
  collection.family = recordFamily(collection.family, state)
  const wanted = x ?? layout.width * rng.range(0.25, 0.7)
  const actor = new PetActor(state, state.nurture.stage === 'egg' ? freeSpot(wanted) : wanted)
  pets.push(actor)
  reslot()
  return actor
}

export function removePet(actor: PetActor): void {
  const index = pets.indexOf(actor)
  if (index < 0) return
  pets.splice(index, 1)
  actor.dispose()
  reslot()
}

// ───────── เซฟ ─────────
export function snapshot(): SaveData {
  return createSave(
    pets.map((p) => p.state),
    habitatKind(),
    settings,
    Date.now(),
    farm,
    companion,
    { ...collection },
  )
}
export const saveNow = (): Promise<void> => storeSave(snapshot())

export function restore(save: SaveData): void {
  for (const actor of [...pets]) removePet(actor)
  farm = save.farm
  companion = save.companion
  collection.dex = save.dex
  collection.summons = save.summons
  collection.family = save.family
  // เซฟจากรุ่นก่อนยังไม่มีสมุด: บันทึกทุกตัวที่มีอยู่แล้วแบบเงียบๆ
  for (const pet of farm) {
    collection.family = recordFamily(collection.family, pet)
    if (pet.nurture.stage !== 'egg') learnFrom(pet)
  }
  for (const pet of save.pets) if (pet.nurture.stage !== 'egg') learnFrom(pet)
  Object.assign(settings, save.settings)
  // กระจายตัวกันตอนเริ่ม ไม่ให้ยืนกองกัน
  save.pets.forEach((state, index) => {
    const spread = (index + 1) / (save.pets.length + 1)
    addPet(state, layout.width * (0.2 + spread * 0.55))
  })
}

// ───────── การดูแล ─────────
const CARE_FX: Record<CareAction, { icon: string; line: string; className?: string }> = {
  feed: { icon: '🍎', line: 'อร่อย!' },
  treat: { icon: '🍬', line: 'หวานจัง~' },
  pet: { icon: '♥', line: '' },
  play: { icon: '♪', line: 'เย้!', className: 'note' },
  bathe: { icon: '💧', line: 'สะอาดแล้ว~' },
  rest: { icon: '💤', line: 'ฝันดีนะ…' },
}

export function care(actor: PetActor, action: CareAction): void {
  if (actor.isEgg) {
    // ไข่: ลูบได้อย่างเดียว (ให้ความอบอุ่น ช่วยให้ฟักเร็วขึ้น)
    if (action !== 'pet') return
    actor.setState(carePet(actor.state, 'pet'))
    actor.hearts()
    saveNow()
    return
  }
  let next = carePet(actor.state, action)
  if (action === 'play') {
    actor.playTimer = 6
    next = { ...next, behavior: 'idle', behaviorTimer: 6 }
  } else if (action === 'rest') {
    next = { ...next, behavior: 'sleep', behaviorTimer: 180 }
  } else if (next.behavior === 'sleep' && action !== 'pet') {
    // ให้อาหาร/อาบน้ำ → ตื่นมารับ
    next = { ...next, behavior: 'idle', behaviorTimer: 4 }
  }
  actor.setState(next)
  const fx = CARE_FX[action]
  actor.float(fx.icon, fx.className)
  actor.say(fx.line || undefined)
  saveNow()
}

export function callAll(): void {
  for (const actor of pets) {
    if (actor.isEgg) continue
    actor.state = { ...actor.state, behavior: 'followCursor', behaviorTimer: 12 }
    actor.say('มาแล้ว~')
  }
}

/** รับไข่ใบใหม่ (ถ้าบนจอยังมีที่) */
export function addEgg(): PetActor | null {
  if (!hasRoom()) {
    pets[0]?.say(`บนจออยู่ได้ ${MAX_ACTIVE_PETS} ตัว ฝากฟาร์มก่อนนะ`, 4)
    return null
  }
  const egg = addPet({
    ...newEgg(rng, allNames()),
    bornAt: Date.now(),
    origin: { kind: 'gift' },
  })
  egg.say('ไข่ใบใหม่! ลูบเพื่อช่วยฟัก', 4)
  saveNow()
  return egg
}

/** ฝากสัตว์ไว้ที่ฟาร์ม (ต้องเหลืออย่างน้อย 1 ตัวบนจอ) */
export function sendToFarm(actor: PetActor): boolean {
  if (pets.length <= 1) return false
  farm.push(actor.state)
  removePet(actor)
  saveNow()
  return true
}

/** เรียกสัตว์ตัวที่ฝากไว้นานที่สุดกลับมาบนจอ */
export function recallFromFarm(): PetActor | null {
  const speaker = pets[0]
  if (farm.length === 0) {
    speaker?.say('ที่ฟาร์มไม่มีใครอยู่เลย', 3)
    return null
  }
  if (!hasRoom()) {
    speaker?.say(`บนจออยู่ได้ ${MAX_ACTIVE_PETS} ตัว ฝากฟาร์มก่อนนะ`, 4)
    return null
  }
  const actor = addPet(farm.shift()!)
  actor.say('กลับมาแล้ว~', 3)
  saveNow()
  return actor
}

/** ฟาร์มยังรับเพิ่มได้ไหม */
export const farmHasRoom = (): boolean => farm.length < MAX_FARM_PETS

/**
 * รับสัตว์ตัวใหม่เข้าบ้าน: บนจอถ้ายังมีที่ ไม่งั้นไปฟาร์ม
 * คืนตัวบนจอ, 'farm' หรือ null ถ้าเต็มทั้งสองที่
 */
export function adopt(state: PetState, x?: number): PetActor | 'farm' | null {
  if (hasRoom()) return addPet(state, x)
  if (!farmHasRoom()) return null
  collection.family = recordFamily(collection.family, state)
  farm.push(state)
  return 'farm'
}

/**
 * เรียกตัวที่เลือกจากฟาร์มมาบนจอ — บนจอเต็มแล้วให้ระบุตัวที่จะสลับไปพักแทน
 * คืนตัวที่ขึ้นมาบนจอ หรือ null ถ้าทำไม่ได้
 */
export function recallPet(id: string, swap?: PetActor): PetActor | null {
  const index = farm.findIndex((p) => p.id === id)
  if (index < 0) return null
  if (!hasRoom()) {
    if (!swap || !pets.includes(swap)) return null
    farm.push(swap.state)
    removePet(swap)
  }
  const [state] = farm.splice(index, 1)
  const actor = addPet(state!, swap?.x)
  actor.say('กลับมาแล้ว~', 3)
  saveNow()
  return actor
}

// ───────── สมุดสะสม ─────────
const discoveryListeners: ((actor: PetActor, found: PartAlleleDef[], species: string[]) => void)[] =
  []
/** แจ้งเมื่อสัตว์บนจอทำให้ค้นพบลักษณะ/สายพันธุ์ใหม่ */
export function onDiscovery(
  listener: (actor: PetActor, found: PartAlleleDef[], species: string[]) => void,
): void {
  discoveryListeners.push(listener)
}

/** บันทึกสิ่งที่เห็นจากสัตว์ 1 ตัวลงสมุด (ยีนส์แฝงนับเมื่อโตพอจะเปิดเผย) */
function learnFrom(pet: PetState): { found: PartAlleleDef[]; species: string[] } {
  const result = discover(collection.dex, pet.genome, canBreed(pet), Date.now())
  collection.dex = result.dex
  return { found: result.alleles, species: result.species }
}

/** ตรวจสัตว์บนจอทุกตัว: ฟักใหม่/โตจนยีนส์แฝงเปิดเผย → ฉลองการค้นพบ; ชื่อเปลี่ยน → อัปเดตเครือญาติ */
function noticeCollection(): void {
  for (const actor of pets) {
    collection.family = recordFamily(collection.family, actor.state)
    if (actor.isEgg) continue
    const { found, species } = learnFrom(actor.state)
    if (found.length === 0 && species.length === 0) continue
    for (const listener of discoveryListeners) listener(actor, found, species)
    saveNow()
  }
}

// ───────── ผสมพันธุ์ ─────────
/** ตัวที่จับคู่กับ actor ได้ตอนนี้ */
export const partnersFor = (actor: PetActor): PetActor[] =>
  canBreed(actor.state) ? pets.filter((other) => other !== actor && canBreed(other.state)) : []

/**
 * จับคู่: ทั้งสองเดินมาหากัน แสดงความรัก แล้วได้ไข่ใบใหม่ (ลูกได้ยีนส์จากพ่อแม่ + โอกาสกลายพันธุ์)
 * คืน false ถ้าเริ่มไม่ได้
 */
export function startPairing(a: PetActor, b: PetActor): boolean {
  if (a === b || !canBreed(a.state) || !canBreed(b.state)) return false
  if (!hasRoom()) {
    a.say(`บนจออยู่ได้ ${MAX_ACTIVE_PETS} ตัว ฝากฟาร์มก่อนนะ`, 4)
    return false
  }
  const [left, right] = a.x <= b.x ? [a, b] : [b, a]
  const gap = (a.hit.r + b.hit.r) * 0.6
  const mid = Math.min(layout.width - 140, Math.max(140, (a.x + b.x) / 2))
  let arrived = 0
  const meet = (): void => {
    if (++arrived < 2) return
    left.face(1)
    right.face(-1)
    for (const actor of [a, b]) {
      actor.loveTimer = 3
      actor.hearts()
      actor.say('♥')
    }
    setTimeout(() => {
      // ระหว่างรอ อาจมีตัวถูกฝากฟาร์มหรือที่เต็มไปแล้ว
      if (!pets.includes(a) || !pets.includes(b) || !hasRoom()) return
      const bred = breedPets(a.state, b.state, pickName(rng, allNames()), rng)
      if (!bred) return
      const egg = { ...bred, bornAt: Date.now() }
      addPet(egg, mid).say('ไข่ใบใหม่! ลูบเพื่อช่วยฟัก', 4)
      saveNow()
    }, 1800)
  }
  for (const actor of [a, b]) {
    // ตื่นและอยู่นิ่งๆ ระหว่างนัดพบ
    actor.state = { ...actor.state, behavior: 'idle', behaviorTimer: 20 }
  }
  left.goTo(mid - gap, meet)
  right.goTo(mid + gap, meet)
  return true
}

// ───────── จำลองชีวิต ─────────
const lastBehavior = new Map<string, Behavior>()

/** เดินเวลาจำลองของสัตว์ทุกตัวบนจอ 1 ก้าว */
let collectionAccum = 0

export function tickAll(dtSec: number): void {
  collectionAccum += dtSec
  if (collectionAccum >= 3) {
    collectionAccum = 0
    noticeCollection()
  }
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  const active = userActive()
  for (const actor of pets) {
    const hit = actor.hit
    actor.setState(
      tickPet(
        actor.state,
        dtSec,
        {
          hour,
          cursorNear: cursor.seen && Math.hypot(cursor.x - hit.x, cursor.y - hit.y) < 260,
          userActive: active,
          quiet: hushed(),
        },
        rng,
      ),
    )
    // ระหว่างโฟกัส ไข่ฟักเร็วขึ้น 3 เท่า (เวลาที่ตั้งใจทำงานช่วยให้ลูกเกิดเร็วขึ้น)
    if (mode.focusing && active && actor.isEgg)
      actor.setState(incubate(actor.state, (2 * dtSec) / INCUBATION_SECONDS))
    const behavior = actor.state.behavior
    if (behavior !== lastBehavior.get(actor.state.id)) {
      lastBehavior.set(actor.state.id, behavior)
      if (behavior === 'seekAttention' || behavior === 'beg') actor.say()
    }
  }
}
