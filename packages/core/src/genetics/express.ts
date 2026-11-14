import { geneDb, type GeneDb, type PartAlleleDef, type Slot } from '@mochimon/data'
import { mixOklch, oklchToHex } from '../color'
import type {
  ColorAllele,
  ExpressedColor,
  ExpressedPart,
  Genome,
  Habitat,
  NumAllele,
  PartAllele,
  Phenotype,
} from './types'

/**
 * กฎการแสดงออกของ part-locus
 * - dominance สูงกว่าชนะ (เด่นข่มด้อย) อีกตัวกลายเป็นยีนส์ซ่อน
 * - dominance เท่ากันและรูปทรงเดียวกัน → ผสมค่า params ครึ่ง/ครึ่ง
 * - dominance เท่ากันแต่คนละรูปทรง → เด่นร่วม: เลือกตัวที่ id มาก่อน (คงที่เสมอ ไม่ขึ้นกับลำดับพ่อแม่)
 */
export function expressPart(a: PartAlleleDef, b: PartAlleleDef): ExpressedPart {
  if (a.id === b.id) {
    return { def: a, shape: a.shape, params: { ...a.params }, codominant: false }
  }
  if (a.dominance !== b.dominance) {
    const [win, lose] = a.dominance > b.dominance ? [a, b] : [b, a]
    return {
      def: win,
      shape: win.shape,
      params: { ...win.params },
      hidden: lose,
      codominant: false,
    }
  }
  const [win, lose] = a.id < b.id ? [a, b] : [b, a]
  const params: Record<string, number> = { ...win.params }
  if (win.shape === lose.shape) {
    for (const [key, value] of Object.entries(lose.params ?? {})) {
      params[key] = ((params[key] ?? value) + value) / 2
    }
  }
  return { def: win, shape: win.shape, params, hidden: lose, codominant: true }
}

/**
 * การแสดงออกของสี: ผสมแบบถ่วงน้ำหนักด้วยความเด่น
 * ต่างกันมาก → สีเด่นแทบจะชนะขาด, ใกล้กัน → สีผสมกลาง (incomplete dominance)
 */
export function expressColor(a: ColorAllele, b: ColorAllele): ExpressedColor {
  const t = 1 / (1 + Math.exp(-(b.d - a.d) * 10))
  const mixed = mixOklch(a, b, t)
  return { ...mixed, hex: oklchToHex(mixed) }
}

const FLYING_WINGS = new Set(['feather', 'bat', 'fairy'])

export function deriveHabitat(parts: Phenotype['parts'], wingSize: number): Habitat {
  const canSwim =
    parts.limbs.shape === 'flipper' || parts.tail.shape === 'fish' || parts.wings.shape === 'fin'
  const canWalk = parts.limbs.shape !== 'flipper'
  const canFly = FLYING_WINGS.has(parts.wings.shape) && wingSize > 0.3
  if (canSwim && !canWalk) return 'water'
  if (canSwim) return 'amphibious'
  if (canFly) return 'sky'
  return 'land'
}

const SLOT_LOCUS: Record<Slot, string> = {
  head: 'head.shape',
  ears: 'ear.type',
  horns: 'horn.type',
  wings: 'wing.type',
  tail: 'tail.type',
  limbs: 'limb.type',
  eyes: 'eye.type',
  pattern: 'pattern.type',
  special: 'special.trait',
}

/** แปลง genotype → phenotype (สิ่งที่มองเห็น/นิสัยตั้งต้น) — เป็นฟังก์ชันบริสุทธิ์ */
export function express(genome: Genome, db: GeneDb = geneDb): Phenotype {
  const part = (slot: Slot): ExpressedPart => {
    const gene = genome.genes[SLOT_LOCUS[slot]] as [PartAllele, PartAllele]
    const a = db.alleles[gene[0].id]
    const b = db.alleles[gene[1].id]
    if (!a || !b) throw new Error(`unknown allele in ${SLOT_LOCUS[slot]}`)
    return expressPart(a, b)
  }
  const parts: Phenotype['parts'] = {
    head: part('head'),
    ears: part('ears'),
    horns: part('horns'),
    wings: part('wings'),
    tail: part('tail'),
    limbs: part('limbs'),
    eyes: part('eyes'),
    pattern: part('pattern'),
    special: part('special'),
  }

  const nums: Record<string, number> = {}
  for (const locus of db.loci) {
    if (locus.kind !== 'num') continue
    const [a, b] = genome.genes[locus.id] as [NumAllele, NumAllele]
    nums[locus.id] = (a.v + b.v) / 2
  }
  const num = (id: string): number => nums[id] ?? 0.5

  const color = (id: string): ExpressedColor => {
    const [a, b] = genome.genes[id] as [ColorAllele, ColorAllele]
    return expressColor(a, b)
  }

  const lineageMix = { modern: 0, prehistoric: 0, mythical: 0 }
  let counted = 0
  for (const p of Object.values(parts)) {
    if (p.def.lineage === 'any') continue
    lineageMix[p.def.lineage] += 1
    counted += 1
  }
  if (counted > 0) {
    lineageMix.modern /= counted
    lineageMix.prehistoric /= counted
    lineageMix.mythical /= counted
  }

  return {
    parts,
    nums,
    colors: {
      base: color('color.base'),
      belly: color('color.belly'),
      pattern: color('color.pattern'),
      eye: color('color.eye'),
      accent: color('color.accent'),
    },
    temperament: {
      affection: num('temper.affection'),
      mischief: num('temper.mischief'),
      playful: num('temper.playful'),
      sleepy: num('temper.sleepy'),
      shy: num('temper.shy'),
      curious: num('temper.curious'),
      appetite: num('temper.appetite'),
    },
    habitat: deriveHabitat(parts, num('wing.size')),
    lineageMix,
  }
}
