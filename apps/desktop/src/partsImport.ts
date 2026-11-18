import { activePartPack, loadPartPack, setPartPack, type PackReport } from '@mochimon/creature'
import { clearPartFile, loadPartFile, setKeyboardFocus, storePartFile } from './bridge'
import { pets, walkers } from './game'
import { clearPortraits } from './portrait'
import { button, el, rectOf } from './ui'
import { guestActor } from './visitors'
import { layout, uiLayer } from './world'

/**
 * นำเข้าชุดชิ้นส่วน 3D (.glb) ที่ออกแบบด้วยโปรแกรมอื่น (คู่มือ: docs/PARTS_GUIDE.md)
 * หู/เขา/ปีก/หางที่ชื่อตรงกันจะถูกแทนด้วยชิ้นจากไฟล์ — ยีนส์ สี ขน ท่าทาง ยังทำงานเหมือนเดิม
 */
const root = el('div', 'panel parts-panel')
root.hidden = true
uiLayer.append(root)
const picker = el('input')
picker.type = 'file'
picker.accept = '.glb,model/gltf-binary'
picker.hidden = true
document.body.append(picker)

let report: PackReport | null = null
let message = ''
let fileName = ''

export const partsOpen = (): boolean => !root.hidden
export const partsRect = (): { x: number; y: number; w: number; h: number } | null =>
  root.hidden ? null : rectOf(root)

export function openParts(): void {
  root.hidden = false
  render()
}
export function closeParts(): void {
  root.hidden = true
}
export function toggleParts(): void {
  if (partsOpen()) closeParts()
  else openParts()
}

/** สร้างโมเดลของทุกตัวบนจอใหม่ด้วยชุดชิ้นส่วนปัจจุบัน */
function remodelAll(): void {
  clearPortraits()
  for (const actor of [...pets, ...walkers]) actor.remodel()
  guestActor()?.remodel()
}

/** ใช้ไฟล์ .glb เป็นชุดชิ้นส่วน — คืนรายงานผล (โยน Error ถ้าอ่านไม่ได้) */
export async function applyPartFile(
  bytes: ArrayBuffer,
  name: string,
  store = true,
): Promise<PackReport> {
  const pack = await loadPartPack(bytes)
  setPartPack(pack)
  report = pack.report
  fileName = name
  remodelAll()
  if (store) await storePartFile(bytes).catch(() => undefined)
  return pack.report
}

export async function resetParts(): Promise<void> {
  setPartPack(null)
  report = null
  fileName = ''
  message = 'กลับไปใช้ชิ้นส่วนเดิมแล้ว'
  remodelAll()
  await clearPartFile()
  render()
}

/** ตอนเปิดแอป: โหลดชุดที่นำเข้าไว้ครั้งก่อน */
export async function startParts(): Promise<void> {
  const bytes = await loadPartFile()
  if (!bytes) return
  try {
    await applyPartFile(bytes, 'ชุดที่นำเข้าไว้', false)
  } catch {
    // ไฟล์เสีย → ใช้ชิ้นส่วนเดิม
  }
}

async function importFile(file: File): Promise<void> {
  message = 'กำลังอ่านไฟล์…'
  render()
  try {
    const r = await applyPartFile(await file.arrayBuffer(), file.name)
    message =
      r.used.length > 0
        ? `ใช้ได้ ${r.used.length} ชิ้น — สัตว์ทุกตัวเปลี่ยนแล้ว`
        : 'ไม่มีชิ้นไหนใช้ได้ — ดูชื่อ node ในคู่มือ'
  } catch (error) {
    message = (error as Error).message
  }
  render()
}

picker.addEventListener('change', () => {
  setKeyboardFocus(false)
  const file = picker.files?.[0]
  if (file) void importFile(file)
})
picker.addEventListener('cancel', () => setKeyboardFocus(false))

function render(): void {
  if (root.hidden) return
  const head = el('div', 'panel-header')
  head.append(
    el('div', 'panel-name', 'ชิ้นส่วน 3D'),
    button('×', closeParts, 'panel-icon panel-close'),
  )
  const choose = button(
    'เลือกไฟล์ .glb…',
    () => {
      setKeyboardFocus(true)
      picker.value = ''
      picker.click()
    },
    'primary',
  )
  const body: HTMLElement[] = [
    head,
    el(
      'div',
      'panel-hint',
      'หู เขา ปีก หาง ที่ตั้งชื่อตรงกับรูปทรงในเกม (เช่น ears.point, wings.bat) จะถูกแทนด้วยชิ้นจากไฟล์ — สีและขนยังมาจากยีนส์',
    ),
    choose,
  ]
  if (message) body.push(el('div', 'altar-status', message))
  const current = report ?? activePartPack()?.report ?? null
  if (current) {
    body.push(el('div', 'list-head', `ใช้อยู่: ${fileName || 'ชุดที่นำเข้า'}`))
    const chips = el('div', 'dex-chips')
    for (const u of current.used) chips.append(el('span', 'chip', `✅ ${u.name} (${u.key})`))
    for (const u of current.unknown) chips.append(el('span', 'chip unknown', `❓ ${u}`))
    body.push(chips)
    for (const n of current.notes) body.push(el('div', 'panel-hint', `ℹ️ ${n}`))
    for (const p of current.problems) body.push(el('div', 'panel-hint', `⚠️ ${p}`))
    body.push(button('กลับไปใช้ชิ้นส่วนเดิม', () => void resetParts()))
  }
  body.push(el('div', 'panel-hint', 'วิธีทำไฟล์ (ใช้ ChatGPT + Blender ได้): docs/PARTS_GUIDE.md'))
  root.replaceChildren(...body)
  root.style.left = `${Math.round((layout.width - root.offsetWidth) / 2)}px`
  root.style.top = `${Math.max(8, layout.groundY - root.offsetHeight - 16)}px`
}

export function updateParts(): void {
  if (root.hidden) return
  root.style.left = `${Math.round((layout.width - root.offsetWidth) / 2)}px`
  root.style.top = `${Math.max(8, layout.groundY - root.offsetHeight - 16)}px`
}
