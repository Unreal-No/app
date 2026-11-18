import { geneDb, type ColorChoice, type GeneDb } from '@mochimon/data'
import { clamp, type Rng } from '../rng'
import type { Allele, ColorAllele, Gene, Genome } from './types'

const DEFAULT_NUM: [number, number] = [0.5, 0.12]
const DEFAULT_TEMPER: [number, number] = [0.5, 0.2]

function colorAllele(choice: ColorChoice, rng: Rng): ColorAllele {
  // ขยับเล็กน้อยให้แต่ละตัวไม่ซ้ำกันเป๊ะ
  return {
    k: 'c',
    l: clamp(choice.l + rng.gauss() * 0.015, 0.2, 0.98),
    c: clamp(choice.c + rng.gauss() * 0.008, 0, 0.3),
    h: (choice.h + rng.gauss() * 4 + 360) % 360,
    d: choice.d,
  }
}

/** สุ่ม allele 1 ตัวของ locus จาก pool ของสายพันธุ์ */
export function drawSpeciesAllele(
  speciesId: string,
  locusId: string,
  rng: Rng,
  db: GeneDb = geneDb,
): Allele {
  const sp = db.species[speciesId]
  const locus = db.lociById[locusId]
  if (!sp) throw new Error(`unknown species: ${speciesId}`)
  if (!locus) throw new Error(`unknown locus: ${locusId}`)
  if (locus.kind === 'part') {
    return { k: 'p', id: rng.weighted(sp.parts[locusId] as [string, number][]) }
  }
  if (locus.kind === 'num') {
    const [mean, sd] = sp.nums[locusId] ?? (locus.hidden ? DEFAULT_TEMPER : DEFAULT_NUM)
    return { k: 'n', v: clamp(mean + rng.gauss() * sd) }
  }
  const palette = sp.colors[locusId] as ColorChoice[]
  const choice = rng.weighted(palette.map((c) => [c, c.w ?? 1] as const))
  return colorAllele(choice, rng)
}

/** สร้างสัตว์รุ่นบุกเบิก (generation 0) ของสายพันธุ์ */
export function createFounder(speciesId: string, rng: Rng, db: GeneDb = geneDb): Genome {
  if (!db.species[speciesId]) throw new Error(`unknown species: ${speciesId}`)
  const genes: Record<string, Gene> = {}
  for (const locus of db.loci) {
    genes[locus.id] = [
      drawSpeciesAllele(speciesId, locus.id, rng, db),
      drawSpeciesAllele(speciesId, locus.id, rng, db),
    ]
  }
  return { v: 1, genes, ancestry: { [speciesId]: 1 }, generation: 0 }
}

export function allelesEqual(a: Allele, b: Allele): boolean {
  if (a.k === 'p' && b.k === 'p') return a.id === b.id
  if (a.k === 'n' && b.k === 'n') return a.v === b.v
  if (a.k === 'c' && b.k === 'c') return a.l === b.l && a.c === b.c && a.h === b.h && a.d === b.d
  return false
}

/** ตรวจว่า genome ครบทุก locus และชนิด allele ถูกต้อง */
export function validateGenome(genome: Genome, db: GeneDb = geneDb): string[] {
  const errors: string[] = []
  for (const locus of db.loci) {
    const gene = genome.genes[locus.id]
    if (!gene) {
      errors.push(`missing locus ${locus.id}`)
      continue
    }
    const want = locus.kind === 'part' ? 'p' : locus.kind === 'num' ? 'n' : 'c'
    for (const a of gene) {
      if (a.k !== want) errors.push(`${locus.id}: wrong allele kind ${a.k}`)
      else if (a.k === 'p' && db.alleles[a.id]?.locus !== locus.id)
        errors.push(`${locus.id}: unknown allele ${a.id}`)
      else if (a.k === 'n' && !(a.v >= 0 && a.v <= 1)) errors.push(`${locus.id}: out of range`)
    }
  }
  return errors
}

export const serializeGenome = (genome: Genome): string => JSON.stringify(genome)

export function deserializeGenome(json: string, db: GeneDb = geneDb): Genome {
  const genome = JSON.parse(json) as Genome
  if (genome?.v !== 1 || typeof genome.genes !== 'object') throw new Error('invalid genome')
  const errors = validateGenome(genome, db)
  if (errors.length) throw new Error(`invalid genome: ${errors.join('; ')}`)
  return genome
}
