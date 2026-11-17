import * as THREE from 'three'
import {
  computePerches,
  DEFAULT_SETTINGS,
  Rng,
  surfaceBelow,
  type DesktopWindow,
  type Perch,
  type SaveSettings,
} from '@mochimon/core'
import { createHabitat, type Habitat, type HabitatKind } from '@mochimon/habitat'
import type { DesktopLayout } from './bridge'

/**
 * สภาพแวดล้อมของฉาก overlay ที่ทุกส่วนใช้ร่วมกัน: ตัววาดภาพ กล้อง ขนาดจอ ตำแหน่งเคอร์เซอร์
 * และ "พื้นผิวที่ยืนได้" (พื้น Taskbar, แท่นฉาก, ขอบหน้าต่างโปรแกรมอื่น)
 *
 * พิกัดมี 2 ระบบ:
 * - พิกัดจอ: CSS px จากมุมซ้ายบน, y ชี้ลง (เมาส์, DOM, ข้อมูลจาก Rust)
 * - พิกัดโลก: px จากมุมซ้ายล่าง, y ชี้ขึ้น (ฉาก 3D และฟิสิกส์ของสัตว์)
 */

/** ขนาดบนจอ: 1 หน่วยโมเดล = กี่ CSS px */
export const PX_PER_UNIT = 130

export const canvas = document.getElementById('gl') as HTMLCanvasElement
export const fxLayer = document.getElementById('fx') as HTMLDivElement
export const uiLayer = document.getElementById('ui') as HTMLDivElement
export const rng = new Rng(String(Date.now()))

export const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
renderer.setClearColor(0x000000, 0)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
export const scene = new THREE.Scene()
export const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -3000, 3000)

export let layout: DesktopLayout = {
  width: innerWidth,
  height: innerHeight,
  groundY: innerHeight - 48,
}

export function applyLayout(next: DesktopLayout): void {
  layout = next
  refreshPerches()
  renderer.setSize(layout.width, layout.height, false)
  camera.right = layout.width
  camera.top = layout.height
  camera.updateProjectionMatrix()
}

/** ความสูงของพื้น (ขอบบน Taskbar) ในพิกัดโลก */
export const groundLevel = (): number => layout.height - layout.groundY
/** แปลง y ระหว่างพิกัดโลกกับพิกัดจอ (สูตรเดียวกันทั้งสองทาง) */
export const flipY = (y: number): number => layout.height - y

/** ตำแหน่งเคอร์เซอร์ (พิกัดจอ) */
export const cursor = { x: -9999, y: -9999, seen: false, movedAt: performance.now() }

/**
 * วินาทีตั้งแต่ผู้ใช้แตะเมาส์/คีย์บอร์ดครั้งล่าสุด
 * ในแอปจริงอ่านจาก Windows (`systemIdle`, รวมการพิมพ์ในโปรแกรมอื่น) — ในเบราว์เซอร์ใช้การขยับเมาส์บนหน้า
 */
export const presence = { systemIdle: null as number | null }
export const idleSeconds = (): number =>
  presence.systemIdle ?? (performance.now() - cursor.movedAt) / 1000

/** ผู้ใช้ยังอยู่หน้าจอไหม (เวลาของสัตว์หยุดเมื่อผู้ใช้ไม่อยู่) */
export const userActive = (): boolean => idleSeconds() < 5 * 60

export const settings: SaveSettings = { ...DEFAULT_SETTINGS }

/** สถานะชั่วคราวที่หลายส่วนต้องรู้ */
export const mode = {
  /** กำลังจับเวลาโฟกัส: สัตว์อยู่เงียบๆ ไม่ขอความสนใจ */
  focusing: false,
  /** อยู่ในช่วงประชุมตามปฏิทิน: สัตว์เงียบ */
  meeting: false,
  /** ความกว้างด้านขวาของจอที่แผงผู้ช่วยใช้อยู่ — สัตว์ไม่เดินเข้าไปใต้แผง */
  reserveRight: 0,
}

/** ขอบขวาสุดที่สัตว์ไปยืนได้ตอนนี้ */
export const walkMaxX = (margin: number): number => layout.width - margin - mode.reserveRight
/** ควรงดคำพูดทั่วไปไหม (คำเตือนที่ผู้ใช้ตั้งเองยังพูดได้เสมอ) */
export const hushed = (): boolean => settings.quiet || mode.focusing || mode.meeting

// ───────── โหมดมุมพักผ่อน: ไดโอรามาเล็กที่มุมขวาล่าง ─────────
const HABITAT_PX = 110

class HabitatActor {
  readonly holder = new THREE.Group()
  constructor(
    readonly kind: HabitatKind,
    readonly habitat: Habitat,
  ) {
    this.holder.add(habitat.root)
    this.holder.rotation.set(0.14, 0.3, 0)
    this.holder.scale.setScalar(HABITAT_PX)
    scene.add(this.holder)
  }
  get x(): number {
    return layout.width - HABITAT_PX * 1.5
  }
  /** ความสูงของพื้นที่สัตว์ยืนได้ ณ ตำแหน่ง x (พิกัดโลก) */
  floorAt(x: number): number {
    const onTop = Math.abs(x - this.x) < HABITAT_PX * 0.62
    return groundLevel() + (onTop ? this.habitat.surfaceY * HABITAT_PX : 0)
  }
  update(dt: number): void {
    // อยู่หลังสัตว์ในแนวลึก
    this.holder.position.set(this.x, groundLevel(), -400)
    this.habitat.update(dt)
  }
  dispose(): void {
    this.holder.removeFromParent()
    this.habitat.dispose()
  }
}

let habitatActor: HabitatActor | null = null

export function setHabitat(kind: HabitatKind | null): void {
  habitatActor?.dispose()
  habitatActor = kind ? new HabitatActor(kind, createHabitat(kind)) : null
}
export const habitatKind = (): HabitatKind | null => habitatActor?.kind ?? null
/** จุดพักผ่อนโปรด (กลางแท่นฉาก) ถ้ามีฉาก */
export const restSpot = (): number | null => habitatActor?.x ?? null
export const updateHabitat = (dt: number): void => habitatActor?.update(dt)

// ───────── พื้นผิวที่ยืนได้ ─────────
let windows: DesktopWindow[] = []
let perches: Perch[] = []

function refreshPerches(): void {
  perches = computePerches(
    windows,
    { x: 0, y: 0, w: layout.width, h: layout.height },
    layout.groundY,
    // ขอบที่สูงเกินไปไม่นับ: สัตว์ทั้งตัวต้องอยู่ในจอ
    { minY: 190 },
  )
}

/** รายการหน้าต่างของโปรแกรมอื่น (หน้าสุด → หลังสุด) จากฝั่ง Rust */
export function setWindows(next: DesktopWindow[]): void {
  windows = next
  refreshPerches()
}
export const windowById = (id: number): DesktopWindow | undefined =>
  windows.find((win) => win.id === id)
export const activePerches = (): Perch[] => (settings.perching ? perches : [])

export interface Surface {
  /** ระดับของพื้นผิว (พิกัดโลก) */
  y: number
  /** ขอบหน้าต่างที่เป็นเจ้าของพื้นผิวนี้ (null = พื้น/แท่นฉาก) */
  perch: Perch | null
}

/** พื้นผิวที่สูงที่สุดซึ่งอยู่ใต้ตำแหน่ง (x, y) ในพิกัดโลก */
export function surfaceAt(x: number, y: number): Surface {
  const floor = habitatActor?.floorAt(x) ?? groundLevel()
  const found = surfaceBelow(x, flipY(y), flipY(floor), activePerches())
  return { y: flipY(found.y), perch: found.perch }
}
