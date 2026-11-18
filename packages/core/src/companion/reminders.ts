import { addDays, DAYS_TH, formatClock, isWeekend, MINUTE } from './time'

/** การทำซ้ำของนัด */
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly'

export interface Reminder {
  id: string
  text: string
  /** เวลานัดครั้งถัดไป (epoch ms) */
  at: number
  repeat: Repeat
  /** เตือนล่วงหน้ากี่นาที */
  lead: number[]
  /** ถูกเลื่อนไว้ถึงเวลานี้ (ใช้แทน `at` จนกว่าจะรับทราบ) */
  snoozedUntil?: number
  /** นัดครั้งเดียวที่รับทราบแล้ว */
  done: boolean
  createdAt: number
}

export const DEFAULT_LEAD = [10, 5, 1]
/** ถึงเวลาแล้วแต่แจ้งช้ากว่านี้ (เช่น เครื่องหลับอยู่) → ถือว่า "เลยเวลามาแล้ว" */
export const MISSED_AFTER = 2 * MINUTE

export function createReminder(
  id: string,
  text: string,
  at: number,
  repeat: Repeat = 'none',
  createdAt = Date.now(),
  lead: number[] = DEFAULT_LEAD,
): Reminder {
  return { id, text, at, repeat, lead: [...lead], done: false, createdAt }
}

/** เวลาที่จะแจ้งจริง (รวมการเลื่อน) */
export const effectiveAt = (reminder: Reminder): number => reminder.snoozedUntil ?? reminder.at

export interface ReminderAlert {
  reminderId: string
  /** lead = เตือนล่วงหน้า, due = ถึงเวลา, missed = เลยเวลามาแล้ว (แจ้งช้า) */
  kind: 'lead' | 'due' | 'missed'
  /** นาทีที่เหลือ (เฉพาะ lead) */
  minutes?: number
  /** เวลาที่การแจ้งเตือนนี้ควรเกิด */
  at: number
}

/**
 * การแจ้งเตือนที่ "ควรเกิด" ในช่วงเวลา (from, to] — เรียกซ้ำทุกวินาทีด้วยช่วงต่อกันจะไม่ซ้ำและไม่ตกหล่น
 * - ถ้าช่วงยาว (เครื่องหลับ/แอปปิดไป) แจ้งแค่สิ่งล่าสุดของแต่ละนัด ไม่ไล่แจ้งทุกครั้งที่พลาดไป
 * - นัดที่ถูกเลื่อนไม่มีการเตือนล่วงหน้า
 */
export function alertsBetween(reminders: Reminder[], from: number, to: number): ReminderAlert[] {
  const alerts: ReminderAlert[] = []
  if (to <= from) return alerts
  for (const reminder of reminders) {
    if (reminder.done) continue
    const due = effectiveAt(reminder)
    if (due > from && due <= to) {
      alerts.push({
        reminderId: reminder.id,
        kind: to - due > MISSED_AFTER ? 'missed' : 'due',
        at: due,
      })
      continue
    }
    if (reminder.snoozedUntil !== undefined || due <= to) continue
    // เตือนล่วงหน้า: เลือกอันที่ใกล้เวลานัดที่สุดในช่วงนี้
    let best: ReminderAlert | null = null
    for (const minutes of reminder.lead) {
      const at = due - minutes * MINUTE
      if (at > from && at <= to && (!best || minutes < (best.minutes ?? Infinity)))
        best = { reminderId: reminder.id, kind: 'lead', minutes, at }
    }
    if (best) alerts.push(best)
  }
  return alerts.sort((a, b) => a.at - b.at)
}

/** นัดที่ถึงเวลาแล้วแต่ผู้ใช้ยังไม่รับทราบ (เช่น ป้ายที่ค้างอยู่ตอนเปิดแอปใหม่) */
export const overdue = (reminders: Reminder[], now: number): Reminder[] =>
  reminders
    .filter((r) => !r.done && effectiveAt(r) <= now)
    .sort((a, b) => effectiveAt(a) - effectiveAt(b))

/** นัดที่ยังมาไม่ถึง เรียงจากใกล้ไปไกล */
export const upcoming = (reminders: Reminder[], now: number): Reminder[] =>
  reminders
    .filter((r) => !r.done && effectiveAt(r) > now)
    .sort((a, b) => effectiveAt(a) - effectiveAt(b))

/** เวลานัดครั้งถัดไปที่อยู่หลัง `after` (นัดครั้งเดียวคืนเวลาเดิม) */
export function nextOccurrence(reminder: Reminder, after: number): number {
  if (reminder.repeat === 'none') return reminder.at
  let at = reminder.at
  // ข้ามรอบที่ผ่านไปแล้วทีละรอบ (ใช้ปฏิทินท้องถิ่น); จำกัดรอบกันวนไม่จบถ้าข้อมูลผิดปกติ
  for (
    let guard = 0;
    guard < 4000 && (at <= after || (reminder.repeat === 'weekdays' && isWeekend(at)));
    guard++
  ) {
    at = addDays(at, reminder.repeat === 'weekly' ? 7 : 1)
  }
  return at
}

/** เลื่อนการแจ้งออกไป n นาทีจากตอนนี้ */
export const snooze = (reminder: Reminder, now: number, minutes: number): Reminder => ({
  ...reminder,
  snoozedUntil: now + minutes * MINUTE,
})

/** รับทราบ: นัดครั้งเดียว → เสร็จ, นัดซ้ำ → เลื่อนไปรอบถัดไป */
export function acknowledge(reminder: Reminder, now: number): Reminder {
  const { snoozedUntil: _snoozed, ...rest } = reminder
  if (reminder.repeat === 'none') return { ...rest, done: true }
  return { ...rest, at: nextOccurrence(reminder, Math.max(now, reminder.at)) }
}

/** คำอธิบายการทำซ้ำ: "ทุกวัน 12:00", "ทุกวันจันทร์ 10:00" */
export function describeRepeat(reminder: Reminder): string {
  const clock = formatClock(reminder.at)
  switch (reminder.repeat) {
    case 'daily':
      return `ทุกวัน ${clock}`
    case 'weekdays':
      return `ทุกวันทำงาน ${clock}`
    case 'weekly':
      return `ทุกวัน${DAYS_TH[new Date(reminder.at).getDay()]} ${clock}`
    default:
      return ''
  }
}
