import { setKeyboardFocus } from './bridge'

/** ตัวช่วยสร้าง DOM เล็กๆ ที่แผงต่างๆ ใช้ร่วมกัน */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = el('button', className, label)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

/** สี่เหลี่ยมของ element ในพิกัดจอ (ใช้แจ้ง Rust ว่าตรงนี้รับเมาส์) */
export function rectOf(node: HTMLElement): { x: number; y: number; w: number; h: number } {
  const rect = node.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
  }
}

export interface KeyboardScope {
  /** ช่องพิมพ์ในแผงนี้กำลังถือคีย์บอร์ดอยู่ */
  typing: boolean
  /** เรียกเมื่อออกจากช่องพิมพ์ทุกช่องของแผงแล้ว */
  onRelease?: () => void
}

/**
 * หน้าต่างสัตว์ปกติไม่รับคีย์บอร์ด (ไม่แย่งงานของผู้ใช้) — ขอรับชั่วคราวตอนกดช่องพิมพ์
 * และคืนเมื่อออกจากช่องพิมพ์ทุกช่องใน `root` แล้ว (ย้ายช่องภายในแผงไม่ปล่อย)
 */
export function bindKeyboard(
  input: HTMLInputElement | HTMLTextAreaElement,
  root: HTMLElement,
  scope: KeyboardScope,
  onEnter: () => void,
): void {
  let pressedAt = 0
  let blurredAt = 0
  input.addEventListener('pointerdown', () => {
    pressedAt = performance.now()
    if (!scope.typing) {
      scope.typing = true
      setKeyboardFocus(true)
    }
    // รอให้หน้าต่างรับคีย์บอร์ดก่อน — แต่ถ้าผู้ใช้ออกจากช่องไปแล้วระหว่างรอ ไม่ดึงกลับมา
    setTimeout(() => {
      if (blurredAt < pressedAt && input.isConnected && document.activeElement !== input)
        input.focus()
    }, 60)
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    const key = e as KeyboardEvent
    if (key.key === 'Enter' && !key.shiftKey) {
      key.preventDefault()
      onEnter()
    } else if (key.key === 'Escape') input.blur()
  })
  input.addEventListener('blur', () => {
    blurredAt = performance.now()
    setTimeout(() => {
      const active = document.activeElement
      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        root.contains(active)
      )
        return
      scope.typing = false
      setKeyboardFocus(false)
      scope.onRelease?.()
    }, 120)
  })
}
