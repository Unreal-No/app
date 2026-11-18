/** PRNG แบบกำหนด seed ได้ (mulberry32) — ผลลัพธ์ทำซ้ำได้เสมอ ใช้กับยีนส์/การอัญเชิญ/การทดสอบ */
export class Rng {
  private s: number

  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed >>> 0 : hashString(seed)
  }

  /** เลขทศนิยม [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** จำนวนเต็ม [0, n) */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list')
    return items[this.int(items.length)] as T
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    if (items.length === 0) throw new Error('Rng.weighted: empty list')
    let total = 0
    for (const [, w] of items) total += w
    let r = this.next() * total
    for (const [item, w] of items) {
      r -= w
      if (r < 0) return item
    }
    return (items[items.length - 1] as readonly [T, number])[0]
  }

  /** การแจกแจงปกติมาตรฐาน (Box–Muller) */
  gauss(): number {
    const u = Math.max(this.next(), 1e-12)
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** แตก generator ลูกที่เป็นอิสระ โดยไม่กระทบลำดับของตัวแม่มากกว่า 1 ครั้ง */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ Math.floor(this.next() * 4294967296)) >>> 0)
  }
}

/** แฮชสตริงเป็น uint32 (FNV-1a + avalanche) */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
