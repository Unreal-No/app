import { describe, expect, it } from 'vitest'
import {
  acknowledge,
  alertsBetween,
  AWAY_RESET,
  createCompanion,
  createFocus,
  createReminder,
  createWellbeing,
  DEFAULT_FOCUS_SETTINGS,
  DEFAULT_WELLBEING_SETTINGS,
  drinkWater,
  focusRemaining,
  formatWhen,
  MINUTE,
  nextOccurrence,
  overdue,
  parseQuickEntry,
  pauseFocus,
  repairCompanion,
  resumeFocus,
  snooze,
  startFocus,
  tickFocus,
  tickWellbeing,
  upcoming,
  type QuickEntry,
  type WellbeingSettings,
} from '../src'

/** อังคาร 17 พ.ย. 2026 10:00 (เวลาท้องถิ่น) */
const NOW = new Date(2026, 10, 17, 10, 0).getTime()
const local = (month: number, day: number, hour: number, minute = 0, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).getTime()

describe('นัดและการเตือน', () => {
  const meeting = createReminder('r1', 'ประชุม', local(11, 17, 14, 30), 'none', NOW)

  it('เตือนล่วงหน้า 10/5/1 นาที แล้วถึงเวลา — เรียกทุกวินาทีไม่ซ้ำไม่ตกหล่น', () => {
    const seen: string[] = []
    let last = local(11, 17, 14, 0)
    for (let t = last + 1000; t <= local(11, 17, 14, 31); t += 1000) {
      for (const a of alertsBetween([meeting], last, t))
        seen.push(a.kind === 'lead' ? `lead${a.minutes}` : a.kind)
      last = t
    }
    expect(seen).toEqual(['lead10', 'lead5', 'lead1', 'due'])
  })

  it('เครื่องหลับข้ามเวลานัด → แจ้ง "เลยเวลา" ครั้งเดียว ไม่ไล่แจ้งเตือนล่วงหน้าที่พลาดไป', () => {
    const alerts = alertsBetween([meeting], local(11, 17, 13, 0), local(11, 17, 15, 0))
    expect(alerts).toEqual([{ reminderId: 'r1', kind: 'missed', at: meeting.at }])
  })

  it('ช่วงที่ครอบเตือนล่วงหน้าหลายครั้ง → แจ้งเฉพาะอันที่ใกล้ที่สุด', () => {
    const alerts = alertsBetween([meeting], local(11, 17, 14, 0), local(11, 17, 14, 27))
    expect(alerts.map((a) => a.minutes)).toEqual([5])
  })

  it('นัดที่รับทราบแล้วไม่แจ้งอีก, นัดที่ค้างแสดงใน overdue', () => {
    expect(overdue([meeting], local(11, 17, 15, 0)).map((r) => r.id)).toEqual(['r1'])
    const done = acknowledge(meeting, local(11, 17, 15, 0))
    expect(done.done).toBe(true)
    expect(overdue([done], local(11, 17, 15, 0))).toEqual([])
    expect(alertsBetween([done], local(11, 17, 14, 0), local(11, 17, 15, 0))).toEqual([])
  })

  it('เลื่อน 5 นาที: แจ้งใหม่ตอนครบ และไม่มีเตือนล่วงหน้าซ้ำ', () => {
    const later = snooze(meeting, local(11, 17, 14, 31), 5)
    expect(alertsBetween([later], local(11, 17, 14, 31), local(11, 17, 14, 35, 30))).toEqual([])
    const due = alertsBetween([later], local(11, 17, 14, 35, 30), local(11, 17, 14, 36))
    expect(due.map((a) => a.kind)).toEqual(['due'])
    expect(overdue([later], local(11, 17, 14, 33))).toEqual([])
  })

  it('นัดซ้ำ: รับทราบแล้วเลื่อนไปรอบถัดไป (ทุกวัน / วันทำงาน / ทุกสัปดาห์)', () => {
    const lunch = createReminder('d', 'กินข้าว', local(11, 17, 12, 0), 'daily', NOW)
    expect(acknowledge(lunch, local(11, 17, 12, 1)).at).toBe(local(11, 18, 12, 0))
    // ศุกร์ 20 → จันทร์ 23
    const standup = createReminder('w', 'สแตนด์อัป', local(11, 20, 9, 0), 'weekdays', NOW)
    expect(acknowledge(standup, local(11, 20, 9, 5)).at).toBe(local(11, 23, 9, 0))
    const weekly = createReminder('k', 'ประชุมทีม', local(11, 23, 10, 0), 'weekly', NOW)
    expect(nextOccurrence(weekly, local(11, 23, 10, 0))).toBe(local(11, 30, 10, 0))
    // พลาดไปหลายวัน → ข้ามไปรอบที่ยังไม่ถึง ไม่ไล่ทีละรอบ
    expect(acknowledge(lunch, local(11, 25, 15, 0)).at).toBe(local(11, 26, 12, 0))
    expect(acknowledge(lunch, NOW).done).toBe(false)
  })

  it('upcoming เรียงจากใกล้ไปไกล และไม่รวมที่เสร็จ/เลยเวลา', () => {
    const a = createReminder('a', 'A', local(11, 17, 16, 0))
    const b = createReminder('b', 'B', local(11, 17, 11, 0))
    const c = { ...createReminder('c', 'C', local(11, 17, 12, 0)), done: true }
    const d = createReminder('d', 'D', local(11, 17, 9, 0))
    expect(upcoming([a, b, c, d], NOW).map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('แปลงข้อความเป็นนัด', () => {
  const r = (input: string) => {
    const result = parseQuickEntry(input, NOW)
    if (result?.kind !== 'reminder') throw new Error(`ไม่ใช่นัด: ${input} → ${JSON.stringify(result)}`)
    return result
  }
  const cases: [
    string,
    number,
    string,
    QuickEntry['kind'] extends string ? string : never,
    string?,
  ][] = [
    ['14:30 ประชุม', local(11, 17, 14, 30), 'ประชุม', 'none'],
    ['ประชุมทีม 14.30 น.', local(11, 17, 14, 30), 'ประชุมทีม', 'none'],
    ['อีก 20 นาที โทรหาแม่', NOW + 20 * MINUTE, 'โทรหาแม่', 'none'],
    ['โทรหาแม่ อีก 20 นาที', NOW + 20 * MINUTE, 'โทรหาแม่', 'none'],
    ['อีก 1.5 ชั่วโมง ไปรับลูก', NOW + 90 * MINUTE, 'ไปรับลูก', 'none'],
    ['อีกครึ่งชั่วโมง พักสายตา', NOW + 30 * MINUTE, 'พักสายตา', 'none'],
    ['in 15 min stand up', NOW + 15 * MINUTE, 'stand up', 'none'],
    ['พรุ่งนี้ 9 โมง ส่งงาน', local(11, 18, 9, 0), 'ส่งงาน', 'none'],
    ['พรุ่งนี้ ส่งรายงาน', local(11, 18, 9, 0), 'ส่งรายงาน', 'none'],
    ['บ่าย 2 คุยกับลูกค้า', local(11, 17, 14, 0), 'คุยกับลูกค้า', 'none'],
    ['บ่ายโมง กินยา', local(11, 17, 13, 0), 'กินยา', 'none'],
    ['บ่าย 3 โมงครึ่ง ประชุม', local(11, 17, 15, 30), 'ประชุม', 'none'],
    ['2 ทุ่ม ดูซีรีส์', local(11, 17, 20, 0), 'ดูซีรีส์', 'none'],
    ['ตี 5 ตื่นไปวิ่ง', local(11, 18, 5, 0), 'ตื่นไปวิ่ง', 'none'],
    ['เที่ยง กินข้าว', local(11, 17, 12, 0), 'กินข้าว', 'none'],
    ['9 โมงครึ่ง ประชุม', local(11, 18, 9, 30), 'ประชุม', 'none'],
    ['4 โมงเย็น รับของ', local(11, 17, 16, 0), 'รับของ', 'none'],
    ['เที่ยงคืน ปิดคอม', local(11, 18, 0, 0), 'ปิดคอม', 'none'],
    ['คืนนี้ อ่านหนังสือ', local(11, 17, 20, 0), 'อ่านหนังสือ', 'none'],
    ['ทุกวัน 12:00 กินข้าว', local(11, 17, 12, 0), 'กินข้าว', 'daily'],
    ['ทุกวันทำงาน 9:00 สแตนด์อัป', local(11, 18, 9, 0), 'สแตนด์อัป', 'weekdays'],
    ['ทุกวันจันทร์ 10:00 ประชุมประจำสัปดาห์', local(11, 23, 10, 0), 'ประชุมประจำสัปดาห์', 'weekly'],
    ['วันศุกร์ 15:00 ส่งงาน', local(11, 20, 15, 0), 'ส่งงาน', 'none'],
    ['25/12 ซื้อของขวัญ', local(12, 25, 9, 0), 'ซื้อของขวัญ', 'none'],
    ['3/1 จ่ายค่าเช่า', local(1, 3, 9, 0, 2027), 'จ่ายค่าเช่า', 'none'],
    ['5/1/2570 ต่อภาษีรถ', local(1, 5, 9, 0, 2027), 'ต่อภาษีรถ', 'none'],
    ['2pm call bank', local(11, 17, 14, 0), 'call bank', 'none'],
    ['tomorrow 8:30am gym', local(11, 18, 8, 30), 'gym', 'none'],
    ['every monday 9am team sync', local(11, 23, 9, 0), 'team sync', 'weekly'],
    ['เตือนให้ ๑๕:๐๐ โทรกลับ', local(11, 17, 15, 0), 'โทรกลับ', 'none'],
    ['remind me to stretch in 45 minutes', NOW + 45 * MINUTE, 'stretch', 'none'],
    ['อีก 10 นาที', NOW + 10 * MINUTE, 'ถึงเวลาแล้ว', 'none'],
  ]
  for (const [input, at, text, repeat] of cases) {
    it(`"${input}"`, () => {
      const result = r(input)
      expect(new Date(result.at).toString()).toBe(new Date(at).toString())
      expect(result.text).toBe(text)
      expect(result.repeat).toBe(repeat)
    })
  }

  it('ไม่มีเวลา → เป็นรายการงาน และไม่เดาวันจากคำที่บังเอิญมีชื่อวัน', () => {
    expect(parseQuickEntry('ซื้อนม', NOW)).toEqual({
      kind: 'todo',
      text: 'ซื้อนม',
      summary: 'งาน: ซื้อนม',
    })
    expect(parseQuickEntry('ดูพระจันทร์เต็มดวง', NOW)?.kind).toBe('todo')
    expect(parseQuickEntry('   ', NOW)).toBeNull()
    expect(parseQuickEntry('', NOW)).toBeNull()
  })

  it('สรุปผลให้ผู้ใช้ยืนยันเป็นภาษาไทย', () => {
    expect(r('14:30 ประชุม').summary).toBe('เตือน “ประชุม” วันนี้ 14:30')
    expect(r('พรุ่งนี้ 9 โมง ส่งงาน').summary).toBe('เตือน “ส่งงาน” พรุ่งนี้ 09:00')
    expect(r('ทุกวันจันทร์ 10:00 ประชุมทีม').summary).toBe('เตือน “ประชุมทีม” ทุกวันจันทร์ 10:00')
    expect(r('อีก 20 นาที โทรหาแม่').summary).toBe('เตือน “โทรหาแม่” วันนี้ 10:20 (อีก 20 นาที)')
    expect(formatWhen(local(11, 20, 15, 0), NOW)).toBe('ศ. 20 พ.ย. 15:00')
  })
})

describe('จับเวลาโฟกัส', () => {
  const s = DEFAULT_FOCUS_SETTINGS

  it('โฟกัส 25 → พัก 5 → ว่าง และนับรอบวันนี้', () => {
    let state = startFocus(createFocus(NOW), NOW, s)
    expect(focusRemaining(state, NOW + MINUTE)).toBe(24 * MINUTE)
    let out = tickFocus(state, NOW + 25 * MINUTE + 500, s)
    expect(out.event).toBe('focusDone')
    expect(out.state.phase).toBe('break')
    expect(out.state.todayCount).toBe(1)
    // พักนับจากเวลาที่โฟกัสจบจริง
    expect(out.state.endsAt).toBe(NOW + 30 * MINUTE)
    state = out.state
    out = tickFocus(state, NOW + 30 * MINUTE, s)
    expect(out.event).toBe('breakDone')
    expect(out.state.phase).toBe('idle')
  })

  it('ครบ 4 รอบได้พักยาว แล้วเริ่มนับชุดใหม่', () => {
    let state = createFocus(NOW)
    let t = NOW
    for (let i = 0; i < 4; i++) {
      state = startFocus(state, t, s)
      t += 25 * MINUTE
      state = tickFocus(state, t, s).state
      if (i < 3) {
        expect(state.phase).toBe('break')
        t += 5 * MINUTE
        state = tickFocus(state, t, s).state
      }
    }
    expect(state.phase).toBe('longBreak')
    expect(state.endsAt).toBe(t + 15 * MINUTE)
    state = tickFocus(state, t + 15 * MINUTE, s).state
    expect(state.cycle).toBe(0)
    expect(state.todayCount).toBe(4)
  })

  it('หยุดชั่วคราวแล้วเวลาไม่เดิน', () => {
    let state = startFocus(createFocus(NOW), NOW, s)
    state = pauseFocus(state, NOW + 10 * MINUTE)
    expect(tickFocus(state, NOW + 60 * MINUTE, s).event).toBeNull()
    state = resumeFocus(state, NOW + 60 * MINUTE)
    expect(focusRemaining(state, NOW + 60 * MINUTE)).toBe(15 * MINUTE)
  })

  it('เปิดแอปใหม่หลังจบไปนานแล้ว → รีเซ็ต ไม่นับรอบ; ข้ามวัน → สถิติวันนี้เริ่มใหม่', () => {
    const state = startFocus(createFocus(NOW), NOW, s)
    const out = tickFocus(state, NOW + 5 * 60 * MINUTE, s)
    expect(out.event).toBe('expired')
    expect(out.state.todayCount).toBe(0)
    expect(out.state.phase).toBe('idle')
    const yesterday = { ...createFocus(NOW), todayCount: 6 }
    expect(tickFocus(yesterday, local(11, 18, 8, 0), s).state.todayCount).toBe(0)
  })
})

describe('ดูแลสุขภาพ', () => {
  const on: WellbeingSettings = { eyes: true, water: true, stretch: true, night: true }
  const run = (
    settings: WellbeingSettings,
    seconds: number,
    opts: { idleSec?: number; focusing?: boolean; start?: number } = {},
  ) => {
    let state = createWellbeing(opts.start ?? NOW)
    const prompts: string[] = []
    for (let t = 1; t <= seconds; t++) {
      const out = tickWellbeing(state, settings, {
        now: (opts.start ?? NOW) + t * 1000,
        dtSec: 1,
        idleSec: opts.idleSec ?? 3,
        focusing: opts.focusing,
      })
      state = out.state
      prompts.push(...out.prompts)
    }
    return { state, prompts }
  }

  it('ปิดเป็นค่าเริ่มต้น: ไม่มีการเตือนเลย', () => {
    expect(run(DEFAULT_WELLBEING_SETTINGS, 3 * 3600).prompts).toEqual([])
  })

  it('ใช้เครื่องต่อเนื่อง 1 ชม. → พักสายตา 3 ครั้ง, ยืดเส้น 1, ดื่มน้ำ 1', () => {
    const { prompts } = run({ ...on, night: false }, 3600)
    expect(prompts.filter((p) => p === 'eyes')).toHaveLength(3)
    expect(prompts.filter((p) => p === 'stretch')).toHaveLength(1)
    expect(prompts.filter((p) => p === 'water')).toHaveLength(1)
  })

  it('ลุกไปเกิน 5 นาที = ได้พักแล้ว ตัวนับเริ่มใหม่', () => {
    let state = createWellbeing(NOW)
    state = tickWellbeing(state, on, { now: NOW, dtSec: 19 * 60, idleSec: 0 }).state
    state = tickWellbeing(state, on, { now: NOW, dtSec: 1, idleSec: AWAY_RESET }).state
    expect(state.eyes).toBe(0)
    const back = tickWellbeing(state, on, { now: NOW, dtSec: 2 * 60, idleSec: 0 })
    expect(back.prompts).toEqual([])
  })

  it('ระหว่างโฟกัสเลื่อนดื่มน้ำ/ยืดเส้นไปช่วงพัก แต่ยังเตือนพักสายตา', () => {
    const focusing = run({ ...on, night: false }, 3600, { focusing: true })
    expect(focusing.prompts.every((p) => p === 'eyes')).toBe(true)
    const after = tickWellbeing(focusing.state, on, { now: NOW + 3601_000, dtSec: 1, idleSec: 1 })
    expect(after.prompts).toEqual(expect.arrayContaining(['water', 'stretch']))
  })

  it('ดึกแล้ว: เตือนครั้งเดียวต่อคืน (รวมหลังเที่ยงคืน)', () => {
    const late = run({ ...DEFAULT_WELLBEING_SETTINGS, night: true }, 2 * 3600, {
      start: local(11, 17, 23, 0),
    })
    expect(late.prompts).toEqual(['night'])
    const early = run({ ...DEFAULT_WELLBEING_SETTINGS, night: true }, 60, {
      start: local(11, 17, 21, 0),
    })
    expect(early.prompts).toEqual([])
  })

  it('นับแก้วน้ำวันนี้ และรีเซ็ตเมื่อข้ามวัน', () => {
    let state = drinkWater(drinkWater(createWellbeing(NOW)))
    expect(state.cupsToday).toBe(2)
    state = tickWellbeing(state, on, { now: local(11, 18, 9, 0), dtSec: 1, idleSec: 1 }).state
    expect(state.cupsToday).toBe(0)
  })
})

describe('ข้อมูลผู้ช่วยในเซฟ', () => {
  it('ซ่อมรายการที่เสียทีละรายการ และใช้ค่าเริ่มต้นเมื่อไม่มีข้อมูล', () => {
    const good = createReminder('r1', 'ประชุม', NOW + MINUTE)
    const repaired = repairCompanion(
      {
        reminders: [
          good,
          { id: 'bad' },
          null,
          { ...good, text: 'ซ้ำ' },
          { ...good, id: 'r2', repeat: 'hourly' },
        ],
        todos: [{ id: 't1', text: 'ซื้อนม', done: true }, { text: 'ไม่มีรหัส' }],
        focus: { phase: 'focus', endsAt: 'x', todayCount: -4 },
        focusSettings: { focusMin: 9999, breakMin: 3 },
        wellbeingSettings: { eyes: true, water: 'yes' },
        lastCheck: NOW + 99 * MINUTE,
      },
      NOW,
    )
    expect(repaired.reminders.map((r) => [r.id, r.text, r.repeat])).toEqual([
      ['r1', 'ประชุม', 'none'],
      ['r2', 'ประชุม', 'none'],
    ])
    expect(repaired.todos).toEqual([{ id: 't1', text: 'ซื้อนม', done: true, createdAt: 0 }])
    expect(repaired.focus.phase).toBe('idle')
    expect(repaired.focus.todayCount).toBe(0)
    expect(repaired.focusSettings).toEqual({
      ...DEFAULT_FOCUS_SETTINGS,
      focusMin: 180,
      breakMin: 3,
    })
    expect(repaired.wellbeingSettings).toEqual({ ...DEFAULT_WELLBEING_SETTINGS, eyes: true })
    // เวลาตรวจล่าสุดในอนาคตไม่ได้ (นาฬิกาเครื่องถูกปรับ) → ใช้เวลาปัจจุบัน
    expect(repaired.lastCheck).toBe(NOW)
    expect(repairCompanion(undefined, NOW)).toEqual(createCompanion(NOW))
  })

  it('จับเวลาที่หยุดชั่วคราวไว้ยังอยู่หลังโหลด', () => {
    const paused = pauseFocus(
      startFocus(createFocus(NOW), NOW, DEFAULT_FOCUS_SETTINGS),
      NOW + MINUTE,
    )
    const repaired = repairCompanion({ ...createCompanion(NOW), focus: paused }, NOW)
    expect(repaired.focus).toEqual(paused)
  })
})
