import { describe, expect, it } from 'vitest'
import {
  dayPhase,
  festivalOn,
  isFullMoon,
  loyKrathongDay,
  moonPhase,
  skyLight,
  thaiSeason,
} from '../src'

const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

describe('ช่วงของวันและแสง', () => {
  it('แบ่งช่วงวันตามชั่วโมงท้องถิ่น', () => {
    expect(dayPhase(local(2026, 11, 18, 5, 30))).toBe('dawn')
    expect(dayPhase(local(2026, 11, 18, 12))).toBe('day')
    expect(dayPhase(local(2026, 11, 18, 18))).toBe('dusk')
    expect(dayPhase(local(2026, 11, 18, 23))).toBe('night')
    expect(dayPhase(local(2026, 11, 18, 2))).toBe('night')
  })

  it('กลางวันไม่ปรับสี เย็นอมส้ม กลางคืนอมน้ำเงินแต่ไม่มืดเกิน', () => {
    expect(skyLight(local(2026, 11, 18, 12))).toEqual({ r: 1, g: 1, b: 1 })
    const dusk = skyLight(local(2026, 11, 18, 17, 45))
    expect(dusk.r).toBeGreaterThan(dusk.b)
    const night = skyLight(local(2026, 11, 18, 23))
    expect(night.b).toBeGreaterThan(night.r)
    expect(Math.min(night.r, night.g, night.b)).toBeGreaterThan(0.7)
  })

  it('ไล่สีต่อเนื่อง ไม่กระโดด และปิดได้ด้วย strength 0', () => {
    let prev = skyLight(local(2026, 11, 18, 0))
    for (let m = 5; m < 24 * 60; m += 5) {
      const next = skyLight(local(2026, 11, 18, Math.floor(m / 60), m % 60))
      expect(Math.abs(next.r - prev.r)).toBeLessThan(0.03)
      expect(Math.abs(next.b - prev.b)).toBeLessThan(0.03)
      prev = next
    }
    expect(skyLight(local(2026, 11, 18, 23), 0)).toEqual({ r: 1, g: 1, b: 1 })
  })
})

describe('ฤดู ดวงจันทร์ เทศกาล', () => {
  it('ฤดูไทย', () => {
    expect(thaiSeason(local(2026, 4, 1))).toBe('hot')
    expect(thaiSeason(local(2026, 8, 1))).toBe('rainy')
    expect(thaiSeason(local(2026, 12, 1))).toBe('cool')
    expect(thaiSeason(local(2027, 2, 1))).toBe('cool')
  })

  it('ข้างขึ้นข้างแรมใกล้เคียงวันเต็มดวง/จันทร์ดับที่รู้จัก (คลาดไม่เกินราวครึ่งวัน)', () => {
    // จันทร์เต็มดวง 24 พ.ย. 2026 และ 14 มี.ค. 2025, จันทร์ดับ 9 พ.ย. 2026
    const tolerance = 0.7 / 29.53
    expect(Math.abs(moonPhase(Date.UTC(2026, 10, 24, 14, 53)) - 0.5)).toBeLessThan(tolerance)
    expect(Math.abs(moonPhase(Date.UTC(2025, 2, 14, 6, 55)) - 0.5)).toBeLessThan(tolerance)
    const newMoon = moonPhase(Date.UTC(2026, 10, 9, 7, 2))
    expect(Math.min(newMoon, 1 - newMoon)).toBeLessThan(tolerance)
    expect(isFullMoon(Date.UTC(2026, 10, 24, 12))).toBe(true)
    expect(isFullMoon(Date.UTC(2026, 10, 18, 12))).toBe(false)
  })

  it('วันลอยกระทงตรงกับปฏิทินไทย', () => {
    expect(loyKrathongDay(2024)).toBe(15)
    expect(loyKrathongDay(2025)).toBe(5)
    expect(loyKrathongDay(2026)).toBe(24)
    expect(loyKrathongDay(2028)).toBe(2)
    // ปีที่ไม่มีในตาราง: ประมาณจากวันเต็มดวง (อยู่ในเดือนพฤศจิกายนเสมอ)
    for (let y = 2029; y <= 2040; y++) {
      expect(loyKrathongDay(y)).toBeGreaterThanOrEqual(1)
      expect(loyKrathongDay(y)).toBeLessThanOrEqual(30)
    }
  })

  it('เทศกาลตามวัน', () => {
    expect(festivalOn(local(2026, 12, 31, 20))).toBe('newyear')
    expect(festivalOn(local(2027, 1, 1, 9))).toBe('newyear')
    expect(festivalOn(local(2026, 4, 13))).toBe('songkran')
    expect(festivalOn(local(2026, 4, 15))).toBe('songkran')
    expect(festivalOn(local(2026, 4, 16))).toBeNull()
    expect(festivalOn(local(2026, 11, 24))).toBe('loykrathong')
    expect(festivalOn(local(2026, 11, 18))).toBeNull()
  })
})
