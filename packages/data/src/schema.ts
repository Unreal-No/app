import { z } from 'zod'

/** กลุ่มสายเลือดของ allele / สายพันธุ์ */
export const LineageSchema = z.enum(['modern', 'prehistoric', 'mythical', 'any'])
export type Lineage = z.infer<typeof LineageSchema>

export const RaritySchema = z.enum(['common', 'uncommon', 'rare', 'legendary'])
export type Rarity = z.infer<typeof RaritySchema>

export const LocalizedSchema = z.object({ th: z.string(), en: z.string() })
export type Localized = z.infer<typeof LocalizedSchema>

/** ช่องชิ้นส่วนร่างกายที่ part-locus ควบคุม */
export const SlotSchema = z.enum([
  'head',
  'ears',
  'horns',
  'wings',
  'tail',
  'limbs',
  'eyes',
  'pattern',
  'special',
  'mask',
  'socks',
  'tailmark',
  'symbol',
])
export type Slot = z.infer<typeof SlotSchema>

export const LocusSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('part'),
    slot: SlotSchema,
    linkage: z.number().int().optional(),
    name: LocalizedSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('num'),
    /** hidden = ไม่แสดงในรูปร่างโดยตรง (นิสัย, เผาผลาญ ฯลฯ) */
    hidden: z.boolean().optional(),
    linkage: z.number().int().optional(),
    name: LocalizedSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('color'),
    linkage: z.number().int().optional(),
    name: LocalizedSchema,
  }),
])
export type Locus = z.infer<typeof LocusSchema>

export const PartAlleleDefSchema = z.object({
  id: z.string(),
  locus: z.string(),
  /** ยิ่งสูงยิ่งเด่น — เท่ากัน = เด่นร่วม (co-dominant) */
  dominance: z.number().int().min(1).max(5),
  lineage: LineageSchema,
  rarity: RaritySchema,
  /** ได้จากการกลายพันธุ์เท่านั้น ไม่อยู่ใน pool ของสายพันธุ์ใด */
  mutationOnly: z.boolean().optional(),
  name: LocalizedSchema,
  /** รหัสรูปทรงที่ตัวสร้าง mesh ใช้ */
  shape: z.string(),
  params: z.record(z.string(), z.number()).optional(),
})
export type PartAlleleDef = z.infer<typeof PartAlleleDefSchema>

export const OklchSchema = z.object({
  l: z.number().min(0).max(1),
  c: z.number().min(0).max(0.4),
  h: z.number(),
})
export type Oklch = z.infer<typeof OklchSchema>

export const ColorChoiceSchema = OklchSchema.extend({
  /** ระดับความเด่นของสี 0..1 */
  d: z.number().min(0).max(1),
  w: z.number().positive().optional(),
})
export type ColorChoice = z.infer<typeof ColorChoiceSchema>

export const SpeciesSchema = z.object({
  id: z.string(),
  name: LocalizedSchema,
  lineage: LineageSchema.exclude(['any']),
  /** พยางค์สำหรับตั้งชื่อลูกผสม */
  nameParts: z.object({ prefix: z.array(z.string()).min(1), suffix: z.array(z.string()).min(1) }),
  /** pool ของ allele ชิ้นส่วน: locusId -> [alleleId, weight][] */
  parts: z.record(z.string(), z.array(z.tuple([z.string(), z.number().positive()])).min(1)),
  /** ค่าเฉลี่ย/ส่วนเบี่ยงเบนของ locus ตัวเลข: locusId -> [mean, sd] */
  nums: z.record(z.string(), z.tuple([z.number(), z.number()])),
  /** จานสีของ locus สี */
  colors: z.record(z.string(), z.array(ColorChoiceSchema).min(1)),
})
export type Species = z.infer<typeof SpeciesSchema>

export interface GeneDb {
  loci: Locus[]
  lociById: Record<string, Locus>
  alleles: Record<string, PartAlleleDef>
  allelesByLocus: Record<string, PartAlleleDef[]>
  species: Record<string, Species>
}
