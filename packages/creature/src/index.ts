import * as THREE from 'three'
import { composeBody, DEFAULT_NURTURE, type Nurture, type Phenotype } from '@mochimon/core'
import { Animator, defaultAnimInput, type AnimInput } from './anim/animate'
import { buildCreature, type BuiltCreature, type Rig } from './build/creature'

export { defaultAnimInput, type AnimInput } from './anim/animate'
export { buildCreature, type BuiltCreature, type Rig } from './build/creature'
export { createCreatureMaterials } from './material/toon'

/**
 * สัตว์ 1 ตัวพร้อมใช้งานใน scene: โมเดล + animation
 * หันหน้าไปทาง +Z, เท้าอยู่ที่ y=0 ของ `root`
 */
export class Creature {
  readonly root: THREE.Group
  readonly rig: Rig
  /** ขนาดกล่องขอบเขตในท่าพัก */
  readonly size: THREE.Vector3
  /** รัศมีฐานลำตัวโดยประมาณ (ไม่รวมปีก/หาง) */
  readonly footprint: number
  readonly input: AnimInput = defaultAnimInput()
  private readonly built: BuiltCreature
  private readonly animator: Animator
  private time = 0

  constructor(
    readonly phenotype: Phenotype,
    nurture: Nurture = DEFAULT_NURTURE,
  ) {
    this.built = buildCreature(phenotype, composeBody(phenotype, nurture))
    this.root = this.built.root
    this.rig = this.built.rig
    this.size = this.built.size
    this.footprint = this.built.footprint
    this.animator = new Animator(this.rig)
  }

  update(dt: number, input?: Partial<AnimInput>): void {
    if (input) Object.assign(this.input, input)
    this.time += dt
    this.built.materials.setTime(this.time)
    this.animator.update(dt, this.input)
  }

  dispose(): void {
    this.root.removeFromParent()
    this.built.dispose()
  }
}

/** เงากลมใต้เท้า ช่วยให้สัตว์ดู "ยืนอยู่บนพื้น" แม้ไม่มีฉากหลัง */
export function createBlobShadow(radius: number, opacity = 0.16): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({
      color: '#3a2a4a',
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.002
  shadow.scale.set(1, 0.8, 1)
  return shadow
}
