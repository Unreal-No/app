import { createFounder, createPet, geneDb, newPetId, type LifeStage } from '@mochimon/core'
import { HABITAT_KINDS, type HabitatKind } from '@mochimon/habitat'
import * as assist from './assist'
import { focusChipRect, onFocusChipClick, startFocusSession, tickAssistant } from './assist'
import { assistantRect, openAssistant, toggleAssistant, updateAssistant } from './assistant'
import {
  getLayout,
  onCursor,
  onPlatforms,
  onTray,
  quitApp,
  setHitShapes,
  syncMenuState,
  type HitShape,
} from './bridge'
import {
  addEgg,
  addPet,
  callAll,
  care,
  collection,
  companion,
  farm,
  onDiscovery,
  pets,
  recallFromFarm,
  setCompanion,
  restore,
  saveNow,
  tickAll,
} from './game'
import {
  closePanel,
  cyclePanel,
  openPanel,
  panelActor,
  panelRect,
  pickPartner,
  updatePanel,
} from './panel'
import type { PetActor } from './pet'
import { signRect, updateSigns } from './signs'
import { altarRect, openAltar, summonWith, toggleAltar, updateAltar } from './summon'
import { bookRect, openBook, toggleBook, updateBook } from './book'
import { chatRect, openChat, updateChatPanel } from './chatPanel'
import { firstPet, loadSave } from './store'
import {
  applyLayout,
  camera,
  canvas,
  cursor,
  layout,
  mode,
  renderer,
  rng,
  scene,
  setHabitat,
  settings,
  setWindows,
  updateHabitat,
} from './world'

// ───────── เคอร์เซอร์ + การจับ/ลูบ ─────────
onCursor((x, y) => {
  cursor.x = x
  cursor.y = y
  cursor.seen = true
  cursor.movedAt = performance.now()
})

/** สัตว์ที่อยู่ใต้ตำแหน่งนี้ (ตัวที่วาดอยู่หน้าสุดก่อน) */
function petAt(x: number, y: number): PetActor | undefined {
  for (let i = pets.length - 1; i >= 0; i--) if (pets[i]!.contains(x, y)) return pets[i]
  return undefined
}

let press: { actor: PetActor; x: number; y: number; time: number; dragging: boolean } | null = null

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  const actor = petAt(e.clientX, e.clientY)
  if (!actor) return
  canvas.setPointerCapture(e.pointerId)
  press = { actor, x: e.clientX, y: e.clientY, time: performance.now(), dragging: false }
})
canvas.addEventListener('pointermove', (e) => {
  if (!press) return
  if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
    press.dragging = true
    press.actor.grab(press.x, press.y)
  }
  if (press.dragging) press.actor.dragTo(e.clientX, e.clientY)
})
const endPress = (e: PointerEvent) => {
  if (!press) return
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  if (press.dragging) press.actor.release()
  // คลิกสั้นๆ = ลูบ (หรือเลือกคู่ ถ้าแผงกำลังรอให้เลือก)
  else if (performance.now() - press.time < 600 && !pickPartner(press.actor))
    care(press.actor, 'pet')
  press = null
}
canvas.addEventListener('pointerup', endPress)
canvas.addEventListener('pointercancel', endPress)

// คลิกขวาที่สัตว์ = เปิด/ปิดแผงดูแล
addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (e.target !== canvas) return
  const actor = petAt(e.clientX, e.clientY)
  if (!actor) return
  if (panelActor() === actor) closePanel()
  else openPanel(actor)
})

onPlatforms(setWindows)
// ในเบราว์เซอร์ (ไม่มีข้อมูลจาก Windows) การพิมพ์ก็นับว่าผู้ใช้อยู่
addEventListener('keydown', () => (cursor.movedAt = performance.now()))
onFocusChipClick(() => openAssistant('focus'))

// ฟักแล้วเห็นลักษณะใหม่ / โตจนยีนส์แฝงเปิดเผย → บอกผู้ใช้ว่าสมุดสะสมมีของใหม่
onDiscovery((actor, found, species) => {
  // "ไม่มีเขา/ไม่มีปีก" ถูกบันทึกลงสมุดด้วย แต่ไม่ต้องประกาศ
  const names = [
    ...species.map((id) => `สายพันธุ์${geneDb.species[id]?.name.th ?? id}`),
    ...found
      .filter((def) => def.shape !== 'none')
      .map((def) => (def.mutationOnly ? `✨${def.name.th}` : def.name.th)),
  ]
  if (names.length === 0) return
  const shown =
    names.slice(0, 3).join(', ') + (names.length > 3 ? ` และอีก ${names.length - 3}` : '')
  actor.float('✨', 'note')
  actor.say(`ค้นพบ: ${shown}!`, 5)
})

// ───────── เมนู tray ─────────
onTray((action) => {
  switch (action) {
    case 'call':
      callAll()
      break
    case 'feed':
    case 'play':
      for (const actor of [...pets]) care(actor, action)
      break
    case 'quiet-on':
    case 'quiet-off':
      settings.quiet = action === 'quiet-on'
      break
    case 'perch-on':
    case 'perch-off':
      settings.perching = action === 'perch-on'
      break
    case 'fshide-on':
    case 'fshide-off':
      settings.hideOnFullscreen = action === 'fshide-on'
      break
    case 'reroll':
      addEgg()
      break
    case 'farm-recall':
      recallFromFarm()
      break
    case 'panel':
      cyclePanel()
      break
    case 'assistant':
      toggleAssistant()
      return
    case 'chat':
      openChat()
      return
    case 'summon':
      toggleAltar()
      return
    case 'book':
      toggleBook()
      return
    case 'focus-start':
      startFocusSession()
      return
    case 'quit':
      // เซฟให้เสร็จก่อนแล้วค่อยปิด (ฝั่ง Rust มีตัวจับเวลาสำรองถ้าตรงนี้ไม่ตอบ)
      void saveNow().then(quitApp)
      return
    default:
      if (action.startsWith('habitat-')) {
        const kind = action.slice('habitat-'.length)
        setHabitat(HABITAT_KINDS.includes(kind as HabitatKind) ? (kind as HabitatKind) : null)
      }
  }
  saveNow()
})

// ───────── วงรอบหลัก ─────────
let last = performance.now()
let simAccum = 0
let saveAccum = 0
let shapesKey = ''
let lastRender = 0

/** บอก Rust ว่าตรงไหนจับต้องได้ (ตอนลากให้ทั้งจอรับเมาส์ จะได้ไม่หลุดมือ) */
function reportHitShapes(): void {
  const shapes: HitShape[] = press?.dragging
    ? [{ x: layout.width / 2, y: layout.height / 2, r: layout.width + layout.height }]
    : pets.map((actor) => {
        const hit = actor.hit
        return { x: Math.round(hit.x), y: Math.round(hit.y), r: Math.round(hit.r) }
      })
  if (!press?.dragging) {
    for (const rect of [
      panelRect(),
      assistantRect(),
      signRect(),
      focusChipRect(),
      chatRect(),
      altarRect(),
      bookRect(),
    ])
      if (rect) shapes.push(rect)
  }
  const key = JSON.stringify(shapes)
  if (key === shapesKey) return
  shapesKey = key
  setHitShapes(shapes)
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  // ประหยัดพลังงาน: 30fps ปกติ, ~12fps เมื่อทุกตัวหลับ/นั่งนิ่ง
  const resting = pets.every(
    (actor) =>
      !actor.held &&
      !actor.inAir &&
      !actor.moving &&
      (actor.isEgg || actor.state.behavior === 'sleep' || actor.state.behavior === 'sit'),
  )
  if (now - lastRender < (resting ? 80 : 32)) return
  lastRender = now
  const dt = Math.min((now - last) / 1000, 0.25)
  last = now

  // จำลองชีวิตสัตว์ทุก 1 วินาที
  simAccum += dt
  while (simAccum >= 1) {
    simAccum -= 1
    tickAll(1)
  }
  saveAccum += dt
  if (saveAccum > 20) {
    saveAccum = 0
    saveNow()
  }

  for (const actor of pets) actor.update(dt, pets)
  updatePanel()
  tickAssistant()
  updateSigns()
  updateAssistant()
  updateChatPanel()
  updateAltar()
  updateBook()
  reportHitShapes()
  canvas.style.cursor = press?.dragging
    ? 'grabbing'
    : cursor.seen && petAt(cursor.x, cursor.y)
      ? 'grab'
      : 'default'

  updateHabitat(dt)
  renderer.render(scene, camera)
}

async function start(): Promise<void> {
  applyLayout(await getLayout())
  const save = await loadSave()
  // ฉากมุมพักผ่อน: จากที่เซฟไว้ (หรือ ?habitat=... ตอนทดสอบในเบราว์เซอร์)
  const kind = new URLSearchParams(location.search).get('habitat') ?? save?.habitat
  if (HABITAT_KINDS.includes(kind as HabitatKind)) setHabitat(kind as HabitatKind)
  if (save) restore(save)
  else addPet(firstPet()).say('สวัสดี! โมจิเอง', 4)
  saveNow()
  syncMenuState(settings)
  assist.startAssistant()

  // ความละเอียดจอ/ขนาด Taskbar อาจเปลี่ยนระหว่างใช้งาน
  setInterval(() => void getLayout().then(applyLayout), 5000)
  addEventListener('resize', () => void getLayout().then(applyLayout))
  addEventListener('beforeunload', saveNow)
  // สำหรับการทดสอบอัตโนมัติ
  Object.assign(window, {
    __game: {
      pets,
      farm: () => farm,
      saveNow,
      addPet,
      settings,
      openPanel,
      closePanel,
      assist,
      companion: () => companion,
      setCompanion,
      mode,
      collection,
      openAltar,
      openBook,
      summonWith,
      /** สร้างสัตว์สายพันธุ์ที่ระบุบนจอ (ใช้ทดสอบ) */
      spawn: (species: string, stage: LifeStage = 'adult', x?: number) =>
        addPet(
          createPet(
            species,
            createFounder(species, rng),
            { stage, fat: 0.35, fitness: 0.4 },
            newPetId(rng),
          ),
          x,
        ),
    },
  })
  requestAnimationFrame(frame)
}
void start()
