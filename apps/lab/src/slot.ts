import * as THREE from 'three'
import { DEFAULT_NURTURE, express, type Genome, type Nurture } from '@mochimon/core'
import { createBlobShadow, Creature, type AnimInput } from '@mochimon/creature'

/** ช่องแสดงสัตว์ 1 ตัว: ผูกกับ element บนหน้าเว็บ แล้ววาดด้วย scissor บน canvas กลาง */
export class Slot {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50)
  creature?: Creature
  genome?: Genome
  nurture: Nurture = { ...DEFAULT_NURTURE }
  spin = false
  yaw = -0.5
  private shadow?: THREE.Mesh
  private readonly turntable = new THREE.Group()

  constructor(readonly el: HTMLElement) {
    this.scene.add(this.turntable)
  }

  set(genome: Genome | undefined, nurture: Nurture = this.nurture): void {
    this.genome = genome
    this.nurture = { ...nurture }
    this.creature?.dispose()
    this.creature = undefined
    if (this.shadow) {
      this.shadow.removeFromParent()
      this.shadow.geometry.dispose()
      ;(this.shadow.material as THREE.Material).dispose()
      this.shadow = undefined
    }
    if (!genome) return
    const creature = new Creature(express(genome), this.nurture)
    this.creature = creature
    this.turntable.add(creature.root)
    this.shadow = createBlobShadow(creature.footprint)
    this.turntable.add(this.shadow)
    this.frame()
  }

  /** จัดกล้องให้เห็นทั้งตัว */
  private frame(): void {
    const size = this.creature?.size
    if (!size) return
    const extent = Math.max(size.y, size.x * 0.9, size.z * 0.9, 0.5)
    const dist = extent * 3.3 + 0.6
    const cy = size.y * 0.48
    this.camera.position.set(0, cy + dist * 0.2, dist)
    this.camera.lookAt(0, cy, 0)
  }

  update(dt: number, input?: Partial<AnimInput>): void {
    if (this.spin) this.yaw += dt * 0.5
    this.turntable.rotation.y = this.yaw
    this.creature?.update(dt, input)
  }

  render(renderer: THREE.WebGLRenderer, canvasHeight: number): void {
    if (!this.creature) return
    const rect = this.el.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > canvasHeight || rect.width === 0) return
    const y = canvasHeight - rect.bottom
    renderer.setViewport(rect.left, y, rect.width, rect.height)
    renderer.setScissor(rect.left, y, rect.width, rect.height)
    this.camera.aspect = rect.width / rect.height
    this.camera.updateProjectionMatrix()
    renderer.render(this.scene, this.camera)
  }
}
