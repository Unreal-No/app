import type { Phenotype } from '../genetics/types'
import { clamp, lerp } from '../rng'

export type LifeStage = 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'elder'
export const LIFE_STAGES: LifeStage[] = ['egg', 'baby', 'child', 'teen', 'adult', 'elder']

/** สภาพร่างกายที่เกิดจากการเลี้ยงดู (ไม่ใช่ยีนส์) */
export interface Nurture {
  stage: LifeStage
  /** ไขมันสะสม 0..1 (≈0.35 คือสมส่วน) */
  fat: number
  /** ความฟิตจากการเล่น/ออกกำลัง 0..1 */
  fitness: number
}

export const DEFAULT_NURTURE: Nurture = { stage: 'adult', fat: 0.35, fitness: 0.4 }

export type Posture = 'quad' | 'upright' | 'float'
export type Build = 'thin' | 'fit' | 'balanced' | 'chubby' | 'round'

/** สัดส่วนร่างกายสำเร็จรูปที่ตัวสร้าง mesh ใช้ (หน่วย: ความสูงตัวโตเต็มวัยขนาดกลาง ≈ 1) */
export interface BodySpec {
  posture: Posture
  scale: number
  /** ครึ่งแกนของลำตัว: x=กว้าง y=สูง z=ยาว */
  torso: { rx: number; ry: number; rz: number }
  /** พุงย้อย 0..1 */
  belly: number
  headR: number
  legLen: number
  legR: number
  earScale: number
  hornScale: number
  wingScale: number
  tailScale: number
  eyeScale: number
  build: Build
}

const STAGE: Record<LifeStage, { scale: number; head: number; leg: number; extra: number }> = {
  egg: { scale: 0.5, head: 1.3, leg: 0.6, extra: 0.3 },
  baby: { scale: 0.5, head: 1.3, leg: 0.6, extra: 0.3 },
  child: { scale: 0.68, head: 1.18, leg: 0.8, extra: 0.6 },
  teen: { scale: 0.86, head: 1.06, leg: 0.95, extra: 0.85 },
  adult: { scale: 1, head: 1, leg: 1, extra: 1 },
  elder: { scale: 0.97, head: 1, leg: 0.95, extra: 1 },
}

export function postureOf(limbShape: string): Posture {
  if (limbShape === 'flipper') return 'float'
  if (limbShape === 'biped' || limbShape === 'stubby') return 'upright'
  return 'quad'
}

/**
 * รูปร่าง = f(ยีนส์โครงร่าง, ช่วงวัย, ไขมัน, ความฟิต)
 * ยีนส์กำหนด "กรอบ" (สูง/เตี้ย โครงใหญ่/เล็ก) การเลี้ยงดูกำหนดว่าอ้วน/ผอม/ฟิตแค่ไหนในกรอบนั้น
 */
export function composeBody(p: Phenotype, nurture: Nurture = DEFAULT_NURTURE): BodySpec {
  const n = (id: string) => p.nums[id] ?? 0.5
  const stage = STAGE[nurture.stage]
  const fat = clamp(nurture.fat)
  const fitness = clamp(nurture.fitness)
  const posture = postureOf(p.parts.limbs.shape)

  const girth = lerp(0.82, 1.2, n('body.girth')) * (1 + (fat - 0.35) * 0.9) * (1 - fitness * 0.08)
  const length = n('body.length')
  const torso =
    posture === 'upright'
      ? { rx: 0.26 * girth, ry: lerp(0.27, 0.36, length), rz: 0.24 * girth }
      : { rx: 0.25 * girth, ry: 0.235 * girth, rz: lerp(0.28, 0.4, length) }

  // สัดส่วนชิบิ: ขาสั้นป้อม หัวโต (หัว ≈ ครึ่งหนึ่งของความสูง)
  const legGene = lerp(0.08, 0.26, n('leg.length'))
  const legLen = posture === 'float' ? 0 : legGene * stage.leg * (posture === 'upright' ? 0.75 : 1)

  const score = fat - fitness * 0.25
  const build: Build =
    score > 0.62
      ? 'round'
      : score > 0.42
        ? 'chubby'
        : score < 0.12
          ? 'thin'
          : fitness > 0.7
            ? 'fit'
            : 'balanced'

  return {
    posture,
    scale: lerp(0.75, 1.4, n('body.size')) * stage.scale,
    torso,
    belly: clamp((fat - 0.25) * 1.3),
    headR: lerp(0.36, 0.46, n('head.size')) * stage.head,
    legLen,
    legR: 0.082 * lerp(0.9, 1.15, n('body.girth')) * (1 + fat * 0.4 + fitness * 0.15),
    earScale: lerp(0.6, 1.4, n('ear.size')),
    hornScale: lerp(0.5, 1.4, n('horn.size')) * stage.extra,
    wingScale: lerp(0.6, 1.4, n('wing.size')) * lerp(0.7, 1, stage.extra),
    tailScale: lerp(0.6, 1.4, n('tail.size')),
    eyeScale: lerp(0.85, 1.2, n('eye.size')),
    build,
  }
}

/** ความสูงรวมโดยประมาณ (หน่วยเดียวกับ BodySpec หลังคูณ scale) */
export function approxHeight(spec: BodySpec): number {
  const torsoTop = spec.legLen + spec.torso.ry * 2
  const headTop =
    spec.posture === 'upright'
      ? torsoTop + spec.headR * 1.5
      : spec.legLen + spec.torso.ry * 1.6 + spec.headR * 1.5
  return Math.max(torsoTop, headTop) * spec.scale
}
