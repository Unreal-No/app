import {
  alertsBetween,
  CALENDAR_AHEAD,
  CALENDAR_PAST,
  calendarDue,
  calendarEvents,
  calendarReminders,
  companionId,
  formatClock,
  maskUrl,
  meetingNow,
  MINUTE,
  normalizeCalendarUrl,
  pruneAcks,
  replaceCalendarEvents,
  type CalendarEvent,
  type CalendarSource,
} from '@mochimon/core'
import { updateCompanion } from './assist'
import { fetchCalendar, type Alarm } from './bridge'
import { companion } from './game'
import { dismissSignsWhere, messenger, showSign, signCarrier } from './signs'
import { mode } from './world'

/**
 * ปฏิทินจริงจากลิงก์ ICS: ซิงก์เป็นระยะ, เตือนล่วงหน้า/ป้ายตอนเริ่มนัด, เงียบระหว่างประชุม
 * การอ่านไฟล์และตรรกะเวลาอยู่ใน `@mochimon/core` (มี unit test) — โมดูลนี้ต่อเข้ากับสัตว์บนจอ
 */
const SYNC_EVERY = 15 * MINUTE
/** ลองใหม่เร็วขึ้นเมื่อซิงก์ล้มเหลว (เช่น เน็ตหลุดชั่วคราว) */
const RETRY_AFTER = 3 * MINUTE

const syncing = new Set<string>()
const lastAttempt = new Map<string, number>()

// ───────── จัดการปฏิทิน ─────────
/** เพิ่มปฏิทินจากลิงก์ — คืนข้อความผิดพลาด หรือ null ถ้าสำเร็จ */
export function addCalendar(name: string, link: string): string | null {
  const url = normalizeCalendarUrl(link)
  if (!url) return 'ใช้ได้เฉพาะลิงก์ https:// หรือ webcal:// ของปฏิทิน (ICS)'
  if (companion.calendars.some((c) => c.url === url)) return 'เพิ่มปฏิทินนี้ไว้แล้ว'
  if (companion.calendars.length >= 10) return 'เพิ่มได้สูงสุด 10 ปฏิทิน'
  const id = companionId(
    'cal',
    companion.calendars.map((c) => c.id),
  )
  const source: CalendarSource = {
    id,
    name: name.trim().slice(0, 40) || 'ปฏิทิน',
    url,
    enabled: true,
  }
  updateCompanion((c) => ({ ...c, calendars: [...c.calendars, source] }))
  void syncCalendar(id)
  return null
}

export function removeCalendar(id: string): void {
  updateCompanion((c) => ({
    ...c,
    calendars: c.calendars.filter((s) => s.id !== id),
    calendarEvents: c.calendarEvents.filter((e) => e.calendarId !== id),
  }))
  dismissSignsWhere((key) => key.startsWith(`cal:${id}:`))
}

export function setCalendarEnabled(id: string, enabled: boolean): void {
  updateCompanion((c) => ({
    ...c,
    calendars: c.calendars.map((s) => (s.id === id ? { ...s, enabled } : s)),
    // ปิดแล้วไม่เตือนนัดของปฏิทินนี้อีก (เปิดใหม่จะซิงก์ใหม่)
    calendarEvents: enabled
      ? c.calendarEvents
      : c.calendarEvents.filter((e) => e.calendarId !== id),
  }))
  if (enabled) void syncCalendar(id)
  else dismissSignsWhere((key) => key.startsWith(`cal:${id}:`))
}

export const setMeetingQuiet = (on: boolean): void =>
  updateCompanion((c) => ({ ...c, meetingQuiet: on }))

export const isSyncing = (id: string): boolean => syncing.has(id)
export const calendarLabel = (source: CalendarSource): string => maskUrl(source.url)

/** ดึงปฏิทินหนึ่งรายการ — ล้มเหลวแล้วใช้นัดในแคชเดิมต่อ พร้อมเก็บข้อความผิดพลาดไว้แสดง */
export async function syncCalendar(id: string): Promise<void> {
  const source = companion.calendars.find((s) => s.id === id)
  if (!source || !source.enabled || syncing.has(id)) return
  syncing.add(id)
  lastAttempt.set(id, Date.now())
  updateCompanion((c) => c, false)
  try {
    const text = await fetchCalendar(source.url)
    const now = Date.now()
    const events = calendarEvents(text, id, now - CALENDAR_PAST, now + CALENDAR_AHEAD)
    updateCompanion((c) => ({
      ...c,
      calendars: c.calendars.map((s) =>
        s.id === id ? { ...s, lastSync: now, lastError: undefined } : s,
      ),
      calendarEvents: replaceCalendarEvents(c.calendarEvents, id, events),
      calendarAcks: pruneAcks(c.calendarAcks, now),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateCompanion((c) => ({
      ...c,
      calendars: c.calendars.map((s) =>
        s.id === id ? { ...s, lastError: message.slice(0, 200) } : s,
      ),
    }))
  } finally {
    syncing.delete(id)
    updateCompanion((c) => c, false)
  }
}

export function syncAllCalendars(): void {
  for (const source of companion.calendars) if (source.enabled) void syncCalendar(source.id)
}

// ───────── เตือนนัดในปฏิทิน ─────────
function acknowledgeEvent(event: CalendarEvent): void {
  updateCompanion((c) => ({
    ...c,
    calendarAcks: { ...c.calendarAcks, [event.id]: { start: event.start, done: true } },
  }))
}

function snoozeEvent(event: CalendarEvent, minutes: number): void {
  updateCompanion((c) => ({
    ...c,
    calendarAcks: {
      ...c.calendarAcks,
      [event.id]: { start: event.start, snoozedUntil: Date.now() + minutes * MINUTE },
    },
  }))
}

function eventSign(event: CalendarEvent): void {
  const at = companion.calendarAcks[event.id]?.snoozedUntil ?? event.start
  const started = Date.now() - event.start > 2 * MINUTE
  showSign({
    key: `cal:${event.id}@${at}`,
    icon: '📅',
    title: event.title,
    body: [
      started ? `เริ่มไปแล้วตั้งแต่ ${formatClock(event.start)}` : `เริ่ม ${formatClock(event.start)}`,
      `ถึง ${formatClock(event.end)}`,
      event.location,
    ]
      .filter(Boolean)
      .join(' · '),
    buttons: [
      { label: 'รับทราบ', primary: true, onClick: () => acknowledgeEvent(event) },
      { label: 'อีก 5 นาที', onClick: () => snoozeEvent(event, 5) },
    ],
  })
}

/**
 * ตรวจนัดในปฏิทินในช่วง (from, now] — เรียกจากวงรอบของผู้ช่วยทุก 1 วินาที
 * คืนว่า "ตอนนี้อยู่ในช่วงประชุม" หรือไม่ (ใช้ให้สัตว์เงียบ)
 */
export function tickCalendars(from: number, now: number): boolean {
  const { calendarEvents: events, calendarAcks: acks } = companion
  const reminders = calendarReminders(events, acks)
  for (const alert of alertsBetween(reminders, from, now)) {
    if (alert.kind !== 'lead') continue
    const reminder = reminders.find((r) => r.id === alert.reminderId)
    const pet = messenger()
    if (reminder && pet && pet !== signCarrier())
      pet.say(`อีก ${alert.minutes} นาที: ${reminder.text}`, 6)
  }
  for (const event of calendarDue(events, acks, now)) eventSign(event)

  // ซิงก์ตามรอบ (ล้มเหลวแล้วลองใหม่เร็วขึ้น)
  for (const source of companion.calendars) {
    if (!source.enabled || syncing.has(source.id)) continue
    const last = lastAttempt.get(source.id) ?? 0
    const wait = source.lastError ? RETRY_AFTER : SYNC_EVERY
    if (now - last >= wait) void syncCalendar(source.id)
  }

  const meeting = companion.meetingQuiet ? meetingNow(events, now) : null
  if (meeting && !mode.meeting) messenger()?.say('ประชุมอยู่ จะเงียบๆ นะ', 3)
  mode.meeting = meeting !== null
  return mode.meeting
}

/** นัดในปฏิทินที่ส่งให้ฝั่ง Rust แจ้งเตือนตอนหน้าต่างถูกซ่อน */
export function calendarAlarms(now: number): Alarm[] {
  return calendarReminders(companion.calendarEvents, companion.calendarAcks)
    .filter((r) => !r.done && (r.snoozedUntil ?? r.at) > now)
    .map((r) => ({
      id: r.id,
      atMs: r.snoozedUntil ?? r.at,
      title: 'Mochimon — ถึงเวลานัด',
      body: r.text,
    }))
}
