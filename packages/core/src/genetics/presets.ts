import { geneDb, type GeneDb } from '@mochimon/data'
import { Rng } from '../rng'
import { breed } from './breed'
import { createFounder } from './genome'
import type { Allele, Gene, Genome } from './types'

const P = (id: string): Allele => ({ k: 'p', id })
const N = (v: number): Allele => ({ k: 'n', v })
const C = (l: number, c: number, h: number, d = 0.5): Allele => ({ k: 'c', l, c, h, d })
const both = (a: Allele): Gene => [a, { ...a }]

/**
 * "โมจิ" — ตัวเอกของเกม: ลูกผสมแมว×มังกร ขนขาว-ลาเวนเดอร์ เขาฟ้าเรืองแสง ปีกขนนกเล็ก หางฟู
 * ลักษณะที่มองเห็นถูกกำหนดตายตัว ส่วนยีนส์ด้อยที่ซ่อนอยู่และนิสัยมาจากการผสมจริง (seed คงที่)
 */
export function createMochi(db: GeneDb = geneDb): Genome {
  const rng = new Rng('mochi-the-first')
  const genome = breed(createFounder('cat', rng, db), createFounder('dragon', rng, db), rng, {
    mutationRate: 0,
    db,
  }).genome
  genome.generation = 0

  const visible: Record<string, Gene> = {
    'head.shape': both(P('head.cat')),
    'ear.type': both(P('ear.cat')),
    'horn.type': [P('horn.curved'), P('horn.none')],
    'wing.type': [P('wing.feather'), P('wing.feather')],
    'tail.type': [P('tail.fluffy'), P('tail.dragon')],
    'limb.type': both(P('limb.quad')),
    'eye.type': [P('eye.round'), P('eye.sparkle')],
    'pattern.type': [P('pattern.plain'), P('pattern.gradient')],
    'special.trait': both(P('special.none')),
    'marking.mask': [P('mask.cape'), P('mask.none')],
    'marking.socks': both(P('socks.none')),
    'marking.tail': both(P('tailmark.tip')),
    'marking.symbol': both(P('symbol.star')),
    'body.size': both(N(0.45)),
    'body.length': both(N(0.4)),
    'body.girth': both(N(0.5)),
    'leg.length': both(N(0.3)),
    'head.size': both(N(0.8)),
    'ear.size': both(N(0.62)),
    'horn.size': both(N(0.42)),
    'wing.size': both(N(0.34)),
    'tail.size': both(N(0.72)),
    'eye.size': both(N(0.78)),
    'fur.length': both(N(0.85)),
    'glow.level': both(N(0.9)),
    'color.base': both(C(0.975, 0.012, 290)),
    'color.belly': both(C(0.985, 0.008, 90)),
    'color.mark': both(C(0.74, 0.1, 283)),
    'color.pattern': both(C(0.74, 0.1, 283)),
    'color.eye': both(C(0.56, 0.11, 55)),
    'color.accent': both(C(0.86, 0.09, 232)),
    'color.inner': both(C(0.84, 0.085, 8)),
  }
  for (const [locus, gene] of Object.entries(visible)) {
    if (!genome.genes[locus]) throw new Error(`createMochi: unknown locus ${locus}`)
    genome.genes[locus] = gene
  }
  return genome
}
