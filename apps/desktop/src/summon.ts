import {
  canSummon,
  createPet,
  newPetId,
  recordSummon,
  summonFromFile,
  summonsLeft,
  type FileFeatures,
  type FileKind,
  type PetState,
} from '@mochimon/core'
import { isTauri, onFileDrop, setKeyboardFocus } from './bridge'
import { featuresFromFile, featuresFromPath, IntakeError } from './fileIntake'
import { floatIcons } from './fx'
import { adopt, allNames, collection, farmHasRoom, hasRoom, pets, saveNow } from './game'
import { pickName } from './store'
import { button, el, rectOf } from './ui'
import { flipY, fxLayer, groundLevel, layout, rng, uiLayer } from './world'

/**
 * แท่นอัญเชิญ: ลากไฟล์จาก Explorer มาวาง หรือกด "เลือกไฟล์…" → ได้ไข่ที่หน้าตาตามไฟล์
 * ใช้แค่ลายนิ้วมือของไฟล์ (hash/ขนาด/อายุ/สีของรูป) ไฟล์เดิมได้ไข่แบบเดิมเสมอ และอัญเชิญได้ไฟล์ละครั้ง
 */
export const KIND_TH: Record<FileKind, string> = {
  image: 'รูปภาพ',
  audio: 'เพลง/เสียง',
  video: 'วิดีโอ',
  document: 'เอกสาร',
  code: 'โค้ด',
  archive: 'ไฟล์บีบอัด',
  data: 'ไฟล์ข้อมูล',
  other: 'ไฟล์ลึกลับ',
}

type Status = { kind: 'idle' | 'hover' | 'busy' | 'done' | 'error'; text: string }

const root = el('div', 'panel altar')
root.hidden = true
uiLayer.append(root)

const circle = el('div', 'altar-circle')
const circleText = el('div', 'altar-circle-text')
circle.append(el('div', 'altar-ring'), el('div', 'altar-ring inner'), circleText)
const statusLine = el('div', 'altar-status')
const quotaLine = el('div', 'panel-hint altar-quota')
const picker = el('input', 'altar-picker')
picker.type = 'file'
picker.hidden = true

let status: Status = { kind: 'idle', text: '' }
let signature = ''

function build(): void {
  const head = el('div', 'panel-header')
  head.append(
    el('div', 'panel-name', 'แท่นอัญเชิญ'),
    button('×', closeAltar, 'panel-icon panel-close'),
  )
  const choose = button('เลือกไฟล์…', choosePicker, 'primary altar-choose')
  root.append(
    head,
    circle,
    choose,
    statusLine,
    quotaLine,
    el(
      'div',
      'panel-hint',
      'ใช้แค่ลายนิ้วมือของไฟล์ — ไฟล์ไม่ถูกเก็บหรือส่งออกจากเครื่อง · ไฟล์ละ 1 ครั้ง · ไฟล์เดิมได้ไข่แบบเดิมเสมอ',
    ),
    picker,
  )
}
build()

export const altarOpen = (): boolean => !root.hidden

export function openAltar(): void {
  root.hidden = false
  if (status.kind !== 'busy') status = { kind: 'idle', text: '' }
  signature = ''
  updateAltar()
}

export function closeAltar(): void {
  root.hidden = true
}

export function toggleAltar(): void {
  if (altarOpen()) closeAltar()
  else openAltar()
}

export const altarRect = (): { x: number; y: number; w: number; h: number } | null =>
  root.hidden ? null : rectOf(root)

function setStatus(kind: Status['kind'], text = ''): void {
  status = { kind, text }
  signature = ''
  updateAltar()
}

export function updateAltar(): void {
  if (root.hidden) return
  const left = summonsLeft(collection.summons, Date.now())
  const next = `${status.kind}|${status.text}|${left}`
  if (next !== signature) {
    signature = next
    circle.dataset.state = status.kind
    circleText.textContent =
      status.kind === 'busy'
        ? 'กำลังอ่านพลังจากไฟล์…'
        : status.kind === 'hover'
          ? 'ปล่อยเลย!'
          : 'ลากไฟล์มาวางตรงนี้'
    statusLine.textContent = status.text
    statusLine.className = `altar-status ${status.kind}`
    quotaLine.textContent = left > 0 ? `วันนี้อัญเชิญได้อีก ${left} ครั้ง` : 'วันนี้พลังเวทหมดแล้ว — พรุ่งนี้มาใหม่นะ'
  }
  root.style.left = `${Math.round((layout.width - root.offsetWidth) / 2)}px`
  root.style.top = `${Math.max(8, layout.groundY - root.offsetHeight - 16)}px`
}

// ───────── รับไฟล์ ─────────
async function intake(read: () => Promise<FileFeatures>): Promise<void> {
  if (status.kind === 'busy') return
  setStatus('busy')
  try {
    const features = await read()
    setStatus(...summonWith(features))
  } catch (error) {
    setStatus('error', error instanceof IntakeError ? error.message : 'อ่านไฟล์นี้ไม่ได้')
  }
}

/** อัญเชิญจากลายนิ้วมือของไฟล์ → [สถานะ, ข้อความ] */
export function summonWith(features: FileFeatures): [Status['kind'], string] {
  const now = Date.now()
  const check = canSummon(collection.summons, features.hashHex, now)
  if (!check.ok) {
    return check.reason === 'used'
      ? ['error', `ไฟล์นี้อัญเชิญ "${check.record.name || 'สัตว์ตัวหนึ่ง'}" มาแล้ว ลองไฟล์อื่นนะ`]
      : ['error', 'วันนี้พลังเวทหมดแล้ว — พรุ่งนี้มาใหม่นะ']
  }
  if (!hasRoom() && !farmHasRoom()) return ['error', 'ทั้งบนจอและฟาร์มเต็มแล้ว']
  const result = summonFromFile(features)
  const name = pickName(rng, allNames())
  const egg: PetState = {
    ...createPet(name, result.genome, { stage: 'egg', fat: 0.35, fitness: 0.4 }, newPetId(rng)),
    bornAt: now,
    origin: { kind: 'summon', fileKind: result.kind, ...(result.fossil ? { fossil: true } : {}) },
  }
  // ไข่ลงข้างแท่น (ตรงกลางถูกแผงบังอยู่)
  const x = Math.min(layout.width - 90, layout.width / 2 + root.offsetWidth / 2 + 70)
  const where = adopt(egg, x)
  if (!where) return ['error', 'ทั้งบนจอและฟาร์มเต็มแล้ว']
  collection.summons = recordSummon(
    collection.summons,
    features.hashHex,
    { at: now, petId: egg.id, name, kind: result.kind },
    now,
  )
  beam(x)
  if (where !== 'farm') {
    // ไข่ลอยลงมาจากลำแสง
    where.y = groundLevel() + 260
    where.say(result.fossil ? 'ไข่ฟอสซิล!' : 'ไข่ใบใหม่! ลูบเพื่อช่วยฟัก', 4)
  } else {
    pets[0]?.say(`ไข่ของ${name}ไปรอที่ฟาร์มนะ`, 4)
  }
  saveNow()
  const what = result.fossil ? 'ไข่ฟอสซิล (ไฟล์เก่ากว่า 8 ปี)' : 'ไข่'
  const placeNote = where === 'farm' ? ' — บนจอเต็ม ไข่ไปรอที่ฟาร์ม' : ''
  return ['done', `${KIND_TH[result.kind]}ให้กำเนิด${what}ของ "${name}"!${placeNote}`]
}

function beam(x: number): void {
  const node = el('div', 'summon-beam')
  node.style.left = `${x}px`
  node.style.top = '0px'
  node.style.height = `${flipY(groundLevel())}px`
  fxLayer.append(node)
  setTimeout(() => node.remove(), 1600)
  floatIcons(x, flipY(groundLevel()) - 40, '✨', 5, 'note')
}

function choosePicker(): void {
  // หน้าต่างเลือกไฟล์ของ Windows ต้องให้หน้าต่างเรารับ focus ชั่วคราว
  setKeyboardFocus(true)
  picker.value = ''
  picker.click()
}
const releasePicker = (): void => setKeyboardFocus(false)
picker.addEventListener('change', () => {
  releasePicker()
  const file = picker.files?.[0]
  if (file) void intake(() => featuresFromFile(file))
})
picker.addEventListener('cancel', releasePicker)

// เบราว์เซอร์ (และ WebView ที่ไม่ได้ใช้ระบบลากวางของ Tauri): HTML drag & drop
circle.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (status.kind !== 'busy' && status.kind !== 'hover') setStatus('hover')
})
circle.addEventListener('dragleave', () => {
  if (status.kind === 'hover') setStatus('idle')
})
circle.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file) void intake(() => featuresFromFile(file))
  else setStatus('idle')
})

// แอปจริง: ไฟล์ที่ลากจาก Explorer (หน้าต่างรับการวางได้เฉพาะบริเวณที่จับต้องได้ เช่น ตัวแท่น)
if (isTauri) {
  onFileDrop((event) => {
    if (event.type === 'leave') {
      if (status.kind === 'hover') setStatus('idle')
      return
    }
    if (event.type === 'over') {
      if (altarOpen() && status.kind !== 'busy') {
        const r = rectOf(root)
        const inside =
          event.x >= r.x && event.x <= r.x + r.w && event.y >= r.y && event.y <= r.y + r.h
        if (inside !== (status.kind === 'hover')) setStatus(inside ? 'hover' : 'idle')
      }
      return
    }
    const path = event.paths[0]
    if (!path) return
    // วางบนตัวสัตว์/แผงอื่นก็นับ: เปิดแท่นให้เห็นผล
    if (!altarOpen()) openAltar()
    void intake(() => featuresFromPath(path))
  })
}
