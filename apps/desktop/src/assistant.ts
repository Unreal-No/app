import {
  DAY,
  describeRepeat,
  formatClock,
  startOfDay,
  upcomingEvents,
  type CalendarEvent,
  effectiveAt,
  focusRemaining,
  formatCountdown,
  formatWhen,
  isPaused,
  overdue,
  parseQuickEntry,
  upcoming,
  type WellbeingSettings,
} from '@mochimon/core'
import {
  addFromText,
  clearDoneTodos,
  drink,
  onCompanionChange,
  pauseFocusSession,
  removeReminder,
  removeTodo,
  resumeFocusSession,
  setFocusMinutes,
  setWellbeing,
  startFocusSession,
  stopFocusSession,
  toggleTodo,
} from './assist'
import { setKeyboardFocus } from './bridge'
import {
  addCalendar,
  calendarLabel,
  isSyncing,
  removeCalendar,
  setCalendarEnabled,
  setMeetingQuiet,
  syncCalendar,
} from './calendarSync'
import { companion } from './game'
import { button, el, rectOf } from './ui'
import { layout, mode, uiLayer } from './world'

/**
 * แผงผู้ช่วย: เตือน · งาน · โฟกัส · สุขภาพ
 * เปิดจากเมนู tray หรือปุ่มในแผงดูแล ลอยอยู่มุมขวาล่างเหนือ Taskbar
 */
export type AssistantTab = 'reminders' | 'todos' | 'calendar' | 'focus' | 'health'

const TABS: { id: AssistantTab; label: string }[] = [
  { id: 'reminders', label: 'เตือน' },
  { id: 'todos', label: 'งาน' },
  { id: 'calendar', label: 'ปฏิทิน' },
  { id: 'focus', label: 'โฟกัส' },
  { id: 'health', label: 'สุขภาพ' },
]

const HEALTH: { key: keyof WellbeingSettings; label: string; hint: string }[] = [
  { key: 'eyes', label: 'พักสายตา 20-20-20', hint: 'ทุก 20 นาทีที่ใช้เครื่อง มองไกลๆ 20 วินาที' },
  { key: 'water', label: 'ดื่มน้ำ', hint: 'ทุก 1 ชั่วโมงที่ใช้เครื่อง' },
  { key: 'stretch', label: 'ลุกยืดเส้น', hint: 'ทุก 50 นาที (ระหว่างโฟกัสจะรอไปเตือนตอนพัก)' },
  { key: 'night', label: 'ดึกแล้วชวนพัก', hint: 'หลัง 5 ทุ่ม เตือนคืนละครั้ง' },
]

const root = el('div', 'panel assistant')
root.hidden = true
uiLayer.append(root)

let tab: AssistantTab = 'reminders'
let draft = ''
let typing = false
let signature = ''
let timerLabel: HTMLElement | null = null

export const assistantOpen = (): boolean => !root.hidden

export function openAssistant(next: AssistantTab = tab): void {
  tab = next
  root.hidden = false
  signature = ''
  render()
}

export function closeAssistant(): void {
  if (typing) setKeyboardFocus(false)
  typing = false
  root.hidden = true
  mode.reserveRight = 0
}

export function toggleAssistant(): void {
  if (assistantOpen()) closeAssistant()
  else openAssistant()
}

onCompanionChange(() => {
  signature = ''
  if (assistantOpen() && !typing) render()
})

function header(): HTMLElement {
  const head = el('div', 'panel-header')
  head.append(
    el('div', 'panel-name', 'ผู้ช่วย'),
    button('×', closeAssistant, 'panel-icon panel-close'),
  )
  const tabs = el('div', 'tabs')
  for (const t of TABS) {
    const b = button(t.label, () => {
      tab = t.id
      draft = ''
      signature = ''
      render()
    })
    if (t.id === tab) b.classList.add('active')
    tabs.append(b)
  }
  const wrap = el('div')
  wrap.append(head, tabs)
  return wrap
}

/**
 * หน้าต่างสัตว์ปกติไม่รับคีย์บอร์ด (ไม่แย่งงานของผู้ใช้) — ขอรับชั่วคราวตอนกดช่องพิมพ์
 * และคืนเมื่อออกจากช่องพิมพ์ทุกช่องของแผงแล้ว (ย้ายช่องภายในแผงไม่ปล่อย)
 */
function typeable(input: HTMLInputElement, onEnter: () => void): void {
  let pressedAt = 0
  let blurredAt = 0
  input.addEventListener('pointerdown', () => {
    pressedAt = performance.now()
    if (!typing) {
      typing = true
      setKeyboardFocus(true)
    }
    // รอให้หน้าต่างรับคีย์บอร์ดก่อน — แต่ถ้าผู้ใช้ออกจากช่องไปแล้วระหว่างรอ ไม่ดึงกลับมา
    setTimeout(() => {
      if (blurredAt < pressedAt && input.isConnected && document.activeElement !== input)
        input.focus()
    }, 60)
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') onEnter()
    else if (e.key === 'Escape') input.blur()
  })
  input.addEventListener('blur', () => {
    blurredAt = performance.now()
    setTimeout(() => {
      const active = document.activeElement
      if (active instanceof HTMLInputElement && root.contains(active)) return
      typing = false
      setKeyboardFocus(false)
      if (signature === '') render()
    }, 120)
  })
}

/** ช่องพิมพ์ด่วน + ผลแปลงให้ยืนยันก่อนบันทึก */
function quickInput(asTodo: boolean): HTMLElement {
  const box = el('div', 'quick')
  const input = el('input', 'quick-input')
  input.placeholder = asTodo ? 'เพิ่มงาน เช่น ส่งรายงาน' : 'เช่น 14:30 ประชุม · อีก 20 นาที โทรหาแม่'
  input.value = draft
  input.maxLength = 120
  const preview = el('div', 'panel-hint quick-preview')
  const add = button('เพิ่ม', () => submit(), 'primary')
  const showPreview = (): void => {
    const entry = asTodo
      ? draft.trim()
        ? { summary: `งาน: ${draft.trim()}` }
        : null
      : parseQuickEntry(draft, Date.now())
    preview.textContent = entry ? `→ ${entry.summary}` : asTodo ? '' : 'พิมพ์เวลา + เรื่อง แล้วกด Enter'
  }
  const submit = (): void => {
    const entry = addFromText(draft, asTodo)
    if (!entry) return
    draft = ''
    input.value = ''
    showPreview()
    signature = ''
    if (!typing) render()
  }
  typeable(input, submit)
  input.addEventListener('input', () => {
    draft = input.value
    showPreview()
  })
  const row = el('div', 'quick-row')
  row.append(input, add)
  box.append(row, preview)
  showPreview()
  return box
}

function renderReminders(): void {
  root.append(quickInput(false))
  const now = Date.now()
  const late = overdue(companion.reminders, now)
  const next = upcoming(companion.reminders, now).slice(0, 8)
  if (late.length + next.length === 0) {
    root.append(el('div', 'panel-hint', 'ยังไม่มีนัด — สัตว์จะเตือนล่วงหน้า 10, 5 และ 1 นาที'))
    return
  }
  const list = el('ul', 'items')
  for (const r of [...late, ...next]) {
    const item = el('li', late.includes(r) ? 'late' : '')
    const text = el('div', 'item-text')
    text.append(
      el('div', '', r.text),
      el(
        'div',
        'item-sub',
        r.repeat !== 'none' ? describeRepeat(r) : formatWhen(effectiveAt(r), now),
      ),
    )
    const remove = button('×', () => removeReminder(r.id), 'panel-icon')
    remove.title = 'ลบ'
    item.append(text, remove)
    list.append(item)
  }
  root.append(list)
}

function renderTodos(): void {
  root.append(quickInput(true))
  const todos = companion.todos
  if (todos.length === 0) {
    root.append(el('div', 'panel-hint', 'ยังไม่มีงาน — ทำเสร็จแล้วติ๊กถูก สัตว์จะดีใจด้วย'))
    return
  }
  const list = el('ul', 'items')
  for (const t of [...todos.filter((x) => !x.done), ...todos.filter((x) => x.done)]) {
    const item = el('li', t.done ? 'done' : '')
    const label = el('label', 'item-text')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = t.done
    box.addEventListener('change', () => toggleTodo(t.id))
    label.append(box, el('span', '', t.text))
    const remove = button('×', () => removeTodo(t.id), 'panel-icon')
    remove.title = 'ลบ'
    item.append(label, remove)
    list.append(item)
  }
  root.append(list)
  if (todos.some((t) => t.done)) {
    const footer = el('div', 'panel-actions panel-footer')
    footer.append(button('ล้างงานที่เสร็จแล้ว', clearDoneTodos))
    root.append(footer)
  }
}

// ───────── ปฏิทิน ─────────
let calName = ''
let calUrl = ''
let calMessage = ''

function calendarForm(): HTMLElement {
  const box = el('div', 'quick calendar-form')
  const name = el('input', 'quick-input')
  name.placeholder = 'ชื่อ เช่น งาน'
  name.maxLength = 40
  name.value = calName
  const url = el('input', 'quick-input')
  url.placeholder = 'วางลิงก์ปฏิทิน (ICS) ที่นี่'
  url.value = calUrl
  url.spellcheck = false
  const message = el('div', 'panel-hint quick-preview', calMessage)
  const submit = (): void => {
    const error = addCalendar(calName, calUrl)
    if (error) {
      calMessage = error
      message.textContent = error
      message.classList.add('error')
      return
    }
    calName = ''
    calUrl = ''
    calMessage = 'เพิ่มแล้ว กำลังดึงนัด…'
    name.value = ''
    url.value = ''
    message.textContent = calMessage
    message.classList.remove('error')
  }
  typeable(name, submit)
  typeable(url, submit)
  name.addEventListener('input', () => (calName = name.value))
  url.addEventListener('input', () => (calUrl = url.value))
  const row = el('div', 'quick-row')
  row.append(url, button('เพิ่ม', submit, 'primary'))
  box.append(name, row, message)
  return box
}

const eventTime = (e: CalendarEvent): string =>
  e.allDay ? 'ทั้งวัน' : `${formatClock(e.start)}–${formatClock(e.end)}`

function renderCalendar(): void {
  const { calendars, calendarEvents, meetingQuiet } = companion
  const now = Date.now()
  // ข้อความ "กำลังดึงนัด" หมดหน้าที่เมื่อซิงก์เสร็จ (สถานะจริงแสดงในรายการแล้ว)
  if (calMessage.startsWith('เพิ่มแล้ว') && !calendars.some((c) => isSyncing(c.id))) calMessage = ''

  if (calendars.length > 0) {
    const list = el('ul', 'items')
    for (const source of calendars) {
      const item = el('li', source.lastError ? 'late' : '')
      const text = el('div', 'item-text')
      const status = isSyncing(source.id)
        ? 'กำลังดึงนัด…'
        : source.lastError
          ? source.lastError
          : source.lastSync
            ? `ซิงก์ล่าสุด ${formatWhen(source.lastSync, now)}`
            : 'ยังไม่ได้ซิงก์'
      text.append(
        el('div', '', `${source.name}`),
        el('div', 'item-sub', `${calendarLabel(source)} · ${status}`),
      )
      const on = el('input')
      on.type = 'checkbox'
      on.checked = source.enabled
      on.title = 'เปิด/ปิดปฏิทินนี้'
      on.addEventListener('change', () => setCalendarEnabled(source.id, on.checked))
      const refresh = button('↻', () => void syncCalendar(source.id), 'panel-icon')
      refresh.title = 'ดึงนัดใหม่ตอนนี้'
      const remove = button('×', () => removeCalendar(source.id), 'panel-icon')
      remove.title = 'ลบปฏิทินนี้'
      item.append(on, text, refresh, remove)
      list.append(item)
    }
    root.append(list)

    // นัดวันนี้-พรุ่งนี้
    const soon = upcomingEvents(calendarEvents, now).filter(
      (e) => e.start < startOfDay(now) + 2 * DAY,
    )
    const agenda = el('ul', 'items agenda')
    for (const e of soon.slice(0, 8)) {
      const item = el('li', e.start <= now ? 'now' : '')
      const text = el('div', 'item-text')
      const day = e.start < startOfDay(now) + DAY ? 'วันนี้' : 'พรุ่งนี้'
      text.append(
        el('div', '', e.title),
        el('div', 'item-sub', [`${day} ${eventTime(e)}`, e.location].filter(Boolean).join(' · ')),
      )
      item.append(text)
      agenda.append(item)
    }
    root.append(el('div', 'panel-status', soon.length ? 'นัดวันนี้–พรุ่งนี้' : 'วันนี้–พรุ่งนี้ไม่มีนัด'))
    if (soon.length) root.append(agenda)

    const quiet = el('label', 'toggle')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = meetingQuiet
    box.addEventListener('change', () => setMeetingQuiet(box.checked))
    const text = el('div')
    text.append(
      el('div', '', 'เงียบระหว่างประชุม'),
      el('div', 'item-sub', 'สัตว์ไม่พูดเล่น และเลื่อนเตือนสุขภาพไปหลังประชุม'),
    )
    quiet.append(box, text)
    root.append(quiet)
  }

  if (calendars.length < 10) root.append(calendarForm())

  const help = el('details', 'panel-genes')
  help.open = calendars.length === 0
  help.append(el('summary', '', 'หาลิงก์ปฏิทินได้ที่ไหน?'))
  for (const line of [
    'Google: เปิด Google Calendar บนเว็บ → ⚙ การตั้งค่า → เลือกปฏิทิน → “ผสานรวมปฏิทิน” → คัดลอก “ที่อยู่ลับในรูปแบบ iCal”',
    'Outlook: Outlook บนเว็บ → ⚙ การตั้งค่า → ปฏิทิน → ปฏิทินที่แชร์ → เผยแพร่ปฏิทิน → คัดลอกลิงก์ ICS',
    'ลิงก์นี้เป็นความลับ ใครมีลิงก์ก็อ่านปฏิทินได้ — Mochimon เก็บไว้ในเครื่องนี้เท่านั้น และอ่านอย่างเดียว',
    'Google อาจอัปเดตลิงก์ช้าหลายชั่วโมงหลังแก้นัด',
  ])
    help.append(el('div', 'panel-hint', line))
  root.append(help)
}

function minutesSelect(
  label: string,
  value: number,
  options: number[],
  onPick: (n: number) => void,
): HTMLElement {
  const wrap = el('label', 'select')
  const select = el('select')
  for (const n of options) {
    const option = el('option', '', `${n} นาที`)
    option.value = String(n)
    option.selected = n === value
    select.append(option)
  }
  select.addEventListener('change', () => onPick(Number(select.value)))
  wrap.append(el('span', '', label), select)
  return wrap
}

function renderFocus(): void {
  const { focus, focusSettings } = companion
  const phaseLabel =
    focus.phase === 'focus'
      ? isPaused(focus)
        ? 'หยุดไว้ชั่วคราว'
        : 'กำลังโฟกัส'
      : focus.phase === 'idle'
        ? 'พร้อมเริ่ม'
        : 'พักก่อน'
  const timer = el('div', `timer ${focus.phase}`)
  timerLabel = el('div', 'timer-time')
  timer.append(timerLabel, el('div', 'timer-phase', phaseLabel))
  root.append(timer)

  const actions = el('div', 'panel-actions')
  if (focus.phase === 'idle')
    actions.append(button(`เริ่มโฟกัส ${focusSettings.focusMin} นาที`, startFocusSession, 'primary'))
  else {
    if (isPaused(focus)) actions.append(button('ทำต่อ', resumeFocusSession, 'primary'))
    else actions.append(button('หยุดชั่วคราว', pauseFocusSession))
    actions.append(button(focus.phase === 'focus' ? 'เลิกรอบนี้' : 'ข้ามการพัก', stopFocusSession))
  }
  root.append(actions)
  root.append(el('div', 'panel-status', `วันนี้โฟกัสครบ ${focus.todayCount} รอบ`))

  const settingsRow = el('div', 'selects')
  settingsRow.append(
    minutesSelect('โฟกัส', focusSettings.focusMin, [15, 25, 30, 45, 50, 60], (n) =>
      setFocusMinutes('focusMin', n),
    ),
    minutesSelect('พัก', focusSettings.breakMin, [3, 5, 10, 15], (n) =>
      setFocusMinutes('breakMin', n),
    ),
  )
  root.append(settingsRow)
  root.append(
    el('div', 'panel-hint', 'ระหว่างโฟกัส สัตว์จะนั่งเป็นเพื่อนเงียบๆ ไม่ขอความสนใจ และไข่บนจอฟักเร็วขึ้น 3 เท่า'),
  )
}

function renderHealth(): void {
  const settings = companion.wellbeingSettings
  const list = el('div', 'toggles')
  for (const h of HEALTH) {
    const row = el('label', 'toggle')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = settings[h.key]
    box.addEventListener('change', () => setWellbeing(h.key, box.checked))
    const text = el('div')
    text.append(el('div', '', h.label), el('div', 'item-sub', h.hint))
    row.append(box, text)
    list.append(row)
  }
  root.append(list)
  const water = el('div', 'panel-actions panel-footer')
  water.append(
    el('span', 'panel-status', `วันนี้ดื่มน้ำ ${companion.wellbeing.cupsToday} แก้ว`),
    button('💧 ดื่มแล้ว', drink),
  )
  root.append(water)
  root.append(el('div', 'panel-hint', 'นับเฉพาะเวลาที่ใช้เครื่องจริง — ลุกไปเกิน 5 นาทีถือว่าได้พักแล้ว'))
}

function render(): void {
  if (root.hidden || typing) return
  const now = Date.now()
  const next = JSON.stringify([
    tab,
    companion.reminders,
    companion.todos,
    companion.focus.phase,
    companion.focus.pausedLeft !== null,
    companion.focus.todayCount,
    companion.focusSettings,
    companion.wellbeingSettings,
    companion.wellbeing.cupsToday,
    companion.calendars,
    companion.calendarEvents.length,
    companion.meetingQuiet,
    companion.calendars.map((c) => isSyncing(c.id)),
    // นัดที่เพิ่งเริ่ม/จบ → ปรับรายการวันนี้
    Math.floor(now / 60_000),
    // นัดที่เพิ่งเลยเวลา → ย้ายไปกลุ่ม "เลยเวลา"
    overdue(companion.reminders, now).length,
  ])
  if (next === signature) return
  signature = next
  timerLabel = null
  root.replaceChildren(header())
  if (tab === 'reminders') renderReminders()
  else if (tab === 'todos') renderTodos()
  else if (tab === 'calendar') renderCalendar()
  else if (tab === 'focus') renderFocus()
  else renderHealth()
  place()
}

function place(): void {
  root.style.left = `${Math.max(8, layout.width - root.offsetWidth - 16)}px`
  root.style.top = `${Math.max(8, layout.groundY - root.offsetHeight - 12)}px`
}

export function updateAssistant(): void {
  if (root.hidden) return
  render()
  if (timerLabel)
    timerLabel.textContent = formatCountdown(focusRemaining(companion.focus, Date.now()))
  place()
  mode.reserveRight = root.offsetWidth + 24
}

export const assistantRect = (): { x: number; y: number; w: number; h: number } | null =>
  root.hidden ? null : rectOf(root)
