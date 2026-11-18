import * as THREE from 'three'
import { viewPet, type PetState } from '@mochimon/core'
import { Creature } from '@mochimon/creature'

/**
 * รูปย่อของสัตว์สำหรับสมุดฟาร์ม: เรนเดอร์ครั้งเดียวต่อตัว (ตามช่วงวัย) แล้วเก็บเป็นรูป
 * ใช้ renderer เล็กแยกจากฉากหลัก และสร้างเมื่อมีคนขอรูปครั้งแรกเท่านั้น
 */
const SIZE = 112
let renderer: THREE.WebGLRenderer | null = null
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 80)
const cache = new Map<string, string>()

function ensureRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer
  try {
    const canvas = document.createElement('canvas')
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(SIZE, SIZE, false)
    renderer.setClearColor(0x000000, 0)
  } catch {
    renderer = null
  }
  return renderer
}

/** ล้างรูปย่อทั้งหมด (หน้าตาเปลี่ยน เช่น นำเข้าชุดชิ้นส่วนใหม่) */
export const clearPortraits = (): void => cache.clear()

const keyOf = (pet: PetState): string =>
  `${pet.id}:${pet.nurture.stage}:${Math.round(pet.nurture.fat * 10)}`

/** รูปย่อ (data URL) — คืนสตริงว่างถ้าวาดไม่ได้ */
export function portrait(pet: PetState): string {
  const key = keyOf(pet)
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const r = ensureRenderer()
  if (!r) return ''
  const creature = new Creature(viewPet(pet).phenotype, pet.nurture, { fur: 'medium' })
  creature.root.rotation.y = -0.45
  scene.add(creature.root)
  creature.snap({ pose: 'auto', emotion: 'content' })
  const size = creature.size
  const extent = Math.max(size.y, size.x * 0.85, size.z * 0.85, 0.5)
  const dist = extent * 3.1 + 0.5
  const cy = size.y * 0.44
  camera.position.set(0, cy + dist * 0.09, dist)
  camera.lookAt(0, cy, 0)
  const worldHeight = 2 * dist * Math.tan((camera.fov * Math.PI) / 360)
  creature.setPixelScale((SIZE * r.getPixelRatio()) / worldHeight)
  creature.update(0.016)
  r.render(scene, camera)
  const url = r.domElement.toDataURL('image/png')
  creature.root.removeFromParent()
  creature.dispose()
  cache.set(key, url)
  return url
}
