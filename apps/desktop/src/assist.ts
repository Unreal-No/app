import { extraAlarms } from './alarmSources'
import {
  acknowledge,
  alertsBetween,
  companionId,
  createReminder,
  drinkWater,
  effectiveAt,
  focusProgress,
  focusRemaining,
  formatClock,
  formatCountdown,
  formatWhen,
  incubate,
  isPaused,
  MISSED_AFTER,
  overdue,
  parseQuickEntry,
  pauseFocus,
  petEvent,
  resumeFocus,
  snooze,
  startFocus,
  stopFocus,
  tickFocus,
  tickWellbeing,
  AWAY_RESET,
  type CompanionState,
  type QuickEntry,
  type Reminder,
  type WellbeingPrompt,
  type WellbeingSettings,
} from '@mochimon/core'
import { getIdleSeconds, setAlarms, type Alarm } from './bridge'
import { calendarAlarms, syncAllCalendars, tickCalendars } from './calendarSync'
import { companion, pets, saveNow, setCompanion } from './game'
import { dismissSignsWhere, messenger, showSign, signCarrier } from './signs'
import { el, rectOf } from './ui'
import { idleSeconds, layout, mode, presence, uiLayer } from './world'

/**
 * ผู้ช่วยทำงาน: เตือนนัด รายการงาน จับเวลาโฟกัส และเตือนดูแลสุขภาพ
 * ตรรกะเวลาทั้งหมดอยู่ใน `@mochimon/core` (มี unit test) — โมดูลนี้แค่ต่อเข้ากับสัตว์บนจอ
 */

// ───────── การเปลี่ยนข้อมูล ─────────
const listeners = new Set<() => void>()
export const onCompanionChange = (callback: () => void): void => void listeners.add(callback)

/** เปลี่ยนข้อมูลผู้ช่วย แล้วแจ้งแผง/ฝั่ง Rust และเซฟ */
export function updateCompanion(
  change: (state: CompanionState) => CompanionState,
  save = true,
): void {
  update(change, save)
}

function update(change: (state: CompanionState) => CompanionState, save = true): void {
  setCompanion(change(companion))
  syncAlarms()
  for (const callback of listeners) callback()
  if (save) void saveNow()
}

// ───────── นัด ─────────
/** เพิ่มนัดหรืองานจากข้อความ — `asTodo` บังคับให้เป็นงาน (แท็บ "งาน") */
export function addFromText(text: string, asTodo = false): QuickEntry | null {
  const now = Date.now()
  const entry = asTodo
    ? text.trim()
      ? ({ kind: 'todo', text: text.trim(), summary: `งาน: ${text.trim()}` } as const)
      : null
    : parseQuickEntry(text, now)
  if (!entry) return null
  if (entry.kind === 'reminder') {
    update((c) => {
      const id = companionId(
        'rem',
        c.reminders.map((r) => r.id),
        now,
      )
      return {
        ...c,
        reminders: [...c.reminders, createReminder(id, entry.text, entry.at, entry.repeat, now)],
      }
    })
    messenger()?.say(`จำไว้แล้ว! ${formatWhen(entry.at, now)}`, 3)
  } else {
    update((c) => {
      const id = companionId(
        'todo',
        c.todos.map((t) => t.id),
        now,
      )
      return { ...c, todos: [...c.todos, { id, text: entry.text, done: false, createdAt: now }] }
    })
  }
  return entry
}

export function removeReminder(id: string): void {
  update((c) => ({ ...c, reminders: c.reminders.filter((r) => r.id !== id) }))
  dismissSignsWhere((key) => key.startsWith(`rem:${id}@`))
}

function changeReminder(id: string, change: (r: Reminder) => Reminder): void {
  update((c) => ({
    ...c,
    // นัดครั้งเดียวที่รับทราบแล้วไม่ต้องเก็บไว้
    reminders: c.reminders.map((r) => (r.id === id ? change(r) : r)).filter((r) => !r.done),
  }))
}

export function toggleTodo(id: string): void {
  const now = Date.now()
  update((c) => ({
    ...c,
    todos: c.todos.map((t) =>
      t.id === id
        ? { ...t, done: !t.done, ...(t.done ? { doneAt: undefined } : { doneAt: now }) }
        : t,
    ),
  }))
  const todo = companion.todos.find((t) => t.id === id)
  if (todo?.done) {
    const pet = messenger()
    pet?.hearts()
    pet?.say('เย้! เสร็จไปอีกอย่าง', 3)
  }
}

export const removeTodo = (id: string): void =>
  update((c) => ({ ...c, todos: c.todos.filter((t) => t.id !== id) }))
export const clearDoneTodos = (): void =>
  update((c) => ({ ...c, todos: c.todos.filter((t) => !t.done) }))

function reminderSign(reminder: Reminder, now: number): void {
  const at = effectiveAt(reminder)
  const missed = now - at > MISSED_AFTER
  showSign({
    key: `rem:${reminder.id}@${at}`,
    icon: '⏰',
    title: reminder.text,
    body: missed ? `เลยเวลามาแล้ว (${formatWhen(at, now)})` : `ถึงเวลาแล้ว · ${formatClock(at)}`,
    buttons: [
      {
        label: 'รับทราบ',
        primary: true,
        onClick: () => changeReminder(reminder.id, (r) => acknowledge(r, Date.now())),
      },
      {
        label: 'อีก 5 นาที',
        onClick: () => changeReminder(reminder.id, (r) => snooze(r, Date.now(), 5)),
      },
      {
        label: 'อีก 30 นาที',
        onClick: () => changeReminder(reminder.id, (r) => snooze(r, Date.now(), 30)),
      },
    ],
  })
}

// ───────── จับเวลาโฟกัส ─────────
export function startFocusSession(): void {
  update((c) => ({ ...c, focus: startFocus(c.focus, Date.now(), c.focusSettings) }))
  dismissSignsWhere((key) => key === 'focus:again')
  const pet = messenger()
  pet?.say(`โฟกัส ${companion.focusSettings.focusMin} นาที สู้ๆ! จะนั่งเป็นเพื่อนนะ`, 4)
}
export const pauseFocusSession = (): void =>
  update((c) => ({ ...c, focus: pauseFocus(c.focus, Date.now()) }))
export const resumeFocusSession = (): void =>
  update((c) => ({ ...c, focus: resumeFocus(c.focus, Date.now()) }))
export const stopFocusSession = (): void => update((c) => ({ ...c, focus: stopFocus(c.focus) }))
export function setFocusMinutes(key: 'focusMin' | 'breakMin', minutes: number): void {
  update((c) => ({ ...c, focusSettings: { ...c.focusSettings, [key]: minutes } }))
}

function celebrateFocus(): void {
  for (const actor of pets) {
    if (actor.isEgg) {
      // รางวัลของการตั้งใจทำงาน: ไข่ใกล้ฟักขึ้น
      actor.setState(incubate(actor.state, 0.15))
      actor.float('✨', 'note')
    } else {
      actor.setState(petEvent(actor.state, 'greeted'))
      actor.hearts()
      actor.playTimer = 4
    }
  }
  messenger()?.say(`เก่งมาก! พักกัน ${companion.focusSettings.breakMin} นาทีนะ`, 5)
}

function askForAnotherRound(): void {
  showSign({
    key: 'focus:again',
    icon: '🍅',
    title: 'พักพอแล้ว',
    body: `วันนี้โฟกัสครบ ${companion.focus.todayCount} รอบ — ต่ออีกรอบไหม?`,
    expiresIn: 120,
    buttons: [
      { label: 'โฟกัสต่อ', primary: true, onClick: startFocusSession },
      { label: 'พอก่อน', onClick: () => undefined },
    ],
  })
}

// ───────── สุขภาพ ─────────
export function setWellbeing(key: keyof WellbeingSettings, on: boolean): void {
  update((c) => ({ ...c, wellbeingSettings: { ...c.wellbeingSettings, [key]: on } }))
}

export function drink(): void {
  update((c) => ({ ...c, wellbeing: drinkWater(c.wellbeing) }))
  const pet = messenger()
  pet?.float('💧', 'note')
  pet?.say(`ดื่มแล้ว ${companion.wellbeing.cupsToday} แก้ววันนี้ เก่งมาก~`, 3)
}

function wellbeingSign(prompt: WellbeingPrompt, now: number): void {
  switch (prompt) {
    case 'eyes':
      showSign({
        key: `eyes@${now}`,
        icon: '👀',
        title: 'พักสายตากันหน่อย',
        body: 'มองไกลๆ',
        countdown: 20,
        onTimeout: () => {
          const pet = messenger()
          pet?.hearts()
          pet?.say('ตาสดชื่นแล้ว~', 3)
        },
        buttons: [{ label: 'ข้ามไปก่อน', onClick: () => undefined }],
      })
      break
    case 'water':
      showSign({
        key: `water@${now}`,
        icon: '💧',
        title: 'ดื่มน้ำกันเถอะ',
        body: `วันนี้ดื่มไป ${companion.wellbeing.cupsToday} แก้ว`,
        expiresIn: 180,
        buttons: [
          { label: 'ดื่มแล้ว', primary: true, onClick: drink },
          { label: 'เดี๋ยวก่อน', onClick: () => undefined },
        ],
      })
      break
    case 'stretch':
      showSign({
        key: `stretch@${now}`,
        icon: '🙆',
        title: 'ลุกยืดเส้นหน่อย',
        body: 'ยืน บิดตัว หมุนไหล่สักนาที',
        expiresIn: 180,
        buttons: [
          {
            label: 'ยืดแล้ว',
            primary: true,
            onClick: () => {
              const pet = messenger()
              if (pet) pet.playTimer = 5
              pet?.say('ยืดตามด้วย~', 3)
            },
          },
          { label: 'เดี๋ยวก่อน', onClick: () => undefined },
        ],
      })
      for (const actor of pets) if (!actor.isEgg) actor.playTimer = 5
      break
    case 'night':
      for (const actor of pets) {
        if (actor.isEgg || actor.held) continue
        actor.state = { ...actor.state, behavior: 'sleep', behaviorTimer: 600 }
      }
      messenger()?.say('ดึกแล้วนะ… พักผ่อนบ้างน้า', 6)
      break
  }
}

// ───────── ส่งเวลานัดให้ Rust (แจ้งเตือนตอนหน้าต่างถูกซ่อน) ─────────
let alarmsKey = ''
function syncAlarms(): void {
  const now = Date.now()
  const alarms: Alarm[] = companion.reminders
    .filter((r) => !r.done)
    .map((r) => ({ id: r.id, atMs: effectiveAt(r), title: 'Mochimon — ถึงเวลาแล้ว', body: r.text }))
  alarms.push(...calendarAlarms(now))
  alarms.push(...extraAlarms().filter((alarm) => alarm.atMs > now))
  const { focus } = companion
  if (focus.endsAt !== null && focus.endsAt > now)
    alarms.push({
      id: `focus-${focus.phase}`,
      atMs: focus.endsAt,
      title: 'Mochimon',
      body: focus.phase === 'focus' ? 'ครบเวลาโฟกัสแล้ว พักกันเถอะ' : 'หมดเวลาพักแล้ว',
    })
  const key = JSON.stringify(alarms)
  if (key === alarmsKey) return
  alarmsKey = key
  setAlarms(alarms)
}

// ───────── วงรอบ ─────────
let lastTick = 0

/** เริ่มต้นตอนเปิดแอป: ซิงก์ปฏิทินทุกอันทันที */
export function startAssistant(): void {
  syncAllCalendars()
}

/** เรียกทุกเฟรม — ทำงานจริงวินาทีละครั้งตามนาฬิกาจริง */
export function tickAssistant(): void {
  const now = Date.now()
  if (lastTick && now - lastTick < 1000) {
    updateFocusChip(now)
    return
  }
  const gap = lastTick ? (now - lastTick) / 1000 : 1
  lastTick = now
  void getIdleSeconds().then((seconds) => {
    presence.systemIdle = seconds
  })

  let c = companion
  let changed = false

  // เตือนล่วงหน้า (คำพูด) + นัดที่ถึงเวลา (ป้าย)
  for (const alert of alertsBetween(c.reminders, c.lastCheck, now)) {
    if (alert.kind !== 'lead') continue
    const reminder = c.reminders.find((r) => r.id === alert.reminderId)
    const pet = messenger()
    if (reminder && pet && pet !== signCarrier())
      pet.say(`อีก ${alert.minutes} นาที: ${reminder.text}`, 6)
  }
  for (const reminder of overdue(c.reminders, now)) reminderSign(reminder, now)
  const inMeeting = tickCalendars(c.lastCheck, now)
  c = { ...c, lastCheck: now }

  // โฟกัส
  const focus = tickFocus(c.focus, now, c.focusSettings)
  if (focus.state !== c.focus) {
    c = { ...c, focus: focus.state }
    changed = true
  }
  mode.focusing = c.focus.phase === 'focus' && !isPaused(c.focus)
  if (mode.focusing) {
    // เพื่อนนั่งทำงานด้วย (body doubling): ตัวที่ถือนาฬิกานั่งนิ่งเงียบๆ
    const buddy = messenger()
    if (buddy && !buddy.held && buddy.state.behavior !== 'sleep' && buddy.state.behavior !== 'sit')
      buddy.state = { ...buddy.state, behavior: 'sit', behaviorTimer: 60 }
  }

  // สุขภาพ (ช่องว่างนานผิดปกติ = เครื่องหลับ/ถูกพักไว้ → ถือว่าได้พักแล้ว)
  const well = tickWellbeing(c.wellbeing, c.wellbeingSettings, {
    now,
    dtSec: Math.min(gap, 5),
    idleSec: gap > 120 ? AWAY_RESET : idleSeconds(),
    // ระหว่างโฟกัส/ประชุม: เลื่อนดื่มน้ำ/ยืดเส้นไปทีหลัง
    focusing: mode.focusing || inMeeting,
  })
  // ระหว่างประชุมไม่ขึ้นป้ายพักสายตา (จะกวนหน้าจอที่กำลังแชร์อยู่)
  if (inMeeting) well.prompts = well.prompts.filter((p) => p !== 'eyes')
  if (well.prompts.length > 0) changed = true
  c = { ...c, wellbeing: well.state }

  // บันทึกสถานะก่อน แล้วค่อยแสดงผล (ข้อความใช้ตัวเลขล่าสุด เช่น จำนวนรอบวันนี้)
  setCompanion(c)
  if (focus.event === 'focusDone') celebrateFocus()
  if (focus.event === 'breakDone') askForAnotherRound()
  for (const prompt of well.prompts) wellbeingSign(prompt, now)
  syncAlarms()
  if (changed) {
    for (const callback of listeners) callback()
    void saveNow()
  }
  updateFocusChip(now)
}

// ───────── นาฬิกาโฟกัสเหนือหัวเพื่อนร่วมงาน ─────────
const chip = el('div', 'focus-chip')
chip.hidden = true
chip.innerHTML =
  '<svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="ring" cx="18" cy="18" r="15"/></svg><span></span>'
uiLayer.append(chip)
const chipLabel = chip.querySelector('span')!
const chipRing = chip.querySelector<SVGCircleElement>('.ring')!
const RING = 2 * Math.PI * 15
let chipClick: (() => void) | null = null
chip.addEventListener('click', () => chipClick?.())
export const onFocusChipClick = (callback: () => void): void => {
  chipClick = callback
}

function updateFocusChip(now: number): void {
  const { focus, focusSettings } = companion
  const buddy = focus.phase === 'idle' ? undefined : messenger()
  chip.hidden = !buddy
  if (!buddy) return
  chip.classList.toggle('break', focus.phase !== 'focus')
  chip.classList.toggle('paused', isPaused(focus))
  chipLabel.textContent = formatCountdown(focusRemaining(focus, now))
  chipRing.style.strokeDasharray = `${RING}`
  chipRing.style.strokeDashoffset = `${RING * (1 - focusProgress(focus, now, focusSettings))}`
  const hit = buddy.hit
  // ด้านข้างหัว (เหนือหัวเป็นที่ของฟองคำพูดและป้าย)
  const x = Math.min(layout.width - 70, hit.x + hit.r * 0.7)
  chip.style.left = `${x}px`
  chip.style.top = `${Math.max(8, hit.y - hit.r * 0.9)}px`
}

export const focusChipRect = (): { x: number; y: number; w: number; h: number } | null =>
  chip.hidden ? null : rectOf(chip)
