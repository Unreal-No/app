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
