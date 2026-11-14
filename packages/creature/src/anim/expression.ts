import type { EmotionLabel } from '@mochimon/core'

/** พารามิเตอร์ของใบหน้า — ตา/ปากเป็น shader จึงเปลี่ยนสีหน้าได้โดยไม่ต้องสร้าง mesh ใหม่ */
export interface FacePose {
  /** ตาเปิด 1 → หลับ 0 */
  open: number
  /** ตายิ้มปิดเป็นโค้ง ^ ^ */
  smile: boolean
  /** + โกรธ, - เศร้า */
  slant: number
  /** ขนาดตา (ตกใจ/สงสัยตาโตขึ้น) */
  wide: number
  /** 0 = ω, 1 = ยิ้มอ้าปาก, 2 = o, 3 = คว่ำ, 4 = หยัก */
  mouth: 0 | 1 | 2 | 3 | 4
  mouthOpen: number
  blush: number
}

const face = (over: Partial<FacePose>): FacePose => ({
  open: 1,
  smile: false,
  slant: 0,
  wide: 1,
  mouth: 0,
  mouthOpen: 0,
  blush: 0.45,
  ...over,
})

export const FACES: Record<EmotionLabel, FacePose> = {
  joyful: face({ smile: true, mouth: 1, mouthOpen: 0.75, blush: 0.7 }),
  excited: face({ mouth: 1, mouthOpen: 1, wide: 1.06, blush: 0.6 }),
  content: face({}),
  curious: face({ wide: 1.1, mouth: 2, mouthOpen: 0.05 }),
  shy: face({ smile: true, mouth: 4, blush: 1.4 }),
  sleepy: face({ open: 0, blush: 0.35 }),
  hungry: face({ open: 0.9, slant: -0.3, mouth: 2, mouthOpen: 0.4 }),
  lonely: face({ open: 0.82, slant: -0.6, mouth: 3, blush: 0.3 }),
  bored: face({ open: 0.58, mouth: 3, blush: 0.3 }),
  grumpy: face({ open: 0.72, slant: 0.95, mouth: 3, blush: 0.25 }),
  sad: face({ open: 0.78, slant: -0.85, mouth: 3, blush: 0.3 }),
  scared: face({ wide: 1.14, slant: -0.25, mouth: 2, mouthOpen: 1, blush: 0.2 }),
}
