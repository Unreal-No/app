import * as THREE from 'three'
import {
  carePet,
  petEvent,
  Rng,
  tickPet,
  viewPet,
  type Behavior,
  type EmotionLabel,
  type PetState,
} from '@mochimon/core'
import { createBlobShadow, Creature } from '@mochimon/creature'
import { getLayout, onCursor, onTray, setHitShapes, type DesktopLayout } from './bridge'
import { loadPet, newPet, savePet } from './save'

/** ขนาดบนจอ: 1 หน่วยโมเดล = กี่ CSS px */
const PX_PER_UNIT = 130
const WALK_SPEED = 60
const GRAVITY = 2600
const EDGE_MARGIN = 70

const canvas = document.getElementById('gl') as HTMLCanvasElement
const fx = document.getElementById('fx') as HTMLDivElement
const rng = new Rng(String(Date.now()))

// ───────── ฉาก: กล้อง orthographic หน่วยเป็น px, จุดกำเนิดมุมซ้ายล่าง ─────────
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
renderer.setClearColor(0x000000, 0)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000)
let layout: DesktopLayout = { width: innerWidth, height: innerHeight, groundY: innerHeight - 48 }

function applyLayout(next: DesktopLayout): void {
  layout = next
  renderer.setSize(layout.width, layout.height, false)
  camera.right = layout.width
  camera.top = layout.height
  camera.updateProjectionMatrix()
}
/** ความสูงของพื้น (ขอบบน Taskbar) ในพิกัดโลก (y ชี้ขึ้น) */
const groundLevel = () => layout.height - layout.groundY

// ───────── ตัวสัตว์บนจอ ─────────
class PetActor {
  state: PetState
  creature!: Creature
  emotion: EmotionLabel = 'content'
  readonly holder = new THREE.Group()
  private shadow?: THREE.Mesh
  x = 0
  y = 0
  private vy = 0
  private facing: 1 | -1 = 1
  private yaw = 0.3
  private targetX: number | null = null
  private squash = 0
  held = false
  private grabOffset = { x: 0, y: 0 }
  private fallFrom = 0

  constructor(state: PetState) {
    this.state = state
    this.holder.rotation.x = 0.14 // ก้มกล้องเล็กน้อยให้เห็นมิติ
    scene.add(this.holder)
    this.rebuild()
    this.x = layout.width * rng.range(0.3, 0.7)
    this.y = groundLevel()
  }

  /** สร้างโมเดลใหม่จากยีนส์ + สภาพร่างกายปัจจุบัน */
  rebuild(): void {
    this.creature?.dispose()
    if (this.shadow) {
      this.shadow.removeFromParent()
      this.shadow.geometry.dispose()
      ;(this.shadow.material as THREE.Material).dispose()
    }
    const view = viewPet(this.state)
    this.emotion = view.emotionLabel
    this.creature = new Creature(view.phenotype, this.state.nurture)
    this.holder.add(this.creature.root)
    this.shadow = createBlobShadow(this.creature.footprint, 0.2)
    this.holder.add(this.shadow)
  }

  get heightPx(): number {
    return this.creature.size.y * PX_PER_UNIT
  }
  /** วงกลมพื้นที่จับต้องได้ (พิกัดจอ: จุดกำเนิดมุมซ้ายบน) */
  get hit(): { x: number; y: number; r: number } {
    const r = Math.max(this.heightPx * 0.55, this.creature.footprint * PX_PER_UNIT * 1.2)
    return { x: this.x, y: layout.height - (this.y + this.heightPx * 0.5), r }
  }

  contains(px: number, py: number): boolean {
    const h = this.hit
    return Math.hypot(px - h.x, py - h.y) <= h.r
  }

  grab(px: number, py: number): void {
    this.held = true
    this.grabOffset = { x: this.x - px, y: this.y - (layout.height - py) }
    this.state = petEvent(this.state, 'pickedUp')
  }
  dragTo(px: number, py: number): void {
    const prevX = this.x
    this.x = THREE.MathUtils.clamp(px + this.grabOffset.x, 20, layout.width - 20)
    this.y = Math.max(groundLevel(), layout.height - py + this.grabOffset.y)
    if (Math.abs(this.x - prevX) > 0.5) this.facing = this.x > prevX ? 1 : -1
  }
  release(): void {
    this.held = false
    this.vy = 0
    this.fallFrom = this.y
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
        // เดินไปอยู่ข้างๆ เคอร์เซอร์ ไม่ยืนทับ
        const side = cursor.x > this.x ? -1 : 1
        this.targetX = THREE.MathUtils.clamp(cursor.x + side * 90, min, max)
        break
      }
      case 'hide':
        this.targetX = cursor.x > layout.width / 2 ? min : max
        break
      default:
        this.targetX = null
    }
  }

  update(dt: number): void {
    const behavior = this.state.behavior
    const asleep = behavior === 'sleep'
    const ground = groundLevel()
    let moving = false

    if (this.held) {
      this.targetX = null
    } else if (this.y > ground + 0.5 || this.vy !== 0) {
      // ร่วงลงพื้น
      this.vy -= GRAVITY * dt
      this.y += this.vy * dt
      if (this.y <= ground) {
        this.y = ground
        this.vy = 0
        this.squash = 1
        if (this.fallFrom - ground > 320) {
          this.state = petEvent(this.state, 'dropped')
          say(this, 'โอ๊ย!')
        }
      }
    } else {
      this.y = ground
      this.pickTarget(behavior)
      if (this.targetX !== null && !asleep) {
        const dx = this.targetX - this.x
        if (Math.abs(dx) > 6) {
          const speed =
            WALK_SPEED * (behavior === 'zoomies' ? 3 : 1) * (0.7 + this.creature.size.y * 0.5)
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt)
          this.facing = dx > 0 ? 1 : -1
          moving = true
        } else if (behavior === 'wander' || behavior === 'zoomies') {
          this.targetX = null
          if (behavior === 'wander') this.state = { ...this.state, behaviorTimer: 0 }
        }
      }
    }

    // หันข้างตอนเดิน หันเฉียงมาทางกล้องตอนยืน
    const yawTarget = this.facing * (moving ? 1.15 : 0.35)
    this.yaw = THREE.MathUtils.damp(this.yaw, yawTarget, 8, dt)
    this.squash = Math.max(0, this.squash - dt * 5)
    const sq = Math.sin(this.squash * Math.PI) * 0.18
    this.holder.position.set(this.x, this.y, 0)
    this.holder.scale.set(PX_PER_UNIT * (1 + sq), PX_PER_UNIT * (1 - sq), PX_PER_UNIT)
    this.creature.root.rotation.y = this.yaw
    if (this.shadow) this.shadow.visible = !this.held && this.y <= ground + 2

    const hit = this.hit
    const look = cursorSeen ? THREE.MathUtils.clamp((cursor.x - hit.x) / 380, -1, 1) : 0
    this.creature.update(dt, {
      speed: moving ? (behavior === 'zoomies' ? 1 : 0.6) : 0,
      emotion: this.emotion,
      asleep: asleep && !this.held,
      held: this.held,
      flying: this.held,
      lookX: THREE.MathUtils.clamp(look - this.yaw * 0.6, -1, 1),
      lookY: cursorSeen ? THREE.MathUtils.clamp((hit.y - cursor.y) / 380, -1, 1) : 0,
    })
  }
}

// ───────── คำพูด + เอฟเฟกต์ ─────────
const LINES: Record<EmotionLabel, string[]> = {
  joyful: ['♪', 'วันนี้ดีจัง~', 'อิอิ'],
  content: ['อยู่นี่นะ', 'ฮัมม~', '…♪'],
  excited: ['เย้!', 'เล่นกัน!', 'ว้าว!'],
  sleepy: ['ง่วงจัง…', 'หาววว', 'zzz'],
  hungry: ['หิวแล้วน้า', 'ขอขนมหน่อย~', 'ท้องร้องแล้ว…'],
  lonely: ['มาเล่นด้วยกันหน่อย', 'เหงาจัง…'],
  bored: ['เบื่ออ่า', 'ทำอะไรดี…'],
  grumpy: ['ฮึ!', 'งอนแล้ว'],
  sad: ['ฮือ…', '…'],
  scared: ['ว้าย!', '!!'],
}
const bubble = document.createElement('div')
bubble.className = 'bubble'
fx.append(bubble)
let bubbleTimer = 0
let quiet = false

function say(actor: PetActor, text?: string): void {
  if (quiet && !text) return
  bubble.textContent = text ?? rng.pick(LINES[actor.emotion])
  bubble.classList.add('show')
  bubbleTimer = 2.6
}
function hearts(actor: PetActor): void {
  const hit = actor.hit
  for (let i = 0; i < 3; i++) {
    const heart = document.createElement('div')
    heart.className = 'heart'
    heart.textContent = '♥'
    heart.style.left = `${hit.x + rng.range(-24, 24)}px`
    heart.style.top = `${hit.y - hit.r * 0.6}px`
    heart.style.setProperty('--dx', `${rng.range(-20, 20)}px`)
    heart.style.animationDelay = `${i * 0.12}s`
    fx.append(heart)
    setTimeout(() => heart.remove(), 1500)
  }
}

// ───────── เคอร์เซอร์ + การจับ/ลูบ ─────────
const cursor = { x: -9999, y: -9999 }
let cursorSeen = false
onCursor((x, y) => {
  cursor.x = x
  cursor.y = y
  cursorSeen = true
})

let pet: PetActor
let press: { x: number; y: number; time: number; dragging: boolean } | null = null

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !pet.contains(e.clientX, e.clientY)) return
  canvas.setPointerCapture(e.pointerId)
  press = { x: e.clientX, y: e.clientY, time: performance.now(), dragging: false }
})
canvas.addEventListener('pointermove', (e) => {
  if (!press) return
  if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
    press.dragging = true
    pet.grab(press.x, press.y)
  }
  if (press.dragging) pet.dragTo(e.clientX, e.clientY)
})
const endPress = (e: PointerEvent) => {
  if (!press) return
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  if (press.dragging) {
    pet.release()
  } else if (performance.now() - press.time < 600) {
    // คลิกสั้นๆ = ลูบ
    pet.state = carePet(pet.state, 'pet')
    pet.emotion = viewPet(pet.state).emotionLabel
    hearts(pet)
    say(pet)
    savePet(pet.state)
  }
  press = null
}
canvas.addEventListener('pointerup', endPress)
canvas.addEventListener('pointercancel', endPress)

onTray((action) => {
  switch (action) {
    case 'call':
      pet.state = { ...pet.state, behavior: 'followCursor', behaviorTimer: 12 }
      say(pet, 'มาแล้ว~')
      break
    case 'feed':
      pet.state = carePet(pet.state, 'feed')
      say(pet, 'อร่อย!')
      break
    case 'play':
      pet.state = { ...carePet(pet.state, 'play'), behavior: 'zoomies', behaviorTimer: 6 }
      say(pet, 'เย้!')
      break
    case 'quiet-on':
    case 'quiet-off':
      quiet = action === 'quiet-on'
      break
    case 'reroll':
      pet.state = newPet(rng)
      pet.rebuild()
      say(pet, `สวัสดี! ${pet.state.name}เอง`)
      break
  }
  pet.emotion = viewPet(pet.state).emotionLabel
  savePet(pet.state)
})

// ───────── วงรอบหลัก ─────────
let last = performance.now()
let simAccum = 0
let saveAccum = 0
let shapesKey = ''
let lastBehavior: Behavior = 'idle'
let lastRender = 0

function frame(now: number): void {
  requestAnimationFrame(frame)
  // ประหยัดพลังงาน: 30fps ปกติ, ~12fps ตอนหลับ/นั่งนิ่ง
  const resting = !pet.held && (pet.state.behavior === 'sleep' || pet.state.behavior === 'sit')
  if (now - lastRender < (resting ? 80 : 32)) return
  lastRender = now
  const dt = Math.min((now - last) / 1000, 0.25)
  last = now

  // จำลองชีวิตสัตว์ทุก 1 วินาที
  simAccum += dt
  while (simAccum >= 1) {
    simAccum -= 1
    const before = pet.state.nurture
    pet.state = tickPet(
      pet.state,
      1,
      {
        hour: new Date().getHours() + new Date().getMinutes() / 60,
        cursorNear: cursorSeen && Math.hypot(cursor.x - pet.hit.x, cursor.y - pet.hit.y) < 260,
        userActive: true,
        quiet,
      },
      rng,
    )
    pet.emotion = viewPet(pet.state).emotionLabel
    if (pet.state.nurture !== before) pet.rebuild()
    if (pet.state.behavior !== lastBehavior) {
      lastBehavior = pet.state.behavior
      if (lastBehavior === 'seekAttention' || lastBehavior === 'beg') say(pet)
    }
  }
  saveAccum += dt
  if (saveAccum > 20) {
    saveAccum = 0
    savePet(pet.state)
  }

  pet.update(dt)

  // บอก Rust ว่าตรงไหนจับต้องได้ (ตอนลากให้ทั้งจอรับเมาส์ จะได้ไม่หลุดมือ)
  const hit = pet.hit
  const shapes = press?.dragging
    ? [{ x: layout.width / 2, y: layout.height / 2, r: layout.width + layout.height }]
    : [{ x: Math.round(hit.x), y: Math.round(hit.y), r: Math.round(hit.r) }]
  const key = JSON.stringify(shapes)
  if (key !== shapesKey) {
    shapesKey = key
    setHitShapes(shapes)
  }
  canvas.style.cursor = pet.held
    ? 'grabbing'
    : cursorSeen && pet.contains(cursor.x, cursor.y)
      ? 'grab'
      : 'default'

  if (bubbleTimer > 0) {
    bubbleTimer -= dt
    if (bubbleTimer <= 0) bubble.classList.remove('show')
  }
  bubble.style.left = `${hit.x}px`
  bubble.style.top = `${hit.y - hit.r - 14}px`

  renderer.render(scene, camera)
}

async function start(): Promise<void> {
  applyLayout(await getLayout())
  const saved = loadPet()
  pet = new PetActor(saved ?? newPet(rng))
  if (!saved) say(pet, `สวัสดี! ${pet.state.name}เอง`)
  savePet(pet.state)

  // ความละเอียดจอ/ขนาด Taskbar อาจเปลี่ยนระหว่างใช้งาน
  setInterval(() => void getLayout().then(applyLayout), 5000)
  addEventListener('resize', () => void getLayout().then(applyLayout))
  addEventListener('beforeunload', () => savePet(pet.state))
  Object.assign(window, { __pet: () => pet })
  requestAnimationFrame(frame)
}
void start()
