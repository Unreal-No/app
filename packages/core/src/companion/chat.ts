import type { LifeStage } from '../body/composition'
import { DAYS_TH, formatClock } from './time'

/**
 * คุยกับสัตว์ด้วย AI — ส่วนที่ไม่ขึ้นกับผู้ให้บริการ: บุคลิก (system prompt), เครื่องมือที่สัตว์ใช้ได้,
 * ประวัติแชตที่ส่งไป และการอ่านคำตอบ
 *
 * ประวัติข้ามรอบเก็บเป็น "ข้อความล้วน" เท่านั้น (ไม่ส่ง thinking / tool blocks ของรอบเก่ากลับไป)
 * — ข้อมูลสถานะในบุคลิกเปลี่ยนทุกรอบ จึงไม่ต้องรักษา prefix เดิม; ภายในรอบเดียว (ลูปเรียกเครื่องมือ)
 * ฝั่งผู้เรียกต้องส่งเนื้อหาของผู้ช่วยกลับไปแบบไม่แก้ไข
 */

export type ChatProvider = 'off' | 'anthropic' | 'ollama'

/** รุ่น Claude ที่เลือกได้ — ค่าเริ่มต้นตามคำแนะนำของ Anthropic; ผู้ใช้เลือกรุ่นที่ประหยัดกว่าได้เอง */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (แนะนำ)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (ประหยัดที่สุด)' },
] as const
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

export interface ChatTurn {
  role: 'user' | 'pet'
  text: string
  at: number
}

export interface ChatSettings {
  provider: ChatProvider
  /** ผู้ใช้ยอมรับแล้วว่าข้อความจะถูกส่งไปผู้ให้บริการภายนอก (เฉพาะ anthropic) */
  consent: boolean
  model: string
  ollamaUrl: string
  ollamaModel: string
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: 'off',
  consent: false,
  model: DEFAULT_CLAUDE_MODEL,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
}

/** จำนวนรอบล่าสุดที่ส่งไปเป็นบริบท / ที่เก็บในเซฟ / สิ่งที่สัตว์จำได้สูงสุด */
export const CHAT_CONTEXT_TURNS = 12
export const CHAT_KEEP_TURNS = 40
export const MAX_MEMORIES = 30

export interface PersonaInput {
  name: string
  species: string
  stage: LifeStage
  /** อารมณ์ตอนนี้ (ภาษาไทย) */
  mood: string
  /** นิสัยเด่น (ภาษาไทย) */
  traits: string[]
  /** ความต้องการที่ต่ำอยู่ (ภาษาไทย) เช่น "หิว" */
  wants: string[]
  memories: string[]
  now: number
  /** มีเครื่องมือให้ใช้ไหม (Ollama ไม่มี) */
  tools: boolean
}

const VOICE: Record<Exclude<LifeStage, 'egg'>, string> = {
  baby: 'ยังเป็นเบบี้ พูดได้แค่คำสั้นๆ 1–4 คำ ปนเสียงอ้อแอ้หรือเสียงสัตว์ เช่น "งื้อ~" "หิว!" "เล่น ๆ!" ยังเรียงประโยคยาวไม่เป็น',
  child: 'ยังเป็นเด็ก พูดประโยคสั้นๆ ง่ายๆ 1–2 ประโยค ใช้คำแบบเด็ก',
  teen: 'เป็นวัยรุ่น พูด 1–2 ประโยค ขี้เล่น มีความเป็นตัวเอง',
  adult: 'โตเต็มวัยแล้ว พูด 1–3 ประโยค อบอุ่นและรู้เรื่อง',
  elder: 'เป็นผู้อาวุโส พูด 1–3 ประโยค ใจเย็น อบอุ่น บางทีเล่าเรื่องเก่า',
}

/** บุคลิกของสัตว์สำหรับโมเดล (ภาษาไทย) */
export function buildPersona(input: PersonaInput): string {
  const stage = input.stage === 'egg' ? 'baby' : input.stage
  const d = new Date(input.now)
  const lines = [
    `คุณคือ "${input.name}" สัตว์เลี้ยงตัวเล็กที่อาศัยอยู่บนหน้าจอคอมพิวเตอร์ของผู้ใช้ สายพันธุ์: ${input.species}`,
    VOICE[stage],
    `นิสัยเด่น: ${input.traits.join(', ') || 'ปกติ'} — ให้คำพูดและท่าทีสะท้อนนิสัยนี้`,
    `ความรู้สึกตอนนี้: ${input.mood}${input.wants.length ? ` (อยากได้: ${input.wants.join(', ')})` : ''}`,
    `ตอนนี้: วัน${DAYS_TH[d.getDay()]} ${formatClock(input.now)} น.`,
    '',
    'วิธีคุย:',
    '- ตอบเป็นภาษาไทย เว้นแต่ผู้ใช้คุยภาษาอื่น ตอบสั้นแบบคำพูดในฟองข้อความ ไม่ใช้ markdown หรือรายการหัวข้อ',
    '- คุณเป็นสัตว์เลี้ยง ไม่ใช่ผู้ช่วย AI ทั่วไป อย่าพูดถึงตัวเองว่าเป็นโปรแกรมหรือโมเดล เว้นแต่ผู้ใช้ถามตรงๆ ก็ตอบตามจริง',
    '- คุณมองไม่เห็นหน้าจอหรือไฟล์ของผู้ใช้ และทำอะไรในเครื่องไม่ได้นอกจากผ่านเครื่องมือที่มี',
    '- ถ้าผู้ใช้ดูเหนื่อยหรือเครียด ให้กำลังใจแบบเพื่อน ถ้าเรื่องดูร้ายแรง ชวนให้คุยกับคนที่ไว้ใจหรือผู้เชี่ยวชาญ',
  ]
  if (input.tools)
    lines.push(
      '- ผู้ใช้ขอให้เตือน จดงาน เริ่มจับเวลาโฟกัส หรือถามนัดหมาย → ใช้เครื่องมือ แล้วตอบรับสั้นๆ ตามนิสัย อย่าเดานัดเอง',
      '- ถ้าผู้ใช้เล่าเรื่องสำคัญเกี่ยวกับตัวเอง (ชื่อเล่น ของชอบ วันสำคัญ) ใช้ remember เก็บไว้',
    )
  if (input.memories.length) {
    lines.push('', 'สิ่งที่คุณจำได้เกี่ยวกับผู้ใช้:')
    for (const memory of input.memories) lines.push(`- ${memory}`)
  }
  return lines.join('\n')
}

/** เครื่องมือที่สัตว์เรียกใช้ได้ (รูปแบบของ Messages API) */
export function chatTools(): object[] {
  const tool = (name: string, description: string, properties: object, required: string[]) => ({
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  })
  return [
    tool(
      'add_reminder',
      'ตั้งการเตือนในเครื่องของผู้ใช้ ส่งเวลาและเรื่องเป็นข้อความภาษาไทยหรืออังกฤษแบบที่คนพิมพ์ เช่น "พรุ่งนี้ 9 โมง ส่งรายงาน", "อีก 20 นาที โทรหาแม่", "ทุกวันจันทร์ 10:00 ประชุมทีม" ผลลัพธ์บอกเวลาที่ตั้งจริง',
      { when_and_what: { type: 'string', description: 'เวลา + เรื่องที่จะเตือน' } },
      ['when_and_what'],
    ),
    tool(
      'add_todo',
      'เพิ่มรายการงานที่ต้องทำ (ไม่มีเวลาเตือน)',
      { text: { type: 'string', description: 'งานที่ต้องทำ' } },
      ['text'],
    ),
    tool(
      'list_schedule',
      'ดูนัดหมายวันนี้และพรุ่งนี้ (การเตือนที่ตั้งไว้ + ปฏิทินที่ผู้ใช้เชื่อมไว้) และงานที่ยังไม่เสร็จ',
      {},
      [],
    ),
    tool(
      'start_focus',
      'เริ่มจับเวลาโฟกัส (Pomodoro) — สัตว์จะนั่งเป็นเพื่อนเงียบๆ',
      { minutes: { type: 'integer', description: 'จำนวนนาที 5–90 (ปกติ 25)' } },
      ['minutes'],
    ),
    tool(
      'remember',
      'จำข้อเท็จจริงสั้นๆ เกี่ยวกับผู้ใช้ไว้คุยในครั้งต่อไป',
      { fact: { type: 'string', description: 'สิ่งที่จะจำ เขียนสั้นๆ 1 ประโยค' } },
      ['fact'],
    ),
  ]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** ประวัติล่าสุดเป็นข้อความล้วน (ขึ้นต้นด้วยผู้ใช้เสมอ) + ข้อความใหม่ */
export function historyMessages(
  turns: ChatTurn[],
  next: string,
  limit = CHAT_CONTEXT_TURNS,
): ChatMessage[] {
  const recent = turns.slice(-limit)
  while (recent.length && recent[0]!.role !== 'user') recent.shift()
  const messages: ChatMessage[] = recent.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    content: t.text,
  }))
  messages.push({ role: 'user', content: next })
  return messages
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ClaudeReply {
  text: string
  toolCalls: ToolCall[]
  stopReason: string
}

/** อ่านคำตอบของ Messages API: ข้อความ + การเรียกเครื่องมือ */
export function readClaudeReply(response: unknown): ClaudeReply {
  const body = (response ?? {}) as { content?: unknown; stop_reason?: unknown }
  const blocks = Array.isArray(body.content) ? body.content : []
  const text: string[] = []
  const toolCalls: ToolCall[] = []
  for (const block of blocks as {
    type?: string
    text?: unknown
    id?: unknown
    name?: unknown
    input?: unknown
  }[]) {
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
      toolCalls.push({
        id: block.id,
        name: block.name,
        input:
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {},
      })
  }
  return {
    text: text.join('').trim(),
    toolCalls,
    stopReason: typeof body.stop_reason === 'string' ? body.stop_reason : 'unknown',
  }
}

/** ข้อความสั้นพอจะอยู่ในฟองคำพูด: ตัด markdown ที่หลุดมาและย่อช่องว่าง */
export function bubbleText(text: string, max = 220): string {
  const clean = text
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** เพิ่มสิ่งที่จำ (ไม่ซ้ำ, ใหม่สุดอยู่ท้าย, จำกัดจำนวน) */
export function addMemory(memories: string[], fact: string): string[] {
  const clean = fact.replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!clean) return memories
  const rest = memories.filter((m) => m !== clean)
  return [...rest, clean].slice(-MAX_MEMORIES)
}
