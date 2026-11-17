import { CLAUDE_MODELS, type ChatProvider } from '@mochimon/core'
import { onCompanionChange, updateCompanion } from './assist'
import { clearApiKey, hasApiKey, setApiKey } from './bridge'
import { chatHistory, clearChat, forgetMemory, isThinking, petMemories, sendChat } from './chat'
import { companion, pets } from './game'
import type { PetActor } from './pet'
import { messenger } from './signs'
import { bindKeyboard, button, el, rectOf, type KeyboardScope } from './ui'
import { layout, uiLayer } from './world'

/**
 * แผงคุยกับสัตว์: ข้อความล่าสุด + ช่องพิมพ์ และหน้าตั้งค่า (ผู้ให้บริการ, API key, รุ่น, สิ่งที่สัตว์จำได้)
 * ลอยข้างตัวสัตว์ที่คุยด้วย — สัตว์ยืนรอระหว่างที่แผงเปิด
 */
const WIDTH = 290

const root = el('div', 'panel chat')
root.hidden = true
uiLayer.append(root)
new ResizeObserver(() => place()).observe(root)

let actor: PetActor | null = null
let view: 'chat' | 'settings' = 'chat'
let draft = ''
let error = ''
let keyDraft = ''
let keySaved = false
let signature = ''
/** ส่วนที่อัปเดตได้โดยไม่สร้างช่องพิมพ์ใหม่ (ระหว่างผู้ใช้กำลังพิมพ์) */
let logBox: HTMLElement | null = null
let errorBox: HTMLElement | null = null

const keyboard: KeyboardScope = {
  typing: false,
  onRelease: () => {
    signature = ''
    render()
  },
}

onCompanionChange(() => {
  signature = ''
  render()
})

export const chatOpen = (): boolean => !root.hidden

export function openChat(target: PetActor | undefined = messenger()): void {
  if (!target) return
  if (actor && actor !== target) actor.attending = false
  actor = target
  actor.attending = true
  view = companion.chat.provider === 'anthropic' && !companion.chat.consent ? 'settings' : 'chat'
  error = ''
  root.hidden = false
  signature = ''
  void hasApiKey().then((has) => {
    keySaved = has
    signature = ''
    render()
  })
  render()
}

export function closeChat(): void {
  if (actor) actor.attending = false
  actor = null
  root.hidden = true
  root.replaceChildren()
}

function header(target: PetActor): HTMLElement {
  const head = el('div', 'panel-header')
  const title = el('div', 'panel-name', view === 'chat' ? `คุยกับ${target.state.name}` : 'ตั้งค่าการคุย')
  const gear = button(
    view === 'chat' ? '⚙' : '←',
    () => {
      view = view === 'chat' ? 'settings' : 'chat'
      signature = ''
      render()
    },
    'panel-icon',
  )
  gear.title = view === 'chat' ? 'ตั้งค่า' : 'กลับไปคุย'
  head.append(title, gear, button('×', closeChat, 'panel-icon panel-close'))
  return head
}

/** เติมข้อความแชตและข้อความผิดพลาด (เรียกซ้ำได้ระหว่างพิมพ์) */
function paint(target: PetActor): void {
  if (errorBox) {
    errorBox.textContent = error
    errorBox.hidden = !error
  }
  const log = logBox
  if (!log) return
  log.replaceChildren()
  const turns = chatHistory(target.state.id).slice(-8)
  if (turns.length === 0) {
    const provider = companion.chat.provider
    log.append(
      el(
        'div',
        'panel-hint',
        provider === 'off'
          ? 'ตอนนี้คุยแบบง่ายในเครื่อง (สั่ง "เตือน…" หรือ "จด…" ได้) — เปิด AI ให้คุยรู้เรื่องได้ที่ ⚙'
          : `ทักทาย${target.state.name}ได้เลย ลองให้ช่วยเตือน จดงาน ดูนัดวันนี้ หรือเริ่มโฟกัส`,
      ),
    )
  }
  for (const turn of turns) log.append(el('div', `chat-line ${turn.role}`, turn.text))
  if (isThinking(target.state.id)) log.append(el('div', 'chat-line pet thinking', '…'))
  requestAnimationFrame(() => (log.scrollTop = log.scrollHeight))
}

function renderChat(target: PetActor): void {
  logBox = el('div', 'chat-log')
  errorBox = el('div', 'panel-hint quick-preview error')
  root.append(logBox, errorBox)
  paint(target)

  const input = el('input', 'quick-input')
  input.placeholder = 'พิมพ์ข้อความ แล้วกด Enter'
  input.maxLength = 500
  input.value = draft
  const send = (): void => {
    const text = draft.trim()
    if (!text || isThinking(target.state.id)) return
    draft = ''
    input.value = ''
    error = ''
    void sendChat(target, text).then((problem) => {
      error = problem ?? ''
      signature = ''
      render()
    })
  }
  bindKeyboard(input, root, keyboard, send)
  input.addEventListener('input', () => (draft = input.value))
  const row = el('div', 'quick-row')
  row.append(input, button('ส่ง', send, 'primary'))
  root.append(row)
}

const PROVIDERS: { id: ChatProvider; label: string; hint: string }[] = [
  { id: 'off', label: 'คุยแบบง่าย (ไม่ใช้ AI)', hint: 'ไม่ส่งข้อมูลออกจากเครื่อง เข้าใจคำสั่งเตือน/จดงาน' },
  { id: 'anthropic', label: 'Claude (API key ของคุณ)', hint: 'คุยรู้เรื่อง ช่วยตั้งเตือน ดูนัด เริ่มโฟกัสได้' },
  {
    id: 'ollama',
    label: 'Ollama (โมเดลในเครื่อง)',
    hint: 'ไม่ส่งข้อมูลออก ต้องติดตั้ง Ollama เอง ยังสั่งงานไม่ได้',
  },
]

function setChat(change: Partial<typeof companion.chat>): void {
  updateCompanion((c) => ({ ...c, chat: { ...c.chat, ...change } }))
}

function renderSettings(target: PetActor): void {
  const settings = companion.chat
  const list = el('div', 'toggles')
  for (const p of PROVIDERS) {
    const row = el('label', 'toggle')
    const radio = el('input')
    radio.type = 'radio'
    radio.name = 'chat-provider'
    radio.checked = settings.provider === p.id
    radio.addEventListener('change', () => setChat({ provider: p.id }))
    const text = el('div')
    text.append(el('div', '', p.label), el('div', 'item-sub', p.hint))
    row.append(radio, text)
    list.append(row)
  }
  root.append(list)

  if (settings.provider === 'anthropic') {
    const box = el('div', 'chat-settings')
    const consent = el('label', 'toggle')
    const agree = el('input')
    agree.type = 'checkbox'
    agree.checked = settings.consent
    agree.addEventListener('change', () => setChat({ consent: agree.checked }))
    const consentText = el('div')
    consentText.append(
      el('div', '', 'ยอมรับการส่งข้อความไปยัง Anthropic'),
      el(
        'div',
        'item-sub',
        'สิ่งที่ส่ง: ข้อความที่คุณพิมพ์, ชื่อ/นิสัย/อารมณ์ของสัตว์, สิ่งที่สัตว์จำได้ และนัด/งานเฉพาะตอนที่สัตว์เปิดดูให้ตามที่คุณขอ — ไม่ส่งไฟล์หรือหน้าจอ',
      ),
    )
    consent.append(agree, consentText)
    box.append(consent)

    if (keySaved) {
      const row = el('div', 'quick-row')
      row.append(
        el('div', 'panel-status', 'API key: บันทึกในที่เก็บรหัสของ Windows แล้ว'),
        button('ลบ', () => {
          void clearApiKey().then(() => {
            keySaved = false
            signature = ''
            render()
          })
        }),
      )
      box.append(row)
    } else {
      const key = el('input', 'quick-input')
      key.type = 'password'
      key.placeholder = 'วาง API key (sk-ant-…)'
      key.value = keyDraft
      key.autocomplete = 'off'
      const save = (): void => {
        void setApiKey(keyDraft)
          .then(() => {
            keyDraft = ''
            keySaved = true
            error = ''
          })
          .catch((e: Error) => (error = e.message))
          .finally(() => {
            signature = ''
            render()
          })
      }
      bindKeyboard(key, root, keyboard, save)
      key.addEventListener('input', () => (keyDraft = key.value))
      const row = el('div', 'quick-row')
      row.append(key, button('บันทึก', save, 'primary'))
      box.append(
        row,
        el(
          'div',
          'item-sub',
          'สร้าง key ได้ที่ Claude Console (console.anthropic.com) — ค่าใช้จ่ายคิดกับบัญชีของคุณ',
        ),
      )
    }

    const model = el('label', 'select')
    const select = el('select')
    for (const m of CLAUDE_MODELS) {
      const option = el('option', '', m.label)
      option.value = m.id
      option.selected = m.id === settings.model
      select.append(option)
    }
    select.addEventListener('change', () => setChat({ model: select.value }))
    model.append(el('span', '', 'รุ่น'), select)
    box.append(model)
    root.append(box)
  }

  if (settings.provider === 'ollama') {
    const box = el('div', 'chat-settings')
    for (const [label, key, placeholder] of [
      ['ที่อยู่', 'ollamaUrl', 'http://localhost:11434'],
      ['รุ่น', 'ollamaModel', 'llama3.2'],
    ] as const) {
      const input = el('input', 'quick-input')
      input.value = settings[key]
      input.placeholder = placeholder
      const commit = (): void => {
        const value = input.value.trim()
        if (key === 'ollamaUrl' && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(value)) {
          error = 'ต่อ Ollama ได้เฉพาะในเครื่องนี้ เช่น http://localhost:11434'
          signature = ''
          render()
          return
        }
        error = ''
        if (value) setChat({ [key]: value })
      }
      bindKeyboard(input, root, keyboard, commit)
      input.addEventListener('change', commit)
      const row = el('label', 'select')
      row.append(el('span', '', label), input)
      box.append(row)
    }
    root.append(box)
  }
  errorBox = el('div', 'panel-hint quick-preview error')
  root.append(errorBox)
  paint(target)

  // สิ่งที่สัตว์จำได้ (ผู้ใช้ดูและลบได้)
  const memories = petMemories(target.state.id)
  const details = el('details', 'panel-genes')
  details.append(el('summary', '', `สิ่งที่${target.state.name}จำได้ (${memories.length})`))
  const list2 = el('ul', 'items')
  memories.forEach((memory, index) => {
    const item = el('li')
    item.append(
      el('div', 'item-text', memory),
      button('×', () => forgetMemory(target.state.id, index), 'panel-icon'),
    )
    list2.append(item)
  })
  if (memories.length) details.append(list2)
  else details.append(el('div', 'panel-hint', 'ยังไม่ได้จำอะไร'))
  root.append(details)
  const footer = el('div', 'panel-actions panel-footer')
  footer.append(button('ล้างประวัติแชต', () => clearChat(target.state.id)))
  root.append(footer)
}

function render(): void {
  if (!actor || root.hidden) return
  const next = JSON.stringify([
    actor.state.id,
    view,
    error,
    keySaved,
    companion.chat,
    chatHistory(actor.state.id).length,
    petMemories(actor.state.id),
    isThinking(actor.state.id),
  ])
  if (next === signature) return
  signature = next
  // ระหว่างพิมพ์: อัปเดตเฉพาะข้อความ ไม่สร้างช่องพิมพ์ใหม่ (จะเสียตัวอักษรที่กำลังพิมพ์)
  if (keyboard.typing) {
    paint(actor)
    return
  }
  logBox = null
  errorBox = null
  root.replaceChildren(header(actor))
  if (view === 'chat') renderChat(actor)
  else renderSettings(actor)
  place()
}

function place(): void {
  if (!actor || root.hidden) return
  const hit = actor.hit
  const height = root.offsetHeight
  const right = hit.x + hit.r + 14
  const x = right + WIDTH <= layout.width - 8 ? right : hit.x - hit.r - 14 - WIDTH
  const y = Math.min(layout.groundY - height - 10, Math.max(8, hit.y + hit.r - height))
  root.style.left = `${Math.max(8, Math.min(layout.width - WIDTH - 8, x))}px`
  root.style.top = `${Math.max(8, y)}px`
}

export function updateChatPanel(): void {
  if (!actor || root.hidden) return
  if (!pets.includes(actor) || actor.held) {
    closeChat()
    return
  }
  render()
  place()
}

export const chatRect = (): { x: number; y: number; w: number; h: number } | null =>
  root.hidden ? null : rectOf(root)
