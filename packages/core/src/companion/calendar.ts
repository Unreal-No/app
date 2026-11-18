import ICAL from 'ical.js'
import { DEFAULT_LEAD, type Reminder } from './reminders'
import { DAY, MINUTE } from './time'

/**
 * ปฏิทินจากลิงก์ ICS (Google "ที่อยู่ลับในรูปแบบ iCal", Outlook "เผยแพร่ปฏิทิน")
 * การอ่านไฟล์และขยายนัดซ้ำใช้ ical.js (รองรับ VTIMEZONE, RRULE, EXDATE, RECURRENCE-ID)
 * ส่วนที่เหลือเป็นฟังก์ชันบริสุทธิ์ที่รับเวลาจริง (epoch ms)
 */

/** ปฏิทินที่ผู้ใช้เพิ่มไว้ — `url` เป็นความลับ (ใครมีลิงก์อ่านปฏิทินได้) เก็บเฉพาะในเครื่อง */
export interface CalendarSource {
  id: string
  name: string
  url: string
  enabled: boolean
  /** ซิงก์สำเร็จครั้งล่าสุด */
  lastSync?: number
  /** ข้อความผิดพลาดของการซิงก์ครั้งล่าสุด (ไม่มี = สำเร็จ) */
  lastError?: string
}

export interface CalendarEvent {
  /** รหัสของ "รอบ" นี้ (นัดซ้ำแต่ละรอบมีรหัสต่างกัน) */
  id: string
  calendarId: string
  uid: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  /** false = ทำเครื่องหมายว่า "ว่าง" (TRANSP:TRANSPARENT) — ไม่นับเป็นช่วงประชุม */
  busy: boolean
}

/** สถานะที่ผู้ใช้ตอบป้ายของนัดในปฏิทิน (ต่อรอบ) */
export interface CalendarAck {
  /** เวลาเริ่มของรอบนั้น — ใช้ล้างของเก่า */
  start: number
  done?: boolean
  snoozedUntil?: number
}

/** ช่วงเวลาที่เก็บนัดไว้ใช้ (รวมตอนออฟไลน์) */
export const CALENDAR_PAST = DAY
export const CALENDAR_AHEAD = 14 * DAY
export const MAX_CALENDAR_EVENTS = 400
/** ไม่ขยายนัดซ้ำเกินจำนวนรอบนี้ต่อหนึ่งนัด (กันไฟล์ผิดปกติทำให้ค้าง) */
const MAX_OCCURRENCES = 20_000

// ───────── เขตเวลา ─────────
/** ชื่อเขตเวลาแบบ Windows ที่ Outlook ใช้ → IANA (ใช้เมื่อไฟล์ไม่มี VTIMEZONE ของชื่อนั้น) */
const WINDOWS_ZONES: Record<string, string> = {
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Myanmar Standard Time': 'Asia/Yangon',
  'Singapore Standard Time': 'Asia/Singapore',
  'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'India Standard Time': 'Asia/Kolkata',
  'Arabian Standard Time': 'Asia/Dubai',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()
function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(
        zone,
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        }),
      )
    } catch {
      formatters.set(zone, null)
    }
  }
  return formatters.get(zone) ?? null
}

/** ชื่อเขตเวลา IANA ที่ใช้ได้จริง (รับทั้งชื่อ IANA และชื่อแบบ Windows) */
export function resolveZone(tzid: string): string | null {
  const name = tzid.replace(/^"|"$/g, '').trim()
  if (formatterFor(name)) return name
  const mapped = WINDOWS_ZONES[name]
  return mapped && formatterFor(mapped) ? mapped : null
}

/** ส่วนต่าง (ms) ระหว่างเวลาตามนาฬิกาในเขตนั้นกับ UTC ณ ขณะ `ms` */
function zoneOffset(ms: number, zone: string): number {
  const parts = formatterFor(zone)!.formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** เวลาตามนาฬิกาในเขต `zone` → epoch ms */
export function wallTimeToEpoch(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  let at = guess - zoneOffset(guess, zone)
  // ช่วงเปลี่ยนเวลาออมแสง: ปรับอีกรอบด้วยส่วนต่าง ณ เวลาที่ได้
  at = guess - zoneOffset(at, zone)
  return at
}

type IcalTime = InstanceType<typeof ICAL.Time>

/** แปลงเวลา ical.js → epoch ms (ทั้งวัน = เที่ยงคืนตามเวลาเครื่อง) */
function toEpoch(time: IcalTime): number {
  if (time.isDate) return new Date(time.year, time.month - 1, time.day).getTime()
  const tzid = (time as unknown as { timezone?: string }).timezone
  const floating = !time.zone || time.zone.tzid === 'floating'
  if (floating && tzid) {
    const zone = resolveZone(tzid)
    if (zone)
      return wallTimeToEpoch(
        zone,
        time.year,
        time.month,
        time.day,
        time.hour,
        time.minute,
        time.second,
      )
  }
  if (floating) {
    // ไม่มีเขตเวลา = เวลาตามเครื่องผู้ใช้
    return new Date(
      time.year,
      time.month - 1,
      time.day,
      time.hour,
      time.minute,
      time.second,
    ).getTime()
  }
  return time.toJSDate().getTime()
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * นัดทั้งหมดในไฟล์ ICS ที่ "ทับ" ช่วง [from, to) — ขยายนัดซ้ำ ตัดรอบที่ยกเลิก ใช้รอบที่ถูกแก้แทนรอบเดิม
 * นัดที่อ่านไม่ได้ถูกข้ามทีละรายการ; ไฟล์ที่ไม่ใช่ปฏิทินเลยจะโยนข้อผิดพลาด
 */
export function calendarEvents(
  ics: string,
  calendarId: string,
  from: number,
  to: number,
): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error('ไม่ใช่ไฟล์ปฏิทิน (ICS)')
  const root = new ICAL.Component(ICAL.parse(ics))
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    try {
      const tzid = text(vtimezone.getFirstPropertyValue('tzid'))
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(vtimezone)
    } catch {
      // เขตเวลาที่อ่านไม่ได้ → เวลาในเขตนั้นจะใช้ตารางชื่อ/เวลาเครื่องแทน
    }
  }

  // แยกนัดหลักกับ "รอบที่ถูกแก้" (มี RECURRENCE-ID) แล้วผูกเข้าด้วยกัน
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>()
  const exceptions: InstanceType<typeof ICAL.Event>[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    try {
      const event = new ICAL.Event(vevent)
      if (!event.uid || !event.startDate) continue
      if (event.isRecurrenceException()) exceptions.push(event)
      else masters.set(event.uid, event)
    } catch {
      // ข้ามนัดที่เสีย
    }
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid)
    try {
      if (master) master.relateException(exception)
      else masters.set(`${exception.uid}#${exception.recurrenceId}`, exception)
    } catch {
      // ข้าม
    }
  }

  const events: CalendarEvent[] = []
  const push = (
    item: InstanceType<typeof ICAL.Event>,
    startTime: IcalTime,
    endTime: IcalTime | null,
  ): void => {
    const status = text(item.component.getFirstPropertyValue('status')).toUpperCase()
    if (status === 'CANCELLED') return
    const allDay = startTime.isDate
    const start = toEpoch(startTime)
    let end = endTime ? toEpoch(endTime) : start
    if (allDay && end <= start) end = start + DAY
    if (end < start) end = start
    if (end <= from || start >= to) return
    const transp = text(item.component.getFirstPropertyValue('transp')).toUpperCase()
    const location = text(item.location)
    events.push({
      id: `${calendarId}:${item.uid}@${start}`,
      calendarId,
      uid: item.uid,
      title: text(item.summary) || '(ไม่มีชื่อนัด)',
      start,
      end,
      allDay,
      ...(location ? { location } : {}),
      busy: transp !== 'TRANSPARENT',
    })
  }

  for (const event of masters.values()) {
    try {
      if (!event.isRecurring()) {
        push(event, event.startDate, event.endDate)
        continue
      }
      const iterator = event.iterator()
      for (let n = 0; n < MAX_OCCURRENCES; n++) {
        const next = iterator.next()
        if (!next) break
        const details = event.getOccurrenceDetails(next)
        if (toEpoch(details.startDate) >= to) break
        push(details.item, details.startDate, details.endDate)
      }
    } catch {
      // ข้ามนัดที่ขยายไม่ได้
    }
  }
  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
  return events.slice(0, MAX_CALENDAR_EVENTS)
}

/** แทนที่นัดของปฏิทินหนึ่งในแคชด้วยชุดใหม่ (ปฏิทินอื่นคงเดิม) */
export function replaceCalendarEvents(
  cache: CalendarEvent[],
  calendarId: string,
  fresh: CalendarEvent[],
): CalendarEvent[] {
  return [...cache.filter((e) => e.calendarId !== calendarId), ...fresh]
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CALENDAR_EVENTS)
}

/** นัดในปฏิทินในรูปแบบ `Reminder` เพื่อใช้ระบบเตือนล่วงหน้าเดิม (`alertsBetween`) */
export function calendarReminders(
  events: CalendarEvent[],
  acks: Record<string, CalendarAck>,
): Reminder[] {
  return events
    .filter((e) => !e.allDay)
    .map((e) => {
      const ack = acks[e.id]
      return {
        id: e.id,
        text: e.location ? `${e.title} · ${e.location}` : e.title,
        at: e.start,
        repeat: 'none' as const,
        lead: DEFAULT_LEAD,
        ...(ack?.snoozedUntil !== undefined ? { snoozedUntil: ack.snoozedUntil } : {}),
        done: ack?.done === true,
        createdAt: 0,
      }
    })
}

/**
 * นัดที่ควรมีป้ายบนจอตอนนี้: ถึงเวลา (หรือเลื่อนครบแล้ว) และยัง**ไม่จบ** —
 * นัดที่จบไปแล้วตอนเปิดเครื่องตอนเช้าไม่ต้องไล่แจ้งทีละนัด
 */
export function calendarDue(
  events: CalendarEvent[],
  acks: Record<string, CalendarAck>,
  now: number,
): CalendarEvent[] {
  return events.filter((e) => {
    if (e.allDay) return false
    const ack = acks[e.id]
    if (ack?.done) return false
    const at = ack?.snoozedUntil ?? e.start
    return at <= now && now < Math.max(e.end, at + MINUTE)
  })
}

/** นัด "ไม่ว่าง" ที่กำลังดำเนินอยู่ (ไม่นับนัดทั้งวัน) */
export const meetingNow = (events: CalendarEvent[], now: number): CalendarEvent | null =>
  events.find((e) => e.busy && !e.allDay && e.start <= now && now < e.end) ?? null

/** นัดที่ยังไม่จบ เรียงตามเวลาเริ่ม */
export const upcomingEvents = (events: CalendarEvent[], now: number): CalendarEvent[] =>
  events.filter((e) => e.end > now)

/** ล้างสถานะป้ายของนัดที่ผ่านไปนานแล้ว */
export function pruneAcks(
  acks: Record<string, CalendarAck>,
  now: number,
): Record<string, CalendarAck> {
  const kept: Record<string, CalendarAck> = {}
  for (const [id, ack] of Object.entries(acks)) if (ack.start >= now - 2 * DAY) kept[id] = ack
  return kept
}

/** แสดงลิงก์แบบไม่เปิดเผยส่วนที่เป็นความลับ: "calendar.google.com/…/basic.ics" */
export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url.replace(/^webcal:/i, 'https:'))
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
    return last
      ? `${parsed.host}/…/${last.length > 24 ? `${last.slice(0, 6)}…` : last}`
      : parsed.host
  } catch {
    return 'ลิงก์ไม่ถูกต้อง'
  }
}

/** ตรวจลิงก์ก่อนบันทึก: ต้องเป็น https:// หรือ webcal:// */
export function normalizeCalendarUrl(input: string): string | null {
  const trimmed = input.trim()
  const candidate = trimmed.replace(/^webcals?:\/\//i, 'https://')
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}
