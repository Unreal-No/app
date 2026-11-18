import { dayKey, MINUTE } from './time'

/**
 * จับเวลาโฟกัสแบบ Pomodoro: โฟกัส → พัก → … ทุก N รอบพักยาว
 * ขึ้นกับเวลาจริง (epoch ms) อย่างเดียว จึงถูกต้องแม้หน้าจอถูกซ่อนหรือเครื่องช้า
 */
export interface FocusSettings {
  focusMin: number
  breakMin: number
  longBreakMin: number
  /** พักยาวทุกกี่รอบโฟกัส */
  longEvery: number
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
}

export type FocusPhase = 'idle' | 'focus' | 'break' | 'longBreak'

export interface FocusState {
  phase: FocusPhase
  /** เวลาสิ้นสุดช่วงปัจจุบัน (null = ไม่ได้จับเวลา หรือหยุดชั่วคราว) */
  endsAt: number | null
  /** เวลาที่เหลือตอนหยุดชั่วคราว (ms) */
  pausedLeft: number | null
  /** รอบโฟกัสที่สำเร็จในชุดปัจจุบัน (นับเพื่อพักยาว) */
  cycle: number
  /** รอบโฟกัสที่สำเร็จวันนี้ */
  todayCount: number
  todayKey: string
  totalCount: number
}

export const createFocus = (now: number): FocusState => ({
  phase: 'idle',
  endsAt: null,
  pausedLeft: null,
  cycle: 0,
  todayCount: 0,
  todayKey: dayKey(now),
  totalCount: 0,
})

/** ช่วงที่จบไปนานกว่านี้ตอนเปิดแอปใหม่ → ไม่นับว่าสำเร็จ (ผู้ใช้น่าจะเลิกไปแล้ว) */
export const STALE_AFTER = 60 * MINUTE

const minutesOf = (phase: FocusPhase, s: FocusSettings): number =>
  phase === 'focus'
    ? s.focusMin
    : phase === 'break'
      ? s.breakMin
      : phase === 'longBreak'
        ? s.longBreakMin
        : 0

export function startFocus(state: FocusState, now: number, settings: FocusSettings): FocusState {
  return { ...state, phase: 'focus', endsAt: now + settings.focusMin * MINUTE, pausedLeft: null }
}

export function startBreak(state: FocusState, now: number, settings: FocusSettings): FocusState {
  const long = state.cycle > 0 && state.cycle % settings.longEvery === 0
  const phase: FocusPhase = long ? 'longBreak' : 'break'
  return { ...state, phase, endsAt: now + minutesOf(phase, settings) * MINUTE, pausedLeft: null }
}

export function pauseFocus(state: FocusState, now: number): FocusState {
  if (state.endsAt === null) return state
  return { ...state, endsAt: null, pausedLeft: Math.max(0, state.endsAt - now) }
}

export function resumeFocus(state: FocusState, now: number): FocusState {
  if (state.pausedLeft === null) return state
  return { ...state, endsAt: now + state.pausedLeft, pausedLeft: null }
}

export const stopFocus = (state: FocusState): FocusState => ({
  ...state,
  phase: 'idle',
  endsAt: null,
  pausedLeft: null,
})

export const isPaused = (state: FocusState): boolean => state.pausedLeft !== null

/** เวลาที่เหลือของช่วงปัจจุบัน (ms) */
export function focusRemaining(state: FocusState, now: number): number {
  if (state.pausedLeft !== null) return state.pausedLeft
  return state.endsAt === null ? 0 : Math.max(0, state.endsAt - now)
}

/** ความคืบหน้าของช่วงปัจจุบัน 0..1 */
export function focusProgress(state: FocusState, now: number, settings: FocusSettings): number {
  const total = minutesOf(state.phase, settings) * MINUTE
  return total > 0 ? 1 - focusRemaining(state, now) / total : 0
}

export type FocusEvent = 'focusDone' | 'breakDone' | 'expired'

/**
 * เดินเวลา: จบโฟกัส → เริ่มพักต่อทันที (`focusDone`); จบพัก → กลับเป็นว่าง (`breakDone`)
 * ช่วงที่จบไปนานเกิน `STALE_AFTER` (เช่น ปิดแอปข้ามคืน) → รีเซ็ตเงียบๆ (`expired`)
 */
export function tickFocus(
  state: FocusState,
  now: number,
  settings: FocusSettings,
): { state: FocusState; event: FocusEvent | null } {
  let next = state
  if (next.todayKey !== dayKey(now)) next = { ...next, todayKey: dayKey(now), todayCount: 0 }
  if (next.endsAt === null || now < next.endsAt) return { state: next, event: null }

  if (now - next.endsAt > STALE_AFTER)
    return { state: { ...stopFocus(next), cycle: 0 }, event: 'expired' }

  if (next.phase === 'focus') {
    const done = {
      ...next,
      cycle: next.cycle + 1,
      todayCount: next.todayCount + 1,
      totalCount: next.totalCount + 1,
    }
    // พักเริ่มนับจากเวลาที่โฟกัสจบจริง ไม่ใช่เวลาที่ตรวจพบ
    return { state: startBreak(done, next.endsAt, settings), event: 'focusDone' }
  }
  const finished = stopFocus(next)
  return {
    state: next.phase === 'longBreak' ? { ...finished, cycle: 0 } : finished,
    event: 'breakDone',
  }
}
