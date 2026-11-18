import { classifyFile, paletteFromPixels, type FileFeatures, type Oklch } from '@mochimon/core'
import { inspectFile, readImage } from './bridge'

/**
 * อ่าน "ลายนิ้วมือ" ของไฟล์สำหรับอัญเชิญ — เนื้อหาไฟล์ไม่ถูกเก็บและไม่ออกจากเครื่อง
 * - ไฟล์ที่ลากจาก Explorer (path) → ฝั่ง Rust คำนวณ hash
 * - ไฟล์จากหน้าต่างเลือกไฟล์/เบราว์เซอร์ (File) → WebCrypto ด้วยวิธีเดียวกัน (ไฟล์ใหญ่ใช้หัว+ท้าย)
 */
const CHUNK = 16 * 1024 * 1024
const YEAR_MS = 365.25 * 24 * 3600 * 1000
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export class IntakeError extends Error {}

async function paletteOf(blob: Blob): Promise<Oklch[]> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32 })
  } catch {
    return []
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(bitmap, 0, 0, 32, 32)
  bitmap.close()
  return paletteFromPixels(ctx.getImageData(0, 0, 32, 32).data)
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}

/** จาก File (หน้าต่างเลือกไฟล์ หรือวางในเบราว์เซอร์) */
export async function featuresFromFile(file: File): Promise<FileFeatures> {
  if (file.size === 0) throw new IntakeError('ไฟล์นี้ว่างเปล่า ไม่มีพลังพอจะอัญเชิญ')
  const blob =
    file.size > CHUNK * 2 ? new Blob([file.slice(0, CHUNK), file.slice(file.size - CHUNK)]) : file
  let hashHex: string
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    hashHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    throw new IntakeError('อ่านไฟล์นี้ไม่ได้')
  }
  const ext = extOf(file.name)
  const palette =
    classifyFile(ext) === 'image' && file.size <= MAX_IMAGE_BYTES ? await paletteOf(file) : []
  return {
    hashHex,
    size: file.size,
    ext,
    ageYears: file.lastModified ? Math.max(0, (Date.now() - file.lastModified) / YEAR_MS) : 0,
    ...(palette.length > 0 ? { palette } : {}),
  }
}

/** จาก path ที่ลากมาวาง (แอปจริงเท่านั้น) */
export async function featuresFromPath(path: string): Promise<FileFeatures> {
  let info
  try {
    info = await inspectFile(path)
  } catch (error) {
    throw new IntakeError(typeof error === 'string' ? error : 'อ่านไฟล์นี้ไม่ได้')
  }
  let palette: Oklch[] = []
  if (info.image) {
    try {
      palette = await paletteOf(new Blob([await readImage(path)]))
    } catch {
      palette = []
    }
  }
  return {
    hashHex: info.hash,
    size: info.size,
    ext: info.ext,
    ageYears: info.ageYears,
    ...(palette.length > 0 ? { palette } : {}),
  }
}
