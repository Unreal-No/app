import {
  dayPhase,
  dayKey,
  festivalOn,
  FESTIVAL_TH,
  isFullMoon,
  skyLight,
  thaiSeason,
  type Festival,
} from '@mochimon/core'
import { setSceneTint as tintCreatures } from '@mochimon/creature'
import { setSceneTint as tintHabitat } from '@mochimon/habitat'
import { pets } from './game'
import { el } from './ui'
import { fxLayer, habitatKind, hushed, layout, restSpot, rng, settings } from './world'

/**
 * บรรยากาศตามเวลาจริง: สีแสงของฉาก (เช้า/เย็น/กลางคืน), หิ่งห้อยตอนกลางคืน,
 * ฝนปรอยบนไดโอรามาช่วงหน้าฝน และเทศกาล (ปีใหม่ สงกรานต์ ลอยกระทง) — ปิดได้จากเมนู tray
 * เอฟเฟกต์อยู่ใกล้พื้น/ฉากเท่านั้น ไม่ลอยบังงานกลางจอ
 */
const FIREFLIES = 6
const GREETED_KEY = 'mochimon.greeted.v1'

const fireflyLayer = el('div', 'ambient fireflies')
const rainLayer = el('div', 'ambient rain')
const krathong = el('div', 'krathong', '🪷')
krathong.hidden = true
fxLayer.append(fireflyLayer, rainLayer, krathong)

/** วัน+เหตุการณ์ที่ทักไปแล้ว (กันทักซ้ำหลังรีโหลด) */
function greeted(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(GREETED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function markGreeted(what: string, day: string): void {
  try {
    localStorage.setItem(GREETED_KEY, JSON.stringify({ ...greeted(), [what]: day }))
  } catch {
    // ไม่มีที่เก็บ → อาจทักซ้ำหลังรีโหลด ไม่เป็นไร
  }
}

const GREETINGS: Record<Festival, { line: string; icon: string }> = {
  newyear: { line: 'สวัสดีปีใหม่! ปีนี้ขอให้มีแต่เรื่องดีๆ นะ', icon: '🎉' },
  songkran: { line: 'สุขสันต์วันสงกรานต์! สาดน้ำ~', icon: '💦' },
  loykrathong: { line: 'คืนนี้วันลอยกระทง~ ขอให้ทุกข์ลอยไปกับน้ำนะ', icon: '🪷' },
}

/** สัตว์ที่ตื่นอยู่และไม่ใช่ไข่ (คนทัก) */
const awakePets = () => pets.filter((p) => !p.isEgg && p.state.behavior !== 'sleep')

function greet(what: string, line: string, icon: string, now: number): boolean {
  const day = dayKey(now)
  if (greeted()[what] === day || hushed()) return false
  const speakers = awakePets()
  if (speakers.length === 0) return false
  speakers[0]!.say(line, 6)
  for (const actor of speakers) actor.float(icon, 'note')
  markGreeted(what, day)
  return true
}

// ───────── เอฟเฟกต์ ─────────
function setFireflies(on: boolean): void {
  if (!on) {
    fireflyLayer.replaceChildren()
    return
  }
  if (fireflyLayer.childElementCount > 0) return
  for (let i = 0; i < FIREFLIES; i++) {
    const fly = el('div', 'firefly')
    fly.style.setProperty('--dx', `${rng.range(-60, 60)}px`)
    fly.style.setProperty('--dy', `${rng.range(-40, 30)}px`)
    fly.style.animationDelay = `${rng.range(0, 6)}s, ${rng.range(0, 3)}s`
    fly.dataset.offset = String(rng.range(-0.5, 0.5))
    fly.dataset.height = String(rng.range(20, 140))
    fireflyLayer.append(fly)
  }
}

/** หิ่งห้อยลอยอยู่รอบๆ ฝูงสัตว์ (หรือรอบฉากถ้ามี) */
function placeFireflies(): void {
  if (fireflyLayer.childElementCount === 0) return
  const xs = pets.map((p) => p.x)
  const spot = restSpot()
  const center = spot ?? (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : layout.width / 2)
  const spread = Math.max(220, xs.length ? Math.max(...xs) - Math.min(...xs) + 200 : 300)
  for (const node of fireflyLayer.children as HTMLCollectionOf<HTMLElement>) {
    const x = center + Number(node.dataset.offset) * spread
    node.style.left = `${Math.min(layout.width - 10, Math.max(10, x))}px`
    node.style.top = `${layout.groundY - Number(node.dataset.height)}px`
  }
}

function setRain(on: boolean): void {
  const spot = restSpot()
  if (!on || spot === null) {
    rainLayer.replaceChildren()
    return
  }
  rainLayer.style.left = `${spot - 120}px`
  rainLayer.style.top = `${layout.groundY - 260}px`
  if (rainLayer.childElementCount > 0) return
  for (let i = 0; i < 14; i++) {
    const drop = el('div', 'raindrop')
    drop.style.left = `${rng.range(10, 230)}px`
    drop.style.animationDelay = `${rng.range(0, 1.4)}s`
    drop.style.animationDuration = `${rng.range(0.9, 1.4)}s`
    rainLayer.append(drop)
  }
}

let lastTick = -Infinity
let splashAt = 0

/** เรียกทุกเฟรม (ทำงานจริงทุก 2 วินาที) */
export function updateAmbient(): void {
  placeFireflies()
  const tick = performance.now()
  if (tick - lastTick < 2000) return
  lastTick = tick
  const now = Date.now()

  const on = settings.daylight
  const light = skyLight(now, on ? 1 : 0)
  tintCreatures(light.r, light.g, light.b)
  tintHabitat(light.r, light.g, light.b)

  const phase = dayPhase(now)
  const night = on && phase === 'night'
  setFireflies(night && !hushed())
  setRain(on && thaiSeason(now) === 'rainy' && habitatKind() !== null)

  const festival = on ? festivalOn(now) : null
  // กระทงลอยตอนค่ำของวันลอยกระทง
  krathong.hidden = !(festival === 'loykrathong' && (phase === 'dusk' || phase === 'night'))
  if (!krathong.hidden) {
    const spot = restSpot()
    krathong.style.left = `${spot ?? layout.width * 0.7}px`
    krathong.style.top = `${layout.groundY - 26}px`
  }
  if (!on) return
  if (festival) {
    const g = GREETINGS[festival]
    greet(`festival-${festival}`, g.line, g.icon, now)
    // สงกรานต์: สาดน้ำกันเป็นระยะ
    if (festival === 'songkran' && now > splashAt && !hushed()) {
      splashAt = now + rng.range(6, 12) * 60_000
      const actor = rng.pick(awakePets().length ? awakePets() : pets)
      actor?.float('💦', 'note')
    }
  } else if (night && isFullMoon(now)) {
    greet('fullmoon', 'คืนนี้พระจันทร์เต็มดวงเลย~ 🌕', '🌕', now)
  }
}

/** ชื่อเทศกาลวันนี้ (ใช้แสดงในแผง) */
export const festivalToday = (): string | null => {
  const f = festivalOn(Date.now())
  return f ? FESTIVAL_TH[f] : null
}
