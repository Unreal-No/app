import * as THREE from 'three'
import {
  LIFE_STAGES,
  petEvent,
  viewPet,
  type Behavior,
  type EmotionLabel,
  type PetState,
  type Temperament,
} from '@mochimon/core'
import { createBlobShadow, Creature } from '@mochimon/creature'
import { Bubble, floatIcons } from './fx'
import { LINES, STAGE_TH } from './text'
import {
  cursor,
  flipY,
  groundLevel,
  layout,
  PX_PER_UNIT,
  restSpot,
  rng,
  scene,
  settings,
  surfaceAt,
} from './world'

const WALK_SPEED = 60
const GRAVITY = 2600
const EDGE_MARGIN = 70
/** ตำแหน่งพักรอบจุดพักผ่อน เรียงตามลำดับของสัตว์ (ไม่ให้กองทับกัน) */
const REST_OFFSETS = [0, -78, 78, -156]

/** สัตว์ 1 ตัวบนจอ: โมเดล 3D + ฟิสิกส์ง่ายๆ + ฟองคำพูด */
export class PetActor {
  state: PetState
  creature!: Creature
  emotion: EmotionLabel = 'content'
  personality!: Temperament
  readonly holder = new THREE.Group()
  readonly bubble = new Bubble()
  private shadow?: THREE.Mesh
  /** ตำแหน่งเท้าในพิกัดโลก (px, y ชี้ขึ้น) */
  x: number
  y: number
  /** ลำดับบนจอ: ใช้เว้นระยะและจัดลำดับหน้า-หลัง */
  slot = 0
  held = false
  /** กำลังเดินอยู่ในเฟรมนี้ */
  moving = false
  /** เวลาที่เหลือของท่าเล่นลูกบอล (วินาที) */
  playTimer = 0
  /** เป้าหมายที่สั่งจากภายนอก (เช่น เดินไปหาคู่) — มาก่อนพฤติกรรมปกติ */
  errand: { x: number; ttl: number; onArrive?: () => void } | null = null
  /** แผงดูแลเปิดอยู่ → ยืนรอ ไม่เดินหนี */
  attending = false
  /** เวลาที่เหลือของท่าอ้อน/กอดหัวใจ (วินาที) */
  loveTimer = 0
  private vy = 0
  private airborne = false
  private fallFrom = 0
  private droppedByUser = false
  private facing: 1 | -1 = 1
  private yaw = 0.3
  private targetX: number | null = null
  private squash = 0
  private grabOffset = { x: 0, y: 0 }
  private built = { stage: '', fat: 0, fitness: 0 }

  constructor(state: PetState, x?: number) {
    this.state = state
    this.holder.rotation.x = 0.14 // ก้มกล้องเล็กน้อยให้เห็นมิติ
    scene.add(this.holder)
    this.x = x ?? layout.width * rng.range(0.25, 0.7)
    this.y = groundLevel()
    this.refresh()
  }

  /** สร้างโมเดลใหม่จากยีนส์ + สภาพร่างกายปัจจุบัน */
  private rebuild(): void {
    this.creature?.dispose()
    if (this.shadow) {
      this.shadow.removeFromParent()
      this.shadow.geometry.dispose()
      ;(this.shadow.material as THREE.Material).dispose()
    }
    const { nurture } = this.state
    this.creature = new Creature(viewPet(this.state).phenotype, nurture, {
      fur: 'medium',
      collar: true,
    })
    this.creature.setPixelScale(PX_PER_UNIT)
    this.holder.add(this.creature.root)
    this.shadow = createBlobShadow(this.creature.footprint, 0.2)
    this.holder.add(this.shadow)
    this.built = { stage: nurture.stage, fat: nurture.fat, fitness: nurture.fitness }
  }

  /** คำนวณอารมณ์/นิสัยใหม่จากสถานะ และสร้างโมเดลใหม่เมื่อรูปร่างเปลี่ยนจนเห็นได้ */
  refresh(): void {
    const view = viewPet(this.state)
    this.emotion = view.emotionLabel
    this.personality = view.personality
    const { stage, fat, fitness } = this.state.nurture
    if (
      !this.creature ||
      stage !== this.built.stage ||
      Math.abs(fat - this.built.fat) > 0.05 ||
      Math.abs(fitness - this.built.fitness) > 0.08
    )
      this.rebuild()
  }

  /** เปลี่ยนสถานะ (จากการจำลอง/การดูแล) พร้อมฉลองเมื่อฟักหรือโตขึ้น */
  setState(next: PetState): void {
    const before = this.state.nurture.stage
    this.state = next
    this.refresh()
    const after = next.nurture.stage
    if (after === before) return
    if (before === 'egg') {
      this.hearts()
      this.say(`แง้~ ${next.name}เกิดแล้ว!`, 4)
    } else if (LIFE_STAGES.indexOf(after) > LIFE_STAGES.indexOf(before)) {
      this.hearts()
      this.say(`${next.name}โตเป็น${STAGE_TH[after]}แล้ว!`, 4)
    }
  }

  get isEgg(): boolean {
    return this.state.nurture.stage === 'egg'
  }
  get heightPx(): number {
    return this.creature.size.y * PX_PER_UNIT
  }
  /** วงกลมพื้นที่จับต้องได้ (พิกัดจอ) */
  get hit(): { x: number; y: number; r: number } {
    const r = Math.max(this.heightPx * 0.55, this.creature.footprint * PX_PER_UNIT * 1.2)
    return { x: this.x, y: flipY(this.y + this.heightPx * 0.5), r }
  }
  contains(px: number, py: number): boolean {
    const h = this.hit
    return Math.hypot(px - h.x, py - h.y) <= h.r
  }

  say(text?: string, seconds?: number): void {
    if (settings.quiet && !text) return
    this.bubble.say(text ?? rng.pick(LINES[this.emotion]), seconds)
  }
  hearts(): void {
    this.float('♥')
  }
  /** ไอคอนลอยขึ้นจากเหนือหัว */
  float(icon: string, className = 'heart'): void {
    const hit = this.hit
    floatIcons(hit.x, hit.y - hit.r * 0.6, icon, 3, className)
  }

  grab(px: number, py: number): void {
    this.held = true
    this.errand = null
    this.grabOffset = { x: this.x - px, y: this.y - flipY(py) }
    this.setState(petEvent(this.state, 'pickedUp'))
  }
  dragTo(px: number, py: number): void {
    const prevX = this.x
    this.x = THREE.MathUtils.clamp(px + this.grabOffset.x, 20, layout.width - 20)
    this.y = Math.max(groundLevel(), flipY(py) + this.grabOffset.y)
    if (Math.abs(this.x - prevX) > 0.5) this.facing = this.x > prevX ? 1 : -1
  }
  /** สั่งให้เดินไปที่ x (ยกเลิกเองถ้าไปไม่ถึงในเวลาที่กำหนด) */
  goTo(x: number, onArrive?: () => void, ttl = 15): void {
    this.errand = { x, ttl, onArrive }
  }
  face(direction: 1 | -1): void {
    this.facing = direction
  }
  release(): void {
    this.held = false
    this.vy = 0
    this.airborne = true
    this.fallFrom = this.y
    this.droppedByUser = true
  }

  private pickTarget(behavior: Behavior): void {
    const min = EDGE_MARGIN
    const max = layout.width - EDGE_MARGIN
    switch (behavior) {
      case 'wander':
      case 'zoomies':
        if (this.targetX === null) this.targetX = rng.range(min, max)
        break
      case 'followCursor':
      case 'seekAttention':
      case 'beg': {
        // เดินไปอยู่ข้างๆ เคอร์เซอร์ ไม่ยืนทับ (แต่ละตัวเว้นระยะต่างกัน จะได้ไม่ซ้อนกัน)
        const side = cursor.x > this.x ? -1 : 1
        this.targetX = THREE.MathUtils.clamp(cursor.x + side * (90 + this.slot * 105), min, max)
        break
      }
      case 'hide':
        this.targetX = cursor.x > layout.width / 2 ? min : max
        break
      case 'sleep':
      case 'sit': {
        // มีฉากมุมพักผ่อน → เดินกลับไปพักบน/ข้างฉาก
        const spot = restSpot()
        this.targetX = spot === null ? null : spot + (REST_OFFSETS[this.slot] ?? 0)
        break
      }
      default:
        this.targetX = null
    }
  }

  /** ถ้ายืนทับเพื่อนอยู่ ให้ขยับออก (ไข่และตัวที่หลับไม่ขยับ) */
  private makeRoom(others: PetActor[]): void {
    if (this.targetX !== null || this.state.behavior === 'sleep') return
    for (const other of others) {
      // ตัวที่กำลังเดินผ่านไม่นับ (เดี๋ยวก็พ้นไปเอง)
      if (other === this || other.held || other.moving) continue
      if (Math.abs(other.y - this.y) > 60) continue
      const gap = (this.hit.r + other.hit.r) * 0.72
      const dx = this.x - other.x
      if (Math.abs(dx) >= gap) continue
      const side = dx !== 0 ? Math.sign(dx) : this.slot > other.slot ? 1 : -1
      this.targetX = THREE.MathUtils.clamp(
        other.x + side * (gap + 6),
        EDGE_MARGIN,
        layout.width - EDGE_MARGIN,
      )
      return
    }
  }

  update(dt: number, others: PetActor[]): void {
    const behavior = this.state.behavior
    const asleep = behavior === 'sleep'
    const ground = surfaceAt(this.x, this.y).y
    let moving = false

    if (this.held) {
      this.targetX = null
      this.airborne = false
    } else if (this.airborne || this.y > ground + 40) {
      if (!this.airborne) {
        // พื้นใต้เท้าหายไป (เดินพ้นขอบ หรือแท่นถูกย้าย)
        this.airborne = true
        this.fallFrom = this.y
        this.droppedByUser = false
      }
      this.vy -= GRAVITY * dt
      this.y += this.vy * dt
      if (this.vy <= 0 && this.y <= ground) {
        this.y = ground
        this.vy = 0
        this.airborne = false
        this.squash = 1
        if (this.droppedByUser && this.fallFrom - ground > 320 && !this.isEgg) {
          this.setState(petEvent(this.state, 'dropped'))
          this.say('โอ๊ย!')
        }
        this.droppedByUser = false
      }
    } else {
      // ขึ้น/ลงแท่นฉากแบบนุ่มๆ
      this.y = THREE.MathUtils.damp(this.y, ground, 14, dt)
      if (this.errand && (this.errand.ttl -= dt) <= 0) this.errand = null
      if (this.isEgg) this.targetX = null
      else if (this.errand) this.targetX = this.errand.x
      else if (this.attending) this.targetX = null
      else {
        this.pickTarget(behavior)
        this.makeRoom(others)
      }
      if (this.targetX !== null) {
        const dx = this.targetX - this.x
        if (Math.abs(dx) > 6) {
          const hurry = behavior === 'zoomies' ? 3 : this.errand ? 1.6 : 1
          const speed = WALK_SPEED * hurry * (0.7 + this.creature.size.y * 0.5)
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt)
          this.facing = dx > 0 ? 1 : -1
          moving = true
        } else if (this.errand) {
          const done = this.errand.onArrive
          this.errand = null
          this.targetX = null
          done?.()
        } else if (behavior === 'wander' || behavior === 'zoomies') {
          this.targetX = null
          if (behavior === 'wander') this.state = { ...this.state, behaviorTimer: 0 }
        } else if (behavior !== 'sit' && behavior !== 'sleep') {
          this.targetX = null
        }
      }
    }

    this.moving = moving
    // หันข้างตอนเดิน หันเฉียงมาทางกล้องตอนยืน
    const yawTarget = this.facing * (moving ? 1.15 : 0.35)
    this.yaw = THREE.MathUtils.damp(this.yaw, yawTarget, 8, dt)
    this.squash = Math.max(0, this.squash - dt * 5)
    const sq = Math.sin(this.squash * Math.PI) * 0.18
    // ตัวที่ถูกอุ้มอยู่หน้าสุด; ตัวอื่นเรียงตามลำดับ ไม่ให้โมเดลทะลุกัน
    this.holder.position.set(this.x, this.y, this.held ? 1600 : this.slot * 300)
    this.holder.scale.set(PX_PER_UNIT * (1 + sq), PX_PER_UNIT * (1 - sq), PX_PER_UNIT)
    this.creature.root.rotation.y = this.yaw
    if (this.shadow) this.shadow.visible = !this.held && !this.airborne

    const hit = this.hit
    const look = cursor.seen ? THREE.MathUtils.clamp((cursor.x - hit.x) / 380, -1, 1) : 0
    this.playTimer = Math.max(0, this.playTimer - dt)
    this.loveTimer = Math.max(0, this.loveTimer - dt)
    this.creature.hatch = this.state.incubation ?? 0
    const wantsLove = this.loveTimer > 0 || behavior === 'beg' || behavior === 'seekAttention'
    const flying = this.held || this.airborne
    this.creature.update(dt, {
      pose:
        moving || flying
          ? 'auto'
          : this.loveTimer > 0
            ? 'love'
            : this.playTimer > 0
              ? 'play'
              : wantsLove
                ? 'love'
                : 'auto',
      speed: moving ? (behavior === 'zoomies' ? 1 : 0.6) : 0,
      emotion: this.emotion,
      asleep: asleep && !flying && !moving && !this.attending,
      held: this.held,
      flying,
      lookX: THREE.MathUtils.clamp(look - this.yaw * 0.6, -1, 1),
      lookY: cursor.seen ? THREE.MathUtils.clamp((hit.y - cursor.y) / 380, -1, 1) : 0,
    })
    this.bubble.update(dt, hit.x, hit.y - hit.r - 14)
  }

  dispose(): void {
    this.creature.dispose()
    this.holder.removeFromParent()
    this.bubble.dispose()
  }
}
