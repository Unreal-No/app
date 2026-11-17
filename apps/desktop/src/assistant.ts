import {
  describeRepeat,
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
import { companion } from './game'
import { button, el, rectOf } from './ui'
import { layout, mode, uiLayer } from './world'

/**
 * แผงผู้ช่วย: เตือน · งาน · โฟกัส · สุขภาพ
 * เปิดจากเมนู tray หรือปุ่มในแผงดูแล ลอยอยู่มุมขวาล่างเหนือ Taskbar
 */
export type AssistantTab = 'reminders' | 'todos' | 'focus' | 'health'

const TABS: { id: AssistantTab; label: string }[] = [
  { id: 'reminders', label: 'เตือน' },
  { id: 'todos', label: 'งาน' },
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
  // หน้าต่างสัตว์ปกติไม่รับคีย์บอร์ด (ไม่แย่งงานของผู้ใช้) — ขอรับชั่วคราวตอนกดช่องพิมพ์
  input.addEventListener('pointerdown', () => {
    if (typing) return
    typing = true
    setKeyboardFocus(true)
    setTimeout(() => input.focus(), 60)
  })
  input.addEventListener('input', () => {
    draft = input.value
    showPreview()
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') input.blur()
  })
  input.addEventListener('blur', () => {
    typing = false
    setKeyboardFocus(false)
    if (signature === '') render()
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
    // นัดที่เพิ่งเลยเวลา → ย้ายไปกลุ่ม "เลยเวลา"
    overdue(companion.reminders, now).length,
  ])
  if (next === signature) return
  signature = next
  timerLabel = null
  root.replaceChildren(header())
  if (tab === 'reminders') renderReminders()
  else if (tab === 'todos') renderTodos()
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
