import type { Oklch } from '@mochimon/data'
import { clamp } from './rng'

export interface Rgb {
  r: number
  g: number
  b: number
}

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  return {
    r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  }
}

const inGamut = (c: Rgb): boolean =>
  c.r >= -1e-4 && c.r <= 1.0001 && c.g >= -1e-4 && c.g <= 1.0001 && c.b >= -1e-4 && c.b <= 1.0001

const toSrgb = (v: number): number => {
  const x = clamp(v)
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

/** OKLCH -> sRGB (0..1) ลด chroma ลงจนอยู่ใน gamut */
export function oklchToRgb(color: Oklch): Rgb {
  let c = color.c
  let lin = oklchToLinear({ ...color, c })
  for (let i = 0; i < 24 && !inGamut(lin); i++) {
    c *= 0.9
    lin = oklchToLinear({ ...color, c })
  }
  return { r: toSrgb(lin.r), g: toSrgb(lin.g), b: toSrgb(lin.b) }
}

export function oklchToHex(color: Oklch): string {
  const { r, g, b } = oklchToRgb(color)
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** sRGB (0..1) -> OKLCH */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.hypot(a, bb)
  let h = (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: clamp(L), c: Math.min(c, 0.4), h }
}

/** ผสมสี OKLCH โดยเดินตามเส้นทาง hue ที่สั้นที่สุด (t=0 -> a, t=1 -> b) */
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = ((b.h - a.h + 540) % 360) - 180
  // สีที่แทบไม่มี chroma ไม่มี hue ที่มีความหมาย — ใช้ hue ของอีกฝั่ง
  if (a.c < 0.01) dh = 0
  const baseH = a.c < 0.01 ? b.h : a.h
  const h = b.c < 0.01 ? baseH : (baseH + dh * t + 360) % 360
  return { l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h }
}
