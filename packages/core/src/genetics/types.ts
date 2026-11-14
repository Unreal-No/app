import type { Lineage, Oklch, PartAlleleDef } from '@mochimon/data'

/** allele ของ part-locus: อ้าง id ใน Gene DB */
export interface PartAllele {
  k: 'p'
  id: string
}
/** allele ของ polygenic-locus: ค่า 0..1 */
export interface NumAllele {
  k: 'n'
  v: number
}
/** allele สี: OKLCH + ระดับความเด่น d (0..1) */
export interface ColorAllele extends Oklch {
  k: 'c'
  d: number
}
export type Allele = PartAllele | NumAllele | ColorAllele

/** ยีนส์ 1 ตำแหน่ง = allele 2 ตัว (จากพ่อ/แม่) */
export type Gene = [Allele, Allele]

export interface Genome {
  v: 1
  genes: Record<string, Gene>
  /** สัดส่วนบรรพบุรุษ speciesId -> 0..1 (รวมกัน = 1) */
  ancestry: Record<string, number>
  generation: number
}

export type Habitat = 'land' | 'sky' | 'water' | 'amphibious'

export interface ExpressedPart {
  /** allele ที่แสดงออก */
  def: PartAlleleDef
  shape: string
  params: Record<string, number>
  /** allele ที่ถูกข่ม (ยีนส์ด้อยที่ซ่อนอยู่) — ไม่มีถ้าเป็น homozygous */
  hidden?: PartAlleleDef
  codominant: boolean
}

export interface ExpressedColor extends Oklch {
  hex: string
}

export interface Temperament {
  affection: number
  mischief: number
  playful: number
  sleepy: number
  shy: number
  curious: number
  appetite: number
}

export interface Phenotype {
  parts: {
    head: ExpressedPart
    ears: ExpressedPart
    horns: ExpressedPart
    wings: ExpressedPart
    tail: ExpressedPart
    limbs: ExpressedPart
    eyes: ExpressedPart
    pattern: ExpressedPart
    special: ExpressedPart
  }
  /** ค่าที่แสดงออกของ locus ตัวเลขทุกตัว (id -> 0..1) */
  nums: Record<string, number>
  colors: {
    base: ExpressedColor
    belly: ExpressedColor
    pattern: ExpressedColor
    eye: ExpressedColor
    accent: ExpressedColor
  }
  temperament: Temperament
  habitat: Habitat
  /** สัดส่วนสายเลือดจากชิ้นส่วนที่แสดงออก */
  lineageMix: Record<Exclude<Lineage, 'any'>, number>
}

export interface MutationEvent {
  locus: string
  /** 0 = allele จากพ่อแม่ A, 1 = จาก B */
  slot: 0 | 1
  kind: 'shift' | 'swap' | 'novel'
  from: Allele
  to: Allele
}
