import { describe, expect, it } from 'vitest'
import { computePerches, surfaceBelow, type DesktopWindow, type ScreenRect } from '../src'

const screen: ScreenRect = { x: 0, y: 0, w: 1920, h: 1080 }
const ground = 1040

const win = (id: number, x: number, y: number, w: number, h: number): DesktopWindow => ({
  id,
  x,
  y,
  w,
  h,
})

describe('ขอบหน้าต่างที่เกาะได้', () => {
  it('หน้าต่างเดี่ยวให้ขอบบนทั้งเส้น', () => {
    expect(computePerches([win(1, 300, 400, 800, 500)], screen, ground)).toEqual([
      { windowId: 1, x1: 300, x2: 1100, y: 400 },
    ])
  })

  it('ตัดส่วนที่ล้นออกนอกจอ', () => {
    const [perch] = computePerches([win(1, -200, 400, 600, 300)], screen, ground)
    expect(perch).toEqual({ windowId: 1, x1: 0, x2: 400, y: 400 })
    const [right] = computePerches([win(2, 1700, 400, 600, 300)], screen, ground)
    expect(right).toEqual({ windowId: 2, x1: 1700, x2: 1920, y: 400 })
  })

  it('ไม่นับหน้าต่างเต็มจอ ขอบที่ชิดบนจอ หรือชิดพื้น', () => {
    expect(computePerches([win(1, 0, 0, 1920, 1040)], screen, ground)).toEqual([])
    expect(computePerches([win(2, 100, 60, 800, 600)], screen, ground)).toEqual([])
    expect(computePerches([win(3, 100, 1010, 800, 30)], screen, ground)).toEqual([])
  })

  it('หน้าต่างข้างหน้าบังตรงกลาง → ขอบถูกแบ่งเป็นสองช่วง', () => {
    const front = win(1, 600, 200, 300, 500) // คร่อมขอบของหน้าต่างหลัง
    const back = win(2, 200, 400, 1200, 500)
    const perches = computePerches([front, back], screen, ground)
    expect(perches).toContainEqual({ windowId: 1, x1: 600, x2: 900, y: 200 })
    expect(perches).toContainEqual({ windowId: 2, x1: 200, x2: 600, y: 400 })
    expect(perches).toContainEqual({ windowId: 2, x1: 900, x2: 1400, y: 400 })
    expect(perches).toHaveLength(3)
  })

  it('หน้าต่างข้างหน้าบังทั้งเส้น → ไม่เหลือขอบ', () => {
    const front = win(1, 100, 200, 1500, 700)
    const back = win(2, 300, 400, 800, 400)
    expect(computePerches([front, back], screen, ground).map((p) => p.windowId)).toEqual([1])
  })

  it('หน้าต่างข้างหลังไม่บังขอบของหน้าต่างข้างหน้า', () => {
    const front = win(1, 300, 400, 800, 400)
    const back = win(2, 100, 200, 1500, 700)
    const perches = computePerches([front, back], screen, ground)
    expect(perches).toContainEqual({ windowId: 1, x1: 300, x2: 1100, y: 400 })
  })

  it('หน้าต่างข้างหน้าที่อยู่ต่ำกว่าขอบหรือสูงเกินระยะตัวสัตว์ ไม่ตัดขอบ', () => {
    const below = win(1, 500, 600, 300, 300) // อยู่ใต้ขอบ y=400 ทั้งบาน
    const farAbove = win(2, 500, 150, 300, 100) // ขอบล่าง 250 สูงกว่าแถบ 400-90
    const back = win(3, 200, 400, 1200, 500)
    const perches = computePerches([below, farAbove, back], screen, ground)
    expect(perches).toContainEqual({ windowId: 3, x1: 200, x2: 1400, y: 400 })
  })

  it('หน้าต่างข้างหน้าที่ลอยทับแถบเหนือขอบ (ไม่ถึงขอบ) ก็ตัดขอบ', () => {
    const hovering = win(1, 500, 250, 300, 100) // ขอบล่าง 350 อยู่ในแถบ 310..400
    const back = win(2, 200, 400, 1200, 500)
    const spans = computePerches([hovering, back], screen, ground).filter((p) => p.windowId === 2)
    expect(spans).toEqual([
      { windowId: 2, x1: 200, x2: 500, y: 400 },
      { windowId: 2, x1: 800, x2: 1400, y: 400 },
    ])
  })

  it('ช่วงที่แคบกว่าขั้นต่ำถูกทิ้ง', () => {
    const front = win(1, 280, 200, 900, 500)
    const back = win(2, 200, 400, 1200, 500) // เหลือซ้าย 80px (ทิ้ง) ขวา 220px (เก็บ)
    const spans = computePerches([front, back], screen, ground).filter((p) => p.windowId === 2)
    expect(spans).toEqual([{ windowId: 2, x1: 1180, x2: 1400, y: 400 }])
    expect(computePerches([win(3, 100, 400, 100, 300)], screen, ground)).toEqual([])
  })

  it('หน้าต่างซ้อนสามชั้น', () => {
    const top = win(1, 700, 300, 200, 300)
    const mid = win(2, 400, 350, 400, 400)
    const back = win(3, 200, 500, 1200, 400)
    const spans = computePerches([top, mid, back], screen, ground).filter((p) => p.windowId === 3)
    // top (700..900) และ mid (400..800) บังรวมกันเป็น 400..900
    expect(spans).toEqual([
      { windowId: 3, x1: 200, x2: 400, y: 500 },
      { windowId: 3, x1: 900, x2: 1400, y: 500 },
    ])
  })

  it('ข้ามหน้าต่างขนาดศูนย์', () => {
    expect(
      computePerches([win(1, 100, 400, 0, 300), win(2, 100, 400, 500, 0)], screen, ground),
    ).toEqual([])
  })
})

describe('พื้นผิวใต้ตัวสัตว์', () => {
  const perches = computePerches(
    [win(1, 300, 400, 800, 300), win(2, 500, 700, 900, 300)],
    screen,
    ground,
  )

  it('ไม่มีขอบใต้ตัว → ตกถึงพื้น', () => {
    expect(surfaceBelow(100, 200, ground, perches)).toEqual({ y: ground, perch: null })
  })

  it('ตกลงบนขอบที่สูงที่สุดซึ่งอยู่ใต้เท้า', () => {
    expect(surfaceBelow(600, 100, ground, perches).perch?.windowId).toBe(1)
    // อยู่ต่ำกว่าขอบของหน้าต่าง 1 แล้ว → เจอหน้าต่าง 2
    expect(surfaceBelow(1200, 500, ground, perches).perch?.windowId).toBe(2)
    expect(surfaceBelow(1200, 500, ground, perches).y).toBe(700)
  })

  it('ยืนอยู่บนขอบพอดี (มีค่าเผื่อ) ยังนับว่ายืนอยู่', () => {
    expect(surfaceBelow(600, 403, ground, perches).perch?.windowId).toBe(1)
    expect(surfaceBelow(600, 420, ground, perches).perch).toBeNull()
  })

  it('เดินพ้นปลายขอบ → พื้นผิวถัดไปอยู่ต่ำลง', () => {
    expect(surfaceBelow(1101, 400, ground, perches).perch?.windowId).toBe(2)
    expect(surfaceBelow(299, 400, ground, perches).y).toBe(ground)
  })

  it('แท่นฉากที่สูงกว่าขอบหน้าต่างชนะ', () => {
    expect(surfaceBelow(600, 100, 350, perches)).toEqual({ y: 350, perch: null })
  })
})
