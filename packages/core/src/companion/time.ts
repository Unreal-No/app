/** ตัวช่วยเรื่องเวลาแบบเวลาท้องถิ่นของเครื่อง (ทุกฟังก์ชันรับ/คืน epoch ms) */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** เวลาเดียวกันของวันที่เลื่อนไป n วัน (ใช้ปฏิทินท้องถิ่น จึงถูกต้องแม้ข้ามช่วงปรับเวลา) */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** epoch ms ของ "วันของ ms" เวลา hh:mm */
export function atTime(ms: number, hour: number, minute = 0): number {
  const d = new Date(ms)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

export const startOfDay = (ms: number): number => atTime(ms, 0, 0)

/** รหัสวันแบบ yyyy-mm-dd ตามเวลาท้องถิ่น (ใช้รีเซ็ตสถิติรายวัน) */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const isWeekend = (ms: number): boolean => {
  const day = new Date(ms).getDay()
  return day === 0 || day === 6
}

const DAYS_SHORT_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
export const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS_SHORT_TH = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "วันนี้ 14:30", "พรุ่งนี้ 09:00", "ศ. 20 พ.ย. 10:00" */
export function formatWhen(at: number, now: number): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY)
  const clock = formatClock(at)
  if (days === 0) return `วันนี้ ${clock}`
  if (days === 1) return `พรุ่งนี้ ${clock}`
  if (days === -1) return `เมื่อวาน ${clock}`
  const d = new Date(at)
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear() + 543}` : ''
  return `${DAYS_SHORT_TH[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT_TH[d.getMonth()]}${year} ${clock}`
}

/** "อีก 5 นาที", "อีก 1 ชม. 20 นาที" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  if (minutes < 60) return `${minutes} นาที`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ชม. ${rest} นาที` : `${hours} ชม.`
}

/** นาฬิกานับถอยหลัง mm:ss */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
