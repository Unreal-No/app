import { clamp } from '../rng'
import {
  createFocus,
  DEFAULT_FOCUS_SETTINGS,
  type FocusPhase,
  type FocusSettings,
  type FocusState,
} from './focus'
import { DEFAULT_LEAD, type Reminder, type Repeat } from './reminders'
import {
  createWellbeing,
  DEFAULT_WELLBEING_SETTINGS,
  type WellbeingSettings,
  type WellbeingState,
} from './wellbeing'

export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  doneAt?: number
}

/** ข้อมูลผู้ช่วยทำงานทั้งหมด (ส่วนที่เซฟ) */
export interface CompanionState {
  reminders: Reminder[]
  todos: Todo[]
  focus: FocusState
  focusSettings: FocusSettings
  wellbeing: WellbeingState
  wellbeingSettings: WellbeingSettings
  /** เวลาที่ตรวจการแจ้งเตือนครั้งล่าสุด — เปิดแอปใหม่จะได้รู้ว่าพลาดอะไรไประหว่างปิด */
  lastCheck: number
}

export function createCompanion(now: number): CompanionState {
  return {
    reminders: [],
    todos: [],
    focus: createFocus(now),
    focusSettings: { ...DEFAULT_FOCUS_SETTINGS },
    wellbeing: createWellbeing(now),
    wellbeingSettings: { ...DEFAULT_WELLBEING_SETTINGS },
    lastCheck: now,
  }
}

/** สร้างรหัสสั้นๆ ที่ไม่ซ้ำกับที่มีอยู่ */
export function companionId(prefix: string, taken: Iterable<string>, seed = Date.now()): string {
  const used = new Set(taken)
  for (let n = 0; ; n++) {
    const id = `${prefix}-${(seed + n).toString(36)}`
    if (!used.has(id)) return id
  }
}

// ───────── ซ่อมข้อมูลจากเซฟ ─────────
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const str = (value: unknown, max = 200): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null
const REPEATS: Repeat[] = ['none', 'daily', 'weekdays', 'weekly']
const PHASES: FocusPhase[] = ['idle', 'focus', 'break', 'longBreak']
const MAX_ITEMS = 500

function repairReminder(raw: unknown): Reminder | null {
  if (!isObject(raw)) return null
  const id = str(raw.id, 64)
  const text = str(raw.text)
  if (!id || !text || !finite(raw.at)) return null
  const lead = Array.isArray(raw.lead)
    ? raw.lead.filter((m): m is number => finite(m) && m > 0 && m <= 24 * 60).slice(0, 5)
    : DEFAULT_LEAD
  return {
    id,
    text,
    at: raw.at,
    repeat: REPEATS.includes(raw.repeat as Repeat) ? (raw.repeat as Repeat) : 'none',
    lead,
    ...(finite(raw.snoozedUntil) ? { snoozedUntil: raw.snoozedUntil } : {}),
    done: raw.done === true,
    createdAt: finite(raw.createdAt) ? raw.createdAt : raw.at,
  }
}

function repairTodo(raw: unknown): Todo | null {
  if (!isObject(raw)) return null
  const id = str(raw.id, 64)
  const text = str(raw.text)
  if (!id || !text) return null
  return {
    id,
    text,
    done: raw.done === true,
    createdAt: finite(raw.createdAt) ? raw.createdAt : 0,
    ...(finite(raw.doneAt) ? { doneAt: raw.doneAt } : {}),
  }
}

/** รายการที่ไม่ซ้ำรหัส (ตัวที่ซ่อมไม่ได้ถูกทิ้งทีละรายการ ไม่ทำให้ทั้งเซฟเสีย) */
function repairList<T extends { id: string }>(raw: unknown, repair: (r: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const list: T[] = []
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    const item = repair(entry)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    list.push(item)
  }
  return list
}

function repairNumbers<T extends object>(raw: unknown, base: T, min: number, max: number): T {
  const out = { ...base }
  if (!isObject(raw)) return out
  for (const key of Object.keys(base) as (keyof T)[]) {
    const value = raw[key as string]
    if (finite(value)) (out[key] as unknown as number) = clamp(value, min, max)
  }
  return out
}

function repairFlags<T extends object>(raw: unknown, base: T): T {
  const out = { ...base }
  if (!isObject(raw)) return out
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (typeof raw[key as string] === 'boolean')
      (out[key] as unknown as boolean) = raw[key as string] as boolean
  }
  return out
}

export function repairCompanion(raw: unknown, now: number): CompanionState {
  const base = createCompanion(now)
  if (!isObject(raw)) return base
  const focusRaw = isObject(raw.focus) ? raw.focus : {}
  const wellRaw = isObject(raw.wellbeing) ? raw.wellbeing : {}
  const counts = repairNumbers(
    focusRaw,
    { cycle: 0, todayCount: 0, totalCount: 0 },
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const phase = PHASES.includes(focusRaw.phase as FocusPhase)
    ? (focusRaw.phase as FocusPhase)
    : 'idle'
  const endsAt = finite(focusRaw.endsAt) ? focusRaw.endsAt : null
  const pausedLeft = finite(focusRaw.pausedLeft) ? Math.max(0, focusRaw.pausedLeft) : null
  const running = phase !== 'idle' && (endsAt !== null || pausedLeft !== null)
  return {
    reminders: repairList(raw.reminders, repairReminder),
    todos: repairList(raw.todos, repairTodo),
    focus: {
      ...base.focus,
      ...counts,
      phase: running ? phase : 'idle',
      endsAt: running ? endsAt : null,
      pausedLeft: running && endsAt === null ? pausedLeft : null,
      todayKey: str(focusRaw.todayKey, 16) ?? base.focus.todayKey,
    },
    focusSettings: {
      ...repairNumbers(raw.focusSettings, DEFAULT_FOCUS_SETTINGS, 1, 180),
      longEvery: Math.round(
        repairNumbers(raw.focusSettings, { longEvery: DEFAULT_FOCUS_SETTINGS.longEvery }, 1, 12)
          .longEvery,
      ),
    },
    wellbeing: {
      ...base.wellbeing,
      ...repairNumbers(wellRaw, { eyes: 0, water: 0, stretch: 0, cupsToday: 0 }, 0, 24 * 3600),
      todayKey: str(wellRaw.todayKey, 16) ?? base.wellbeing.todayKey,
      nightKey: str(wellRaw.nightKey, 16),
    },
    wellbeingSettings: repairFlags(raw.wellbeingSettings, DEFAULT_WELLBEING_SETTINGS),
    lastCheck: finite(raw.lastCheck) ? Math.min(raw.lastCheck, now) : now,
  }
}
