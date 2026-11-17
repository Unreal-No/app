import {
  breedPets,
  canBreed,
  carePet,
  createCompanion,
  createSave,
  incubate,
  INCUBATION_SECONDS,
  MAX_ACTIVE_PETS,
  tickPet,
  type Behavior,
  type CareAction,
  type CompanionState,
  type PetState,
  type SaveData,
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
  )
}
export const saveNow = (): Promise<void> => storeSave(snapshot())

export function restore(save: SaveData): void {
  for (const actor of [...pets]) removePet(actor)
  farm = save.farm
  companion = save.companion
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
  const egg = addPet(newEgg(rng, allNames()))
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
      const egg = breedPets(a.state, b.state, pickName(rng, allNames()), rng)
      if (!egg) return
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
export function tickAll(dtSec: number): void {
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
