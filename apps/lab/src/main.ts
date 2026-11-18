import * as THREE from 'three'
import * as core from '@mochimon/core'
import {
  breed,
  composeBody,
  createFounder,
  createMochi,
  DEFAULT_NURTURE,
  EMOTION_NAME_TH,
  express,
  geneDb,
  Rng,
  speciesLabel,
  summonFromFile,
  TRAIT_KEYS,
  TRAIT_NAME_TH,
  type EmotionLabel,
  type ExpressedPart,
  type Genome,
  type LifeStage,
  type MutationEvent,
  type Nurture,
} from '@mochimon/core'
import { loadPartPack, setPartPack, type PoseName } from '@mochimon/creature'
import { HABITAT_KINDS, HABITAT_NAME_TH } from '@mochimon/habitat'
import { extractPalette, hashFile } from './palette'
import { Slot } from './slot'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
/** ?seed=... ทำให้ผลสุ่มทั้งหน้าทำซ้ำได้ (ใช้ตอนจับภาพทดสอบ) */
const rng = new Rng(params.get('seed') ?? String(Date.now()))

// ───────── renderer กลาง 1 ตัว วาดทุกช่องด้วย scissor ─────────
const canvas = $<HTMLCanvasElement>('gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
// ตั้งค่าสีล้างจอให้โปร่งใสตั้งแต่ก่อนวาดเฟรมแรก (ค่าตั้งต้นของ WebGL state ใน three คือทึบ)
renderer.setClearColor(0x000000, 0)
renderer.setScissorTest(true)
const slots: Slot[] = []
const thumbFur = (params.get('fur') ?? 'medium') as 'off' | 'medium' | 'high'
const newSlot = (el: HTMLElement) => {
  const slot = new Slot(el)
  slot.options = { fur: thumbFur }
  slots.push(slot)
  return slot
}

// ───────── state ─────────
const stage = newSlot($('stage'))
stage.spin = true
const parentA = newSlot($('parent-a'))
const parentB = newSlot($('parent-b'))
let nurture: Nurture = { ...DEFAULT_NURTURE }
let emotion: EmotionLabel = 'content'
let selectedNote = ''

const HABITAT_TH = { land: 'บก', sky: 'ท้องฟ้า', water: 'ใต้น้ำ', amphibious: 'สะเทินน้ำสะเทินบก' }
const BUILD_TH = { thin: 'ผอม', fit: 'ฟิต', balanced: 'สมส่วน', chubby: 'เจ้าเนื้อ', round: 'อ้วนกลม' }
const KIND_TH = {
  image: 'รูปภาพ',
  audio: 'เสียง/เพลง',
  video: 'วิดีโอ',
  document: 'เอกสาร',
  code: 'โค้ด',
  archive: 'ไฟล์บีบอัด',
  data: 'ข้อมูล',
  other: 'อื่นๆ',
}
const SLOT_ROWS: [keyof ReturnType<typeof express>['parts'], string][] = [
  ['head', 'หัว'],
  ['ears', 'หู'],
  ['horns', 'เขา'],
  ['wings', 'ปีก'],
  ['tail', 'หาง'],
  ['limbs', 'แขนขา'],
  ['eyes', 'ตา'],
  ['pattern', 'ลวดลาย'],
  ['special', 'พิเศษ'],
  ['mask', 'ลายแต้ม'],
  ['socks', 'ถุงเท้า'],
  ['tailmark', 'ลายหาง'],
  ['symbol', 'สัญลักษณ์'],
]

function describeMutations(mutations: MutationEvent[]): string {
  if (mutations.length === 0) return ''
  const novel = mutations.filter((m) => m.kind === 'novel').length
  return novel > 0 ? `✨ กลายพันธุ์พิเศษ ×${novel}` : `กลายพันธุ์ ×${mutations.length}`
}

function select(genome: Genome, note = ''): void {
  selectedNote = note
  stage.options = {
    fur: $<HTMLSelectElement>('fur').value as 'off' | 'medium' | 'high',
    collar: $<HTMLInputElement>('collar').checked,
  }
  stage.set(genome, nurture)
  renderInfo()
}

function renderInfo(): void {
  const genome = stage.genome
  if (!genome) return
  const p = express(genome)
  const body = composeBody(p, nurture)
  $('pet-title').textContent = speciesLabel(genome).th
  const tags = [
    `รุ่นที่ ${genome.generation}`,
    `ถิ่น: ${HABITAT_TH[p.habitat]}`,
    `รูปร่าง: ${BUILD_TH[body.build]}`,
    ...Object.entries(genome.ancestry)
      .sort((a, b) => b[1] - a[1])
      .map(([id, share]) => `${geneDb.species[id]?.name.th ?? id} ${Math.round(share * 100)}%`),
  ]
  $('pet-tags').innerHTML =
    tags.map((t) => `<span class="tag">${t}</span>`).join('') +
    (selectedNote ? `<span class="tag hot">${selectedNote}</span>` : '')

  const partCell = (part: ExpressedPart) =>
    `${part.def.name.th}${part.codominant ? ' <span class="hidden-gene">(เด่นร่วม)</span>' : ''}` +
    (part.hidden ? ` <span class="hidden-gene">(ซ่อน: ${part.hidden.name.th})</span>` : '')
  const swatch = (hex: string) => `<span class="swatch" style="background:${hex}"></span>${hex}`
  $('genes').innerHTML = `<table>
    ${SLOT_ROWS.map(([key, label]) => `<tr><td>${label}</td><td>${partCell(p.parts[key])}</td></tr>`).join('')}
    <tr><td>สีหลัก / ท้อง</td><td>${swatch(p.colors.base.hex)} &nbsp; ${swatch(p.colors.belly.hex)}</td></tr>
    <tr><td>สีลาย / เขา-ปีก</td><td>${swatch(p.colors.pattern.hex)} &nbsp; ${swatch(p.colors.accent.hex)}</td></tr>
    <tr><td>สีลายแต้ม / ในหู</td><td>${swatch(p.colors.mark.hex)} &nbsp; ${swatch(p.colors.inner.hex)}</td></tr>
    <tr><td>สีตา</td><td>${swatch(p.colors.eye.hex)}</td></tr>
  </table>`
  $('temper').innerHTML = `<table>${TRAIT_KEYS.map(
    (key) =>
      `<tr><td>${TRAIT_NAME_TH[key]}</td><td><div class="bar"><i style="width:${Math.round(
        p.temperament[key] * 100,
      )}%"></i></div></td></tr>`,
  ).join('')}</table>`
}

/** สร้างการ์ดย่อ (thumbnail) ที่คลิกเลือกได้ */
function thumb(container: HTMLElement, title: string, note: string, onClick: () => void): Slot {
  const card = document.createElement('div')
  card.className = 'thumb'
  card.innerHTML = `<div class="slot"></div><div>${title}</div><div class="note">${note}</div>`
  card.addEventListener('click', onClick)
  container.append(card)
  return newSlot(card.querySelector('.slot') as HTMLElement)
}

// ───────── แกลเลอรีสายพันธุ์ ─────────
const speciesIds = Object.keys(geneDb.species)
const LINEAGE_TH = { modern: 'ปัจจุบัน', prehistoric: 'ดึกดำบรรพ์', mythical: 'เทพนิยาย' }
for (const id of speciesIds) {
  const sp = geneDb.species[id]!
  const slot: Slot = thumb($('gallery'), sp.name.th, LINEAGE_TH[sp.lineage], () => {
    slot.set(createFounder(id, rng))
    select(slot.genome!)
  })
  slot.set(createFounder(id, rng))
}

// ตัวเอก "โมจิ" (แมว×มังกร) — ใส่ปลอกคอ + ขนคุณภาพสูง
{
  const slot: Slot = thumb($('gallery'), 'โมจิ ★', 'ตัวเอก', () => select(slot.genome!))
  slot.options = { fur: thumbFur, collar: true }
  slot.set(createMochi())
  $('gallery').prepend(slot.el.parentElement!)
}

// ───────── ผสมพันธุ์ ─────────
function setParent(which: 'a' | 'b', genome: Genome): void {
  const slot = which === 'a' ? parentA : parentB
  slot.set(genome)
  $(`parent-${which}-name`).textContent = `${which.toUpperCase()}: ${speciesLabel(genome).th}`
}
const offspringSlots: Slot[] = []
function breedNow(): void {
  if (!parentA.genome || !parentB.genome) return
  const container = $('offspring')
  for (const slot of offspringSlots) {
    slot.set(undefined)
    slots.splice(slots.indexOf(slot), 1)
  }
  offspringSlots.length = 0
  container.innerHTML = ''
  const mutationRate = Number($<HTMLInputElement>('mutation').value)
  for (let i = 0; i < 6; i++) {
    const { genome, mutations } = breed(parentA.genome, parentB.genome, rng, { mutationRate })
    const note = describeMutations(mutations)
    const slot = thumb(container, speciesLabel(genome).en, note, () => select(genome, note))
    slot.set(genome, { ...DEFAULT_NURTURE, stage: 'baby' })
    offspringSlots.push(slot)
  }
}
$('to-a').addEventListener('click', () => stage.genome && setParent('a', stage.genome))
$('to-b').addEventListener('click', () => stage.genome && setParent('b', stage.genome))
$('breed').addEventListener('click', breedNow)
$<HTMLInputElement>('mutation').addEventListener('input', (e) => {
  const value = Number((e.target as HTMLInputElement).value)
  $('mutation-out').textContent = `${(value * 100).toFixed(1)}%`
})

// ───────── ปรับการเลี้ยงดู / อารมณ์ ─────────
const refreshBody = () => {
  nurture = {
    stage: $<HTMLSelectElement>('stage-select').value as LifeStage,
    fat: Number($<HTMLInputElement>('fat').value),
    fitness: Number($<HTMLInputElement>('fitness').value),
  }
  if (stage.genome) select(stage.genome, selectedNote)
}
for (const id of ['stage-select', 'fat', 'fitness', 'fur', 'collar'])
  $(id).addEventListener('input', refreshBody)
const emotionSelect = $<HTMLSelectElement>('emotion')
for (const [value, label] of Object.entries(EMOTION_NAME_TH)) {
  emotionSelect.add(new Option(label, value, value === 'content', value === 'content'))
}
emotionSelect.addEventListener('input', () => {
  emotion = emotionSelect.value as EmotionLabel
})
$<HTMLInputElement>('spin').addEventListener('input', (e) => {
  stage.spin = (e.target as HTMLInputElement).checked
})

// ───────── ชุดชิ้นส่วน 3D จากไฟล์ .glb ─────────
async function importParts(data: ArrayBuffer, label: string): Promise<void> {
  let tags: string[]
  try {
    const pack = await loadPartPack(data)
    setPartPack(pack)
    tags = [
      `ชุดชิ้นส่วน: ${label}`,
      ...pack.report.used.map((u) => `✅ ${u.key} (${u.name})`),
      ...pack.report.unknown.map((u) => `❓ ไม่รู้จัก: ${u}`),
      ...pack.report.problems.map((u) => `⚠️ ${u}`),
    ]
  } catch (error) {
    tags = [`⚠️ ${(error as Error).message}`]
  }
  // สร้างทุกช่องใหม่ด้วยชิ้นส่วนชุดใหม่
  for (const slot of [stage, ...slots]) if (slot.genome) slot.set(slot.genome, slot.nurture)
  $('summon-info').innerHTML = tags.map((t) => `<span class="tag">${t}</span>`).join('')
}

// ───────── อัญเชิญจากไฟล์ ─────────
async function summon(file: File): Promise<void> {
  if (/\.glb$/i.test(file.name)) return importParts(await file.arrayBuffer(), file.name)
  const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : ''
  const [hashHex, palette] = await Promise.all([hashFile(file), extractPalette(file)])
  const ageYears = Math.max(0, (Date.now() - file.lastModified) / (365.25 * 24 * 3600 * 1000))
  const result = summonFromFile({ hashHex, size: file.size, ext, ageYears, palette })
  const note = result.fossil ? '🦴 ไข่ฟอสซิล' : '🥚 อัญเชิญจากไฟล์'
  select(result.genome, note)
  $('summon-info').innerHTML = [
    `ชนิดไฟล์: ${KIND_TH[result.kind]}`,
    `ขนาด: ${(file.size / 1024).toFixed(1)} KB`,
    `อายุไฟล์: ${ageYears.toFixed(1)} ปี`,
    `hash: ${hashHex.slice(0, 12)}…`,
    ...(palette.length ? [`สีจากภาพ: ${palette.length} สี`] : []),
  ]
    .map((t) => `<span class="tag">${t}</span>`)
    .join('')
  $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' })
}
const drop = $('drop')
const fileInput = $<HTMLInputElement>('file')
drop.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => fileInput.files?.[0] && void summon(fileInput.files[0]))
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  const file = e.dataTransfer?.files[0]
  if (file) void summon(file)
})

// ───────── ฉากไดโอรามา ─────────
for (const kind of HABITAT_KINDS) {
  const slot = thumb($('habitats'), HABITAT_NAME_TH[kind], '', () => {})
  slot.el.style.height = '200px'
  slot.options = { fur: thumbFur }
  slot.yaw = 0.35
  slot.setHabitat(kind)
  slot.set(createFounder(rng.pick(speciesIds), rng), { ...DEFAULT_NURTURE, stage: 'child' })
}

// ───────── เริ่มต้น ─────────
select(createMochi())
setParent('a', createFounder(params.get('a') ?? 'cat', rng))
setParent('b', createFounder(params.get('b') ?? 'dragon', rng))
breedNow()

const clock = new THREE.Clock()
function loop(): void {
  const dt = Math.min(clock.getDelta(), 0.1)
  const w = innerWidth
  const h = innerHeight
  if (
    canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(h * renderer.getPixelRatio())
  ) {
    renderer.setSize(w, h, false)
  }
  renderer.setScissorTest(false)
  renderer.clear()
  renderer.setScissorTest(true)
  const walking = $<HTMLInputElement>('walk').checked
  const asleep = $<HTMLInputElement>('sleep').checked
  const pose = $<HTMLSelectElement>('pose').value as PoseName | 'auto'
  for (const slot of slots) {
    slot.update(
      dt,
      slot === stage ? { emotion, speed: walking ? 0.6 : 0, asleep, pose } : undefined,
    )
    slot.render(renderer, h)
  }
  requestAnimationFrame(loop)
}
loop()

// สำหรับการทดสอบอัตโนมัติ
Object.assign(window, {
  __lab: {
    select,
    setParent,
    breedNow,
    stage,
    slots,
    core,
    importParts,
    clearParts: () => setPartPack(null),
  },
})
