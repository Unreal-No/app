import { describe, expect, it } from 'vitest'
import {
  classifyFile,
  express,
  geneDb,
  summonFromFile,
  validateGenome,
  type FileFeatures,
} from '../src'

const hash = (n: number) => n.toString(16).padStart(64, 'a')
const file = (over: Partial<FileFeatures> = {}): FileFeatures => ({
  hashHex: hash(1),
  size: 250_000,
  ext: 'png',
  ...over,
})

describe('classifyFile', () => {
  it('แยกชนิดไฟล์จากนามสกุล (ไม่สนตัวพิมพ์/จุดนำหน้า)', () => {
    expect(classifyFile('PNG')).toBe('image')
    expect(classifyFile('.mp3')).toBe('audio')
    expect(classifyFile('docx')).toBe('document')
    expect(classifyFile('rs')).toBe('code')
    expect(classifyFile('zip')).toBe('archive')
    expect(classifyFile('whatever')).toBe('other')
  })
})

describe('summonFromFile', () => {
  it('ไฟล์เดียวกันได้สัตว์ตัวเดิมเสมอ', () => {
    expect(summonFromFile(file())).toEqual(summonFromFile(file()))
  })

  it('ไฟล์ต่างกันได้สัตว์ต่างกัน และ genome ถูกต้องทุกตัว', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const ext = ['png', 'mp3', 'pdf', 'ts', 'zip', 'csv', 'mp4', 'bin'][i % 8]!
      const result = summonFromFile(file({ hashHex: hash(i), ext, size: 1000 * (i + 1) }))
      expect(validateGenome(result.genome)).toEqual([])
      expect(() => express(result.genome)).not.toThrow()
      seen.add(JSON.stringify(result.genome.genes))
    }
    expect(seen.size).toBe(200)
  })

  it('ไฟล์ใหญ่ → ตัวใหญ่กว่าไฟล์เล็ก (โดยเฉลี่ย)', () => {
    const avg = (size: number) => {
      let sum = 0
      for (let i = 0; i < 100; i++) {
        sum += express(summonFromFile(file({ hashHex: hash(i), size })).genome).nums['body.size']!
      }
      return sum / 100
    }
    expect(avg(2_000_000_000)).toBeGreaterThan(avg(500) + 0.15)
  })

  it('ไฟล์เก่า → ได้สายดึกดำบรรพ์บ่อยขึ้น และเป็นไข่ฟอสซิล', () => {
    const prehistoricShare = (ageYears: number) => {
      let count = 0
      for (let i = 0; i < 400; i++) {
        const { species } = summonFromFile(file({ hashHex: hash(i), ext: 'txt', ageYears }))
        if (species.some((id) => geneDb.species[id]!.lineage === 'prehistoric')) count++
      }
      return count / 400
    }
    expect(prehistoricShare(12)).toBeGreaterThan(prehistoricShare(0) + 0.15)
    expect(summonFromFile(file({ ageYears: 12 })).fossil).toBe(true)
    expect(summonFromFile(file({ ageYears: 1 })).fossil).toBe(false)
  })

  it('รูปภาพ: สีเด่นของภาพกลายเป็นสีตัว', () => {
    const teal = { l: 0.8, c: 0.1, h: 190 }
    const result = summonFromFile(file({ palette: [teal, teal, teal] }))
    const base = express(result.genome).colors.base
    expect(Math.abs(base.h - 190)).toBeLessThan(1)
  })

  it('ไฟล์โค้ดมียีนส์เกล็ดเสมอ', () => {
    for (let i = 0; i < 30; i++) {
      const { genome } = summonFromFile(file({ hashHex: hash(i), ext: 'py' }))
      const ids = genome.genes['pattern.type']!.map((a) => (a.k === 'p' ? a.id : ''))
      expect(ids).toContain('pattern.scales')
    }
  })
})
