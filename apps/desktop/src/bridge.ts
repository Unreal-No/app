import type { DesktopWindow, SaveSettings } from '@mochimon/core'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * สะพานเชื่อมกับฝั่ง Rust — ถ้าเปิดในเบราว์เซอร์ธรรมดา (ไม่มี Tauri) จะใช้ค่าจำลองแทน
 * ทำให้พัฒนา/ทดสอบฉาก overlay ได้โดยไม่ต้องมี Windows
 */
export const isTauri = '__TAURI_INTERNALS__' in window

/** พิกัดทั้งหมดเป็น CSS px เทียบมุมซ้ายบนของหน้าต่าง overlay */
export interface DesktopLayout {
  width: number
  height: number
  /** ระยะจากขอบบนของหน้าต่างถึง "พื้น" ที่สัตว์ยืน (ขอบบนของ Taskbar) */
  groundY: number
}

/** พื้นที่จับต้องได้: วงกลม (จุดศูนย์กลาง + รัศมี) หรือสี่เหลี่ยม (มุมซ้ายบน + ขนาด) */
export type HitShape =
  { x: number; y: number; r: number } | { x: number; y: number; w: number; h: number }

export type TrayAction =
  | 'call'
  | 'feed'
  | 'play'
  | 'quiet-on'
  | 'quiet-off'
  | 'reroll'
  | 'farm-recall'
  | 'panel'
  | 'perch-on'
  | 'perch-off'
  | 'fshide-on'
  | 'fshide-off'
  | 'daylight-on'
  | 'daylight-off'
  | 'quit'
  | 'assistant'
  | 'chat'
  | 'focus-start'
  | 'summon'
  | 'explore'
  | 'book'
  | 'habitat-none'
  | 'habitat-meadow'
  | 'habitat-cloud'
  | 'habitat-underwater'
  | 'habitat-snow'

const MOCK_TASKBAR = 48

export async function getLayout(): Promise<DesktopLayout> {
  if (isTauri) return invoke<DesktopLayout>('get_desktop_layout')
  return { width: innerWidth, height: innerHeight, groundY: innerHeight - MOCK_TASKBAR }
}

/** บอก Rust ว่าพื้นที่ไหนของจอ "จับต้องได้" — นอกพื้นที่นี้เมาส์จะคลิกทะลุไปยังแอปข้างหลัง */
export function setHitShapes(shapes: HitShape[]): void {
  if (isTauri) void invoke('set_hit_shapes', { shapes })
}

/** ตำแหน่งเคอร์เซอร์ (แม้ตอนหน้าต่างอยู่ในโหมดคลิกทะลุซึ่ง webview ไม่ได้รับ mousemove) */
export function onCursor(callback: (x: number, y: number) => void): void {
  if (isTauri) {
    void listen<{ x: number; y: number }>('cursor', (e) => callback(e.payload.x, e.payload.y))
  } else {
    addEventListener('pointermove', (e) => callback(e.clientX, e.clientY))
  }
}

export function onTray(callback: (action: TrayAction) => void): void {
  if (isTauri) {
    void listen<TrayAction>('tray', (e) => callback(e.payload))
  } else {
    // ในเบราว์เซอร์ไม่มี tray: จำลองได้ด้วย window.dispatchEvent(new CustomEvent('mochimon-tray', { detail: 'feed' }))
    addEventListener('mochimon-tray', (e) => callback((e as CustomEvent<TrayAction>).detail))
  }
}

/** เนื้อหาไฟล์เซฟทั้งหมดที่อ่านได้ เรียงจากไฟล์หลักแล้วสำเนาสำรองใหม่→เก่า (ในเบราว์เซอร์ไม่มีไฟล์) */
export async function readSaveFiles(): Promise<string[]> {
  if (!isTauri) return []
  try {
    return await invoke<string[]>('load_save')
  } catch {
    return []
  }
}

/** เขียนไฟล์เซฟ (ฝั่ง Rust เขียนแบบ atomic และหมุนสำเนาสำรองให้) */
export async function writeSaveFile(json: string): Promise<void> {
  if (!isTauri) return
  try {
    await invoke('store_save', { json })
  } catch {
    // เขียนไฟล์ไม่ได้ — ยังมีสำเนาใน localStorage และจะลองใหม่ในรอบเซฟถัดไป
  }
}

/** ปิดแอป (เรียกหลังเซฟเสร็จ เมื่อผู้ใช้เลือก "ออก" จากเมนู tray) */
export function quitApp(): void {
  if (isTauri) void invoke('quit_now').catch(() => undefined)
}

/**
 * ขอให้หน้าต่างรับคีย์บอร์ดชั่วคราว (ปกติหน้าต่าง overlay ไม่รับ focus เพื่อไม่แย่งงานของผู้ใช้)
 * ใช้ตอนพิมพ์ตั้งชื่อสัตว์เท่านั้น
 */
export function setKeyboardFocus(on: boolean): void {
  if (isTauri) void invoke('set_keyboard_focus', { on }).catch(() => undefined)
}

/**
 * หน้าต่างของโปรแกรมอื่นที่มองเห็นอยู่ เรียงจากหน้าสุดไปหลังสุด (พิกัดจอของ overlay)
 * ในเบราว์เซอร์จำลองได้ด้วย window.dispatchEvent(new CustomEvent('mochimon-platforms', { detail: [...] }))
 */
export function onPlatforms(callback: (windows: DesktopWindow[]) => void): void {
  if (isTauri) {
    void listen<DesktopWindow[]>('platforms', (e) => callback(e.payload))
  } else {
    addEventListener('mochimon-platforms', (e) =>
      callback((e as CustomEvent<DesktopWindow[]>).detail),
    )
  }
}

/** ให้เครื่องหมายถูกในเมนู tray และเธรดเบื้องหลังของ Rust ตรงกับค่าตั้งที่โหลดจากเซฟ */
export function syncMenuState(menu: SaveSettings): void {
  if (isTauri) void invoke('sync_menu_state', { menu }).catch(() => undefined)
}

/** นัดที่ฝั่ง Rust ใช้แสดง Windows toast เมื่อหน้าต่างสัตว์ถูกซ่อน */
export interface Alarm {
  id: string
  atMs: number
  title: string
  body: string
}

export function setAlarms(alarms: Alarm[]): void {
  if (isTauri) void invoke('set_alarms', { alarms }).catch(() => undefined)
}

/** วินาทีตั้งแต่ผู้ใช้แตะเมาส์/คีย์บอร์ดครั้งล่าสุดทั้งเครื่อง (null = ไม่รองรับ) */
export async function getIdleSeconds(): Promise<number | null> {
  if (!isTauri) return null
  try {
    return await invoke<number | null>('idle_seconds')
  } catch {
    return null
  }
}

/**
 * ดึงไฟล์ปฏิทินจากลิงก์ ICS — ในแอปจริงให้ Rust ดึง (WebView ถูกบล็อกด้วย CORS)
 * ข้อผิดพลาดเป็นข้อความภาษาไทยพร้อมแสดงให้ผู้ใช้
 */
export async function fetchCalendar(url: string): Promise<string> {
  if (isTauri) {
    try {
      return await invoke<string>('fetch_calendar', { url })
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : 'ดึงปฏิทินไม่สำเร็จ')
    }
  }
  // ในเบราว์เซอร์ (ตอนพัฒนา/ทดสอบ): ดึงตรงๆ — ลิงก์จริงส่วนใหญ่จะถูก CORS บล็อก
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new Error('เบราว์เซอร์ดึงลิงก์นี้ไม่ได้ (ใช้ในแอปจริงได้)')
  }
  if (!response.ok) throw new Error(`ดึงปฏิทินไม่สำเร็จ (สถานะ ${response.status})`)
  const text = await response.text()
  if (!/^\s*BEGIN:VCALENDAR/i.test(text.replace(/^\uFEFF/, '')))
    throw new Error('ลิงก์นี้ไม่ใช่ไฟล์ปฏิทิน (ICS)')
  return text
}

// ───────── คุยกับสัตว์ด้วย AI ─────────
/**
 * ในแอปจริง API key อยู่ในที่เก็บรหัสของ Windows ฝั่ง Rust และคำขอถูกส่งจากฝั่งนั้น
 * ในเบราว์เซอร์ (ตอนพัฒนา/ทดสอบ) เก็บ key ไว้ในหน่วยความจำเท่านั้น ไม่บันทึกลงที่ใด
 */
let browserKey: string | null = null

export async function setApiKey(key: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke('set_api_key', { key })
      return
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : 'บันทึก API key ไม่สำเร็จ')
    }
  }
  const trimmed = key.trim()
  if (!/^sk-ant-\S{13,}$/.test(trimmed))
    throw new Error('API key ของ Anthropic ขึ้นต้นด้วย sk-ant- — ลองคัดลอกใหม่จาก Claude Console')
  browserKey = trimmed
}

export async function hasApiKey(): Promise<boolean> {
  if (isTauri) return invoke<boolean>('has_api_key').catch(() => false)
  return browserKey !== null
}

export async function clearApiKey(): Promise<void> {
  if (isTauri) await invoke('clear_api_key').catch(() => undefined)
  else browserKey = null
}

const asError = (error: unknown, fallback: string): Error =>
  new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : fallback)

/** ส่งคำขอไปยัง Messages API (key ใส่ให้ฝั่ง Rust) — คืนเนื้อหาคำตอบทั้งก้อน */
export async function claudeMessages(body: object, betas: string[]): Promise<unknown> {
  if (isTauri) {
    try {
      return await invoke('claude_messages', { body, betas })
    } catch (error) {
      throw asError(error, 'คุยกับ Claude ไม่สำเร็จ')
    }
  }
  if (!browserKey) throw new Error('ยังไม่ได้ใส่ API key — เปิดการตั้งค่าแชตแล้วใส่ key ก่อน')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': browserKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error('เชื่อมต่อ Anthropic ไม่ได้')
  })
  if (!response.ok) throw new Error(`คำขอไม่สำเร็จ (สถานะ ${response.status})`)
  return response.json()
}

/** คุยผ่าน Ollama ในเครื่อง */
export async function ollamaChat(baseUrl: string, body: object): Promise<unknown> {
  if (isTauri) {
    try {
      return await invoke('ollama_chat', { baseUrl, body })
    } catch (error) {
      throw asError(error, 'คุยกับ Ollama ไม่สำเร็จ')
    }
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error('ต่อ Ollama ในเครื่องไม่ได้ — เปิดโปรแกรม Ollama แล้วลองใหม่')
  })
  if (!response.ok) throw new Error(`Ollama ตอบผิดพลาด (สถานะ ${response.status})`)
  return response.json()
}

// ───────── แท่นอัญเชิญ: ไฟล์จากเครื่อง ─────────

/** ลายนิ้วมือของไฟล์ที่ฝั่ง Rust อ่าน (ไม่มีเนื้อหาไฟล์) */
export interface FileInfo {
  hash: string
  size: number
  ext: string
  ageYears: number
  /** อ่านสีจากรูปได้ */
  image: boolean
}

/** อ่าน hash/ขนาด/อายุของไฟล์จาก path (ใช้กับไฟล์ที่ลากมาวาง) */
export async function inspectFile(path: string): Promise<FileInfo> {
  return invoke<FileInfo>('inspect_file', { path })
}

/** ไบต์ของรูปภาพ (ให้ WebView ย่อเพื่อหาสีเด่น) */
export async function readImage(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_image', { path })
}

export type FileDrop =
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; x: number; y: number; paths: string[] }
  | { type: 'leave' }

/**
 * ไฟล์ที่ผู้ใช้ลากมาจาก Explorer (เฉพาะแอปจริง — ในเบราว์เซอร์ใช้ HTML drag & drop ที่แท่นแทน)
 * ตำแหน่งแปลงเป็น CSS px แล้ว
 */
export function onFileDrop(callback: (event: FileDrop) => void): void {
  if (!isTauri) return
  void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'leave') return callback({ type: 'leave' })
      const x = payload.position.x / devicePixelRatio
      const y = payload.position.y / devicePixelRatio
      if (payload.type === 'drop') callback({ type: 'drop', x, y, paths: payload.paths })
      else callback({ type: 'over', x, y })
    }),
  )
}
