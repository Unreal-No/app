import {
  addMemory,
  bubbleText,
  buildPersona,
  CHAT_KEEP_TURNS,
  chatTools,
  DAY,
  dominantTraits,
  EMOTION_NAME_TH,
  effectiveAt,
  formatClock,
  formatWhen,
  historyMessages,
  NEED_KEYS,
  parseQuickEntry,
  petEvent,
  readClaudeReply,
  speciesLabel,
  startOfDay,
  TRAIT_NAME_TH,
  upcoming,
  upcomingEvents,
  type ChatTurn,
  type NeedKey,
} from '@mochimon/core'
import { addFromText, setFocusMinutes, startFocusSession, updateCompanion } from './assist'
import { claudeMessages, ollamaChat } from './bridge'
import { companion } from './game'
import type { PetActor } from './pet'
import { LINES } from './text'
import { rng } from './world'

/**
 * คุยกับสัตว์: ส่งข้อความไปยังผู้ให้บริการที่ผู้ใช้เลือก (Claude ด้วย key ของผู้ใช้ / Ollama ในเครื่อง)
 * หรือคุยแบบง่ายในเครื่องเมื่อปิด AI — บุคลิกและเครื่องมืออยู่ใน `@mochimon/core`
 */

/** ความต้องการที่ต่ำ → คำที่สัตว์ใช้บอกว่าอยากได้อะไร */
const WANT_TH: Record<NeedKey, string> = {
  hunger: 'หิว',
  energy: 'ง่วง/เหนื่อย',
  hygiene: 'อยากอาบน้ำ',
  fun: 'อยากเล่น',
  social: 'อยากให้สนใจ',
  comfort: 'ไม่ค่อยสบายตัว',
}

/** จำนวนรอบเรียกเครื่องมือสูงสุดต่อหนึ่งข้อความ */
const MAX_TOOL_ROUNDS = 4

export const chatHistory = (petId: string): ChatTurn[] => companion.chatHistory[petId] ?? []
export const petMemories = (petId: string): string[] => companion.memories[petId] ?? []

function pushTurn(petId: string, turn: ChatTurn): void {
  updateCompanion((c) => ({
    ...c,
    chatHistory: {
      ...c.chatHistory,
      [petId]: [...(c.chatHistory[petId] ?? []), turn].slice(-CHAT_KEEP_TURNS),
    },
  }))
}

export function forgetMemory(petId: string, index: number): void {
  updateCompanion((c) => ({
    ...c,
    memories: { ...c.memories, [petId]: (c.memories[petId] ?? []).filter((_, i) => i !== index) },
  }))
}

export function clearChat(petId: string): void {
  updateCompanion((c) => {
    const { [petId]: _removed, ...rest } = c.chatHistory
    return { ...c, chatHistory: rest }
  })
}

// ───────── เครื่องมือที่สัตว์เรียกใช้ ─────────
function scheduleText(now: number): string {
  const until = startOfDay(now) + 2 * DAY
  const lines: string[] = []
  for (const r of upcoming(companion.reminders, now).filter((r) => effectiveAt(r) < until))
    lines.push(`เตือน: ${r.text} — ${formatWhen(effectiveAt(r), now)}`)
  for (const e of upcomingEvents(companion.calendarEvents, now).filter((e) => e.start < until))
    lines.push(
      `ปฏิทิน: ${e.title} — ${e.allDay ? `${formatWhen(e.start, now).split(' ')[0]} ทั้งวัน` : `${formatWhen(e.start, now)}–${formatClock(e.end)}`}${e.location ? ` (${e.location})` : ''}`,
    )
  const todos = companion.todos.filter((t) => !t.done).slice(0, 10)
  for (const t of todos) lines.push(`งานค้าง: ${t.text}`)
  return lines.length ? lines.join('\n') : 'วันนี้และพรุ่งนี้ไม่มีนัด และไม่มีงานค้าง'
}

interface ToolOutcome {
  content: string
  isError?: boolean
}

function runTool(actor: PetActor, name: string, input: Record<string, unknown>): ToolOutcome {
  const now = Date.now()
  const text = (key: string): string =>
    typeof input[key] === 'string' ? (input[key] as string).trim() : ''
  switch (name) {
    case 'add_reminder': {
      const request = text('when_and_what')
      const parsed = parseQuickEntry(request, now)
      if (parsed?.kind !== 'reminder')
        return { content: 'ไม่พบเวลาในข้อความ — ถามผู้ใช้ว่าจะให้เตือนกี่โมง', isError: true }
      addFromText(request)
      return { content: `ตั้งแล้ว: ${parsed.summary}` }
    }
    case 'add_todo': {
      const entry = addFromText(text('text'), true)
      return entry
        ? { content: `จดแล้ว: ${entry.summary}` }
        : { content: 'ข้อความว่าง', isError: true }
    }
    case 'list_schedule':
      return { content: scheduleText(now) }
    case 'start_focus': {
      const minutes = Math.round(Math.min(90, Math.max(5, Number(input.minutes) || 25)))
      setFocusMinutes('focusMin', minutes)
      startFocusSession()
      return { content: `เริ่มจับเวลาโฟกัส ${minutes} นาทีแล้ว` }
    }
    case 'remember': {
      const fact = text('fact')
      if (!fact) return { content: 'ข้อความว่าง', isError: true }
      updateCompanion((c) => ({
        ...c,
        memories: {
          ...c.memories,
          [actor.state.id]: addMemory(c.memories[actor.state.id] ?? [], fact),
        },
      }))
      return { content: 'จำไว้แล้ว' }
    }
    default:
      return { content: `ไม่รู้จักเครื่องมือ ${name}`, isError: true }
  }
}

// ───────── ผู้ให้บริการ ─────────
function persona(actor: PetActor, tools: boolean): string {
  const view = actor.state
  const wants = NEED_KEYS.filter((k) => view.needs[k] < 0.35).map((k) => WANT_TH[k])
  return buildPersona({
    name: view.name,
    species: speciesLabel(view.genome).th,
    stage: view.nurture.stage,
    mood: EMOTION_NAME_TH[actor.emotion],
    traits: dominantTraits(actor.personality, 2).map((k) => TRAIT_NAME_TH[k]),
    wants,
    memories: petMemories(view.id),
    now: Date.now(),
    tools,
  })
}

/** รุ่นที่รองรับการส่งต่อไปรุ่นสำรองฝั่งเซิร์ฟเวอร์เมื่อถูกปฏิเสธ */
const SUPPORTS_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

async function askClaude(actor: PetActor, history: ChatTurn[], text: string): Promise<string> {
  const model = companion.chat.model
  const fallback = SUPPORTS_FALLBACK.has(model)
  const messages: object[] = historyMessages(history, text)
  const body: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: persona(actor, true),
    tools: chatTools(),
    // คุยเล่นสั้นๆ ไม่ต้องคิดลึก
    output_config: { effort: 'low' },
    messages,
    ...(fallback ? { fallbacks: 'default' } : {}),
  }
  const betas = fallback ? ['server-side-fallback-2026-07-01'] : []
  let lastText = ''
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = (await claudeMessages(body, betas)) as { content?: unknown }
    const reply = readClaudeReply(response)
    if (reply.stopReason === 'refusal') return 'เรื่องนี้ขอไม่คุยนะ~ คุยเรื่องอื่นกันเถอะ'
    if (reply.text) lastText = reply.text
    if (reply.stopReason !== 'tool_use' || reply.toolCalls.length === 0)
      return reply.text || lastText || '…'
    // ส่งคำตอบของรอบนี้กลับไปแบบไม่แก้ไข แล้วตามด้วยผลของทุกเครื่องมือในข้อความเดียว
    messages.push({ role: 'assistant', content: response.content })
    messages.push({
      role: 'user',
      content: reply.toolCalls.map((call) => {
        const outcome = runTool(actor, call.name, call.input)
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        }
      }),
    })
  }
  return lastText || 'งงนิดหน่อย ลองพูดใหม่อีกทีนะ'
}

async function askOllama(actor: PetActor, history: ChatTurn[], text: string): Promise<string> {
  const { ollamaUrl, ollamaModel } = companion.chat
  const response = (await ollamaChat(ollamaUrl, {
    model: ollamaModel,
    stream: false,
    messages: [
      { role: 'system', content: persona(actor, false) },
      ...historyMessages(history, text),
    ],
  })) as { message?: { content?: unknown } }
  const reply = typeof response.message?.content === 'string' ? response.message.content.trim() : ''
  return reply || '…'
}

/** คุยแบบไม่ใช้ AI: เข้าใจคำสั่งเตือน/จดงาน และตอบตามอารมณ์ */
function answerLocally(actor: PetActor, text: string): string {
  const now = Date.now()
  if (/เตือน|remind|นัด/i.test(text)) {
    const parsed = parseQuickEntry(text, now)
    if (parsed?.kind === 'reminder') {
      addFromText(text)
      return `จำไว้แล้ว! ${parsed.summary.replace(/^เตือน /, '')}`
    }
  }
  if (/^(จด|todo|งาน)\s*[:：]?\s*/i.test(text)) {
    const entry = addFromText(text.replace(/^(จด|todo|งาน)\s*[:：]?\s*/i, ''), true)
    if (entry) return 'จดไว้ให้แล้ว~'
  }
  if (/นัด|ตาราง|วันนี้มีอะไร|schedule/i.test(text))
    return bubbleText(scheduleText(now).split('\n').slice(0, 3).join(' · '))
  return rng.pick(LINES[actor.emotion])
}

/** สถานะการส่งข้อความของแต่ละตัว */
const pending = new Set<string>()
export const isThinking = (petId: string): boolean => pending.has(petId)

/**
 * ส่งข้อความหาสัตว์ — คืนข้อความผิดพลาด (ถ้ามี) เพื่อแสดงในแผง
 * คำตอบถูกเก็บในประวัติและแสดงในฟองคำพูดของสัตว์
 */
export async function sendChat(actor: PetActor, raw: string): Promise<string | null> {
  const text = raw.trim().slice(0, 1000)
  const petId = actor.state.id
  if (!text || pending.has(petId)) return null
  const settings = companion.chat
  if (settings.provider === 'anthropic' && !settings.consent)
    return 'ยอมรับเรื่องการส่งข้อความไปยัง Anthropic ในการตั้งค่าแชตก่อน'
  const history = chatHistory(petId)
  pushTurn(petId, { role: 'user', text, at: Date.now() })
  pending.add(petId)
  updateCompanion((c) => c, false)
  try {
    const reply =
      settings.provider === 'anthropic'
        ? await askClaude(actor, history, text)
        : settings.provider === 'ollama'
          ? await askOllama(actor, history, text)
          : answerLocally(actor, text)
    const shown = bubbleText(reply)
    pushTurn(petId, { role: 'pet', text: shown, at: Date.now() })
    actor.setState(petEvent(actor.state, 'greeted'))
    actor.say(shown, Math.min(10, 2.5 + shown.length / 12))
    return null
  } catch (error) {
    actor.say('…?', 2)
    return error instanceof Error ? error.message : 'คุยไม่สำเร็จ'
  } finally {
    pending.delete(petId)
    updateCompanion((c) => c, false)
  }
}
