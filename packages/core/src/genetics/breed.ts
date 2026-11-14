import { geneDb, type GeneDb, type Locus } from '@mochimon/data'
import { clamp, type Rng } from '../rng'
import type { Allele, Gene, Genome, MutationEvent } from './types'

export interface BreedOptions {
  /** โอกาสกลายพันธุ์ต่อ allele ที่ถ่ายทอด (ค่าเริ่มต้น 2.5%) */
  mutationRate?: number
  /** โอกาสไขว้เปลี่ยน (crossing-over) ระหว่าง locus ในกลุ่ม linkage เดียวกัน */
  recombination?: number
  db?: GeneDb
}

export interface BreedResult {
  genome: Genome
  mutations: MutationEvent[]
}

export const DEFAULT_MUTATION_RATE = 0.025
export const DEFAULT_RECOMBINATION = 0.25

/**
 * สร้างเซลล์สืบพันธุ์ (gamete): เลือก allele 1 ตัวต่อ locus
 * locus ที่อยู่กลุ่ม linkage เดียวกันมักถูกถ่ายทอดไปด้วยกันจากสายเดียวกัน
 */
function makeGamete(parent: Genome, loci: Locus[], rng: Rng, recombination: number): Allele[] {
  const strandByGroup = new Map<number, 0 | 1>()
  return loci.map((locus) => {
    const gene = parent.genes[locus.id]
    if (!gene) throw new Error(`parent genome missing locus ${locus.id}`)
    let strand: 0 | 1
    if (locus.linkage === undefined) {
      strand = rng.chance(0.5) ? 0 : 1
    } else {
      const prev = strandByGroup.get(locus.linkage)
      if (prev === undefined) strand = rng.chance(0.5) ? 0 : 1
      else strand = rng.chance(recombination) ? ((1 - prev) as 0 | 1) : prev
      strandByGroup.set(locus.linkage, strand)
    }
    return gene[strand]
  })
}

/** กลายพันธุ์ allele 1 ตัว — คืน null ถ้าไม่มีอะไรให้เปลี่ยน */
export function mutateAllele(
  allele: Allele,
  locus: Locus,
  rng: Rng,
  db: GeneDb = geneDb,
): { to: Allele; kind: MutationEvent['kind'] } | null {
  if (allele.k === 'n') {
    return { to: { k: 'n', v: clamp(allele.v + rng.gauss() * 0.12) }, kind: 'shift' }
  }
  if (allele.k === 'c') {
    return {
      to: {
        k: 'c',
        l: clamp(allele.l + rng.gauss() * 0.05, 0.25, 0.98),
        c: clamp(allele.c + rng.gauss() * 0.03, 0, 0.3),
        h: (allele.h + rng.gauss() * 35 + 720) % 360,
        d: clamp(allele.d + rng.gauss() * 0.1),
      },
      kind: 'shift',
    }
  }
  const pool = (db.allelesByLocus[locus.id] ?? []).filter((a) => a.id !== allele.id)
  const novel = pool.filter((a) => a.mutationOnly)
  const normal = pool.filter((a) => !a.mutationOnly)
  // 20% ของการกลายพันธุ์ชิ้นส่วนได้ allele พิเศษที่หาไม่ได้จากสายพันธุ์ใด
  if (novel.length > 0 && (normal.length === 0 || rng.chance(0.2))) {
    return { to: { k: 'p', id: rng.pick(novel).id }, kind: 'novel' }
  }
  if (normal.length === 0) return null
  return { to: { k: 'p', id: rng.pick(normal).id }, kind: 'swap' }
}

/**
 * ผสมพันธุ์: ลูกได้ allele 1 ตัวจากพ่อแม่แต่ละฝ่ายต่อ locus (+ โอกาสกลายพันธุ์)
 * ทุกสายพันธุ์ใช้ชุด locus เดียวกัน จึงผสมข้ามสายพันธุ์ได้ทุกคู่
 */
export function breed(a: Genome, b: Genome, rng: Rng, opts: BreedOptions = {}): BreedResult {
  const db = opts.db ?? geneDb
  const mutationRate = opts.mutationRate ?? DEFAULT_MUTATION_RATE
  const recombination = opts.recombination ?? DEFAULT_RECOMBINATION

  const fromA = makeGamete(a, db.loci, rng, recombination)
  const fromB = makeGamete(b, db.loci, rng, recombination)
  const genes: Record<string, Gene> = {}
  const mutations: MutationEvent[] = []

  db.loci.forEach((locus, i) => {
    const pair: Gene = [fromA[i] as Allele, fromB[i] as Allele]
    for (const slot of [0, 1] as const) {
      if (mutationRate <= 0 || !rng.chance(mutationRate)) continue
      const result = mutateAllele(pair[slot], locus, rng, db)
      if (!result) continue
      mutations.push({ locus: locus.id, slot, kind: result.kind, from: pair[slot], to: result.to })
      pair[slot] = result.to
    }
    genes[locus.id] = pair
  })

  const ancestry: Record<string, number> = {}
  for (const parent of [a, b]) {
    for (const [species, share] of Object.entries(parent.ancestry)) {
      ancestry[species] = (ancestry[species] ?? 0) + share / 2
    }
  }

  return {
    genome: { v: 1, genes, ancestry, generation: Math.max(a.generation, b.generation) + 1 },
    mutations,
  }
}
