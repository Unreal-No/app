import * as THREE from 'three'
import { DEFAULT_NURTURE, express, type Genome, type Nurture } from '@mochimon/core'
import { createBlobShadow, Creature, type AnimInput, type BuildOptions } from '@mochimon/creature'
import { createHabitat, type Habitat, type HabitatKind } from '@mochimon/habitat'

/** ช่องแสดงสัตว์/ฉาก 1 ช่อง: ผูกกับ element บนหน้าเว็บ แล้ววาดด้วย scissor บน canvas กลาง */
export class Slot {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(24, 1, 0.1, 80)
  creature?: Creature
  habitat?: Habitat
  genome?: Genome
  nurture: Nurture = { ...DEFAULT_NURTURE }
  options: BuildOptions = { fur: 'medium' }
  /** ค่าที่ส่งให้ animation ทุกเฟรม (ท่าทาง อารมณ์ ฯลฯ) */
  input: Partial<AnimInput> = {}
  /** 'head' = ซูมเฉพาะใบหน้า */
  focus: 'body' | 'head' = 'body'
  /** ขยายภาพในช่อง (1 = พอดีตัว) */
  zoom = 1
  /** ใช้ขนาดอ้างอิงคงที่แทนขนาดของตัวเอง (เทียบขนาดข้ามช่องได้ เช่น ช่วงวัย) */
  fixedExtent?: number
  spin = false
  yaw = -0.5
  private shadow?: THREE.Mesh
  private readonly turntable = new THREE.Group()
  private readonly petHolder = new THREE.Group()

  constructor(readonly el: HTMLElement) {
    this.scene.add(this.turntable)
    this.turntable.add(this.petHolder)
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
    if (genome) {
      const creature = new Creature(express(genome), this.nurture, this.options)
      this.creature = creature
      this.petHolder.add(creature.root)
      if (!this.habitat) {
        this.shadow = createBlobShadow(creature.footprint)
        this.petHolder.add(this.shadow)
      }
    }
    this.frame()
  }

  /** วางฉากไดโอรามา (สัตว์ในช่องนี้จะยืนบนฉาก) */
  setHabitat(kind: HabitatKind | undefined): void {
    this.habitat?.dispose()
    this.habitat = kind ? createHabitat(kind) : undefined
    if (this.habitat) this.turntable.add(this.habitat.root)
    this.frame()
  }

  /** จัดกล้องให้เห็นทั้งตัว/ทั้งฉาก */
  private frame(): void {
    if (this.habitat) {
      // ย่อสัตว์ให้พอดีกับแท่น แล้วยืนบนผิวของฉาก
      this.petHolder.scale.setScalar(0.62)
      this.petHolder.position.set(0, this.habitat.surfaceY, 0.25)
      this.camera.position.set(0, 1.7 / this.zoom + 0.4, 7.4 / this.zoom)
      this.camera.lookAt(0, 0.62, 0)
      return
    }
    this.petHolder.scale.setScalar(1)
    this.petHolder.position.set(0, 0, 0)
    const size = this.creature?.size
    if (!size) return
    if (this.focus === 'head') {
      const dist = (size.y * 2.1 + 0.4) / this.zoom
      this.camera.position.set(0, size.y * 0.66, dist)
      this.camera.lookAt(0, size.y * 0.6, 0)
      return
    }
    const extent = this.fixedExtent ?? Math.max(size.y, size.x * 0.85, size.z * 0.85, 0.5)
    const dist = (extent * 3.1 + 0.5) / this.zoom
    const cy = (this.fixedExtent ?? size.y) * 0.44
    this.camera.position.set(0, cy + dist * 0.09, dist)
    this.camera.lookAt(0, cy, 0)
  }

  update(dt: number, input?: Partial<AnimInput>): void {
    if (this.spin) this.yaw += dt * 0.5
    this.turntable.rotation.y = this.yaw
    this.creature?.update(dt, { ...this.input, ...input })
    this.habitat?.update(dt)
  }

  /** เข้าท่า/สีหน้าปัจจุบันทันที (สำหรับภาพนิ่ง) */
  snap(): void {
    this.creature?.snap(this.input)
    this.turntable.rotation.y = this.yaw
  }

  render(renderer: THREE.WebGLRenderer, canvasHeight: number): void {
    if (!this.creature && !this.habitat) return
    const rect = this.el.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > canvasHeight || rect.width === 0) return
    const y = canvasHeight - rect.bottom
    renderer.setViewport(rect.left, y, rect.width, rect.height)
    renderer.setScissor(rect.left, y, rect.width, rect.height)
    this.camera.aspect = rect.width / rect.height
    this.camera.updateProjectionMatrix()
    // px ต่อหน่วยโมเดล ณ ระยะของกล้อง → ความละเอียดของขน
    const worldHeight = 2 * this.camera.position.z * Math.tan((this.camera.fov * Math.PI) / 360)
    const pxPerUnit = (rect.height * renderer.getPixelRatio()) / worldHeight
    this.creature?.setPixelScale(pxPerUnit * this.petHolder.scale.x)
    renderer.render(this.scene, this.camera)
  }
}
