import { geneDb, type GeneDb, type Lineage, type Oklch } from '@mochimon/data'
import { breed } from '../genetics/breed'
import { createFounder } from '../genetics/genome'
import type { ColorAllele, Genome, NumAllele } from '../genetics/types'
import { clamp, lerp, Rng } from '../rng'

export type FileKind =
  'image' | 'audio' | 'video' | 'document' | 'code' | 'archive' | 'data' | 'other'

/**
 * ลักษณะของไฟล์ที่ใช้อัญเชิญ — ไม่มีเนื้อหาไฟล์ มีแค่ hash + metadata
 * (การอ่านไฟล์/คำนวณ hash ทำที่ชั้นนอก: Rust หรือ WebCrypto)
 */
export interface FileFeatures {
  /** SHA-256 ของเนื้อหาไฟล์ (hex) */
  hashHex: string
  /** ขนาดไฟล์ (bytes) */
  size: number
  /** นามสกุลไฟล์ ไม่มีจุด */
  ext: string
  /** อายุไฟล์เป็นปี นับจากวันแก้ไขล่าสุด (ไม่ทราบ = 0) */
  ageYears?: number
  /** สีเด่นของรูปภาพ (เฉพาะไฟล์รูป) เรียงจากเด่นมากไปน้อย */
  palette?: Oklch[]
}

export interface SummonResult {
  genome: Genome
  kind: FileKind
  /** สายพันธุ์ตั้งต้นที่ถูกเลือก (ซ้ำกัน = พันธุ์แท้) */
  species: [string, string]
  /** ไฟล์เก่ามาก → ไข่ฟอสซิล */
  fossil: boolean
}

const EXT_KIND: Record<FileKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif', 'psd', 'tiff', 'ico'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'mid', 'midi', 'wma'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  document: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'ppt', 'pptx', 'epub', 'pages'],
  code: [
    'js',
    'ts',
    'tsx',
    'jsx',
    'py',
    'rs',
    'go',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'html',
    'css',
    'sh',
    'rb',
    'php',
    'swift',
    'kt',
    'lua',
    'sql',
  ],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  data: ['csv', 'xls', 'xlsx', 'json', 'xml', 'yaml', 'yml', 'db', 'sqlite', 'parquet'],
  other: [],
}

export function classifyFile(ext: string): FileKind {
  const e = ext.toLowerCase().replace(/^\./, '')
  for (const [kind, list] of Object.entries(EXT_KIND) as [FileKind, string[]][]) {
    if (list.includes(e)) return kind
  }
  return 'other'
}

const KIND_LINEAGE_BONUS: Record<FileKind, Partial<Record<Lineage, number>>> = {
  image: { mythical: 2 },
  audio: { mythical: 1, modern: 1 },
  video: { mythical: 1 },
  document: { modern: 1, prehistoric: 1 },
  code: { prehistoric: 1, mythical: 1 },
  archive: { prehistoric: 3 },
  data: { modern: 2 },
  other: {},
}

/** ค่าที่ไฟล์แต่ละชนิดดันยีนส์ตัวเลข (บวกเพิ่มกับ allele ทั้งคู่) */
const KIND_NUM_BIAS: Record<FileKind, Record<string, number>> = {
  image: { 'temper.affection': 0.1, 'eye.size': 0.08 },
  audio: { 'temper.playful': 0.2, 'meta.chronotype': 0.1 },
  video: { 'temper.playful': 0.15, 'temper.curious': 0.1 },
  document: { 'temper.curious': 0.2, 'temper.sleepy': 0.1 },
  code: { 'temper.mischief': 0.15, 'temper.curious': 0.15 },
  archive: { 'temper.appetite': 0.25, 'body.girth': 0.2 },
  data: { 'temper.shy': 0.1, 'temper.curious': 0.1 },
  other: {},
}

const FOSSIL_AGE_YEARS = 8

/** ทำให้สีจากรูปเข้ากับโทนพาสเทลของเกม */
function pastelize(color: Oklch): Oklch {
  return { l: clamp(color.l, 0.6, 0.95), c: clamp(color.c, 0.02, 0.16), h: color.h }
}

/**
 * อัญเชิญสัตว์จากไฟล์: ฟังก์ชันบริสุทธิ์ — features ชุดเดียวกันได้ genome เดิมเสมอ
 */
export function summonFromFile(features: FileFeatures, db: GeneDb = geneDb): SummonResult {
  const kind = classifyFile(features.ext)
  const age = Math.max(0, features.ageYears ?? 0)
  const rng = new Rng(`summon:${features.hashHex}:${features.size}`)

  const lineageWeight: Record<Exclude<Lineage, 'any'>, number> = {
    modern: 6,
    prehistoric: 2 + Math.min(8, age),
    mythical: 2,
  }
  for (const [lineage, bonus] of Object.entries(KIND_LINEAGE_BONUS[kind])) {
    lineageWeight[lineage as Exclude<Lineage, 'any'>] += bonus ?? 0
  }

  const speciesIds = Object.keys(db.species).sort()
  const pickSpecies = (): string => {
    const lineage = rng.weighted(Object.entries(lineageWeight) as [Lineage, number][])
    const candidates = speciesIds.filter((id) => db.species[id]?.lineage === lineage)
    return rng.pick(candidates.length > 0 ? candidates : speciesIds)
  }
  const speciesA = pickSpecies()
  const speciesB = rng.chance(0.5) ? speciesA : pickSpecies()

  let genome: Genome
  if (speciesA === speciesB) {
    genome = createFounder(speciesA, rng, db)
  } else {
    const a = createFounder(speciesA, rng, db)
    const b = createFounder(speciesB, rng, db)
    genome = breed(a, b, rng, { mutationRate: 0.05, db }).genome
    genome.generation = 0
  }

  // ขนาดไฟล์ → ขนาดตัว (1KB ≈ เล็ก, 1GB ≈ ใหญ่สุด)
  const sizeTarget = clamp(Math.log10(features.size + 1) / 9)
  const bias: Record<string, number> = { ...KIND_NUM_BIAS[kind] }
  for (const allele of genome.genes['body.size'] as [NumAllele, NumAllele]) {
    allele.v = clamp(lerp(allele.v, sizeTarget, 0.5))
  }
  for (const [locusId, delta] of Object.entries(bias)) {
    for (const allele of (genome.genes[locusId] ?? []) as NumAllele[]) {
      allele.v = clamp(allele.v + delta)
    }
  }

  // ไฟล์โค้ด → มีโอกาสสูงที่จะได้เกล็ด
  if (kind === 'code' && db.alleles['pattern.scales']) {
    const gene = genome.genes['pattern.type']
    if (gene) gene[rng.int(2)] = { k: 'p', id: 'pattern.scales' }
  }

  // รูปภาพ → สีเด่นของภาพกลายเป็นสีตัว/สีลาย
  const palette = (features.palette ?? []).map(pastelize)
  const setColor = (locusId: string, slot: 0 | 1, color: Oklch | undefined, d: number) => {
    const gene = genome.genes[locusId]
    if (!gene || !color) return
    gene[slot] = { k: 'c', ...color, d } satisfies ColorAllele
  }
  if (palette.length > 0) {
    setColor('color.base', 0, palette[0], 0.7)
    setColor('color.base', 1, palette[1] ?? palette[0], 0.4)
    setColor('color.pattern', 0, palette[2] ?? palette[1], 0.6)
    setColor('color.accent', 0, palette[3] ?? palette[2], 0.5)
  }

  return { genome, kind, species: [speciesA, speciesB], fossil: age >= FOSSIL_AGE_YEARS }
}
