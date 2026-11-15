import * as THREE from 'three'
import { composeBody, DEFAULT_NURTURE, type Nurture, type Phenotype } from '@mochimon/core'
import { Animator, defaultAnimInput, type AnimInput } from './anim/animate'
import { buildCreature, type BuildOptions, type BuiltCreature, type Rig } from './build/creature'
import { buildEgg, type BuiltEgg } from './build/egg'

export { defaultAnimInput, type AnimInput } from './anim/animate'
export { EMOTES, FACES, type FacePose } from './anim/expression'
export type { EmoteKind } from './fx/emote'
export {
  buildCreature,
  type BuildOptions,
  type BuiltCreature,
  type PoseName,
  type Rig,
} from './build/creature'

/**
 * สัตว์ 1 ตัวพร้อมใช้งานใน scene: โมเดล + animation
 * หันหน้าไปทาง +Z, เท้าอยู่ที่ y=0 ของ `root` — ถ้าช่วงวัยเป็น 'egg' จะเป็นไข่แทน
 */
export class Creature {
  readonly root: THREE.Group
  /** โครงกระดูก (ไม่มีถ้าเป็นไข่) */
  readonly rig?: Rig
  readonly isEgg: boolean
  /** ขนาดกล่องขอบเขตในท่ายืน */
  readonly size: THREE.Vector3
  /** รัศมีฐานลำตัวโดยประมาณ (ไม่รวมปีก/หาง) */
  readonly footprint: number
  readonly input: AnimInput = defaultAnimInput()
  /** ความคืบหน้าการฟัก 0..1 (ใช้เฉพาะไข่) */
  hatch = 0
  private readonly built?: BuiltCreature
  private readonly egg?: BuiltEgg
  private readonly animator?: Animator
  private time = 0

  constructor(
    readonly phenotype: Phenotype,
    nurture: Nurture = DEFAULT_NURTURE,
    options: BuildOptions = {},
  ) {
    const body = composeBody(phenotype, nurture)
    this.isEgg = nurture.stage === 'egg'
    if (this.isEgg) {
      this.egg = buildEgg(phenotype, body.scale * 2)
      this.root = this.egg.root
      this.size = this.egg.size
      this.footprint = this.egg.footprint
    } else {
      this.built = buildCreature(phenotype, body, options)
      this.root = this.built.root
      this.rig = this.built.rig
      this.size = this.built.size
      this.footprint = this.built.footprint
      this.animator = new Animator(this.built.rig)
      this.animator.snap(this.input)
    }
  }

  update(dt: number, input?: Partial<AnimInput>): void {
    if (input) Object.assign(this.input, input)
    this.time += dt
    if (this.egg) {
      this.egg.setTime(this.time)
      this.egg.update(dt, this.hatch)
      return
    }
    this.built?.materials.setTime(this.time)
    this.animator?.update(dt, this.input)
  }

  /** เข้าท่า/สีหน้าตาม input ทันทีโดยไม่ค่อยๆ เปลี่ยน */
  snap(input?: Partial<AnimInput>): void {
    if (input) Object.assign(this.input, input)
    this.animator?.snap(this.input)
  }

  /** บอกขนาดบนจอ (px ต่อ 1 หน่วยของ root ก่อน scale ภายนอก) เพื่อปรับความละเอียดของขน */
  setPixelScale(pxPerUnit: number): void {
    this.built?.materials.setPixelScale(pxPerUnit * this.root.scale.x)
  }

  dispose(): void {
    this.root.removeFromParent()
    this.built?.dispose()
    this.egg?.dispose()
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
