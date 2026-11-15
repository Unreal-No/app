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

export interface HitShape {
  x: number
  y: number
  r: number
}

export type TrayAction =
  | 'call'
  | 'feed'
  | 'play'
  | 'quiet-on'
  | 'quiet-off'
  | 'reroll'
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
