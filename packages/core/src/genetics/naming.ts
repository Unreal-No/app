import { geneDb, type GeneDb, type Localized } from '@mochimon/data'
import { Rng } from '../rng'
import type { Genome } from './types'

/** สายพันธุ์บรรพบุรุษเรียงจากสัดส่วนมากไปน้อย */
export function ancestryRanking(genome: Genome): [string, number][] {
  return Object.entries(genome.ancestry).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
}

/**
 * ชื่อชนิดของสัตว์: พันธุ์แท้ใช้ชื่อสายพันธุ์, ลูกผสมประกอบพยางค์จาก 2 สายพันธุ์หลัก
 * (ชื่อเดิมเสมอสำหรับ ancestry ชุดเดียวกัน)
 */
export function speciesLabel(genome: Genome, db: GeneDb = geneDb): Localized {
  const ranked = ancestryRanking(genome)
  const first = ranked[0]
  if (!first) return { th: 'ไม่ทราบสายพันธุ์', en: 'Unknown' }
  const main = db.species[first[0]]
  if (!main) return { th: 'ไม่ทราบสายพันธุ์', en: 'Unknown' }
  const second = ranked[1]
  const other = second ? db.species[second[0]] : undefined
  if (!second || !other || second[1] < 0.2) return main.name

  const rng = new Rng(`${main.id}+${other.id}`)
  const coined = rng.pick(main.nameParts.prefix) + rng.pick(other.nameParts.suffix)
  return { th: `${coined} (${main.name.th}×${other.name.th})`, en: coined }
}
