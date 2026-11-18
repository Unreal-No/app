import type { Alarm } from './bridge'

/**
 * แหล่งเวลาแจ้งเตือนเพิ่มเติม (นอกจากนัด/ปฏิทิน/โฟกัส) เช่น สัตว์กลับจากการสำรวจ
 * — ส่งให้ Rust แสดง Windows toast ตอนหน้าต่างสัตว์ถูกซ่อน
 */
const sources: (() => Alarm[])[] = []

export function addAlarmSource(source: () => Alarm[]): void {
  sources.push(source)
}

export const extraAlarms = (): Alarm[] => sources.flatMap((source) => source())
