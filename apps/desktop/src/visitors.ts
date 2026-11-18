import {
  BASIC_FOODS,
  createVisitor,
  ITEMS,
  nextVisitAt,
  offerFood,
  speciesLabel,
  takeItem,
  visitorHint,
  type FoodId,
  type SpecialItem,
  type Visitor,
} from '@mochimon/core'
import {
  adoptActor,
  allNames,
  collection,
  farm,
  farmHasRoom,
  hasRoom,
  onTick,
  pets,
  saveNow,
} from './game'
import { PetActor } from './pet'
import { pickName } from './store'
import { button, el, rectOf } from './ui'
import { hushed, layout, rng, uiLayer, userActive } from './world'

/**
 * แขกป่า: ทุก 1–2 ชั่วโมงที่ผู้ใช้ใช้เครื่องอยู่ สัตว์ป่า 1 ตัวเดินเข้ามาจากขอบจอ อยู่ราว 3 นาที
 * คลิกที่มันแล้วเลือกของให้ — ถูกใจก็ตามมาอยู่ด้วย ไม่ถูกใจก็แค่เดินจากไป
 * ไม่มาระหว่างโหมดเงียบ/โฟกัส/ประชุม และตอนผู้ใช้ไม่อยู่
 */
interface Guest {
  data: Visitor
  actor: PetActor
  hint: FoodId
  phase: 'arriving' | 'waiting' | 'leaving'
  nextHint: number
}

let guest: Guest | null = null

const panel = el('div', 'panel offer')
panel.hidden = true
uiLayer.append(panel)

export const visitorActor = (): PetActor | null =>
  guest && guest.phase !== 'leaving' ? guest.actor : null
/** ตัวแขก (รวมตอนเดินจากไป) สำหรับวาดทุกเฟรม */
export const guestActor = (): PetActor | null => guest?.actor ?? null
export const offerRect = (): { x: number; y: number; w: number; h: number } | null =>
  panel.hidden ? null : rectOf(panel)

function showHint(g: Guest): void {
  g.actor.say(`💭 ${ITEMS[g.hint].icon}?`, 8)
  g.nextHint = Date.now() + 20_000
}

/** ให้แขกมาตอนนี้เลย (ใช้ทดสอบ / หรือเมื่อถึงเวลา) */
export function spawnVisitor(now = Date.now()): boolean {
  if (guest) return false
  const data = createVisitor(rng, now, pickName(rng, allNames()))
  const fromLeft = rng.chance(0.5)
  const actor = new PetActor(data.pet, fromLeft ? -90 : layout.width + 90)
  actor.state = { ...actor.state, behavior: 'idle', behaviorTimer: 999 }
  const g: Guest = { data, actor, hint: visitorHint(data, rng), phase: 'arriving', nextHint: 0 }
  guest = g
  const spot = fromLeft
    ? rng.range(140, layout.width * 0.4)
    : layout.width - rng.range(180, layout.width * 0.4)
  actor.goTo(
    spot,
    () => {
      if (guest !== g) return
      g.phase = 'waiting'
      g.data = { ...g.data, leavesAt: Date.now() + (g.data.leavesAt - g.data.arrivedAt) }
      showHint(g)
    },
    40,
  )
  // คนในบ้านทักตามนิสัย
  for (const host of pets) {
    if (host.isEgg || host.state.behavior === 'sleep') continue
    if (host.personality.shy > 0.6)
      host.state = { ...host.state, behavior: 'hide', behaviorTimer: 20 }
    else if (host.personality.playful > 0.6) host.say('มีเพื่อนใหม่มา!', 3)
    else if (rng.chance(0.4)) host.say('ใครน่ะ?', 3)
  }
  collection.visitorAt = nextVisitAt(now, rng)
  saveNow()
  return true
}

function leave(line: string): void {
  if (!guest || guest.phase === 'leaving') return
  const g = guest
  g.phase = 'leaving'
  closeOffer()
  g.actor.say(line, 3)
  const edge = g.actor.x < layout.width / 2 ? -140 : layout.width + 140
  const done = (): void => {
    if (guest === g) guest = null
    g.actor.dispose()
  }
  g.actor.goTo(edge, done, 40)
  setTimeout(() => guest === g && done(), 40_000)
}

function befriend(): void {
  if (!guest) return
  const g = guest
  closeOffer()
  g.actor.hearts()
  if (hasRoom()) {
    guest = null
    g.actor.state = { ...g.actor.state, behavior: 'idle', behaviorTimer: 3 }
    adoptActor(g.actor)
    g.actor.say(`${g.actor.state.name}ขออยู่ด้วยนะ!`, 5)
  } else if (farmHasRoom()) {
    farm.push(g.actor.state)
    adoptRecord(g)
    leave('ไปรอที่ฟาร์มนะ~')
    pets[0]?.say(`${g.actor.state.name}ไปอยู่ที่ฟาร์มแล้ว (บนจอเต็ม)`, 5)
  } else {
    leave('บ้านเต็มแล้ว ไว้มาใหม่นะ')
    return
  }
  saveNow()
}

function adoptRecord(g: Guest): void {
  // ให้ผังเครือญาติรู้จักตัวที่ไปอยู่ฟาร์มโดยตรง
  collection.family = {
    ...collection.family,
    [g.actor.state.id]: {
      id: g.actor.state.id,
      name: g.actor.state.name,
      species: speciesLabel(g.actor.state.genome).th,
      generation: g.actor.state.genome.generation,
    },
  }
}

/** ให้ของกับแขก */
export function offer(food: FoodId): 'befriended' | 'meh' | 'leaving' | null {
  if (!guest || guest.phase === 'leaving') return null
  if (!(BASIC_FOODS as readonly string[]).includes(food)) {
    const inventory = takeItem(collection.inventory, food as SpecialItem)
    if (!inventory) return null
    collection.inventory = inventory
  }
  const { visitor, result } = offerFood(guest.data, food)
  guest.data = visitor
  guest.actor.float(ITEMS[food].icon, 'note')
  if (result === 'befriended') befriend()
  else if (result === 'leaving') leave('ไม่ใช่ของที่อยากได้… ไปก่อนนะ')
  else {
    guest.actor.say('อืม… ไม่ค่อยชอบ', 3)
    renderOffer()
  }
  return result
}

// ───────── แผงให้ของ ─────────
export function openOffer(): void {
  if (!guest || guest.phase === 'leaving') return
  panel.hidden = false
  renderOffer()
}
export function closeOffer(): void {
  panel.hidden = true
}

function renderOffer(): void {
  if (!guest) return
  const g = guest
  const head = el('div', 'panel-header')
  head.append(el('div', 'panel-name', 'แขกป่า'), button('×', closeOffer, 'panel-icon panel-close'))
  const foods = el('div', 'panel-actions')
  for (const food of BASIC_FOODS) {
    const b = button(`${ITEMS[food].icon} ${ITEMS[food].name}`, () => offer(food))
    b.disabled = g.data.tried.includes(food)
    foods.append(b)
  }
  const bag = Object.entries(collection.inventory.items) as [SpecialItem, number][]
  const special = el('div', 'panel-actions panel-bag')
  if (bag.length > 0) {
    special.append(el('span', 'need-label', 'ของพิเศษ (ถูกใจทุกตัว):'))
    for (const [id, n] of bag) special.append(button(`${ITEMS[id].icon}×${n}`, () => offer(id)))
  }
  panel.replaceChildren(
    head,
    el('div', 'panel-sub', speciesLabel(g.actor.state.genome).th),
    el('div', 'panel-hint', 'ดูเหมือนอยากได้อะไรสักอย่าง… ลองดูความคิดเหนือหัวมันสิ'),
    foods,
    ...(bag.length > 0 ? [special] : []),
  )
  placeOffer()
}

function placeOffer(): void {
  if (!guest || panel.hidden) return
  const hit = guest.actor.hit
  const width = panel.offsetWidth || 244
  const x =
    hit.x + hit.r + 12 + width < layout.width ? hit.x + hit.r + 12 : hit.x - hit.r - 12 - width
  panel.style.left = `${Math.max(8, x)}px`
  panel.style.top = `${Math.max(8, layout.groundY - panel.offsetHeight - 10)}px`
}

/** เรียกทุกเฟรม */
export function updateVisitor(dt: number): void {
  if (!guest) return
  guest.actor.update(dt, [])
  placeOffer()
}

onTick(() => {
  const now = Date.now()
  if (!collection.visitorAt) {
    collection.visitorAt = nextVisitAt(now, rng)
    return
  }
  if (guest) {
    if (guest.phase === 'waiting') {
      if (now >= guest.data.leavesAt) leave('ไปก่อนนะ~')
      else if (now >= guest.nextHint) showHint(guest)
    }
    return
  }
  if (now < collection.visitorAt) return
  // ไม่มาตอนผู้ใช้ไม่อยู่หรือกำลังตั้งใจทำงาน — เลื่อนไปอีก 10 นาที
  if (!userActive() || hushed() || pets.length === 0) {
    collection.visitorAt = now + 10 * 60_000
    return
  }
  spawnVisitor(now)
})

/** ข้อมูลแขกตอนนี้ (ใช้ทดสอบ) */
export const visitorInfo = (): Visitor | null => guest?.data ?? null
