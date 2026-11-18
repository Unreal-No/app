import {
  canBreed,
  childrenOf,
  dexProgress,
  dexSlots,
  geneDb,
  MAX_ACTIVE_PETS,
  MAX_FARM_PETS,
  pedigree,
  siblingsOf,
  speciesLabel,
  viewPet,
  type Habitat,
  type PedigreeNode,
  type PetState,
  type Rarity,
} from '@mochimon/core'
import { collection, farm, hasRoom, pets, recallPet, sendToFarm } from './game'
import { portrait } from './portrait'
import { KIND_TH } from './summon'
import { STAGE_TH } from './text'
import { button, el, rectOf } from './ui'
import { layout, uiLayer } from './world'

/**
 * สมุดฟาร์ม: ฟาร์ม (เลือกตัวที่จะเรียกมาบนจอ) · เครือญาติ · สมุดสะสม (Monsterpedia)
 * ลอยอยู่มุมซ้ายล่าง (มุมขวาเป็นของแผงผู้ช่วย)
 */
export type BookTab = 'farm' | 'family' | 'dex'

const TABS: { id: BookTab; label: string }[] = [
  { id: 'farm', label: 'ฟาร์ม' },
  { id: 'family', label: 'เครือญาติ' },
  { id: 'dex', label: 'สมุดสะสม' },
]

export const HABITAT_TH: Record<Habitat, string> = {
  land: 'บก',
  sky: 'ฟ้า',
  water: 'น้ำ',
  amphibious: 'สะเทินน้ำ',
}
const RARITY_TH: Record<Rarity, string> = {
  common: 'พบบ่อย',
  uncommon: 'ไม่บ่อย',
  rare: 'หายาก',
  legendary: 'ตำนาน',
}
type Filter = 'all' | 'land' | 'sky' | 'water'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'land', label: 'บก' },
  { id: 'sky', label: 'ฟ้า' },
  { id: 'water', label: 'น้ำ' },
]

const root = el('div', 'panel book')
root.hidden = true
uiLayer.append(root)

let tab: BookTab = 'farm'
let filter: Filter = 'all'
let focusId: string | null = null
let swapFor: string | null = null
let signature = ''
/** รูปย่อที่รอวาด (ทีละรูปต่อเฟรม ไม่ให้จอสะดุด) */
const pendingPortraits: { img: HTMLImageElement; pet: PetState }[] = []

export const bookOpen = (): boolean => !root.hidden

export function openBook(next: BookTab = tab, petId?: string): void {
  tab = next
  if (petId) focusId = petId
  root.hidden = false
  signature = ''
  updateBook()
}

export function closeBook(): void {
  root.hidden = true
  swapFor = null
  pendingPortraits.length = 0
}

export function toggleBook(): void {
  if (bookOpen()) closeBook()
  else openBook()
}

export const bookRect = (): { x: number; y: number; w: number; h: number } | null =>
  root.hidden ? null : rectOf(root)

const allPets = (): PetState[] => [...pets.map((p) => p.state), ...farm]
const findState = (id: string): PetState | undefined => allPets().find((p) => p.id === id)
const nameOf = (id: string): string =>
  findState(id)?.name ?? collection.family[id]?.name ?? 'ไม่ทราบ'

/** ที่มาของสัตว์เป็นภาษาคน (ใช้ร่วมกับแผงดูแล) */
export function originText(pet: PetState): string {
  const o = pet.origin
  if (pet.parents) return `ลูกของ ${nameOf(pet.parents[0])} × ${nameOf(pet.parents[1])}`
  if (!o) return ''
  switch (o.kind) {
    case 'starter':
      return 'เพื่อนตัวแรก'
    case 'summon':
      return `อัญเชิญจาก${KIND_TH[o.fileKind as keyof typeof KIND_TH] ?? 'ไฟล์'}${o.fossil ? ' (ไข่ฟอสซิล)' : ''}`
    case 'gift':
      return 'ไข่ของขวัญ'
    case 'wild':
      return 'แขกป่าที่ผูกมิตรได้'
    case 'expedition':
      return `เจอระหว่างสำรวจ${o.place ? ` (${o.place})` : ''}`
    default:
      return ''
  }
}

export const birthdayText = (pet: PetState): string =>
  pet.bornAt
    ? new Date(pet.bornAt).toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''

function thumb(pet: PetState): HTMLImageElement {
  const img = el('img', 'thumb')
  img.alt = ''
  img.width = img.height = 44
  pendingPortraits.push({ img, pet })
  return img
}

function header(): HTMLElement {
  const head = el('div', 'panel-header')
  head.append(el('div', 'panel-name', 'สมุดฟาร์ม'), button('×', closeBook, 'panel-icon panel-close'))
  const tabs = el('div', 'tabs')
  for (const t of TABS) {
    const b = button(t.label, () => {
      tab = t.id
      swapFor = null
      signature = ''
      updateBook()
    })
    if (t.id === tab) b.classList.add('active')
    tabs.append(b)
  }
  const wrap = el('div')
  wrap.append(head, tabs)
  return wrap
}

const habitatOf = (pet: PetState): Habitat => viewPet(pet).phenotype.habitat
const matches = (pet: PetState): boolean => {
  if (filter === 'all') return true
  const h = habitatOf(pet)
  return filter === 'water' ? h === 'water' || h === 'amphibious' : h === filter
}

function petRow(pet: PetState, onScreen: boolean): HTMLElement {
  const item = el('li', 'pet-row')
  const text = el('div', 'item-text')
  const stage = STAGE_TH[pet.nurture.stage]
  text.append(
    el('div', 'pet-row-name', pet.name),
    el(
      'div',
      'item-sub',
      `${stage} · ${speciesLabel(pet.genome).th} · ${HABITAT_TH[habitatOf(pet)]}`,
    ),
  )
  const actions = el('div', 'pet-row-actions')
  const family = button('🌳', () => openBook('family', pet.id), 'panel-icon')
  family.title = 'เครือญาติ'
  actions.append(family)
  if (onScreen) {
    const actor = pets.find((p) => p.state === pet)
    if (actor && pets.length > 1) {
      actions.append(
        button('ฝาก', () => {
          sendToFarm(actor)
          signature = ''
        }),
      )
    }
  } else {
    actions.append(
      button(
        'เรียกมา',
        () => {
          if (hasRoom()) recallPet(pet.id)
          else swapFor = swapFor === pet.id ? null : pet.id
          signature = ''
        },
        'primary',
      ),
    )
  }
  item.append(thumb(pet), text, actions)
  if (swapFor === pet.id) {
    const swap = el('li', 'swap-row')
    swap.append(el('div', 'panel-hint', `บนจอเต็ม (${MAX_ACTIVE_PETS} ตัว) — สลับกับตัวไหน?`))
    const choices = el('div', 'panel-actions')
    for (const actor of pets)
      choices.append(
        button(actor.state.name, () => {
          recallPet(pet.id, actor)
          swapFor = null
          signature = ''
        }),
      )
    swap.append(choices)
    const frag = el('div')
    frag.append(item, swap)
    return frag
  }
  return item
}

function renderFarm(): void {
  root.append(
    el(
      'div',
      'panel-sub',
      `บนจอ ${pets.length}/${MAX_ACTIVE_PETS} · ฟาร์ม ${farm.length}/${MAX_FARM_PETS}`,
    ),
  )
  const chips = el('div', 'filter-row')
  for (const f of FILTERS) {
    const b = button(f.label, () => {
      filter = f.id
      signature = ''
    })
    if (f.id === filter) b.classList.add('active')
    chips.append(b)
  }
  root.append(chips)
  const list = el('ul', 'items pet-list')
  list.append(el('li', 'list-head', 'บนจอ'))
  for (const actor of pets) if (matches(actor.state)) list.append(petRow(actor.state, true))
  list.append(el('li', 'list-head', 'ที่ฟาร์ม'))
  const resting = farm.filter(matches)
  if (resting.length === 0)
    list.append(
      el(
        'li',
        'panel-hint',
        farm.length === 0 ? 'ยังไม่มีใครพักที่ฟาร์ม — ฝากได้จากแผงดูแล' : 'ไม่มีตัวที่ตรงกับตัวกรอง',
      ),
    )
  for (const pet of resting) list.append(petRow(pet, false))
  root.append(list)
}

function node(n: PedigreeNode | undefined, className: string): HTMLElement {
  const box = el('button', `tree-node ${className}`)
  box.type = 'button'
  if (!n || !n.record) {
    box.append(el('div', 'tree-name', '?'), el('div', 'tree-sub', 'ไม่มีบันทึก'))
    box.disabled = true
    return box
  }
  box.append(el('div', 'tree-name', n.record.name), el('div', 'tree-sub', n.record.species))
  const id = n.id
  box.addEventListener('click', () => {
    focusId = id
    signature = ''
  })
  return box
}

function renderFamily(): void {
  const known = allPets()
  if (!focusId || !collection.family[focusId]) focusId = pets[0]?.state.id ?? known[0]?.id ?? null
  if (!focusId) return
  const select = el('select', 'family-select')
  for (const pet of known) {
    const option = el('option', '', pet.name)
    option.value = pet.id
    select.append(option)
  }
  if (!known.some((p) => p.id === focusId)) {
    const option = el('option', '', collection.family[focusId]?.name ?? '?')
    option.value = focusId
    select.append(option)
  }
  select.value = focusId
  select.addEventListener('change', () => {
    focusId = select.value
    signature = ''
  })
  root.append(select)

  const tree = pedigree(collection.family, focusId, 2)
  const grid = el('div', 'tree')
  const grand = el('div', 'tree-row')
  for (const parent of tree.parents ?? [undefined, undefined])
    for (const g of parent?.parents ?? [undefined, undefined]) grand.append(node(g, 'small'))
  const parentsRow = el('div', 'tree-row')
  for (const parent of tree.parents ?? [undefined, undefined]) parentsRow.append(node(parent, ''))
  const selfRow = el('div', 'tree-row')
  selfRow.append(node(tree, 'self'))
  grid.append(
    el('div', 'tree-label', 'ปู่ย่าตายาย'),
    grand,
    el('div', 'tree-label', 'พ่อแม่'),
    parentsRow,
    selfRow,
  )
  root.append(grid)

  const kids = childrenOf(collection.family, focusId)
  const sibs = siblingsOf(collection.family, focusId)
  const links = (label: string, list: { id: string; name: string }[]): void => {
    if (list.length === 0) return
    const row = el('div', 'family-links')
    row.append(el('span', 'item-sub', `${label}: `))
    for (const r of list)
      row.append(
        button(r.name, () => {
          focusId = r.id
          signature = ''
        }),
      )
    root.append(row)
  }
  links('ลูก', kids)
  links('พี่น้อง', sibs)

  const pet = findState(focusId)
  if (pet) {
    const facts = [
      originText(pet),
      birthdayText(pet) && `เกิด ${birthdayText(pet)}`,
      `รุ่นที่ ${pet.genome.generation + 1}`,
    ].filter(Boolean)
    root.append(el('div', 'panel-hint', facts.join(' · ')))
    if (pet.mutations?.length) {
      const names = pet.mutations.map((id) => geneDb.alleles[id]?.name.th ?? id)
      root.append(el('div', 'panel-hint mutation', `✨ กลายพันธุ์ตอนเกิด: ${names.join(', ')}`))
    }
    if (!canBreed(pet) && pet.nurture.stage !== 'egg')
      root.append(el('div', 'panel-hint', 'ยีนส์แฝงจะเปิดเผยลงสมุดสะสมเมื่อโตเป็นวัยรุ่น'))
  }
}

function renderDex(): void {
  const progress = dexProgress(collection.dex)
  root.append(
    el(
      'div',
      'panel-sub',
      `ค้นพบ ${progress.found}/${progress.total} ลักษณะ · ${progress.species.found}/${progress.species.total} สายพันธุ์`,
    ),
  )
  const bars = el('div', 'dex-bars')
  for (const rarity of Object.keys(RARITY_TH) as Rarity[]) {
    const r = progress.byRarity[rarity]
    const row = el('div', `dex-bar rarity-${rarity}`)
    const track = el('div', 'bar')
    const fill = el('div', 'bar-fill')
    fill.style.width = `${r.total ? (r.found / r.total) * 100 : 0}%`
    track.append(fill)
    row.append(el('span', 'need-label', `${RARITY_TH[rarity]} ${r.found}/${r.total}`), track)
    bars.append(row)
  }
  root.append(bars)

  const species = el('div', 'dex-chips')
  for (const s of Object.values(geneDb.species)) {
    const seen = collection.dex.species[s.id] !== undefined
    species.append(el('span', seen ? 'chip' : 'chip unknown', seen ? s.name.th : '???'))
  }
  root.append(el('div', 'tree-label', 'สายพันธุ์'), species)

  const list = el('div', 'dex-slots')
  for (const slot of dexSlots()) {
    const found = slot.alleles.filter((a) => collection.dex.alleles[a.id] !== undefined).length
    const section = el('details', 'dex-slot')
    section.append(el('summary', '', `${slot.name} ${found}/${slot.alleles.length}`))
    const chips = el('div', 'dex-chips')
    for (const def of slot.alleles) {
      const seen = collection.dex.alleles[def.id] !== undefined
      const label = seen ? def.name.th : '???'
      const chip = el(
        'span',
        `chip rarity-${def.rarity}${seen ? '' : ' unknown'}`,
        def.mutationOnly ? `✨ ${label}` : label,
      )
      chip.title = seen
        ? `${RARITY_TH[def.rarity]}${def.mutationOnly ? ' · ได้จากการกลายพันธุ์เท่านั้น' : ''}`
        : 'ยังไม่พบ'
      chips.append(chip)
    }
    section.append(chips)
    list.append(section)
  }
  root.append(list)
  root.append(
    el(
      'div',
      'panel-hint',
      'ลักษณะถูกบันทึกเมื่อเห็นบนตัวสัตว์ (ยีนส์แฝงเมื่อโตเป็นวัยรุ่น) · ✨ ได้จากการกลายพันธุ์เท่านั้น',
    ),
  )
}

export function updateBook(): void {
  if (root.hidden) return
  const next = JSON.stringify([
    tab,
    filter,
    focusId,
    swapFor,
    pets.map((p) => [p.state.id, p.state.name, p.state.nurture.stage]),
    farm.map((p) => [p.id, p.name]),
    Object.keys(collection.dex.alleles).length,
    Object.keys(collection.family).length,
  ])
  if (next !== signature) {
    signature = next
    // เก็บตำแหน่งเลื่อนและกลุ่มที่เปิดไว้ของสมุดสะสม
    const scroll = root.scrollTop
    const open = [...root.querySelectorAll('details[open] summary')].map((s) =>
      (s.textContent ?? '').replace(/ \d+\/\d+$/, ''),
    )
    pendingPortraits.length = 0
    root.replaceChildren(header())
    if (tab === 'farm') renderFarm()
    else if (tab === 'family') renderFamily()
    else renderDex()
    for (const summary of root.querySelectorAll('details summary'))
      if (open.includes((summary.textContent ?? '').replace(/ \d+\/\d+$/, '')))
        (summary.parentElement as HTMLDetailsElement).open = true
    root.scrollTop = scroll
  }
  // วาดรูปย่อทีละรูปต่อเฟรม
  const job = pendingPortraits.shift()
  if (job) {
    const url = portrait(job.pet)
    if (url) job.img.src = url
  }
  root.style.left = '16px'
  root.style.top = `${Math.max(8, layout.groundY - root.offsetHeight - 12)}px`
}
