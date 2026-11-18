import { fxLayer, rng } from './world'

/** ฟองคำพูดประจำตัวสัตว์ 1 ตัว */
export class Bubble {
  private readonly el = document.createElement('div')
  private timer = 0

  constructor() {
    this.el.className = 'bubble'
    fxLayer.append(this.el)
  }

  say(text: string, seconds = 2.6): void {
    this.el.textContent = text
    this.el.classList.add('show')
    this.timer = seconds
  }

  /** @param x,y ตำแหน่งปลายฟอง (พิกัดจอ) */
  update(dt: number, x: number, y: number): void {
    if (this.timer > 0) {
      this.timer -= dt
      if (this.timer <= 0) this.el.classList.remove('show')
    }
    this.el.style.left = `${x}px`
    this.el.style.top = `${y}px`
  }

  dispose(): void {
    this.el.remove()
  }
}

/** ไอคอนลอยขึ้นแล้วจางหาย (หัวใจ อาหาร ฟองสบู่ ฯลฯ) */
export function floatIcons(
  x: number,
  y: number,
  icon: string,
  count = 3,
  className = 'heart',
): void {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = `float ${className}`
    el.textContent = icon
    el.style.left = `${x + rng.range(-24, 24)}px`
    el.style.top = `${y}px`
    el.style.setProperty('--dx', `${rng.range(-20, 20)}px`)
    el.style.animationDelay = `${i * 0.12}s`
    fxLayer.append(el)
    setTimeout(() => el.remove(), 1600)
  }
}
