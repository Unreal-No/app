import { describe, expect, it } from 'vitest'
import {
  addMemory,
  bubbleText,
  buildPersona,
  chatTools,
  createCompanion,
  DEFAULT_CHAT_SETTINGS,
  historyMessages,
  MAX_MEMORIES,
  readClaudeReply,
  repairCompanion,
  type ChatTurn,
} from '../src'

const NOW = new Date(2026, 10, 17, 14, 5).getTime()

describe('บุคลิกของสัตว์', () => {
  const base = {
    name: 'โมจิ',
    species: 'แมว×มังกร',
    mood: 'สบายใจ',
    traits: ['ขี้อ้อน', 'ขี้เล่น'],
    wants: ['หิว'],
    memories: [],
    now: NOW,
    tools: true,
  }

  it('มีชื่อ สายพันธุ์ นิสัย อารมณ์ เวลา และวิธีพูดตามวัย', () => {
    const baby = buildPersona({ ...base, stage: 'baby' })
    expect(baby).toContain('"โมจิ"')
    expect(baby).toContain('แมว×มังกร')
    expect(baby).toContain('ขี้อ้อน, ขี้เล่น')
    expect(baby).toContain('สบายใจ (อยากได้: หิว)')
    expect(baby).toContain('วันอังคาร 14:05')
    expect(baby).toContain('อ้อแอ้')
    expect(buildPersona({ ...base, stage: 'adult' })).toContain('โตเต็มวัย')
    expect(buildPersona({ ...base, stage: 'egg' })).toContain('อ้อแอ้')
  })

  it('บอกให้ใช้เครื่องมือเฉพาะเมื่อมี และใส่สิ่งที่จำได้', () => {
    expect(buildPersona({ ...base, stage: 'child' })).toContain('ใช้เครื่องมือ')
    expect(buildPersona({ ...base, stage: 'child', tools: false })).not.toContain('ใช้เครื่องมือ')
    const withMemory = buildPersona({ ...base, stage: 'teen', memories: ['ผู้ใช้ชอบชาเย็น'] })
    expect(withMemory).toContain('- ผู้ใช้ชอบชาเย็น')
  })
})

describe('เครื่องมือและข้อความ', () => {
  it('เครื่องมือทุกตัวเป็น strict และมี schema ครบ', () => {
    const tools = chatTools() as {
      name: string
      strict: boolean
      input_schema: { additionalProperties: boolean; required: string[]; properties: object }
    }[]
    expect(tools.map((t) => t.name)).toEqual([
      'add_reminder',
      'add_todo',
      'list_schedule',
      'start_focus',
      'remember',
    ])
    for (const t of tools) {
      expect(t.strict).toBe(true)
      expect(t.input_schema.additionalProperties).toBe(false)
      expect(t.input_schema.required.every((r) => r in t.input_schema.properties)).toBe(true)
    }
  })

  it('ประวัติส่งเฉพาะข้อความล้วน ขึ้นต้นด้วยผู้ใช้ และจำกัดจำนวน', () => {
    const turns: ChatTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'pet',
      text: `ข้อความ ${i}`,
      at: i,
    }))
    const messages = historyMessages(turns, 'สวัสดี', 5)
    expect(messages[0]!.role).toBe('user')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'สวัสดี' })
    expect(messages.length).toBeLessThanOrEqual(6)
    expect(messages.every((m) => typeof m.content === 'string')).toBe(true)
    expect(historyMessages([], 'หวัดดี')).toEqual([{ role: 'user', content: 'หวัดดี' }])
  })

  it('อ่านคำตอบ: ข้อความ การเรียกเครื่องมือ และเหตุที่หยุด (ข้าม thinking)', () => {
    const reply = readClaudeReply({
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text: 'เดี๋ยวจดให้นะ' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'add_reminder',
          input: { when_and_what: 'พรุ่งนี้ 9 โมง ส่งงาน' },
        },
      ],
    })
    expect(reply).toEqual({
      text: 'เดี๋ยวจดให้นะ',
      stopReason: 'tool_use',
      toolCalls: [
        { id: 'toolu_1', name: 'add_reminder', input: { when_and_what: 'พรุ่งนี้ 9 โมง ส่งงาน' } },
      ],
    })
    expect(readClaudeReply({ stop_reason: 'refusal', content: [] })).toEqual({
      text: '',
      toolCalls: [],
      stopReason: 'refusal',
    })
    expect(readClaudeReply(null).stopReason).toBe('unknown')
  })

  it('ข้อความในฟองคำพูด: ตัด markdown และความยาว', () => {
    expect(bubbleText('**สวัสดี**  `ค่ะ`\n\nวันนี้')).toBe('สวัสดี ค่ะ วันนี้')
    expect(bubbleText('ก'.repeat(300), 10)).toHaveLength(10)
  })

  it('สิ่งที่จำได้ไม่ซ้ำและไม่เกินจำนวน', () => {
    let memories: string[] = []
    for (let i = 0; i < MAX_MEMORIES + 5; i++) memories = addMemory(memories, `เรื่อง ${i}`)
    expect(memories).toHaveLength(MAX_MEMORIES)
    expect(memories.at(-1)).toBe(`เรื่อง ${MAX_MEMORIES + 4}`)
    expect(addMemory(['ก', 'ข'], ' ก ')).toEqual(['ข', 'ก'])
    expect(addMemory(['ก'], '   ')).toEqual(['ก'])
  })
})

describe('ข้อมูลแชตในเซฟ', () => {
  it('ค่าเริ่มต้นปิด AI และซ่อมค่าที่ไม่ถูกต้อง', () => {
    expect(createCompanion(NOW).chat).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(DEFAULT_CHAT_SETTINGS.provider).toBe('off')
    const c = repairCompanion(
      {
        chat: {
          provider: 'openai',
          consent: 'yes',
          model: 'gpt-9',
          ollamaUrl: 'http://192.168.1.5:11434',
          ollamaModel: 'qwen',
        },
        chatHistory: {
          p1: [
            { role: 'user', text: 'หวัดดี', at: 1 },
            { role: 'robot', text: 'x' },
            { role: 'pet', text: '' },
          ],
        },
        memories: { p1: ['ชอบแมว', 42, ''] },
      },
      NOW,
    )
    expect(c.chat).toEqual({ ...DEFAULT_CHAT_SETTINGS, ollamaModel: 'qwen' })
    expect(c.chatHistory).toEqual({ p1: [{ role: 'user', text: 'หวัดดี', at: 1 }] })
    expect(c.memories).toEqual({ p1: ['ชอบแมว'] })
    const ok = repairCompanion(
      {
        chat: {
          provider: 'anthropic',
          consent: true,
          model: 'claude-haiku-5-5',
          ollamaUrl: 'http://127.0.0.1:11500',
        },
      },
      NOW,
    )
    expect(ok.chat).toMatchObject({
      provider: 'anthropic',
      consent: true,
      model: 'claude-haiku-5-5',
      ollamaUrl: 'http://127.0.0.1:11500',
    })
  })
})
