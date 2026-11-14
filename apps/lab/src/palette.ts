import { rgbToOklch, type Oklch } from '@mochimon/core'

/** ดึงสีเด่นของรูป (สูงสุด 4 สี) โดยจัดกลุ่มตาม hue — ทำงานในเครื่องทั้งหมด */
export async function extractPalette(file: File): Promise<Oklch[]> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: 32, resizeHeight: 32 })
  } catch {
    return []
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(bitmap, 0, 0, 32, 32)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, 32, 32)

  const BUCKETS = 12
  const buckets = Array.from({ length: BUCKETS + 1 }, () => ({ w: 0, l: 0, c: 0, x: 0, y: 0 }))
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue
    const color = rgbToOklch({
      r: (data[i] ?? 0) / 255,
      g: (data[i + 1] ?? 0) / 255,
      b: (data[i + 2] ?? 0) / 255,
    })
    // สีเทา/ขาว/ดำ รวมไว้ถังสุดท้าย, สีสดได้น้ำหนักมากกว่า
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

/** SHA-256 ของไฟล์ (ไฟล์ใหญ่มากใช้ส่วนหัว+ท้ายเพื่อไม่ให้กินหน่วยความจำ) */
export async function hashFile(file: File): Promise<string> {
  const LIMIT = 16 * 1024 * 1024
  const blob =
    file.size > LIMIT * 2 ? new Blob([file.slice(0, LIMIT), file.slice(file.size - LIMIT)]) : file
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
