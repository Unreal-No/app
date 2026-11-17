import { describeRepeat, type Repeat } from './reminders'
import { addDays, atTime, formatDuration, formatWhen, HOUR, isWeekend, MINUTE } from './time'

/**
 * แปลงข้อความที่ผู้ใช้พิมพ์ (ไทย/อังกฤษ) เป็นนัดหรือรายการงาน
 * เช่น "14:30 ประชุม", "อีก 20 นาที โทรหาแม่", "พรุ่งนี้ 9 โมง ส่งงาน", "ทุกวันจันทร์ 10:00 ประชุมทีม"
 *
 * ผลลัพธ์มี `summary` สำหรับแสดงให้ผู้ใช้ยืนยันก่อนบันทึกเสมอ — การเดาภาษาพูดผิดได้
 */
export type QuickEntry =
  | { kind: 'reminder'; text: string; at: number; repeat: Repeat; summary: string }
  | { kind: 'todo'; text: string; summary: string }

const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส(?:บดี)?', 'ศุกร์', 'เสาร์']
const EN_DAYS = [
  'sun(?:day)?',
  'mon(?:day)?',
  'tue(?:s|sday)?',
  'wed(?:nesday)?',
  'thu(?:rs?|rsday)?',
  'fri(?:day)?',
  'sat(?:urday)?',
]
const TH_DAY = `(${TH_DAYS.join('|')})`
const EN_DAY = `(${EN_DAYS.join('|')})`

/** วันในสัปดาห์ (0 = อาทิตย์) จากคำที่จับได้ */
function weekdayOf(word: string): number {
  const th = TH_DAYS.findIndex((p) => new RegExp(`^${p}$`).test(word))
  if (th >= 0) return th
  return EN_DAYS.findIndex((p) => new RegExp(`^${p}$`).test(word))
}

const normalize = (text: string): string =>
  text
    .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()

/** ชั่วโมงจากคำว่า "N โมง" ตามที่คนไทยพูดกันทั่วไป */
function thaiHour(n: number, part: string | undefined): number {
  if (part === 'เช้า') return n <= 5 ? n + 6 : n
  if (part === 'เย็น') return n < 12 ? n + 12 : n
  return n >= 1 && n <= 6 ? n + 12 : n
}

export function parseQuickEntry(input: string, now: number): QuickEntry | null {
  let rest = ` ${normalize(input)} `
  if (!rest.trim()) return null

  /** หาและตัดส่วนที่ตรงรูปแบบออกจากข้อความ */
  const take = (pattern: RegExp): RegExpMatchArray | null => {
    const match = rest.match(pattern)
    if (match?.index !== undefined)
      rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`
    return match
  }

  // ── การทำซ้ำ ──
  let repeat: Repeat = 'none'
  let weekday: number | null = null
  if (take(/ทุก\s*วัน\s*(?:ทำงาน|ธรรมดา)|วันธรรมดา|every\s+weekday|\bweekdays\b/i)) repeat = 'weekdays'
  else {
    const weekly = take(new RegExp(`ทุก\\s*(?:วัน)?\\s*${TH_DAY}|every\\s+${EN_DAY}\\b`, 'i'))
    if (weekly) {
      repeat = 'weekly'
      weekday = weekdayOf((weekly[1] ?? weekly[2] ?? '').toLowerCase())
    } else if (take(/ทุก\s*วัน|every\s*day|\bdaily\b/i)) repeat = 'daily'
  }

  // ── เวลาสัมพัทธ์: "อีก 20 นาที", "in 2 hours" ──
  let relative: number | null = null
  const rel = take(
    /(?:อีก|(?:^|\s)in)\s*(ครึ่ง|\d+(?:\.\d+)?)\s*(ชั่วโมง|ชม\.?|ช\.ม\.|hours?|hrs?|h|นาที|minutes?|mins?|m)(?![a-z])/i,
  )
  if (rel) {
    const amount = rel[1] === 'ครึ่ง' ? 0.5 : Number(rel[1])
    const hours = /^(ชั่วโมง|ชม|ช\.ม|hour|hr|h)/i.test(rel[2] ?? '')
    relative = amount * (hours ? HOUR : MINUTE)
  }

  // ── วัน ──
  let dayOffset: number | null = null
  let date: number | null = null
  let defaultHour = 9
  if (take(/มะรืน(?:นี้)?|day after tomorrow/i)) dayOffset = 2
  else if (take(/พรุ่งนี้|\btomorrow\b|\btmr\b/i)) dayOffset = 1
  else if (take(/คืนนี้|\btonight\b/i)) {
    dayOffset = 0
    defaultHour = 20
  } else if (take(/วันนี้|\btoday\b/i)) dayOffset = 0

  // วันในสัปดาห์: ภาษาไทยต้องมี "วัน" นำหน้า หรือ "หน้า/นี้" ตามหลัง (กันคำอย่าง "พระจันทร์")
  if (weekday === null) {
    const named = take(
      new RegExp(
        `วัน\\s*${TH_DAY}(?:\\s*(?:หน้า|นี้))?|${TH_DAY}\\s*(?:หน้า|นี้)|(?:next\\s+|on\\s+)?\\b${EN_DAY}\\b`,
        'i',
      ),
    )
    if (named) weekday = weekdayOf((named[1] ?? named[2] ?? named[3] ?? '').toLowerCase())
  }

  // วันที่: "25/12", "3/1/2027", "25/12/2569" (พ.ศ.)
  const numeric = take(/(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/)
  let yearGiven = false
  let dayOfMonthOnly = false
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2]) - 1
    let year = new Date(now).getFullYear()
    if (numeric[3]) {
      yearGiven = true
      year = Number(numeric[3])
      if (year < 100) year += 2000
      if (year > 2400) year -= 543
    }
    if (month >= 0 && month < 12 && day >= 1 && day <= 31)
      date = new Date(year, month, day).getTime()
  } else {
    const dom = take(/วันที่\s*(\d{1,2})(?!\d)/)
    if (dom) {
      const d = new Date(now)
      date = new Date(d.getFullYear(), d.getMonth(), Number(dom[1])).getTime()
      dayOfMonthOnly = true
    }
  }

  // ── เวลา ──
  let hour: number | null = null
  let minute = 0
  const half = (m: RegExpMatchArray, i: number) => (m[i] ? 30 : 0)
  let m: RegExpMatchArray | null
  if ((m = take(/(?<![\d/])(\d{1,2})[:.](\d{2})(?!\d)\s*(?:น\.|นาฬิกา)?\s*(a\.?m\.?|p\.?m\.?)?/i))) {
    hour = Number(m[1])
    minute = Number(m[2])
    const ampm = m[3]?.toLowerCase()
    if (ampm?.startsWith('p') && hour < 12) hour += 12
    if (ampm?.startsWith('a') && hour === 12) hour = 0
  } else if ((m = take(/(?<![\d:.])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i))) {
    hour = Number(m[1]) % 12
    if (m[2]?.toLowerCase().startsWith('p')) hour += 12
  } else if ((m = take(/บ่าย\s*(?:(\d{1,2})\s*(?:โมง)?|โมง)(\s*ครึ่ง)?/))) {
    const n = m[1] ? Number(m[1]) : 1
    hour = n < 12 ? n + 12 : n
    minute = half(m, 2)
  } else if (take(/เที่ยงคืน|midnight/i)) {
    hour = 0
  } else if ((m = take(/เที่ยง(?:วัน)?(\s*ครึ่ง)?|\bnoon\b/i))) {
    hour = 12
    minute = half(m, 1)
  } else if ((m = take(/(\d{1,2})\s*ทุ่ม(\s*ครึ่ง)?/))) {
    hour = 18 + Number(m[1])
    minute = half(m, 2)
  } else if ((m = take(/ตี\s*(\d{1,2})(\s*ครึ่ง)?/))) {
    hour = Number(m[1])
    minute = half(m, 2)
  } else if ((m = take(/(\d{1,2})\s*โมง\s*(เช้า|เย็น)?(\s*ครึ่ง)?/))) {
    hour = thaiHour(Number(m[1]), m[2])
    minute = half(m, 3)
  } else if ((m = take(/(?:^|\s)at\s+(\d{1,2})(?![\d:.])/i))) {
    hour = thaiHour(Number(m[1]), undefined)
  }
  if (hour !== null && (hour > 23 || minute > 59)) hour = null

  // ── ข้อความที่เหลือ ──
  const text = rest
    .replace(
      /^\s*(?:เตือน(?:ให้)?(?:ฉัน|ผม|เรา|หนู)?|อย่าลืม|remind me to|remind me|reminder:?|ให้)\s*/i,
      ' ',
    )
    .replace(/(?:^|\s)(?:ตอน|เวลา|เมื่อ|at|on|by|น\.)(?=\s|$)/gi, ' ')
    .replace(/(?:^|\s)(?:นะ|ด้วย)\s*$/, ' ')
    .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const scheduled =
    relative !== null ||
    repeat !== 'none' ||
    dayOffset !== null ||
    weekday !== null ||
    date !== null ||
    hour !== null
  if (!scheduled) return text ? { kind: 'todo', text, summary: `งาน: ${text}` } : null

  let at: number
  if (relative !== null) {
    at = now + relative
  } else {
    const h = hour ?? defaultHour
    const mm = hour === null ? 0 : minute
    if (date !== null) {
      at = atTime(date, h, mm)
      // วันที่ผ่านไปแล้ว: ไม่ระบุปี → ปีหน้า, ระบุแค่ "วันที่ N" → เดือนหน้า
      if (at <= now && !yearGiven) {
        const d = new Date(at)
        if (dayOfMonthOnly) d.setMonth(d.getMonth() + 1)
        else d.setFullYear(d.getFullYear() + 1)
        at = d.getTime()
      }
    } else if (weekday !== null) {
      const today = new Date(now).getDay()
      const ahead = (weekday - today + 7) % 7
      at = atTime(addDays(now, ahead), h, mm)
      if (ahead === 0 && at <= now) at = addDays(at, 7)
    } else {
      at = atTime(addDays(now, dayOffset ?? 0), h, mm)
      // ระบุแค่เวลาและเวลานั้นผ่านไปแล้ว → พรุ่งนี้
      if (dayOffset === null && at <= now) at = addDays(at, 1)
    }
    if (repeat === 'weekdays') while (isWeekend(at)) at = addDays(at, 1)
  }

  const label = text || 'ถึงเวลาแล้ว'
  const when =
    repeat !== 'none'
      ? describeRepeat({ at, repeat } as Parameters<typeof describeRepeat>[0])
      : relative !== null
        ? `${formatWhen(at, now)} (อีก ${formatDuration(relative)})`
        : formatWhen(at, now)
  return { kind: 'reminder', text: label, at, repeat, summary: `เตือน “${label}” ${when}` }
}
