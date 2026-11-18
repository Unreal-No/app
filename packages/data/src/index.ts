import { z } from 'zod'
import lociJson from './loci.json'
import headJson from './alleles/head.json'
import earsJson from './alleles/ears.json'
import hornsJson from './alleles/horns.json'
import wingsJson from './alleles/wings.json'
import tailJson from './alleles/tail.json'
import limbsJson from './alleles/limbs.json'
import eyesJson from './alleles/eyes.json'
import patternJson from './alleles/pattern.json'
import specialJson from './alleles/special.json'
import markingsJson from './alleles/markings.json'
import catJson from './species/cat.json'
import bunnyJson from './species/bunny.json'
import chickJson from './species/chick.json'
import koiJson from './species/koi.json'
import trikeJson from './species/trike.json'
import dragonJson from './species/dragon.json'
import unicornJson from './species/unicorn.json'
import firedragonJson from './species/firedragon.json'
import {
  LocusSchema,
  PartAlleleDefSchema,
  SpeciesSchema,
  type GeneDb,
  type Locus,
  type PartAlleleDef,
  type Species,
} from './schema'

export * from './schema'

/**
 * ประกอบ + ตรวจความถูกต้องของ Gene DB
 * โยน error ทันทีถ้าข้อมูลอ้างอิงกันผิด (allele ชี้ locus ที่ไม่มี, สายพันธุ์ขาด locus ฯลฯ)
 */
export function buildGeneDb(raw: {
  loci: unknown
  alleles: unknown[]
  species: unknown[]
}): GeneDb {
  const loci: Locus[] = z.array(LocusSchema).parse(raw.loci)
  const lociById: Record<string, Locus> = {}
  for (const l of loci) {
    if (lociById[l.id]) throw new Error(`duplicate locus: ${l.id}`)
    lociById[l.id] = l
  }

  const alleles: Record<string, PartAlleleDef> = {}
  const allelesByLocus: Record<string, PartAlleleDef[]> = {}
  for (const file of raw.alleles) {
    for (const a of z.array(PartAlleleDefSchema).parse(file)) {
      const locus = lociById[a.locus]
      if (!locus || locus.kind !== 'part') throw new Error(`allele ${a.id}: bad locus ${a.locus}`)
      if (alleles[a.id]) throw new Error(`duplicate allele: ${a.id}`)
      alleles[a.id] = a
      ;(allelesByLocus[a.locus] ??= []).push(a)
    }
  }

  const species: Record<string, Species> = {}
  for (const s of raw.species) {
    const sp = SpeciesSchema.parse(s)
    for (const l of loci) {
      if (l.kind === 'part') {
        const pool = sp.parts[l.id]
        if (!pool) throw new Error(`species ${sp.id}: missing part locus ${l.id}`)
        for (const [id] of pool) {
          const a = alleles[id]
          if (!a || a.locus !== l.id) throw new Error(`species ${sp.id}: bad allele ${id}`)
          if (a.mutationOnly) throw new Error(`species ${sp.id}: mutation-only allele ${id}`)
        }
      } else if (l.kind === 'color' && !sp.colors[l.id]) {
        throw new Error(`species ${sp.id}: missing color locus ${l.id}`)
      }
    }
    for (const id of [
      ...Object.keys(sp.parts),
      ...Object.keys(sp.nums),
      ...Object.keys(sp.colors),
    ]) {
      if (!lociById[id]) throw new Error(`species ${sp.id}: unknown locus ${id}`)
    }
    species[sp.id] = sp
  }

  for (const l of loci) {
    if (l.kind === 'part' && !allelesByLocus[l.id]?.some((a) => !a.mutationOnly)) {
      throw new Error(`locus ${l.id} has no inheritable alleles`)
    }
  }
  return { loci, lociById, alleles, allelesByLocus, species }
}

export const geneDb: GeneDb = buildGeneDb({
  loci: lociJson,
  alleles: [
    headJson,
    earsJson,
    hornsJson,
    wingsJson,
    tailJson,
    limbsJson,
    eyesJson,
    patternJson,
    specialJson,
    markingsJson,
  ],
  species: [
    catJson,
    bunnyJson,
    chickJson,
    koiJson,
    trikeJson,
    dragonJson,
    unicornJson,
    firedragonJson,
  ],
})
