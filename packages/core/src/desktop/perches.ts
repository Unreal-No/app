/** สี่เหลี่ยมในพิกัดจอ (จุดกำเนิดมุมซ้ายบน, y ชี้ลง) */
export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/** หน้าต่างของโปรแกรมอื่น */
export interface DesktopWindow extends ScreenRect {
  id: number
}

/** ช่วงขอบบนของหน้าต่างที่สัตว์ยืน/เดินได้ */
export interface Perch {
  windowId: number
  x1: number
  x2: number
  /** ระดับของขอบ (พิกัดจอ) */
  y: number
}

export interface PerchOptions {
  /** ช่วงที่สั้นกว่านี้ไม่นับ (ยืนไม่พอ) */
  minWidth?: number
  /** ที่ว่างเหนือขอบที่ต้องไม่ถูกหน้าต่างอื่นบัง (≈ ความสูงของสัตว์) */
  clearance?: number
  /** ขอบที่อยู่สูงกว่าระดับนี้ไม่นับ (เช่น หน้าต่างขยายเต็มจอ — สัตว์จะหลุดขอบบนของจอ) */
  minY?: number
  /** ขอบต้องอยู่เหนือพื้นอย่างน้อยเท่านี้ */
  groundGap?: number
}

/**
 * หาช่วงขอบบนของหน้าต่างที่ "มองเห็นจริง" ให้สัตว์เกาะได้
 *
 * @param windows หน้าต่างเรียงจาก**หน้าสุดไปหลังสุด** (ลำดับเดียวกับที่ระบบปฏิบัติการคืนมา)
 * @param screen  พื้นที่จอที่สัตว์อยู่ได้
 * @param groundY ระดับพื้น (ขอบบน Taskbar) ในพิกัดจอ
 *
 * ขอบบนของหน้าต่างหนึ่งจะถูกตัดออกตรงที่หน้าต่างที่อยู่ข้างหน้าบังแถบเหนือขอบนั้น
 * เพราะสัตว์วาดอยู่บนสุดเสมอ ถ้ายืนตรงนั้นจะดูเหมือนลอยทับหน้าต่างอื่น
 */
export function computePerches(
  windows: DesktopWindow[],
  screen: ScreenRect,
  groundY: number,
  options: PerchOptions = {},
): Perch[] {
  const minWidth = options.minWidth ?? 120
  const clearance = options.clearance ?? 90
  const minY = options.minY ?? screen.y + 110
  const groundGap = options.groundGap ?? 60
  const perches: Perch[] = []

  windows.forEach((win, index) => {
    if (win.w <= 0 || win.h <= 0) return
    const y = win.y
    if (y < minY || y > groundY - groundGap) return

    // เริ่มจากขอบบนทั้งเส้น (ตัดให้อยู่ในจอ) แล้วลบช่วงที่ถูกหน้าต่างข้างหน้าบัง
    let spans: [number, number][] = [
      [Math.max(win.x, screen.x), Math.min(win.x + win.w, screen.x + screen.w)],
    ]
    for (const front of windows.slice(0, index)) {
      const coversBand = front.y < y && front.y + front.h > y - clearance
      if (!coversBand) continue
      const cutFrom = front.x
      const cutTo = front.x + front.w
      spans = spans.flatMap(([a, b]): [number, number][] => {
        if (cutTo <= a || cutFrom >= b) return [[a, b]]
        const rest: [number, number][] = []
        if (cutFrom > a) rest.push([a, cutFrom])
        if (cutTo < b) rest.push([cutTo, b])
        return rest
      })
    }
    for (const [x1, x2] of spans) {
      if (x2 - x1 >= minWidth) perches.push({ windowId: win.id, x1, x2, y })
    }
  })
  return perches
}

/**
 * พื้นผิวที่สูงที่สุดซึ่งอยู่ใต้ (หรือเท่ากับ) ตำแหน่งปัจจุบันของสัตว์
 * — ฟิสิกส์ใช้กฎเดียวนี้ทั้งการร่วง การกระโดดขึ้น และการเดินตกขอบ
 *
 * @param feetY  ระดับเท้าของสัตว์ในพิกัดจอ (y ชี้ลง)
 * @param floorY ระดับพื้นที่ตำแหน่ง x นี้ (Taskbar หรือแท่นฉาก)
 * @returns ระดับของพื้นผิว (พิกัดจอ) และขอบหน้าต่างที่ยืนอยู่ (ถ้ามี)
 */
export function surfaceBelow(
  x: number,
  feetY: number,
  floorY: number,
  perches: Perch[],
  tolerance = 6,
): { y: number; perch: Perch | null } {
  let best: { y: number; perch: Perch | null } = { y: floorY, perch: null }
  for (const perch of perches) {
    if (x < perch.x1 || x > perch.x2) continue
    // ต้องอยู่ต่ำกว่า (หรือพอดี) เท้า และสูงกว่าพื้นผิวที่ดีที่สุดตอนนี้
    if (perch.y >= feetY - tolerance && perch.y < best.y) best = { y: perch.y, perch }
  }
  return best
}
