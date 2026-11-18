import {
  EXPEDITION_MINUTES,
  formatDuration,
  ITEMS,
  PLACE_IDS,
  PLACES,
  suited,
  type PlaceId,
  type SpecialItem,
  canBreed,
  dominantTraits,
  EMOTION_NAME_TH,
  NEED_KEYS,
  speciesLabel,
  TRAIT_NAME_TH,
  viewPet,
  type CareAction,
  type NeedKey,
} from '@mochimon/core'
import { setKeyboardFocus } from './bridge'
import { exploreBlocker, feedSpecial, sendOnExpedition } from './adventure'
import {
  allNames,
  care,
  collection,
  hasRoom,
  partnersFor,
  pets,
  saveNow,
  sendToFarm,
  startPairing,
} from './game'
import type { PetActor } from './pet'
import { button, el, rectOf } from './ui'
import { openAssistant } from './assistant'
import { openChat } from './chatPanel'
import { birthdayText, openBook, originText } from './book'
import { relationSummary } from './social'
import { pickName } from './store'
import { NEED_TH, STAGE_TH } from './text'
import { cursor, layout, rng, uiLayer } from './world'

/**
 * แผงดูแลบนจอ: คลิกขวาที่สัตว์เพื่อเปิด — ดูสถานะ ให้อาหาร เล่น อาบน้ำ พาเข้านอน ตั้งชื่อ จับคู่ ฝากฟาร์ม
 * แผงเป็น DOM ธรรมดาที่ลอยข้างตัวสัตว์ และแจ้งพื้นที่ของตัวเองให้ Rust รู้ว่าตรงนี้ "จับต้องได้"
 */
const WIDTH = 244
/** ปิดเองเมื่อเมาส์ออกห่างนานเท่านี้ (วินาที) — คลิกนอกแผงทะลุไปแอปอื่น จึงตรวจจาก "คลิกข้างนอก" ไม่ได้ */
const AUTO_CLOSE = 14

const CARE_BUTTONS: { action: CareAction; label: string }[] = [
  { action: 'feed', label: 'อาหาร' },
  { action: 'treat', label: 'ขนม' },
  { action: 'play', label: 'เล่น' },
  { action: 'bathe', label: 'อาบน้ำ' },
  { action: 'rest', label: 'นอน' },
]

const root = el('div', 'panel')
root.hidden = true
uiLayer.append(root)

// เนื้อหาเปลี่ยนความสูงได้ (เช่น กดเปิด "ยีนส์แฝง") → จัดตำแหน่งใหม่ไม่ให้ล้นจอ
new ResizeObserver(() => place()).observe(root)

let actor: PetActor | null = null
let mode: 'care' | 'pair' | 'explore' = 'care'
let chosenPlace: PlaceId | null = null
let chosenMinutes = 60
let renaming = false
/** เวลาล่าสุดที่เมาส์อยู่แถวแผงหรือตัวสัตว์ (ms) */
let lastNear = 0
/** สิ่งที่ทำให้ต้องสร้างเนื้อหาแผงใหม่ทั้งหมด (นอกนั้นแค่อัปเดตแถบ/ข้อความ) */
let signature = ''
let bars = new Map<NeedKey, HTMLElement>()
let statusLine: HTMLElement | null = null
let hatchBar: HTMLElement | null = null

export const panelActor = (): PetActor | null => actor
/** กำลังรอให้เลือกคู่ของสัตว์ตัวนี้อยู่ (คลิกสัตว์อีกตัวบนจอเพื่อเลือกได้) */
export const pairingFor = (): PetActor | null => (mode === 'pair' ? actor : null)

export function openPanel(target: PetActor, view: 'care' | 'explore' = 'care'): void {
  if (actor) actor.attending = false
  actor = target
  actor.attending = true
  mode = view
  chosenPlace = null
  renaming = false
  lastNear = performance.now()
  signature = ''
  root.hidden = false
  render()
}

export function closePanel(): void {
  if (!actor) return
  if (renaming) setKeyboardFocus(false)
  actor.attending = false
  actor = null
  renaming = false
  root.hidden = true
  root.replaceChildren()
}

/** เปิดแผงของตัวถัดไป (จากเมนู tray — เผื่อคลิกขวาใช้ไม่ได้) */
export function cyclePanel(): void {
  if (pets.length === 0) return
  const index = actor ? pets.indexOf(actor) : -1
  openPanel(pets[(index + 1) % pets.length]!)
}

/** เลือกคู่ด้วยการคลิกสัตว์บนจอ — คืน true ถ้าการคลิกนี้ถูกใช้ไปแล้ว */
export function pickPartner(target: PetActor): boolean {
  const chooser = pairingFor()
  if (!chooser || target === chooser) return false
  if (!canBreed(target.state)) {
    target.say('ยังเด็กอยู่เลย~', 3)
    return true
  }
  beginPairing(chooser, target)
  return true
}

function beginPairing(a: PetActor, b: PetActor): void {
  closePanel()
  startPairing(a, b)
}

function startRename(nameNode: HTMLElement): void {
  if (!actor || renaming) return
  const target = actor
  renaming = true
  setKeyboardFocus(true)
  const input = el('input', 'panel-name-input')
  input.value = target.state.name
  input.maxLength = 24
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    renaming = false
    setKeyboardFocus(false)
    const name = input.value.trim()
    if (commit && name && name !== target.state.name) {
      target.state = { ...target.state, name }
      target.say(`${name}!`, 3)
      saveNow()
    }
    signature = ''
    if (actor === target) render()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
    e.stopPropagation()
  })
  input.addEventListener('blur', () => finish(true))
  nameNode.replaceWith(input)
  // รอให้หน้าต่างรับ focus ก่อน (ฝั่ง Rust สลับโหมดหน้าต่างแบบไม่พร้อมกัน)
  setTimeout(() => {
    input.focus()
    input.select()
  }, 60)
}

function renderHeader(target: PetActor): HTMLElement {
  const header = el('div', 'panel-header')
  const name = el('div', 'panel-name', target.state.name)
  name.title = 'คลิกเพื่อตั้งชื่อ'
  name.addEventListener('click', () => startRename(name))
  const dice = button(
    '🎲',
    () => {
      const next = pickName(rng, allNames())
      target.state = { ...target.state, name: next }
      target.say(`${next}!`, 3)
      saveNow()
      signature = ''
      render()
    },
    'panel-icon',
  )
  dice.title = 'สุ่มชื่อใหม่'
  const close = button('×', closePanel, 'panel-icon panel-close')
  close.title = 'ปิด'
  header.append(name, dice, close)
  return header
}

function renderCare(target: PetActor): void {
  const view = viewPet(target.state)
  const stage = target.state.nurture.stage
  root.append(renderHeader(target))
  root.append(
    el('div', 'panel-sub', `${speciesLabel(target.state.genome).th} · ${STAGE_TH[stage]}`),
  )
  const origin = [originText(target.state), birthdayText(target.state)].filter(Boolean).join(' · ')
  if (origin) root.append(el('div', 'panel-sub', origin))
  const friends = stage === 'egg' ? '' : relationSummary(target.state)
  if (friends) root.append(el('div', 'panel-sub relations', friends))

  if (stage === 'egg') {
    statusLine = el('div', 'panel-status')
    const track = el('div', 'bar bar-hatch')
    hatchBar = el('div', 'bar-fill')
    track.append(hatchBar)
    root.append(statusLine, track, el('div', 'panel-hint', 'ลูบไข่ (คลิก) เพื่อให้ความอบอุ่น'))
  } else {
    statusLine = el('div', 'panel-status')
    root.append(statusLine)
    const traits = el('div', 'panel-traits')
    for (const key of dominantTraits(view.personality, 2))
      traits.append(el('span', 'chip', TRAIT_NAME_TH[key]))
    root.append(traits)

    const needs = el('div', 'panel-needs')
    for (const key of NEED_KEYS) {
      const row = el('div', 'need')
      const track = el('div', 'bar')
      const fill = el('div', 'bar-fill')
      track.append(fill)
      bars.set(key, fill)
      row.append(el('span', 'need-label', NEED_TH[key]), track)
      needs.append(row)
    }
    root.append(needs)

    const actions = el('div', 'panel-actions')
    for (const { action, label } of CARE_BUTTONS)
      actions.append(
        button(label, () => {
          care(target, action)
          // สั่งนอน → ปิดแผงให้เห็นว่าหลับจริง
          if (action === 'rest') closePanel()
          else refresh()
        }),
      )
    actions.append(
      button(
        '🧭 สำรวจ',
        () => {
          mode = 'explore'
          signature = ''
          render()
        },
        'explore-open',
      ),
    )
    root.append(actions)
    // ของพิเศษจากการสำรวจ
    const bag = Object.entries(collection.inventory.items) as [SpecialItem, number][]
    if (bag.length > 0) {
      const treats = el('div', 'panel-actions panel-bag')
      treats.append(el('span', 'need-label', 'ของในกระเป๋า:'))
      for (const [id, n] of bag) {
        const b = button(`${ITEMS[id].icon}×${n}`, () => {
          feedSpecial(target, id)
          signature = ''
          render()
        })
        b.title = ITEMS[id].name
        treats.append(b)
      }
      root.append(treats)
    }

    // ยีนส์ด้อยที่ซ่อนอยู่: เปิดเผยเมื่อโตพอจะมีลูกได้
    if (canBreed(target.state)) {
      const hidden = Object.values(view.phenotype.parts)
        .map((part) => part.hidden?.name.th)
        .filter((name): name is string => Boolean(name))
      const genes = el('details', 'panel-genes')
      genes.append(el('summary', '', `ยีนส์แฝง (${hidden.length})`))
      genes.append(
        el(
          'div',
          'panel-hint',
          hidden.length > 0 ? hidden.join(' · ') : 'ไม่มี — ทุกยีนส์แสดงออกหมดแล้ว',
        ),
      )
      root.append(genes)
    } else {
      root.append(el('div', 'panel-hint', 'ยีนส์แฝงจะเปิดเผยเมื่อโตเป็นวัยรุ่น'))
    }
  }

  const footer = el('div', 'panel-actions panel-footer')
  if (canBreed(target.state))
    footer.append(
      button('♥ จับคู่', () => {
        mode = 'pair'
        signature = ''
        render()
      }),
    )
  if (stage !== 'egg')
    footer.append(
      button('💬 คุย', () => {
        closePanel()
        openChat(target)
      }),
    )
  footer.append(
    button('🌳 สมุด', () => {
      closePanel()
      openBook('family', target.state.id)
    }),
  )
  footer.append(
    button('ผู้ช่วย', () => {
      closePanel()
      openAssistant()
    }),
  )
  if (pets.length > 1)
    footer.append(
      button('ฝากฟาร์ม', () => {
        closePanel()
        sendToFarm(target)
      }),
    )
  if (footer.childElementCount > 0) root.append(footer)
}

function renderPair(target: PetActor): void {
  root.append(renderHeader(target))
  root.append(el('div', 'panel-sub', `เลือกคู่ให้ ${target.state.name}`))
  const partners = partnersFor(target)
  if (!hasRoom()) {
    root.append(el('div', 'panel-hint', 'บนจอเต็มแล้ว — ฝากใครสักตัวไว้ที่ฟาร์มก่อน แล้วค่อยรับไข่ใบใหม่'))
  } else if (partners.length === 0) {
    root.append(el('div', 'panel-hint', 'ยังไม่มีคู่ที่โตพอ (ต้องเป็นวัยรุ่นขึ้นไป)'))
  } else {
    const list = el('div', 'panel-actions panel-partners')
    for (const partner of partners)
      list.append(
        button(
          `${partner.state.name} · ${speciesLabel(partner.state.genome).th.split(' (')[0]}`,
          () => beginPairing(target, partner),
        ),
      )
    root.append(list, el('div', 'panel-hint', 'หรือคลิกที่ตัวสัตว์บนจอ'))
  }
  const footer = el('div', 'panel-actions panel-footer')
  footer.append(
    button('ย้อนกลับ', () => {
      mode = 'care'
      signature = ''
      render()
    }),
  )
  root.append(footer)
}

function renderExplore(target: PetActor): void {
  root.append(renderHeader(target))
  root.append(el('div', 'panel-sub', `ส่ง ${target.state.name} ออกสำรวจ`))
  const blocked = exploreBlocker(target)
  if (blocked) {
    root.append(el('div', 'panel-hint', blocked))
  } else {
    const places = el('div', 'explore-places')
    for (const id of PLACE_IDS) {
      const place = PLACES[id]
      const good = suited(target.state, id)
      const b = button(`${place.icon} ${place.name}${good ? ' ⭐' : ''}`, () => {
        chosenPlace = id
        signature = ''
        render()
      })
      if (chosenPlace === id) b.classList.add('active')
      b.title = good ? 'เหมาะกับถิ่นของตัวนี้: ได้ของมากขึ้น' : ''
      places.append(b)
    }
    const times = el('div', 'panel-actions explore-times')
    for (const minutes of EXPEDITION_MINUTES) {
      const b = button(formatDuration(minutes * 60_000), () => {
        chosenMinutes = minutes
        signature = ''
        render()
      })
      if (chosenMinutes === minutes) b.classList.add('active')
      times.append(b)
    }
    const go = button(
      'ออกเดินทาง',
      () => {
        if (!chosenPlace) return
        const place = chosenPlace
        closePanel()
        sendOnExpedition(target, place, chosenMinutes)
      },
      'primary',
    )
    go.disabled = !chosenPlace
    root.append(
      places,
      times,
      go,
      el(
        'div',
        'panel-hint',
        '⭐ = เหมาะกับตัวนี้ · นับเวลาจริงแม้ปิดแอป · ระหว่างนั้นไม่ต้องดูแล ไม่มีล้มเหลว · ยิ่งนานยิ่งมีโอกาสเจอไข่',
      ),
    )
  }
  const footer = el('div', 'panel-actions panel-footer')
  footer.append(
    button('ย้อนกลับ', () => {
      mode = 'care'
      signature = ''
      render()
    }),
  )
  root.append(footer)
}

function render(): void {
  if (!actor || renaming) return
  const state = actor.state
  const next = [
    state.id,
    state.name,
    mode,
    chosenPlace,
    chosenMinutes,
    JSON.stringify(collection.inventory.items),
    collection.expeditions.length,
    state.nurture.stage,
    pets.length,
    partnersFor(actor)
      .map((p) => p.state.id)
      .join(','),
  ].join('|')
  if (next !== signature) {
    signature = next
    bars = new Map()
    statusLine = null
    hatchBar = null
    root.replaceChildren()
    if (mode === 'pair') renderPair(actor)
    else if (mode === 'explore') renderExplore(actor)
    else renderCare(actor)
    place()
  }
  refresh()
}

/** อัปเดตค่าที่เปลี่ยนบ่อย (แถบ อารมณ์ ความคืบหน้าการฟัก) โดยไม่สร้างปุ่มใหม่ */
function refresh(): void {
  if (!actor) return
  const state = actor.state
  if (hatchBar) {
    const progress = state.incubation ?? 0
    hatchBar.style.width = `${Math.round(progress * 100)}%`
    if (statusLine) statusLine.textContent = `กำลังฟัก ${Math.round(progress * 100)}%`
  } else if (statusLine) {
    statusLine.textContent = `ตอนนี้: ${EMOTION_NAME_TH[actor.emotion]}`
  }
  for (const [key, fill] of bars) {
    const value = state.needs[key]
    fill.style.width = `${Math.round(value * 100)}%`
    fill.classList.toggle('low', value < 0.3)
  }
}

/** วางแผงข้างตัวสัตว์ (ด้านที่มีที่ว่าง) และไม่ให้ล้นจอ */
function place(): void {
  if (!actor) return
  const hit = actor.hit
  const height = root.offsetHeight
  const right = hit.x + hit.r + 14
  const x = right + WIDTH <= layout.width - 8 ? right : hit.x - hit.r - 14 - WIDTH
  const y = Math.min(layout.groundY - height - 10, Math.max(8, hit.y + hit.r - height))
  root.style.left = `${Math.max(8, Math.min(layout.width - WIDTH - 8, x))}px`
  root.style.top = `${Math.max(8, y)}px`
}

/** พื้นที่ของแผง (พิกัดจอ) สำหรับแจ้ง Rust ว่าตรงนี้รับเมาส์ */
export function panelRect(): { x: number; y: number; w: number; h: number } | null {
  if (!actor) return null
  return rectOf(root)
}

export function updatePanel(): void {
  if (!actor) return
  if (!pets.includes(actor) || actor.held) {
    closePanel()
    return
  }
  render()
  if (renaming) return
  // ปิดเองเมื่อเมาส์ไม่อยู่แถวแผงหรือตัวสัตว์นานพอ
  const rect = root.getBoundingClientRect()
  const pad = 40
  const nearPanel =
    cursor.x > rect.left - pad &&
    cursor.x < rect.right + pad &&
    cursor.y > rect.top - pad &&
    cursor.y < rect.bottom + pad
  const now = performance.now()
  if (nearPanel || actor.contains(cursor.x, cursor.y)) lastNear = now
  if (cursor.seen && now - lastNear > AUTO_CLOSE * 1000) closePanel()
}
