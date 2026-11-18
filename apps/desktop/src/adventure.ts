import {
  addItems,
  createPet,
  expeditionDone,
  feedItem,
  FOSSILS_PER_EGG,
  formatDuration,
  fossilGenome,
  isFullMoon,
  ITEMS,
  lootEgg,
  MAX_EXPEDITIONS,
  newPetId,
  PLACES,
  startExpedition,
  takeItem,
  type Expedition,
  type PetState,
  type PlaceId,
  type SpecialItem,
} from '@mochimon/core'
import { addAlarmSource } from './alarmSources'
import {
  addPet,
  adopt,
  allNames,
  collection,
  farm,
  hasRoom,
  onTick,
  pets,
  saveNow,
  walkers,
} from './game'
import { PetActor } from './pet'
import { pickName } from './store'
import { layout, rng } from './world'

/**
 * การสำรวจบนจอ: สัตว์โบกมือเดินออกขอบจอ → นับเวลาจริง → เดินกลับเข้าจอพร้อมของ/ไข่/เรื่องเล่า
 * และของพิเศษในกระเป๋า + การประกอบไข่ฟอสซิล
 */

/** เหตุผลที่ส่งตัวนี้ไปสำรวจไม่ได้ตอนนี้ (null = ไปได้) */
export function exploreBlocker(actor: PetActor): string | null {
  if (actor.isEgg) return 'ไข่ยังออกเดินทางไม่ได้'
  if (actor.state.nurture.stage === 'baby') return 'ยังเล็กเกินไป รอให้โตเป็นเด็กก่อนนะ'
  if (pets.filter((p) => p !== actor).length === 0) return 'ต้องมีเพื่อนเฝ้าบ้านอย่างน้อย 1 ตัว'
  if (collection.expeditions.length >= MAX_EXPEDITIONS)
    return `ออกสำรวจพร้อมกันได้ ${MAX_EXPEDITIONS} ตัว`
  return null
}

/** เดินออกนอกจอแล้วหายไป (เป็นภาพเฉยๆ ไม่ใช่สัตว์ในบ้านแล้ว) */
function walkAway(actor: PetActor): void {
  const index = pets.indexOf(actor)
  if (index >= 0) pets.splice(index, 1)
  pets.forEach((p, i) => (p.slot = i))
  walkers.push(actor)
  actor.attending = false
  const edge = actor.x < layout.width / 2 ? -140 : layout.width + 140
  const done = (): void => {
    const at = walkers.indexOf(actor)
    if (at >= 0) walkers.splice(at, 1)
    actor.dispose()
  }
  actor.goTo(edge, done, 40)
  setTimeout(() => walkers.includes(actor) && done(), 40_000)
}

export function sendOnExpedition(actor: PetActor, place: PlaceId, minutes: number): boolean {
  if (exploreBlocker(actor)) return false
  const now = Date.now()
  const trip = startExpedition(actor.state, place, minutes, now, { fullMoon: isFullMoon(now) })
  collection.expeditions.push(trip)
  actor.state = { ...actor.state, behavior: 'wander', behaviorTimer: 60 }
  actor.say(`ไป${PLACES[place].name}แล้วนะ! อีก ${formatDuration(minutes * 60_000)} กลับ`, 4)
  actor.float('👋', 'note')
  walkAway(actor)
  saveNow()
  return true
}

/** สรุปของที่ได้เป็นข้อความสั้น */
export function lootSummary(trip: Expedition): string {
  const parts = Object.entries(trip.loot.items).map(
    ([id, n]) => `${ITEMS[id as SpecialItem].icon}×${n}`,
  )
  if (trip.loot.fossils) parts.push(`🦴×${trip.loot.fossils}`)
  if (trip.loot.egg) parts.push(trip.loot.egg.mythical ? '🥚✨' : '🥚')
  return parts.join(' ')
}

function eggFrom(trip: Expedition): PetState | null {
  const egg = trip.loot.egg
  if (!egg) return null
  return {
    ...createPet(
      pickName(rng, allNames()),
      lootEgg(egg),
      { stage: 'egg', fat: 0.35, fitness: 0.4 },
      newPetId(rng),
    ),
    bornAt: Date.now(),
    origin: { kind: 'expedition', place: PLACES[trip.place].name },
  }
}

/** กลับบ้าน: เดินเข้าจอจากขอบ (จอเต็ม → ไปพักที่ฟาร์ม) */
function returnHome(trip: Expedition): void {
  const place = PLACES[trip.place]
  collection.inventory = addItems(collection.inventory, trip.loot.items, trip.loot.fossils)
  const summary = lootSummary(trip)
  const line = `กลับจาก${place.name}แล้ว! ${trip.loot.story} ได้ ${summary}`
  if (hasRoom()) {
    const fromLeft = rng.chance(0.5)
    const actor = addPet(trip.pet, fromLeft ? -80 : layout.width + 80)
    actor.goTo(fromLeft ? rng.range(160, 420) : layout.width - rng.range(200, 460))
    actor.say(line, 7)
    actor.hearts()
  } else {
    farm.push(trip.pet)
    pets[0]?.say(`${trip.pet.name}${line} (ไปพักที่ฟาร์มนะ บนจอเต็ม)`, 7)
  }
  const egg = eggFrom(trip)
  if (egg) {
    const where = adopt(egg, layout.width * rng.range(0.3, 0.7))
    if (where && where !== 'farm') where.say(egg.origin?.place ? `ไข่จาก${place.name}!` : 'ไข่!', 4)
    else if (!where) farm.push(egg)
  }
}

let checkAccum = 0
onTick((dt) => {
  checkAccum += dt
  if (checkAccum < 2) return
  checkAccum = 0
  const now = Date.now()
  const done = collection.expeditions.filter((trip) => expeditionDone(trip, now))
  if (done.length === 0) return
  collection.expeditions = collection.expeditions.filter((trip) => !done.includes(trip))
  for (const trip of done) returnHome(trip)
  saveNow()
})

addAlarmSource(() =>
  collection.expeditions.map((trip) => ({
    id: `exp-${trip.pet.id}`,
    atMs: trip.endsAt,
    title: 'Mochimon',
    body: `${trip.pet.name}กลับจาก${PLACES[trip.place].name}แล้ว ได้ของมาฝากด้วย`,
  })),
)

// ───────── กระเป๋า ─────────
export function feedSpecial(actor: PetActor, id: SpecialItem): boolean {
  if (actor.isEgg) return false
  const inventory = takeItem(collection.inventory, id)
  if (!inventory) return false
  collection.inventory = inventory
  const { pet, loved } = feedItem(actor.state, id)
  actor.setState(pet)
  actor.float(ITEMS[id].icon, 'note')
  actor.say(loved ? `${ITEMS[id].name}! ของโปรดเลย~` : 'อร่อยจัง~', 3)
  if (loved) actor.hearts()
  saveNow()
  return true
}

/** ประกอบชิ้นฟอสซิลครบ → ไข่ฟอสซิล */
export function assembleFossil(): boolean {
  if (collection.inventory.fossils < FOSSILS_PER_EGG) return false
  const now = Date.now()
  const egg: PetState = {
    ...createPet(
      pickName(rng, allNames()),
      fossilGenome(`${now}`),
      { stage: 'egg', fat: 0.35, fitness: 0.4 },
      newPetId(rng),
    ),
    bornAt: now,
    origin: { kind: 'expedition', place: PLACES.ruins.name, fossil: true },
  }
  const where = adopt(egg, layout.width / 2)
  if (!where) return false
  collection.inventory = {
    ...collection.inventory,
    fossils: collection.inventory.fossils - FOSSILS_PER_EGG,
  }
  if (where !== 'farm') where.say('ไข่ฟอสซิลประกอบเสร็จแล้ว!', 4)
  saveNow()
  return true
}

/** ใช้ทดสอบ: ให้การสำรวจทุกอันจบทันที */
export function finishExpeditionsNow(): void {
  collection.expeditions = collection.expeditions.map((trip) => ({ ...trip, endsAt: Date.now() }))
}
