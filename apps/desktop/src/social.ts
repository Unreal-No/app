import {
  areFamily,
  canBreed,
  hashString,
  NEAR_PX,
  pairKey,
  relationLabel,
  RELATION_TH,
  tickRelations,
  type PetState,
  type RelationLabel,
} from '@mochimon/core'
import { collection, farm, onTick, pets } from './game'
import type { PetActor } from './pet'
import { hushed, rng } from './world'

/**
 * ความสัมพันธ์ระหว่างสัตว์บนจอ: สนิท/ขัดกันขึ้นตามเวลาที่อยู่ใกล้กัน (ตรรกะใน core/mind/relations)
 * แล้วแสดงออก: เพื่อนซี้นั่งชิดกัน, คู่กัดฮึดฮัดแล้วเดินหลบ, แอบชอบเขินเมื่ออยู่ใกล้
 */
export function labelBetween(a: PetState, b: PetState): RelationLabel {
  const affinity = collection.relations[pairKey(a.id, b.id)] ?? 0
  return relationLabel(affinity, {
    grownUp: canBreed(a) && canBreed(b),
    family: areFamily(collection.family, a.id, b.id),
    pairSeed: hashString(pairKey(a.id, b.id)),
  })
}

/** สรุปความสัมพันธ์ของตัวนี้ (สำหรับแผงดูแล) เช่น "เพื่อนซี้: โมจิ · คู่กัด: ดังโงะ" */
export function relationSummary(pet: PetState): string {
  const others = [...pets.map((p) => p.state), ...farm].filter((o) => o.id !== pet.id)
  const groups = new Map<RelationLabel, string[]>()
  for (const other of others) {
    const label = labelBetween(pet, other)
    if (label === 'neutral' || label === 'friend') continue
    groups.set(label, [...(groups.get(label) ?? []), other.name])
  }
  return (['bestie', 'crush', 'rival'] as RelationLabel[])
    .filter((label) => groups.has(label))
    .map((label) => `${RELATION_TH[label]}: ${groups.get(label)!.join(', ')}`)
    .join(' · ')
}

/** เพื่อนสนิทบนจอที่อยากไปนั่งใกล้ */
function buddyOf(actor: PetActor): PetActor | null {
  let best: PetActor | null = null
  let bestAffinity = 0.55
  for (const other of pets) {
    if (other === actor || other.isEgg) continue
    const affinity = collection.relations[pairKey(actor.state.id, other.state.id)] ?? 0
    if (affinity >= bestAffinity) {
      best = other
      bestAffinity = affinity
    }
  }
  return best
}

let accum = 0
onTick((dt) => {
  accum += dt
  if (accum < 5) return
  const step = accum
  accum = 0
  const awake = pets.filter((p) => !p.isEgg && !p.inBowl && !p.flying)
  collection.relations = tickRelations(
    collection.relations,
    awake.map((p) => ({
      id: p.state.id,
      temperament: p.personality,
      x: p.x,
      y: p.y,
      awake: p.state.behavior !== 'sleep',
    })),
    step,
    (a, b) => areFamily(collection.family, a, b),
  )
  for (const actor of pets) actor.buddy = actor.isEgg ? null : buddyOf(actor)
  if (hushed()) return
  // แสดงออกเป็นครั้งคราว (คู่ที่อยู่ใกล้กันเท่านั้น)
  for (let i = 0; i < awake.length; i++)
    for (let j = i + 1; j < awake.length; j++) {
      const a = awake[i]!
      const b = awake[j]!
      if (Math.hypot(a.x - b.x, a.y - b.y) > NEAR_PX) continue
      if (a.state.behavior === 'sleep' || b.state.behavior === 'sleep') continue
      const label = labelBetween(a.state, b.state)
      if (label === 'rival' && rng.chance(0.2)) {
        const grumpy = rng.chance(0.5) ? a : b
        const other = grumpy === a ? b : a
        grumpy.float('💢', 'note')
        grumpy.say('ฮึ่ม!', 2)
        grumpy.goTo(grumpy.x + Math.sign(grumpy.x - other.x || 1) * 220)
      } else if (label === 'crush' && rng.chance(0.15)) {
        const shy = a.personality.shy >= b.personality.shy ? a : b
        shy.float('💗', 'heart')
        shy.say('เขินจัง…', 2)
      } else if (label === 'bestie' && rng.chance(0.08)) {
        a.hearts()
        b.hearts()
      }
    }
})
