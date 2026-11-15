import * as THREE from 'three'
import {
  breed,
  createFounder,
  createMochi,
  DEFAULT_NURTURE,
  EMOTION_NAME_TH,
  geneDb,
  Rng,
  type Allele,
  type EmotionLabel,
  type Genome,
  type LifeStage,
} from '@mochimon/core'
import type { PoseName } from '@mochimon/creature'
import { HABITAT_KINDS, HABITAT_NAME_TH } from '@mochimon/habitat'
import { Slot } from './slot'

/**
 * หน้า Style Sheet: จัดช่องแบบเดียวกับภาพอ้างอิง (docs/reference/style-sheet.webp)
 * ใช้จับภาพเทียบความคืบหน้าของงานศิลป์ — ?fur=off|medium|high, ?animate=1 ให้ขยับ
 */
const params = new URLSearchParams(location.search)
const fur = (params.get('fur') ?? 'high') as 'off' | 'medium' | 'high'
const animate = params.has('animate')
const rng = new Rng('style-sheet')

const canvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
})
renderer.setPixelRatio(1)
renderer.setSize(1536, 1024, false)
// ตั้งค่าสีล้างจอให้โปร่งใสตั้งแต่ก่อนวาดเฟรมแรก (ค่าตั้งต้นของ WebGL state ใน three คือทึบ)
renderer.setClearColor(0x000000, 0)
renderer.setScissorTest(true)
const slots: Slot[] = []

function cell(containerId: string, label: string, setup: (slot: Slot) => void): Slot {
  const container = document.getElementById(containerId) as HTMLElement
  const el = document.createElement('div')
  el.className = 'cell'
  el.innerHTML = `<div class="slot"></div><div>${label}</div>`
  container.append(el)
  const slot = new Slot(el.querySelector('.slot') as HTMLElement)
  slot.options = { fur }
  slot.yaw = 0.4
  slot.zoom = 1.35
  setup(slot)
  slots.push(slot)
  return slot
}

const P = (id: string): Allele => ({ k: 'p', id })
const C = (l: number, c: number, h: number): Allele => ({ k: 'c', l, c, h, d: 0.5 })
/** แทนที่ยีนส์บางตำแหน่ง (ทั้งสอง allele) */
function withGenes(genome: Genome, genes: Record<string, Allele>): Genome {
  const next = { ...genome, genes: { ...genome.genes } }
  for (const [locus, allele] of Object.entries(genes)) next.genes[locus] = [allele, { ...allele }]
  return next
}

const mochi = createMochi()
const adult = { ...DEFAULT_NURTURE }

// ── ตัวเอก ──
{
  const slot = new Slot(document.getElementById('hero') as HTMLElement)
  slot.options = { fur, collar: true }
  slot.yaw = 0.42
  slot.zoom = 1.3
  slot.input = { emotion: 'excited', emotes: false }
  slot.set(mochi, adult)
  slots.push(slot)
}

// ── Base Models ──
const catBase = withGenes(createFounder('cat', rng), {
  'head.shape': P('head.cat'),
  'ear.type': P('ear.cat'),
  'tail.type': P('tail.fluffy'),
  'marking.mask': P('mask.cape'),
  'pattern.type': P('pattern.plain'),
  'color.base': C(0.975, 0.012, 290),
  'color.mark': C(0.72, 0.11, 280),
  'color.eye': C(0.5, 0.12, 280),
  'fur.length': { k: 'n', v: 0.8 },
})
const dragonBase = withGenes(createFounder('dragon', rng), {
  'limb.type': P('limb.quad'),
  'pattern.type': P('pattern.plain'),
  'color.base': C(0.62, 0.14, 285),
  'color.belly': C(0.94, 0.04, 90),
  'color.accent': C(0.72, 0.15, 320),
  'color.eye': C(0.6, 0.13, 60),
})
const bunnyBase = withGenes(createFounder('bunny', rng), {
  'ear.type': P('ear.bunny'),
  'marking.mask': P('mask.none'),
  'pattern.type': P('pattern.plain'),
  'color.base': C(0.975, 0.008, 80),
  'color.eye': C(0.5, 0.13, 300),
})
for (const [label, genome] of [
  ['Modern (แมว)', catBase],
  ['Mythical (มังกร)', dragonBase],
  ['Modern (กระต่าย)', bunnyBase],
] as const) {
  cell('base', label, (slot) => {
    slot.options = { fur, collar: genome === catBase }
    slot.set(genome, adult)
  })
}

// ── Color Variations ──
const variants: Record<string, Allele>[] = [
  // สามสี
  {
    'color.base': C(0.97, 0.01, 80),
    'color.mark': C(0.75, 0.15, 55),
    'color.pattern': C(0.3, 0.02, 280),
    'pattern.type': P('pattern.patch'),
    'marking.mask': P('mask.cap'),
    'color.eye': C(0.5, 0.12, 280),
  },
  // ดำ
  {
    'color.base': C(0.3, 0.02, 290),
    'color.belly': C(0.36, 0.02, 290),
    'marking.mask': P('mask.none'),
    'pattern.type': P('pattern.plain'),
    'color.eye': C(0.78, 0.17, 140),
  },
  // ขาวฟ้า
  {
    'color.base': C(0.975, 0.01, 240),
    'color.mark': C(0.86, 0.06, 240),
    'marking.mask': P('mask.cap'),
    'pattern.type': P('pattern.plain'),
    'color.eye': C(0.68, 0.13, 235),
  },
  // ชมพู
  {
    'color.base': C(0.9, 0.06, 350),
    'color.mark': C(0.6, 0.03, 300),
    'marking.mask': P('mask.cap'),
    'pattern.type': P('pattern.spots'),
    'color.pattern': C(0.62, 0.03, 300),
    'color.eye': C(0.52, 0.14, 310),
  },
  // มินต์
  {
    'color.base': C(0.9, 0.07, 175),
    'color.mark': C(0.78, 0.09, 190),
    'marking.mask': P('mask.cape'),
    'pattern.type': P('pattern.plain'),
    'color.eye': C(0.7, 0.12, 200),
  },
  // ม่วงเข้ม
  {
    'color.base': C(0.36, 0.1, 285),
    'color.belly': C(0.5, 0.11, 285),
    'color.mark': C(0.26, 0.08, 285),
    'marking.mask': P('mask.cap'),
    'pattern.type': P('pattern.plain'),
    'color.eye': C(0.66, 0.15, 260),
  },
]
for (const genes of variants) {
  cell('colors', '', (slot) => slot.set(withGenes(catBase, genes), { ...adult, stage: 'child' }))
}

// ── Expressions ──
for (const emotion of [
  'joyful',
  'curious',
  'grumpy',
  'sleepy',
  'scared',
  'shy',
] as EmotionLabel[]) {
  cell('faces', EMOTION_NAME_TH[emotion], (slot) => {
    slot.focus = 'head'
    slot.zoom = 1
    slot.yaw = emotion === 'grumpy' || emotion === 'curious' ? -0.25 : 0.25
    slot.input = { emotion }
    slot.set(mochi, adult)
  })
}

// ── Stages ──
const STAGE_TH: Record<LifeStage, string> = {
  egg: 'ไข่',
  baby: 'เบบี้',
  child: 'เด็ก',
  teen: 'วัยรุ่น',
  adult: 'โตเต็มวัย',
  elder: 'ผู้อาวุโส',
}
for (const stage of ['egg', 'baby', 'child', 'teen', 'adult'] as LifeStage[]) {
  cell('stages', STAGE_TH[stage], (slot) => {
    slot.options = { fur, collar: stage !== 'egg' && stage !== 'baby' }
    // กล้องระยะเดียวกันทุกช่อง → เห็นว่าตัวโตขึ้นจริง
    slot.fixedExtent = 1.15
    slot.zoom = 1.25
    slot.set(mochi, { ...adult, stage })
  })
}

// ── Features & Parts: ลูกผสมข้ามสายพันธุ์จริงจากระบบผสมพันธุ์ ──
const ids = Object.keys(geneDb.species)
for (let i = 0; i < 5; i++) {
  const a = ids[i % ids.length] as string
  const b = ids[(i * 3 + 2) % ids.length] as string
  const genome = breed(createFounder(a, rng), createFounder(b, rng), rng).genome
  const label = `${geneDb.species[a]?.name.th}×${geneDb.species[b]?.name.th}`
  cell('parts', label, (slot) => slot.set(genome, adult))
}

// ── Habitats ──
for (const kind of HABITAT_KINDS) {
  cell('habitats', HABITAT_NAME_TH[kind], (slot) => {
    slot.yaw = 0.3
    slot.zoom = 1.7
    slot.setHabitat(kind)
  })
}

// ── Actions ──
const actions: [
  string,
  { pose: PoseName; speed?: number; asleep?: boolean; emotion: EmotionLabel },
][] = [
  ['เดิน', { pose: 'stand', speed: 0.6, emotion: 'content' }],
  ['เล่น', { pose: 'play', emotion: 'excited' }],
  ['นอน', { pose: 'curl', asleep: true, emotion: 'sleepy' }],
  ['อ้อน', { pose: 'love', emotion: 'shy' }],
]
for (const [label, input] of actions) {
  cell('actions', label, (slot) => {
    slot.yaw = label === 'เดิน' ? 1.0 : 0.4
    slot.input = { ...input, emotes: false }
    slot.set(mochi, adult)
  })
}

// ── วาด: ภาพนิ่งครั้งเดียว (ค่าเริ่มต้น) หรือขยับต่อเนื่อง (?animate=1) ──
function draw(dt: number): void {
  renderer.setScissorTest(false)
  renderer.clear()
  renderer.setScissorTest(true)
  for (const slot of slots) {
    slot.update(dt)
    slot.render(renderer, 1024)
  }
}
for (const slot of slots) slot.snap()
if (animate) {
  let last = performance.now()
  const loop = (now: number) => {
    draw(Math.min((now - last) / 1000, 0.1))
    last = now
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
} else {
  draw(0.016)
  document.body.dataset.ready = '1'
}
