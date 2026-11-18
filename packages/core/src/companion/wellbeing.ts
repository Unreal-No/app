import { dayKey, DAY } from './time'

/**
 * เตือนดูแลสุขภาพตามเวลาที่ "ใช้เครื่องต่อเนื่อง" (ไม่ใช่เวลานาฬิกา)
 * ผู้ใช้ลุกไปเกิน `AWAY_RESET` = ได้พักแล้ว ตัวนับเริ่มใหม่ — ไม่มีการเตือนซ้ำซ้อนหลังกลับมา
 */
export interface WellbeingSettings {
  /** พักสายตา 20-20-20 */
  eyes: boolean
  water: boolean
  stretch: boolean
  /** ดึกแล้วชวนพัก */
  night: boolean
}

/** ปิดทั้งหมดเป็นค่าเริ่มต้น: ผู้ใช้เลือกเปิดเองทีละอย่าง */
export const DEFAULT_WELLBEING_SETTINGS: WellbeingSettings = {
  eyes: false,
  water: false,
  stretch: false,
  night: false,
}

/** ทุกกี่วินาทีของการใช้เครื่อง */
export const WELLBEING_INTERVAL = { eyes: 20 * 60, water: 60 * 60, stretch: 50 * 60 }
/** ไม่ได้ใช้เครื่องนานเท่านี้ (วินาที) = ได้พักแล้ว */
export const AWAY_RESET = 5 * 60
/** ช่วงเวลา "ดึกแล้ว" */
export const NIGHT_FROM_HOUR = 23
export const NIGHT_UNTIL_HOUR = 4

export interface WellbeingState {
  /** วินาทีที่ใช้เครื่องตั้งแต่เตือนครั้งล่าสุดของแต่ละอย่าง */
  eyes: number
  water: number
  stretch: number
  cupsToday: number
  todayKey: string
  /** คืนล่าสุดที่เตือนเรื่องดึกแล้ว (รหัสวันของช่วงหัวค่ำ) */
  nightKey: string | null
}

export const createWellbeing = (now: number): WellbeingState => ({
  eyes: 0,
  water: 0,
  stretch: 0,
  cupsToday: 0,
  todayKey: dayKey(now),
  nightKey: null,
})

export type WellbeingPrompt = 'eyes' | 'water' | 'stretch' | 'night'

export interface WellbeingInput {
  now: number
  /** วินาทีที่ผ่านไปตั้งแต่ครั้งก่อน */
  dtSec: number
  /** วินาทีตั้งแต่ผู้ใช้แตะเมาส์/คีย์บอร์ดครั้งล่าสุด */
  idleSec: number
  /** กำลังโฟกัสอยู่: เลื่อนการเตือนดื่มน้ำ/ยืดเส้นไปไว้ช่วงพัก (พักสายตาสั้นจึงยังเตือน) */
  focusing?: boolean
}

export function tickWellbeing(
  state: WellbeingState,
  settings: WellbeingSettings,
  input: WellbeingInput,
): { state: WellbeingState; prompts: WellbeingPrompt[] } {
  const prompts: WellbeingPrompt[] = []
  let next = state
  const today = dayKey(input.now)
  if (next.todayKey !== today) next = { ...next, todayKey: today, cupsToday: 0 }

  if (input.idleSec >= AWAY_RESET) {
    if (next.eyes || next.water || next.stretch) next = { ...next, eyes: 0, water: 0, stretch: 0 }
    return { state: next, prompts }
  }

  next = { ...next }
  for (const key of ['eyes', 'water', 'stretch'] as const) {
    if (!settings[key]) {
      next[key] = 0
      continue
    }
    next[key] += input.dtSec
    if (next[key] < WELLBEING_INTERVAL[key]) continue
    if (input.focusing && key !== 'eyes') {
      // รอไว้จนกว่าจะพัก
      next[key] = WELLBEING_INTERVAL[key]
      continue
    }
    next[key] = 0
    prompts.push(key)
  }

  if (settings.night) {
    const hour = new Date(input.now).getHours()
    if (hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR) {
      // หลังเที่ยงคืนยังนับเป็น "คืนเดียวกัน" กับหัวค่ำ
      const night = hour < NIGHT_UNTIL_HOUR ? dayKey(input.now - DAY) : today
      if (next.nightKey !== night) {
        next.nightKey = night
        prompts.push('night')
      }
    }
  }
  return { state: next, prompts }
}

export const drinkWater = (state: WellbeingState): WellbeingState => ({
  ...state,
  cupsToday: state.cupsToday + 1,
  water: 0,
})
