import * as THREE from 'three'
import type { Phenotype } from '@mochimon/core'
import { createPlushMaterials } from '../material/plush'
import { deformedBall } from './shapes'

export interface BuiltEgg {
  root: THREE.Group
  size: THREE.Vector3
  footprint: number
  setTime(t: number): void
  /** @param hatch ความคืบหน้าการฟัก 0..1 — ยิ่งใกล้ฟักยิ่งสั่นบ่อย */
  update(dt: number, hatch: number): void
  dispose(): void
}

const PATTERN_ID: Record<string, number> = {
  spots: 1,
  stripes: 2,
  scales: 3,
  patch: 4,
  gradient: 5,
}

/**
 * ไข่: เปลือกใบ้หน้าตาของตัวข้างใน — สีพื้นมาจากสีตัว (จางลง), ลายมาจากชนิดลวดลาย, สีลายมาจากสีลายแต้ม
 */
export function buildEgg(p: Phenotype, scale: number): BuiltEgg {
  const root = new THREE.Group()
  const shell = new THREE.Group()
  root.add(shell)
  const rx = 0.27
  const ry = 0.35
  const geometry = deformedBall(rx, ry, rx, (v) => {
    // ทรงไข่: ด้านบนเรียว ก้นป้าน
    const k = v.y > 0 ? 1 - 0.22 * v.y * v.y : 1 + 0.04 * v.y
    v.x *= k
    v.z *= k
  })
  geometry.translate(0, ry * 0.97, 0)
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('aPat', geometry.getAttribute('position').clone())
  const paint = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) paint[i * 4 + 3] = 1
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(paint, 4))
  geometry.setAttribute('aFur', new THREE.BufferAttribute(new Float32Array(count), 1))

  const mats = createPlushMaterials(p, {
    height: ry * 2,
    shells: 0,
    symbolPos: new THREE.Vector3(),
    symbolSize: 1,
  })
  const u = mats.skin.uniforms
  const hasMark = p.parts.mask.shape !== 'none' || p.parts.tailmark.shape !== 'none'
  u.uBase = { value: new THREE.Color(p.colors.base.hex).lerp(new THREE.Color('#fff7ea'), 0.55) }
  u.uPatternColor = { value: new THREE.Color(hasMark ? p.colors.mark.hex : p.colors.pattern.hex) }
  u.uPattern = { value: PATTERN_ID[p.parts.pattern.shape] ?? 1 }
  u.uPatFreq = { value: 4.4 }
  u.uPatContrast = { value: 0.85 }
  u.uSymbol = { value: 0 }
  shell.add(new THREE.Mesh(geometry, mats.skin))
  root.scale.setScalar(scale)

  let t = Math.random() * 10
  let shakeIn = 2
  let shake = 0
  return {
    root,
    size: new THREE.Vector3(rx * 2, ry * 2, rx * 2).multiplyScalar(scale),
    footprint: rx * scale * 1.1,
    setTime: mats.setTime,
    update(dt, hatch) {
      t += dt
      shakeIn -= dt
      if (shakeIn <= 0) {
        shake = 1
        shakeIn = THREE.MathUtils.lerp(4.5, 0.9, hatch) * (0.7 + Math.random() * 0.6)
      }
      shake = Math.max(0, shake - dt * 2.2)
      const wobble = Math.sin(t * 2.2) * 0.04 * (0.4 + hatch)
      shell.rotation.z = wobble + Math.sin(t * 28) * 0.11 * shake
      shell.position.y = Math.abs(Math.sin(t * 14)) * 0.03 * shake * hatch
    },
    dispose() {
      geometry.dispose()
      for (const m of mats.all) m.dispose()
    },
  }
}
