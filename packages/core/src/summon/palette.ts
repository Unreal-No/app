import { rgbToOklch } from '../color'
import type { Oklch } from '@mochimon/data'

/**
 * สีเด่นของรูป (สูงสุด 4 สี) จากพิกเซล RGBA ขนาดเล็ก (เช่น 32×32) — จัดกลุ่มตามเฉดสี
 * สีเทา/ขาว/ดำรวมเป็นกลุ่มเดียว และสีสดได้น้ำหนักมากกว่า; ข้ามพิกเซลโปร่งใส
 */
export function paletteFromPixels(rgba: ArrayLike<number>): Oklch[] {
  const BUCKETS = 12
  const buckets = Array.from({ length: BUCKETS + 1 }, () => ({ w: 0, l: 0, c: 0, x: 0, y: 0 }))
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) < 128) continue
    const color = rgbToOklch({
      r: (rgba[i] ?? 0) / 255,
      g: (rgba[i + 1] ?? 0) / 255,
      b: (rgba[i + 2] ?? 0) / 255,
    })
    const grey = color.c < 0.03
    const bucket = buckets[grey ? BUCKETS : Math.floor(color.h / (360 / BUCKETS)) % BUCKETS]!
    const w = grey ? 0.35 : 0.5 + color.c * 6
    const rad = (color.h * Math.PI) / 180
    bucket.w += w
    bucket.l += color.l * w
    bucket.c += color.c * w
    bucket.x += Math.cos(rad) * w
    bucket.y += Math.sin(rad) * w
  }
  return buckets
    .filter((b) => b.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4)
    .map((b) => ({
      l: b.l / b.w,
      c: b.c / b.w,
      h: ((Math.atan2(b.y, b.x) * 180) / Math.PI + 360) % 360,
    }))
}
