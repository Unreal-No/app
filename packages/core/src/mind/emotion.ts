import type { Temperament } from '../genetics/types'
import { clamp, lerp } from '../rng'
import { NEED_KEYS, type Needs } from './needs'

/**
 * อารมณ์ 2 ชั้น
 * - emotion ระยะสั้น: valence (ลบ↔บวก) + arousal (สงบ↔ตื่นตัว) เปลี่ยนเร็วตามเหตุการณ์
 * - mood ระยะยาว: ค่าเฉลี่ยเคลื่อนที่ของ valence (ชั่วโมง–วัน)
 */
export interface EmotionState {
  valence: number
  arousal: number
  mood: number
}

export const neutralEmotion = (): EmotionState => ({ valence: 0.2, arousal: 0.4, mood: 0.2 })

export type EmotionEvent =
  | 'petted'
  | 'fed'
  | 'treat'
  | 'played'
  | 'bathed'
  | 'pickedUp'
  | 'dropped'
  | 'startled'
  | 'ignored'
  | 'greeted'
  | 'scolded'

const BASE_IMPACT: Record<EmotionEvent, { v: number; a: number }> = {
  petted: { v: 0.3, a: 0.1 },
  fed: { v: 0.25, a: 0.1 },
  treat: { v: 0.35, a: 0.25 },
  played: { v: 0.35, a: 0.4 },
  bathed: { v: -0.05, a: 0.2 },
  pickedUp: { v: 0.05, a: 0.35 },
  dropped: { v: -0.2, a: 0.5 },
  startled: { v: -0.25, a: 0.6 },
  ignored: { v: -0.15, a: -0.1 },
  greeted: { v: 0.25, a: 0.3 },
  scolded: { v: -0.4, a: 0.2 },
}

/** ประเมินเหตุการณ์ผ่านนิสัย: เหตุการณ์เดียวกัน สัตว์แต่ละตัวรู้สึกไม่เท่ากัน */
export function applyEvent(
  state: EmotionState,
  event: EmotionEvent,
  temper: Temperament,
): EmotionState {
  let { v, a } = BASE_IMPACT[event]
  switch (event) {
    case 'petted':
    case 'greeted':
      v *= 0.6 + temper.affection * 0.9
      break
    case 'pickedUp':
      // ขี้อายไม่ชอบถูกอุ้ม ขี้อ้อนชอบ
      v += temper.affection * 0.25 - temper.shy * 0.35
      a *= 0.7 + temper.shy * 0.6
      break
    case 'played':
      v *= 0.6 + temper.playful * 0.8
      break
    case 'fed':
    case 'treat':
      v *= 0.7 + temper.appetite * 0.6
      break
    case 'bathed':
      v -= temper.mischief * 0.2
      break
    case 'startled':
    case 'dropped':
      v *= 0.6 + temper.shy * 0.8
      break
    case 'ignored':
      v *= 0.5 + temper.affection * 1.0
      break
    case 'scolded':
      v *= 1.2 - temper.mischief * 0.5
      break
  }
  return {
    ...state,
    valence: clamp(state.valence + v, -1, 1),
    arousal: clamp(state.arousal + a),
  }
}

/** อารมณ์ค่อยๆ ไหลกลับสู่ค่าพื้นฐานที่กำหนดจาก needs และ mood */
export function tickEmotion(
  state: EmotionState,
  needs: Needs,
  temper: Temperament,
  dtSec: number,
): EmotionState {
  let satisfaction = 0
  for (const key of NEED_KEYS) satisfaction += needs[key]
  satisfaction /= NEED_KEYS.length
  const baseValence = clamp((satisfaction - 0.45) * 1.6 + state.mood * 0.3, -1, 1)
  const baseArousal = clamp(
    0.25 + needs.energy * 0.35 + temper.playful * 0.15 - temper.sleepy * 0.15,
  )
  const k = 1 - Math.exp(-dtSec / 90) // emotion half-life ≈ 1 นาที
  const km = 1 - Math.exp(-dtSec / 7200) // mood ≈ 2 ชั่วโมง
  const valence = lerp(state.valence, baseValence, k)
  return {
    valence,
    arousal: lerp(state.arousal, baseArousal, k),
    mood: lerp(state.mood, valence, km),
  }
}

export type EmotionLabel =
  | 'joyful'
  | 'content'
  | 'excited'
  | 'sleepy'
  | 'hungry'
  | 'lonely'
  | 'bored'
  | 'grumpy'
  | 'sad'
  | 'scared'

export const EMOTION_NAME_TH: Record<EmotionLabel, string> = {
  joyful: 'ร่าเริง',
  content: 'สบายใจ',
  excited: 'ตื่นเต้น',
  sleepy: 'ง่วง',
  hungry: 'หิว',
  lonely: 'เหงา',
  bored: 'เบื่อ',
  grumpy: 'งอน',
  sad: 'เศร้า',
  scared: 'ตกใจ',
}

/** แปลงสถานะเป็นอารมณ์เด่น 1 อย่างสำหรับ animation/คำพูด */
export function labelEmotion(state: EmotionState, needs: Needs): EmotionLabel {
  if (state.valence < -0.35 && state.arousal > 0.75) return 'scared'
  if (needs.energy < 0.22) return 'sleepy'
  if (needs.hunger < 0.22) return 'hungry'
  if (state.valence < -0.1) {
    if (needs.social < 0.3) return 'lonely'
    if (needs.fun < 0.3) return 'bored'
    return state.arousal > 0.5 ? 'grumpy' : 'sad'
  }
  if (needs.social < 0.2) return 'lonely'
  if (needs.fun < 0.2) return 'bored'
  if (state.valence > 0.45) return state.arousal > 0.6 ? 'excited' : 'joyful'
  return 'content'
}
