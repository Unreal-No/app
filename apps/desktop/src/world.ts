import * as THREE from 'three'
import { DEFAULT_SETTINGS, Rng, surfaceBelow, type Perch, type SaveSettings } from '@mochimon/core'
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

/** ผู้ใช้ยังอยู่หน้าจอไหม — ประมาณจากการขยับเมาส์ใน 5 นาทีล่าสุด (เวลาของสัตว์หยุดเมื่อผู้ใช้ไม่อยู่) */
export const userActive = (): boolean => performance.now() - cursor.movedAt < 5 * 60_000

export const settings: SaveSettings = { ...DEFAULT_SETTINGS }

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
let perches: Perch[] = []

/** ขอบบนของหน้าต่างโปรแกรมอื่นที่เกาะได้ (พิกัดจอ) */
export function setPerches(next: Perch[]): void {
  perches = next
}
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
