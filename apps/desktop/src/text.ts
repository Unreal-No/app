import type { EmotionLabel, LifeStage, Needs } from '@mochimon/core'

/** ข้อความภาษาไทยที่ใช้ร่วมกันในฉาก overlay */

export const STAGE_TH: Record<LifeStage, string> = {
  egg: 'ไข่',
  baby: 'เบบี้',
  child: 'เด็ก',
  teen: 'วัยรุ่น',
  adult: 'โตเต็มวัย',
  elder: 'ผู้อาวุโส',
}

export const NEED_TH: Record<keyof Needs, string> = {
  hunger: 'อิ่ม',
  energy: 'พลัง',
  hygiene: 'สะอาด',
  fun: 'สนุก',
  social: 'อบอุ่นใจ',
  comfort: 'สบายตัว',
}

/** คำพูดสุ่มตามอารมณ์ */
export const LINES: Record<EmotionLabel, string[]> = {
  joyful: ['♪', 'วันนี้ดีจัง~', 'อิอิ'],
  content: ['อยู่นี่นะ', 'ฮัมม~', '…♪'],
  excited: ['เย้!', 'เล่นกัน!', 'ว้าว!'],
  curious: ['หืม?', 'อะไรน่ะ?'],
  shy: ['เขินจัง…', 'แหะๆ'],
  sleepy: ['ง่วงจัง…', 'หาววว', 'zzz'],
  hungry: ['หิวแล้วน้า', 'ขอขนมหน่อย~', 'ท้องร้องแล้ว…'],
  lonely: ['มาเล่นด้วยกันหน่อย', 'เหงาจัง…'],
  bored: ['เบื่ออ่า', 'ทำอะไรดี…'],
  grumpy: ['ฮึ!', 'งอนแล้ว'],
  sad: ['ฮือ…', '…'],
  scared: ['ว้าย!', '!!'],
}
