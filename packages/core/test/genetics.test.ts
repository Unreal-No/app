import { describe, expect, it } from 'vitest'
import {
  allelesEqual,
  breed,
  createFounder,
  deserializeGenome,
  express,
  expressColor,
  expressPart,
  geneDb,
  mutateAllele,
  Rng,
  serializeGenome,
  speciesLabel,
  validateGenome,
  type Allele,
  type Gene,
  type Genome,
  type PartAllele,
} from '../src'

const speciesIds = Object.keys(geneDb.species)

/** founder ที่บังคับ allele ของ locus หนึ่งให้เป็นค่าที่กำหนด */
function withGene(genome: Genome, locus: string, gene: Gene): Genome {
  return { ...genome, genes: { ...genome.genes, [locus]: gene } }
}
const P = (id: string): PartAllele => ({ k: 'p', id })

describe('Gene DB', () => {
  it('มีสายพันธุ์ครบ 3 lineage', () => {
    const lineages = new Set(Object.values(geneDb.species).map((s) => s.lineage))
    expect(lineages).toEqual(new Set(['modern', 'prehistoric', 'mythical']))
  })

  it('ทุก part-locus มี allele ให้เลือกหลายแบบ (special.trait ได้จากการกลายพันธุ์เท่านั้น)', () => {
    for (const locus of geneDb.loci) {
      if (locus.kind !== 'part') continue
      const all = geneDb.allelesByLocus[locus.id]!
      const inheritable = all.filter((a) => !a.mutationOnly)
      if (locus.id === 'special.trait') {
        expect(inheritable.map((a) => a.id)).toEqual(['special.none'])
        expect(all.length).toBeGreaterThan(1)
      } else {
        expect(inheritable.length, locus.id).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('createFounder', () => {
  it.each(speciesIds)('%s: genome ครบทุก locus และถูกต้อง', (id) => {
    const genome = createFounder(id, new Rng(`founder-${id}`))
    expect(validateGenome(genome)).toEqual([])
    expect(genome.ancestry).toEqual({ [id]: 1 })
    expect(genome.generation).toBe(0)
  })

  it('seed เดียวกันได้ genome เดิมเสมอ, seed ต่างได้ผลต่าง', () => {
    const a = createFounder('dragon', new Rng(42))
    const b = createFounder('dragon', new Rng(42))
    const c = createFounder('dragon', new Rng(43))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('serialize → deserialize ได้ค่าเดิม และปฏิเสธข้อมูลเสีย', () => {
    const genome = createFounder('cat', new Rng(7))
    expect(deserializeGenome(serializeGenome(genome))).toEqual(genome)
    expect(() => deserializeGenome('{"v":1,"genes":{}}')).toThrow(/invalid genome/)
  })
})

describe('express', () => {
  it('เด่นข่มด้อย: allele dominance สูงกว่าแสดงออก อีกตัวเป็นยีนส์ซ่อน', () => {
    const bat = geneDb.alleles['wing.bat']! // dominance 4
    const none = geneDb.alleles['wing.none']! // dominance 3
    const forward = expressPart(bat, none)
    const backward = expressPart(none, bat)
    expect(forward.def.id).toBe('wing.bat')
    expect(forward.hidden?.id).toBe('wing.none')
    expect(backward.def.id).toBe('wing.bat')
    expect(forward.codominant).toBe(false)
  })

  it('เด่นร่วม: dominance เท่ากัน → ผลไม่ขึ้นกับลำดับพ่อแม่', () => {
    const spots = geneDb.alleles['pattern.spots']!
    const stripes = geneDb.alleles['pattern.stripes']!
    expect(spots.dominance).toBe(stripes.dominance)
    const ab = expressPart(spots, stripes)
    const ba = expressPart(stripes, spots)
    expect(ab.codominant).toBe(true)
    expect(ab.def.id).toBe(ba.def.id)
  })

  it('สี: ตัวที่เด่นกว่ามากชนะเกือบขาด, เด่นเท่ากันได้สีกลาง', () => {
    const red: Allele = { k: 'c', l: 0.7, c: 0.15, h: 20, d: 0.9 }
    const blue: Allele = { k: 'c', l: 0.7, c: 0.15, h: 260, d: 0.1 }
    const strong = expressColor(red as never, blue as never)
    expect(Math.abs(strong.h - 20)).toBeLessThan(2)
    const even = expressColor({ ...red, d: 0.5 } as never, { ...blue, d: 0.5 } as never)
    // hue กึ่งกลางตามเส้นทางสั้นสุด (20 → 260 ผ่าน 320)
    expect(even.h).toBeCloseTo(320, 0)
    expect(even.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('locus ตัวเลขแสดงออกเป็นค่าเฉลี่ยของ 2 allele', () => {
    const base = createFounder('cat', new Rng(1))
    const genome = withGene(base, 'body.size', [
      { k: 'n', v: 0.2 },
      { k: 'n', v: 0.8 },
    ])
    expect(express(genome).nums['body.size']).toBeCloseTo(0.5)
  })

  it('ถิ่นอาศัยมาจากชิ้นส่วน: นก→ฟ้า, ปลา→น้ำ, แมว→บก', () => {
    expect(express(createFounder('chick', new Rng(1))).habitat).toBe('sky')
    expect(express(createFounder('koi', new Rng(1))).habitat).toBe('water')
    expect(express(createFounder('cat', new Rng(1))).habitat).toBe('land')
  })
})

describe('breed', () => {
  it('ผสมข้ามสายพันธุ์ได้ทุกคู่ และลูกเป็น genome ที่ถูกต้อง', () => {
    for (const a of speciesIds) {
      for (const b of speciesIds) {
        const rng = new Rng(`${a}x${b}`)
        const child = breed(createFounder(a, rng), createFounder(b, rng), rng).genome
        expect(validateGenome(child), `${a}x${b}`).toEqual([])
        expect(() => express(child)).not.toThrow()
        expect(child.generation).toBe(1)
      }
    }
  })

  it('ไม่มี mutation → ลูกได้ allele 1 ตัวจากพ่อ และ 1 ตัวจากแม่ ทุก locus', () => {
    const rng = new Rng('inherit')
    const mom = createFounder('dragon', rng)
    const dad = createFounder('bunny', rng)
    for (let i = 0; i < 50; i++) {
      const { genome, mutations } = breed(mom, dad, rng, { mutationRate: 0 })
      expect(mutations).toEqual([])
      for (const locus of geneDb.loci) {
        const [fromMom, fromDad] = genome.genes[locus.id]!
        expect(mom.genes[locus.id]!.some((x) => allelesEqual(x, fromMom))).toBe(true)
        expect(dad.genes[locus.id]!.some((x) => allelesEqual(x, fromDad))).toBe(true)
      }
    }
  })

  it('อัตราส่วนเมนเดล: Aa × Aa ได้ลักษณะเด่น:ด้อย ≈ 3:1', () => {
    // wing.bat (เด่น 4) ข่ม wing.none (3) → พ่อแม่มีปีกทั้งคู่แต่ซ่อนยีนส์ไร้ปีก
    const rng = new Rng('mendel')
    const carrier = withGene(createFounder('dragon', rng), 'wing.type', [
      P('wing.bat'),
      P('wing.none'),
    ])
    expect(express(carrier).parts.wings.shape).toBe('bat')
    const trials = 4000
    let recessive = 0
    for (let i = 0; i < trials; i++) {
      const child = breed(carrier, carrier, rng, { mutationRate: 0 }).genome
      if (express(child).parts.wings.shape === 'none') recessive++
    }
    // ค่าคาดหวัง 25% (ส่วนเบี่ยงเบนมาตรฐาน ≈ 0.7%)
    expect(recessive / trials).toBeGreaterThan(0.22)
    expect(recessive / trials).toBeLessThan(0.28)
  })

  it('ยีนส์ด้อยที่ซ่อนอยู่โผล่ได้ในรุ่นหลาน', () => {
    const rng = new Rng('grandchild')
    const unicorn = withGene(createFounder('unicorn', rng), 'horn.type', [
      P('horn.spiral'),
      P('horn.spiral'),
    ])
    const cat = withGene(createFounder('cat', rng), 'horn.type', [P('horn.none'), P('horn.none')])
    // รุ่นลูก: horn.none (เด่น 2) ข่ม horn.spiral (1) ทุกตัว
    const f1 = Array.from(
      { length: 20 },
      () => breed(unicorn, cat, rng, { mutationRate: 0 }).genome,
    )
    expect(f1.every((g) => express(g).parts.horns.shape === 'none')).toBe(true)
    expect(f1.every((g) => express(g).parts.horns.hidden?.id === 'horn.spiral')).toBe(true)
    // รุ่นหลาน: เขายูนิคอร์นกลับมาประมาณ 1 ใน 4
    let horned = 0
    for (let i = 0; i < 400; i++) {
      const g = breed(f1[0]!, f1[1]!, rng, { mutationRate: 0 }).genome
      if (express(g).parts.horns.shape === 'spiral') horned++
    }
    expect(horned).toBeGreaterThan(60)
    expect(horned).toBeLessThan(140)
  })

  it('seed เดียวกันได้ลูกตัวเดิม', () => {
    const mom = createFounder('cat', new Rng(1))
    const dad = createFounder('trike', new Rng(2))
    expect(breed(mom, dad, new Rng(99))).toEqual(breed(mom, dad, new Rng(99)))
  })

  it('ancestry เฉลี่ยจากพ่อแม่ และรวมกันได้ 1', () => {
    const rng = new Rng('ancestry')
    const f1 = breed(createFounder('cat', rng), createFounder('dragon', rng), rng).genome
    expect(f1.ancestry).toEqual({ cat: 0.5, dragon: 0.5 })
    const f2 = breed(f1, createFounder('koi', rng), rng).genome
    expect(f2.ancestry).toEqual({ cat: 0.25, dragon: 0.25, koi: 0.5 })
    expect(f2.generation).toBe(2)
  })

  it('linkage: locus ในกลุ่มเดียวกันถ่ายทอดไปด้วยกันบ่อยกว่าสุ่มอิสระ', () => {
    const rng = new Rng('linkage')
    let parent = createFounder('cat', rng)
    // สาย 0: หัวแมว+หูแมว, สาย 1: หัวกระต่าย+หูยาว (head.shape กับ ear.type อยู่ linkage group 1)
    parent = withGene(parent, 'head.shape', [P('head.cat'), P('head.bunny')])
    parent = withGene(parent, 'ear.type', [P('ear.cat'), P('ear.bunny')])
    let together = 0
    const trials = 2000
    for (let i = 0; i < trials; i++) {
      const child = breed(parent, parent, rng, { mutationRate: 0 }).genome
      const head = (child.genes['head.shape']![0] as PartAllele).id
      const ear = (child.genes['ear.type']![0] as PartAllele).id
      if ((head === 'head.cat') === (ear === 'ear.cat')) together++
    }
    // recombination 25% → ไปด้วยกัน ≈ 75% (ถ้าอิสระจะเป็น 50%)
    expect(together / trials).toBeGreaterThan(0.7)
    expect(together / trials).toBeLessThan(0.8)
  })
})

describe('mutation', () => {
  it('อัตรากลายพันธุ์สูง → เกิด mutation และ genome ยังถูกต้อง', () => {
    const rng = new Rng('mutate')
    const mom = createFounder('cat', rng)
    const dad = createFounder('cat', rng)
    const { genome, mutations } = breed(mom, dad, rng, { mutationRate: 0.5 })
    expect(mutations.length).toBeGreaterThan(10)
    expect(validateGenome(genome)).toEqual([])
  })

  it('allele พิเศษ (mutationOnly) ได้จากการกลายพันธุ์เท่านั้น', () => {
    const rng = new Rng('novel')
    const locus = geneDb.lociById['special.trait']!
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const m = mutateAllele(P('special.none'), locus, rng)
      if (m && m.to.k === 'p') {
        seen.add(m.to.id)
        expect(m.kind).toBe('novel')
      }
    }
    expect(seen).toEqual(new Set(['special.glow', 'special.crystal', 'special.rainbow']))
    // founder ไม่มีทางมี allele พิเศษ
    for (const id of speciesIds) {
      const g = createFounder(id, new Rng(id))
      for (const gene of Object.values(g.genes)) {
        for (const a of gene)
          if (a.k === 'p') expect(geneDb.alleles[a.id]!.mutationOnly).toBeFalsy()
      }
    }
  })

  it('ค่าตัวเลข/สีที่กลายพันธุ์ยังอยู่ในช่วงที่ถูกต้อง', () => {
    const rng = new Rng('range')
    const numLocus = geneDb.lociById['body.size']!
    const colorLocus = geneDb.lociById['color.base']!
    for (let i = 0; i < 500; i++) {
      const n = mutateAllele({ k: 'n', v: rng.next() }, numLocus, rng)!.to
      expect(n.k === 'n' && n.v >= 0 && n.v <= 1).toBe(true)
      const c = mutateAllele({ k: 'c', l: 0.9, c: 0.28, h: 350, d: 0.95 }, colorLocus, rng)!.to
      expect(c.k === 'c' && c.h >= 0 && c.h < 360 && c.d >= 0 && c.d <= 1 && c.c <= 0.3).toBe(true)
    }
  })
})

describe('speciesLabel', () => {
  it('พันธุ์แท้ใช้ชื่อสายพันธุ์ ลูกผสมได้ชื่อประสมที่คงที่', () => {
    const rng = new Rng('names')
    const cat = createFounder('cat', rng)
    const dragon = createFounder('dragon', rng)
    expect(speciesLabel(cat).th).toBe('แมว')
    const hybrid = breed(cat, dragon, rng).genome
    const label = speciesLabel(hybrid)
    expect(label.en).not.toBe('Cat')
    expect(label.th).toContain('×')
    expect(speciesLabel(breed(dragon, cat, rng).genome)).toEqual(label)
  })
})
