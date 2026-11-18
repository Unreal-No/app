import { dayKey } from '../companion/time'
import type { FileKind } from './fileSeed'

/** อัญเชิญได้กี่ครั้งต่อวัน (นับตามวันของเครื่อง) */
export const SUMMONS_PER_DAY = 3
/** จำไฟล์ที่เคยอัญเชิญไว้ไม่เกินเท่านี้ (เก่าสุดถูกลืมก่อน) */
export const MAX_SUMMON_RECORDS = 2000

export interface SummonRecord {
  at: number
  petId: string
  name: string
  kind: FileKind
}

/**
 * บันทึกการอัญเชิญ: เก็บแค่ hash ของไฟล์ (ไม่มีชื่อไฟล์/เนื้อหา) → สัตว์ที่ได้
 * ใช้กันอัญเชิญไฟล์เดิมซ้ำ และนับโควตาต่อวัน
 */
export interface SummonLog {
  files: Record<string, SummonRecord>
  /** วันที่ของตัวนับ (YYYY-MM-DD) */
  day: string
  /** จำนวนครั้งที่ใช้ไปในวันนั้น */
  used: number
}

export const createSummonLog = (): SummonLog => ({ files: {}, day: '', used: 0 })

export type SummonCheck =
  | { ok: true; left: number }
  | { ok: false; reason: 'used'; record: SummonRecord }
  | { ok: false; reason: 'quota' }

/** อัญเชิญได้อีกกี่ครั้งวันนี้ */
export function summonsLeft(log: SummonLog, now: number): number {
  const used = log.day === dayKey(now) ? log.used : 0
  return Math.max(0, SUMMONS_PER_DAY - used)
}

/** ไฟล์นี้อัญเชิญได้ไหม (ไฟล์ละครั้ง + โควตาต่อวัน) */
export function canSummon(log: SummonLog, hash: string, now: number): SummonCheck {
  const record = log.files[hash]
  if (record) return { ok: false, reason: 'used', record }
  const left = summonsLeft(log, now)
  return left > 0 ? { ok: true, left } : { ok: false, reason: 'quota' }
}

/** บันทึกการอัญเชิญ 1 ครั้ง (คืนบันทึกใหม่ ไม่แก้ของเดิม) */
export function recordSummon(
  log: SummonLog,
  hash: string,
  record: SummonRecord,
  now = record.at,
): SummonLog {
  const today = dayKey(now)
  let files: Record<string, SummonRecord> = { ...log.files, [hash]: record }
  const keys = Object.keys(files)
  if (keys.length > MAX_SUMMON_RECORDS) {
    files = Object.fromEntries(
      Object.entries(files)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_SUMMON_RECORDS),
    )
  }
  return { files, day: today, used: (log.day === today ? log.used : 0) + 1 }
}

const HASH = /^[0-9a-f]{64}$/

/** ซ่อมบันทึกจากเซฟ: รายการที่เสียถูกทิ้งทีละรายการ */
export function repairSummonLog(raw: unknown): SummonLog {
  const log = createSummonLog()
  if (typeof raw !== 'object' || raw === null) return log
  const r = raw as Record<string, unknown>
  if (typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) log.day = r.day
  if (typeof r.used === 'number' && Number.isFinite(r.used))
    log.used = Math.max(0, Math.min(SUMMONS_PER_DAY, Math.floor(r.used)))
  if (typeof r.files === 'object' && r.files !== null) {
    for (const [hash, value] of Object.entries(r.files as Record<string, unknown>)) {
      if (!HASH.test(hash) || typeof value !== 'object' || value === null) continue
      const v = value as Record<string, unknown>
      if (typeof v.at !== 'number' || typeof v.petId !== 'string') continue
      log.files[hash] = {
        at: v.at,
        petId: v.petId,
        name: typeof v.name === 'string' ? v.name.slice(0, 24) : '',
        kind: (typeof v.kind === 'string' ? v.kind : 'other') as FileKind,
      }
    }
  }
  return log
}
