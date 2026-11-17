import { describe, expect, it } from 'vitest'
import {
  alertsBetween,
  calendarDue,
  calendarEvents,
  calendarReminders,
  maskUrl,
  meetingNow,
  MINUTE,
  normalizeCalendarUrl,
  pruneAcks,
  repairCompanion,
  replaceCalendarEvents,
  resolveZone,
  wallTimeToEpoch,
  type CalendarEvent,
} from '../src'

const ics = (...lines: string[]) => lines.join('\r\n') + '\r\n'
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi)
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()

const BANGKOK_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Bangkok',
  'X-LIC-LOCATION:Asia/Bangkok',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0700',
  'TZOFFSETTO:+0700',
  'TZNAME:+07',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** แบบที่ Google Calendar ส่งออก: มี VTIMEZONE, นัดซ้ำรายสัปดาห์ + EXDATE + รอบที่ถูกแก้ */
const GOOGLE = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-TIMEZONE:Asia/Bangkok',
  ...BANGKOK_TZ,
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Bangkok:20261117T140000',
  'DTEND;TZID=Asia/Bangkok:20261117T150000',
  'UID:meeting-1@google.com',
  'SUMMARY:ประชุมทีม',
  'LOCATION:ห้องประชุม 3',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Bangkok:20261102T093000',
  'DTEND;TZID=Asia/Bangkok:20261102T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8',
  'EXDATE;TZID=Asia/Bangkok:20261116T093000',
  'UID:standup@google.com',
  'SUMMARY:สแตนด์อัป',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Bangkok:20261123T100000',
  'DTEND;TZID=Asia/Bangkok:20261123T101500',
  'RECURRENCE-ID;TZID=Asia/Bangkok:20261123T093000',
  'UID:standup@google.com',
  'SUMMARY:สแตนด์อัป (เลื่อน)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261118',
  'DTEND;VALUE=DATE:20261119',
  'UID:holiday@google.com',
  'SUMMARY:วันหยุดบริษัท',
  'TRANSP:TRANSPARENT',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Bangkok:20261119T100000',
  'DTEND;TZID=Asia/Bangkok:20261119T110000',
  'UID:cancelled@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:ยกเลิกแล้ว',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Bangkok:20261119T130000',
  'DTEND;TZID=Asia/Bangkok:20261119T140000',
  'UID:free@google.com',
  'TRANSP:TRANSPARENT',
  'SUMMARY:บล็อกเวลาไว้อ่านหนังสือ แต่ยังว่างให้คนอื่นนัดได้ ชื่อยาวจนถูกพับบรรทั',
  ' ดเป็นสองบรรทัด',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:broken@google.com',
  'SUMMARY:นัดที่ไม่มีเวลาเริ่ม',
  'END:VEVENT',
  'END:VCALENDAR',
)

/** แบบที่ Outlook ส่งออก: ชื่อเขตเวลาแบบ Windows (มีและไม่มี VTIMEZONE) และเวลา UTC */
const OUTLOOK = ics(
  'BEGIN:VCALENDAR',
  'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:SE Asia Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T000000',
  'TZOFFSETFROM:+0700',
  'TZOFFSETTO:+0700',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID="SE Asia Standard Time":20261120T090000',
  'DTEND;TZID="SE Asia Standard Time":20261120T100000',
  'UID:040000008200E00074C5B7101A82E008',
  'SUMMARY:รีวิวงานกับหัวหน้า',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Tokyo Standard Time:20261121T100000',
  'DTEND;TZID=Tokyo Standard Time:20261121T110000',
  'UID:tokyo-call',
  'SUMMARY:คุยกับทีมญี่ปุ่น',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261122T020000Z',
  'DTEND:20261122T030000Z',
  'UID:utc-event',
  'SUMMARY:UTC',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261124T100000',
  'DTEND;TZID=Europe/Berlin:20261124T110000',
  'UID:berlin',
  'SUMMARY:ไม่มี VTIMEZONE แต่เป็นชื่อ IANA',
  'END:VEVENT',
  'END:VCALENDAR',
)

const FROM = utc(2026, 11, 16)
const TO = FROM + 14 * 24 * 60 * MINUTE

describe('อ่านไฟล์ปฏิทิน ICS', () => {
  const events = calendarEvents(GOOGLE, 'g', FROM, TO)
  const find = (title: string) => events.filter((e) => e.title === title)

  it('นัดธรรมดาในเขตเวลา Asia/Bangkok (+07:00)', () => {
    const [meeting] = find('ประชุมทีม')
    expect(meeting).toMatchObject({
      start: utc(2026, 11, 17, 7),
      end: utc(2026, 11, 17, 8),
      allDay: false,
      location: 'ห้องประชุม 3',
      busy: true,
      calendarId: 'g',
    })
  })

  it('นัดซ้ำรายสัปดาห์: ข้ามรอบที่ถูกลบ (EXDATE) และใช้รอบที่ถูกเลื่อนแทนรอบเดิม', () => {
    const wide = calendarEvents(GOOGLE, 'g', FROM, FROM + 28 * 24 * 60 * MINUTE)
    const standups = wide.filter((e) => e.uid === 'standup@google.com')
    // 16 พ.ย. ถูกลบ, 23 พ.ย. ถูกเลื่อนเป็น 10:00, ครบ 8 รอบที่ 21 ธ.ค. (นอกช่วง)
    expect(standups.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ['สแตนด์อัป (เลื่อน)', '2026-11-23T03:00:00.000Z'],
      ['สแตนด์อัป', '2026-11-30T02:30:00.000Z'],
      ['สแตนด์อัป', '2026-12-07T02:30:00.000Z'],
    ])
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
  })

  it('นัดทั้งวัน, นัดที่ยกเลิก, นัดที่ "ว่าง", บรรทัดที่ถูกพับ และนัดที่เสีย', () => {
    const [holiday] = find('วันหยุดบริษัท')
    expect(holiday).toMatchObject({ allDay: true, start: local(2026, 11, 18), busy: false })
    expect(holiday!.end - holiday!.start).toBe(24 * 60 * MINUTE)
    expect(find('ยกเลิกแล้ว')).toEqual([])
    const free = events.find((e) => e.uid === 'free@google.com')
    expect(free?.busy).toBe(false)
    expect(free?.title.endsWith('บรรทัดเป็นสองบรรทัด')).toBe(true)
    expect(events.some((e) => e.uid === 'broken@google.com')).toBe(false)
  })

  it('เขตเวลาแบบ Windows (มี/ไม่มี VTIMEZONE), UTC และชื่อ IANA ที่ไม่มี VTIMEZONE', () => {
    const out = calendarEvents(OUTLOOK, 'o', FROM, TO)
    const at = (uid: string) => out.find((e) => e.uid === uid)?.start
    expect(at('040000008200E00074C5B7101A82E008')).toBe(utc(2026, 11, 20, 2))
    expect(at('tokyo-call')).toBe(utc(2026, 11, 21, 1))
    expect(at('utc-event')).toBe(utc(2026, 11, 22, 2))
    // เบอร์ลินช่วงฤดูหนาว = UTC+1
    expect(at('berlin')).toBe(utc(2026, 11, 24, 9))
  })

  it('เอาเฉพาะนัดที่ทับช่วงเวลาที่ขอ', () => {
    const narrow = calendarEvents(GOOGLE, 'g', utc(2026, 11, 17, 7, 30), utc(2026, 11, 17, 9))
    expect(narrow.map((e) => e.title)).toEqual(['ประชุมทีม'])
  })

  it('ไม่ใช่ไฟล์ปฏิทิน → แจ้งข้อผิดพลาด', () => {
    expect(() => calendarEvents('<html>Sign in</html>', 'x', FROM, TO)).toThrow()
  })

  it('แปลงเวลาตามเขตเวลา รวมช่วงเปลี่ยนเวลาออมแสง', () => {
    expect(resolveZone('SE Asia Standard Time')).toBe('Asia/Bangkok')
    expect(resolveZone('"Asia/Tokyo"')).toBe('Asia/Tokyo')
    expect(resolveZone('Mars Standard Time')).toBeNull()
    // นิวยอร์ก: ก่อน/หลังเปลี่ยนเวลา 1 พ.ย. 2026
    expect(wallTimeToEpoch('America/New_York', 2026, 10, 31, 12)).toBe(utc(2026, 10, 31, 16))
    expect(wallTimeToEpoch('America/New_York', 2026, 11, 2, 12)).toBe(utc(2026, 11, 2, 17))
  })
})

describe('ปฏิทินกับระบบเตือน', () => {
  const meeting: CalendarEvent = {
    id: 'g:m@1',
    calendarId: 'g',
    uid: 'm',
    title: 'ประชุมทีม',
    start: utc(2026, 11, 17, 7),
    end: utc(2026, 11, 17, 8),
    allDay: false,
    location: 'ห้อง 3',
    busy: true,
  }
  const allDay: CalendarEvent = {
    ...meeting,
    id: 'g:h@1',
    uid: 'h',
    allDay: true,
    start: utc(2026, 11, 17),
    end: utc(2026, 11, 18),
  }

  it('เตือนล่วงหน้า 10/5/1 นาทีด้วยระบบเดิม และไม่เตือนนัดทั้งวัน', () => {
    const reminders = calendarReminders([meeting, allDay], {})
    expect(reminders).toHaveLength(1)
    expect(reminders[0]!.text).toBe('ประชุมทีม · ห้อง 3')
    const seen: string[] = []
    let last = meeting.start - 15 * MINUTE
    for (let t = last + 1000; t <= meeting.start + 1000; t += 1000) {
      for (const a of alertsBetween(reminders, last, t))
        seen.push(a.kind === 'lead' ? `lead${a.minutes}` : a.kind)
      last = t
    }
    expect(seen).toEqual(['lead10', 'lead5', 'lead1', 'due'])
  })

  it('ป้ายขึ้นระหว่างนัด ไม่ขึ้นหลังนัดจบ, รับทราบแล้วหาย, เลื่อนแล้วกลับมา', () => {
    expect(calendarDue([meeting, allDay], {}, meeting.start - MINUTE)).toEqual([])
    expect(calendarDue([meeting], {}, meeting.start + 10 * MINUTE)).toEqual([meeting])
    // เปิดเครื่องหลังประชุมจบ → ไม่ไล่แจ้ง
    expect(calendarDue([meeting], {}, meeting.end + MINUTE)).toEqual([])
    expect(
      calendarDue(
        [meeting],
        { [meeting.id]: { start: meeting.start, done: true } },
        meeting.start + MINUTE,
      ),
    ).toEqual([])
    const snoozed = {
      [meeting.id]: { start: meeting.start, snoozedUntil: meeting.start + 5 * MINUTE },
    }
    expect(calendarDue([meeting], snoozed, meeting.start + 2 * MINUTE)).toEqual([])
    expect(calendarDue([meeting], snoozed, meeting.start + 5 * MINUTE)).toEqual([meeting])
  })

  it('ช่วงประชุม: เฉพาะนัดที่ไม่ว่างและไม่ใช่ทั้งวัน', () => {
    expect(meetingNow([meeting, allDay], meeting.start + MINUTE)).toBe(meeting)
    expect(meetingNow([{ ...meeting, busy: false }], meeting.start + MINUTE)).toBeNull()
    expect(meetingNow([allDay], meeting.start + MINUTE)).toBeNull()
    expect(meetingNow([meeting], meeting.end)).toBeNull()
  })

  it('แทนที่แคชเฉพาะปฏิทินเดียว และล้างสถานะป้ายเก่า', () => {
    const other = { ...meeting, id: 'o:x@1', calendarId: 'o' }
    const next = replaceCalendarEvents([meeting, other], 'g', [])
    expect(next).toEqual([other])
    const acks = {
      a: { start: utc(2026, 11, 10), done: true },
      b: { start: utc(2026, 11, 16), done: true },
    }
    expect(Object.keys(pruneAcks(acks, utc(2026, 11, 17)))).toEqual(['b'])
  })
})

describe('ลิงก์ปฏิทิน', () => {
  it('รับเฉพาะ https/webcal และแสดงแบบปิดบังส่วนที่เป็นความลับ', () => {
    const google =
      'https://calendar.google.com/calendar/ical/me%40gmail.com/private-0123456789abcdef/basic.ics'
    expect(normalizeCalendarUrl(` ${google} `)).toBe(google)
    expect(
      normalizeCalendarUrl('webcal://outlook.office365.com/owa/calendar/abc/def/calendar.ics'),
    ).toBe('https://outlook.office365.com/owa/calendar/abc/def/calendar.ics')
    expect(normalizeCalendarUrl('http://example.com/a.ics')).toBeNull()
    expect(normalizeCalendarUrl('file:///C:/cal.ics')).toBeNull()
    expect(normalizeCalendarUrl('https://localhost/a.ics')).toBeNull()
    expect(normalizeCalendarUrl('ไม่ใช่ลิงก์')).toBeNull()
    expect(maskUrl(google)).toBe('calendar.google.com/…/basic.ics')
    expect(maskUrl(google)).not.toContain('private')
  })

  it('ซ่อมข้อมูลปฏิทินในเซฟ: ทิ้งลิงก์ที่ไม่ใช่ https และนัดที่เสีย', () => {
    const now = utc(2026, 11, 17)
    const c = repairCompanion(
      {
        calendars: [
          {
            id: 'g',
            name: 'งาน',
            url: 'https://calendar.google.com/x/basic.ics',
            enabled: false,
            lastSync: 5,
          },
          { id: 'bad', name: 'x', url: 'http://insecure/a.ics' },
        ],
        calendarEvents: [
          { id: 'g:a@1', calendarId: 'g', uid: 'a', title: 'นัด', start: 10, end: 5 },
          { id: 'g:b@1', calendarId: 'g', uid: 'b', title: 'ไม่มีเวลา' },
        ],
        calendarAcks: { 'g:a@1': { start: 10, done: true }, junk: 4 },
        meetingQuiet: false,
      },
      now,
    )
    expect(c.calendars).toEqual([
      {
        id: 'g',
        name: 'งาน',
        url: 'https://calendar.google.com/x/basic.ics',
        enabled: false,
        lastSync: 5,
      },
    ])
    expect(c.calendarEvents).toEqual([
      {
        id: 'g:a@1',
        calendarId: 'g',
        uid: 'a',
        title: 'นัด',
        start: 10,
        end: 10,
        allDay: false,
        busy: true,
      },
    ])
    expect(c.calendarAcks).toEqual({ 'g:a@1': { start: 10, done: true } })
    expect(c.meetingQuiet).toBe(false)
    expect(repairCompanion({}, now).meetingQuiet).toBe(true)
  })
})
