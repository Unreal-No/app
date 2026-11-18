import { paletteFromPixels, type Oklch } from '@mochimon/core'

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

  return paletteFromPixels(data)
}

/** SHA-256 ของไฟล์ (ไฟล์ใหญ่มากใช้ส่วนหัว+ท้ายเพื่อไม่ให้กินหน่วยความจำ) */
export async function hashFile(file: File): Promise<string> {
  const LIMIT = 16 * 1024 * 1024
  const blob =
    file.size > LIMIT * 2 ? new Blob([file.slice(0, LIMIT), file.slice(file.size - LIMIT)]) : file
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
