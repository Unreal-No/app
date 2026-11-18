import { pets } from './game'
import type { PetActor } from './pet'
import { button, el, rectOf } from './ui'
import { cursor, layout, uiLayer, walkMaxX } from './world'

/**
 * ป้ายที่สัตว์ถือมาแจ้ง (นัดถึงเวลา พักสายตา ดื่มน้ำ ฯลฯ)
 * แสดงทีละป้าย ที่เหลือต่อคิว — สัตว์ที่ถือป้ายเดินมาข้างเคอร์เซอร์แล้วยืนรอจนกว่าผู้ใช้จะกดปุ่ม
 */
export interface SignButton {
  label: string
  onClick: () => void
  primary?: boolean
}

export interface SignSpec {
  /** ป้ายที่ key ซ้ำกับที่แสดง/รออยู่จะไม่ถูกเพิ่มซ้ำ */
  key: string
  icon: string
  title: string
  body?: string
  buttons: SignButton[]
  /** นับถอยหลัง (วินาที) แล้วปิดเอง พร้อมเรียก `onTimeout` */
  countdown?: number
  onTimeout?: () => void
  /** ไม่มีใครกดภายในเวลานี้ (วินาที) → ปิดเงียบๆ */
  expiresIn?: number
  /** ใครถือป้าย (ไม่ระบุ = เลือกตัวที่ขี้อ้อนที่สุด) */
  carrier?: () => PetActor | undefined
}

interface ActiveSign {
  spec: SignSpec
  node: HTMLElement
  body: HTMLElement | null
  carrier: PetActor | undefined
  shownAt: number
}

const queue: SignSpec[] = []
let active: ActiveSign | null = null

/** ตัวที่จะถือป้าย: ไม่ใช่ไข่ ไม่ได้ถูกอุ้ม และขี้อ้อนที่สุด */
export function messenger(): PetActor | undefined {
  const candidates = pets.filter((p) => !p.isEgg && !p.held)
  candidates.sort((a, b) => b.personality.affection - a.personality.affection)
  return candidates[0] ?? pets[0]
}

export function showSign(spec: SignSpec): void {
  if (active?.spec.key === spec.key || queue.some((s) => s.key === spec.key)) return
  queue.push(spec)
}

/** ปิดป้าย (ทั้งที่แสดงอยู่และที่รอคิว) */
export function dismissSign(key: string): void {
  const index = queue.findIndex((s) => s.key === key)
  if (index >= 0) queue.splice(index, 1)
  if (active?.spec.key === key) close()
}

/** ปิดทุกป้ายที่ key ขึ้นต้นด้วย prefix (เช่น นัดที่ถูกลบไปแล้ว) */
export function dismissSignsWhere(test: (key: string) => boolean): void {
  for (let i = queue.length - 1; i >= 0; i--) if (test(queue[i]!.key)) queue.splice(i, 1)
  if (active && test(active.spec.key)) close()
}

export const signKeys = (): string[] => [
  ...(active ? [active.spec.key] : []),
  ...queue.map((s) => s.key),
]

function close(): void {
  if (!active) return
  if (active.carrier) active.carrier.attending = false
  active.node.remove()
  active = null
}

function open(spec: SignSpec): void {
  const node = el('div', 'sign')
  const head = el('div', 'sign-head')
  head.append(el('span', 'sign-icon', spec.icon), el('span', 'sign-title', spec.title))
  node.append(head)
  const body = spec.body || spec.countdown ? el('div', 'sign-body', spec.body ?? '') : null
  if (body) node.append(body)
  const actions = el('div', 'sign-actions')
  for (const b of spec.buttons) {
    actions.append(
      button(
        b.label,
        () => {
          // ปิดก่อน แล้วค่อยทำงาน (งานอาจเปิดป้ายใหม่)
          if (active?.spec === spec) close()
          b.onClick()
        },
        b.primary ? 'primary' : '',
      ),
    )
  }
  node.append(actions)
  node.append(el('div', 'sign-more'))
  uiLayer.append(node)

  const carrier = (spec.carrier ?? messenger)()
  active = { spec, node, body, carrier, shownAt: performance.now() }
  if (!carrier) return
  carrier.attending = true
  // ตัวขี้อายไม่เดินเข้ามาใกล้ ยืนชูป้ายอยู่ที่เดิม
  if (cursor.seen && carrier.personality.shy < 0.65) {
    const side = cursor.x > carrier.x ? -1 : 1
    const x = Math.min(walkMaxX(90), Math.max(90, cursor.x + side * 140))
    carrier.goTo(x, undefined, 12)
  }
}

export function updateSigns(): void {
  if (active && active.carrier && !pets.includes(active.carrier)) {
    // คนถือป้ายถูกฝากฟาร์ม → ส่งต่อให้ตัวอื่น
    active.carrier = messenger()
    if (active.carrier) active.carrier.attending = true
  }
  if (!active) {
    const next = queue.shift()
    if (!next) return
    open(next)
  }
  if (!active) return
  const { spec, node, carrier } = active
  const elapsed = (performance.now() - active.shownAt) / 1000

  if (spec.countdown !== undefined) {
    const left = Math.max(0, Math.ceil(spec.countdown - elapsed))
    if (active.body) active.body.textContent = `${spec.body ?? ''} ${left} วินาที`.trim()
    if (left <= 0) {
      close()
      spec.onTimeout?.()
      return
    }
  }
  if (spec.expiresIn !== undefined && elapsed > spec.expiresIn) {
    close()
    return
  }

  const more = node.querySelector<HTMLElement>('.sign-more')
  if (more) more.textContent = queue.length > 0 ? `+ อีก ${queue.length} เรื่อง` : ''

  if (carrier) {
    // ท่าทางตามนิสัย: ตัวซนกระโดดโลดเต้น ตัวอื่นกอดหัวใจอ้อน
    if (!carrier.moving) {
      if (carrier.personality.mischief > 0.6) carrier.playTimer = Math.max(carrier.playTimer, 0.5)
      else carrier.loveTimer = Math.max(carrier.loveTimer, 0.5)
    }
    const hit = carrier.hit
    const width = node.offsetWidth
    const x = Math.min(layout.width - width - 8, Math.max(8, hit.x - width / 2))
    const y = Math.max(8, hit.y - hit.r - node.offsetHeight - 6)
    node.style.left = `${x}px`
    node.style.top = `${y}px`
  } else {
    node.style.left = `${layout.width - node.offsetWidth - 24}px`
    node.style.top = `${layout.groundY - node.offsetHeight - 24}px`
  }
}

export const signRect = (): { x: number; y: number; w: number; h: number } | null =>
  active ? rectOf(active.node) : null

/** ตัวที่กำลังถือป้ายอยู่ (ไม่พูดเรื่องอื่นแทรก) */
export const signCarrier = (): PetActor | undefined => active?.carrier
