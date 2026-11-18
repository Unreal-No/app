import * as THREE from 'three'
import { createAquariumCondo, type AquariumCondo } from '@mochimon/habitat'
import { pets } from './game'
import { blockedSpans, groundLevel, layout, mode, scene } from './world'

/**
 * คอนโดตู้ปลา: สัตว์น้ำ (เดินบนบกไม่ได้) อยู่คนละห้องในตู้กระจกซ้อนชั้น วางบนพื้นมุมซ้ายล่าง
 * จำนวนชั้นเท่ากับสัตว์น้ำบนจอ — ไม่มีสัตว์น้ำก็ไม่มีคอนโด
 * ลากปลา = ย้ายทั้งคอนโดไปตามพื้น (ปลาออกจากน้ำไม่ได้)
 */
/** 1 หน่วยของคอนโด = กี่ px (ห้องสูงราว 110 px) */
const CONDO_PX = 96
/** ความลึกของคอนโด — อยู่หน้าสัตว์บนพื้น (slot × 300) แต่หลังตัวที่ถูกอุ้ม */
const CONDO_Z = 1100
const POS_KEY = 'mochimon.aquarium.x'

const holder = new THREE.Group()
scene.add(holder)
let condo: AquariumCondo | null = null
let x: number | null = null

function savedX(): number | null {
  try {
    const v = Number(localStorage.getItem(POS_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function storeX(value: number): void {
  try {
    localStorage.setItem(POS_KEY, String(Math.round(value)))
  } catch {
    // ไม่มีที่เก็บ → ครั้งหน้ากลับไปมุมซ้าย
  }
}

function rebuild(floors: number): void {
  condo?.dispose()
  condo?.root.removeFromParent()
  condo = floors > 0 ? createAquariumCondo(floors) : null
  if (condo) holder.add(condo.root)
}

/** สี่เหลี่ยมของคอนโดบนจอ (ใช้ทดสอบ/วางของอื่นหลบ) */
export function aquariumRect(): { x: number; y: number; w: number; h: number } | null {
  if (!condo || x === null) return null
  const w = condo.width * CONDO_PX
  const h = condo.height * CONDO_PX
  return { x: x - w / 2, y: layout.groundY - h, w, h }
}

/** เรียกทุกเฟรม ก่อนอัปเดตสัตว์ */
export function updateAquarium(dt: number): void {
  const fish = pets.filter((p) => p.aquatic).sort((a, b) => a.slot - b.slot)
  const floors = Math.min(4, fish.length)
  if ((condo?.floors ?? 0) !== floors) rebuild(floors)
  for (const p of pets) if (!p.aquatic) p.tank = null
  blockedSpans.length = 0
  if (!condo) return

  const half = (condo.width * CONDO_PX) / 2 + 24
  const held = fish.find((f) => f.held)
  x ??= savedX() ?? half + 16
  if (held) {
    x = held.x
  }
  const maxX = layout.width - half - mode.reserveRight
  x = THREE.MathUtils.clamp(x, half, Math.max(half, maxX))
  if (held) storeX(x)

  blockedSpans.push({ x1: x - half + 24, x2: x + half - 24 })
  holder.position.set(x, groundLevel(), CONDO_Z)
  holder.scale.setScalar(CONDO_PX)
  fish.forEach((f, i) => {
    const room = condo!.rooms[Math.min(i, condo!.rooms.length - 1)]!
    f.tank = {
      cx: x!,
      floorY: groundLevel() + room.floorY * CONDO_PX,
      height: room.height * CONDO_PX,
      halfWidth: condo!.halfWidth * CONDO_PX,
      z: CONDO_Z,
    }
  })
  condo.update(dt)
}
