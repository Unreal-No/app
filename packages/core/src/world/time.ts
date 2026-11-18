/**
 * โลกตามเวลาจริง: ช่วงของวัน แสง ฤดูไทย ข้างขึ้นข้างแรม และเทศกาล
 * ฟังก์ชันบริสุทธิ์ที่รับเวลาจริง (epoch ms) — ใช้เวลาท้องถิ่นของเครื่อง ยกเว้นวันลอยกระทงที่ยึดเวลาไทย
 */
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'

/** ชั่วโมงทศนิยมตามเวลาท้องถิ่น */
const hourOf = (ms: number): number => {
  const d = new Date(ms)
  return d.getHours() + d.getMinutes() / 60
}

export function dayPhase(ms: number): DayPhase {
  const h = hourOf(ms)
  if (h >= 5 && h < 7) return 'dawn'
  if (h >= 7 && h < 17) return 'day'
  if (h >= 17 && h < 19) return 'dusk'
  return 'night'
}

export interface Rgb3 {
  r: number
  g: number
  b: number
}

/** สีแสงตามเวลา (คูณกับสีของตัวสัตว์/ฉาก) — จุดอ้างอิงรายชั่วโมง แล้วไล่ระหว่างกันให้นุ่ม */
const LIGHT_KEYS: [number, Rgb3][] = [
  [0, { r: 0.78, g: 0.8, b: 0.98 }],
  [4.5, { r: 0.78, g: 0.8, b: 0.98 }],
  [6, { r: 1.0, g: 0.9, b: 0.86 }],
  [8, { r: 1, g: 1, b: 1 }],
  [16, { r: 1, g: 1, b: 1 }],
  [17.75, { r: 1.0, g: 0.88, b: 0.76 }],
  [19.25, { r: 0.86, g: 0.82, b: 0.96 }],
  [20.5, { r: 0.78, g: 0.8, b: 0.98 }],
  [24, { r: 0.78, g: 0.8, b: 0.98 }],
]

/** สีแสงของฉาก ณ เวลานั้น — strength 0 = ไม่ปรับเลย, 1 = เต็มที่ */
export function skyLight(ms: number, strength = 1): Rgb3 {
  const h = hourOf(ms)
  let i = 0
  while (i < LIGHT_KEYS.length - 2 && LIGHT_KEYS[i + 1]![0] <= h) i++
  const [h0, a] = LIGHT_KEYS[i]!
  const [h1, b] = LIGHT_KEYS[i + 1]!
  const t = h1 > h0 ? Math.min(1, Math.max(0, (h - h0) / (h1 - h0))) : 0
  const mix = (x: number, y: number) => 1 + (x + (y - x) * t - 1) * strength
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) }
}

/** ฤดูของไทย: ร้อน (มี.ค.–พ.ค.) ฝน (มิ.ย.–ต.ค.) หนาว (พ.ย.–ก.พ.) */
export type Season = 'hot' | 'rainy' | 'cool'
export function thaiSeason(ms: number): Season {
  const m = new Date(ms).getMonth()
  if (m >= 2 && m <= 4) return 'hot'
  if (m >= 5 && m <= 9) return 'rainy'
  return 'cool'
}
export const SEASON_TH: Record<Season, string> = { hot: 'หน้าร้อน', rainy: 'หน้าฝน', cool: 'หน้าหนาว' }

/** รอบเดือนจันทร์เฉลี่ย (วัน) และจันทร์ดับอ้างอิง 6 ม.ค. 2000 18:14 UTC */
const SYNODIC = 29.530588853
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14)
const DAY_MS = 86_400_000

/** อายุจันทร์ 0..1: 0 = จันทร์ดับ, 0.5 = เต็มดวง (ความคลาดเคลื่อนไม่เกินราว ±0.6 วัน) */
export function moonPhase(ms: number): number {
  const days = (ms - NEW_MOON_REF) / DAY_MS
  return (((days / SYNODIC) % 1) + 1) % 1
}

/** คืนวันเพ็ญ (ช่วงราว ±1 วันจากเต็มดวง) */
export const isFullMoon = (ms: number): boolean => Math.abs(moonPhase(ms) - 0.5) < 1.1 / SYNODIC

const THAI_OFFSET = 7 * 3600_000

/** วันลอยกระทงตามปฏิทินจันทรคติไทย (ไม่ตรงกับเต็มดวงทางดาราศาสตร์เสมอไป) */
const LOY_KRATHONG: Record<number, number> = {
  2024: 15,
  2025: 5,
  2026: 24,
  2027: 13,
  2028: 2,
}

/**
 * วันลอยกระทง (วันเพ็ญเดือน 12) ในเดือนพฤศจิกายน — ใช้ตารางปฏิทินไทยถ้ามี
 * ไม่งั้นประมาณจากวันที่จันทร์เต็มดวงตามเวลาไทย (อาจคลาด 1 วัน)
 */
export function loyKrathongDay(year: number): number {
  const known = LOY_KRATHONG[year]
  if (known) return known
  for (let day = 1; day <= 30; day++) {
    const start = Date.UTC(year, 10, day) - THAI_OFFSET
    const a = moonPhase(start)
    const b = moonPhase(start + DAY_MS)
    if (a <= 0.5 && b > 0.5) return day
  }
  return 15
}

export type Festival = 'newyear' | 'songkran' | 'loykrathong'
export const FESTIVAL_TH: Record<Festival, string> = {
  newyear: 'ปีใหม่',
  songkran: 'สงกรานต์',
  loykrathong: 'ลอยกระทง',
}

/** เทศกาลของวันนี้ (ตามวันท้องถิ่น) */
export function festivalOn(ms: number): Festival | null {
  const d = new Date(ms)
  const m = d.getMonth()
  const day = d.getDate()
  if ((m === 11 && day === 31) || (m === 0 && day === 1)) return 'newyear'
  if (m === 3 && day >= 13 && day <= 15) return 'songkran'
  if (m === 10 && day === loyKrathongDay(d.getFullYear())) return 'loykrathong'
  return null
}
