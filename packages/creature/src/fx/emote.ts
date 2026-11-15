import * as THREE from 'three'

export type EmoteKind = 'spark' | 'question' | 'exclaim' | 'anger' | 'zzz' | 'heart' | 'drop'

const SIZE = 128
const cache = new Map<EmoteKind, THREE.CanvasTexture>()

function outlined(ctx: CanvasRenderingContext2D, draw: () => void, fill: string) {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 14
  draw()
  ctx.stroke()
  ctx.fillStyle = fill
  draw()
  ctx.fill()
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  fill: string,
  size: number,
  x = 64,
  y = 68,
) {
  ctx.font = `900 ${size}px "Trebuchet MS", "Segoe UI", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 14
  ctx.strokeText(value, x, y)
  ctx.fillStyle = fill
  ctx.fillText(value, x, y)
}

const PAINTERS: Record<EmoteKind, (ctx: CanvasRenderingContext2D) => void> = {
  question: (ctx) => text(ctx, '?', '#8a6fe0', 104),
  exclaim: (ctx) => text(ctx, '!', '#ffb02e', 108),
  zzz: (ctx) => {
    text(ctx, 'Z', '#6f9cf0', 76, 48, 78)
    text(ctx, 'z', '#6f9cf0', 52, 94, 44)
  },
  heart: (ctx) =>
    outlined(
      ctx,
      () => {
        ctx.beginPath()
        ctx.moveTo(64, 104)
        ctx.bezierCurveTo(8, 66, 22, 20, 64, 46)
        ctx.bezierCurveTo(106, 20, 120, 66, 64, 104)
        ctx.closePath()
      },
      '#ff7d9c',
    ),
  drop: (ctx) =>
    outlined(
      ctx,
      () => {
        ctx.beginPath()
        ctx.moveTo(64, 20)
        ctx.bezierCurveTo(100, 66, 96, 106, 64, 106)
        ctx.bezierCurveTo(32, 106, 28, 66, 64, 20)
        ctx.closePath()
      },
      '#7fc4f5',
    ),
  spark: (ctx) => {
    // เส้นประกาย 3 เส้นแผ่ออก
    ctx.lineCap = 'round'
    for (const [color, width] of [
      ['#ffffff', 22],
      ['#ffcf3f', 11],
    ] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      for (const angle of [-0.95, -0.2, 0.55]) {
        ctx.beginPath()
        ctx.moveTo(30 + Math.cos(angle) * 22, 100 + Math.sin(angle) * 22 - 20)
        ctx.lineTo(30 + Math.cos(angle) * 70, 100 + Math.sin(angle) * 70 - 20)
        ctx.stroke()
      }
    }
  },
  anger: (ctx) => {
    // เครื่องหมายโกรธ: โค้ง 4 มุมหันออกจากกัน
    ctx.lineCap = 'round'
    for (const [color, width] of [
      ['#ffffff', 22],
      ['#f0455a', 11],
    ] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        ctx.beginPath()
        ctx.moveTo(64 + sx * 12, 64 + sy * 44)
        ctx.quadraticCurveTo(64 + sx * 12, 64 + sy * 12, 64 + sx * 44, 64 + sy * 12)
        ctx.stroke()
      }
    }
  },
}

function texture(kind: EmoteKind): THREE.CanvasTexture {
  let tex = cache.get(kind)
  if (!tex) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (ctx) PAINTERS[kind](ctx)
    tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    cache.set(kind, tex)
  }
  return tex
}

/** ไอคอนอารมณ์ที่ลอยข้างหัว (หันเข้ากล้องเสมอ) */
export class Emote {
  readonly sprite: THREE.Sprite
  private kind: EmoteKind | null = null
  private shown = 0

  /** @param size ขนาดไอคอนในหน่วยโมเดล */
  constructor(private readonly size: number) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
      }),
    )
    this.sprite.renderOrder = 10
    this.sprite.visible = false
  }

  set(kind: EmoteKind | null): void {
    if (kind === this.kind) return
    this.kind = kind
    if (kind) {
      this.sprite.material.map = texture(kind)
      this.sprite.material.needsUpdate = true
      this.shown = 0
    }
  }

  update(dt: number, t: number): void {
    const target = this.kind ? 1 : 0
    this.shown += (target - this.shown) * Math.min(1, dt * 9)
    this.sprite.visible = this.shown > 0.02
    // เด้งออกมาแล้วลอยขึ้นลงเบาๆ
    const pop = this.shown * (1 + 0.25 * Math.sin(Math.min(this.shown, 1) * Math.PI))
    const scale = this.size * pop
    this.sprite.scale.set(scale, scale, 1)
    this.sprite.material.opacity = Math.min(1, this.shown * 1.4)
    this.sprite.center.set(0.5, 0.5 - 0.08 * Math.sin(t * 3))
  }

  dispose(): void {
    this.sprite.material.dispose()
  }
}
