/**
 * Text-model fallback used only when the Gemini agent (ADK) is out of quota
 * or unreachable. The live map agent stays the primary path. These adapters
 * share one method so the chat route can walk Gemini → Groq → Claude → OpenAI
 * without the user seeing a provider switch.
 *
 * A provider with no API key is skipped. Keys stay in server env:
 *   GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 */

import { detectMessageLang, replyLangLabel, type ReplyLang } from '@/lib/detectLang'

export type ProviderName = 'gemini' | 'groq' | 'claude' | 'openai'
export type { ReplyLang }

export interface GenerateInput {
  message: string
  system?: string
}

export class ProviderError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'ProviderError'
    this.retryable = retryable
  }
}

const DEFAULT_SYSTEM = [
  'You are MapForAll, a guide for visitors in Kigali.',
  'Reply in two or three short sentences.',
  'You cannot attach photos, draw a route, or move the map.',
  'Never say a photo, a line, or a marker is visible on screen.',
  'If you do not know a fact, say so.',
].join(' ')

/** Highest-priority language rule — prepended to every system prompt. */
export function languageSystemDirective(lang: ReplyLang): string {
  const label = replyLangLabel(lang)
  return [
    `CRITICAL LANGUAGE RULE: Reply entirely in ${label}.`,
    'Always reply in the same language as the user\'s latest message (French, English, or Kinyarwanda).',
    'Do not mix languages in one reply unless the user mixed them.',
    lang === 'rw'
      ? 'Kinyarwanda quality varies by model; keep place names unchanged and write clear, simple Kinyarwanda.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function withLanguage(system: string | undefined, lang: ReplyLang): string {
  return [languageSystemDirective(lang), system?.trim() || DEFAULT_SYSTEM].join('\n\n')
}

function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

async function readError(res: Response): Promise<string> {
  return (await res.text().catch(() => '')).slice(0, 300)
}

function httpError(status: number, body: string): ProviderError {
  const retryable = status === 429 || status >= 500 || /quota|resource_exhausted|overloaded|rate limit|unavailable/i.test(body)
  return new ProviderError(body || `HTTP ${status}`, retryable)
}

async function chatCompletions(url: string, key: string, model: string, message: string, system: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
    }),
  })
  if (!res.ok) throw httpError(res.status, await readError(res))
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new ProviderError('Empty completion', true)
  return text
}

export const geminiProvider = {
  name: 'gemini' as const,
  configured: () => configured('GEMINI_API_KEY'),
  async generate({ message, system = DEFAULT_SYSTEM }: GenerateInput): Promise<string> {
    const key = process.env.GEMINI_API_KEY?.trim() ?? ''
    const model = process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-2.0-flash'
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: message }] }],
        }),
      },
    )
    if (!res.ok) throw httpError(res.status, await readError(res))
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) throw new ProviderError('Empty Gemini completion', true)
    return text
  },
}

export const groqProvider = {
  name: 'groq' as const,
  configured: () => configured('GROQ_API_KEY'),
  generate({ message, system = DEFAULT_SYSTEM }: GenerateInput): Promise<string> {
    return chatCompletions(
      'https://api.groq.com/openai/v1/chat/completions',
      process.env.GROQ_API_KEY?.trim() ?? '',
      process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
      message,
      system,
    )
  },
}

export const claudeProvider = {
  name: 'claude' as const,
  configured: () => configured('ANTHROPIC_API_KEY'),
  async generate({ message, system = DEFAULT_SYSTEM }: GenerateInput): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY?.trim() ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    })
    if (!res.ok) throw httpError(res.status, await readError(res))
    const data = await res.json() as { content?: Array<{ text?: string }> }
    const text = data.content?.map((p) => p.text ?? '').join('').trim()
    if (!text) throw new ProviderError('Empty Claude completion', true)
    return text
  },
}

export const openaiProvider = {
  name: 'openai' as const,
  configured: () => configured('OPENAI_API_KEY'),
  generate({ message, system = DEFAULT_SYSTEM }: GenerateInput): Promise<string> {
    return chatCompletions(
      'https://api.openai.com/v1/chat/completions',
      process.env.OPENAI_API_KEY?.trim() ?? '',
      process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
      message,
      system,
    )
  },
}

/** Prefer Groq → Claude → OpenAI → Gemini for admin tools and chat fallback. */
const FAILOVER_CHAIN = [groqProvider, claudeProvider, openaiProvider, geminiProvider]

export async function generateWithFailover(
  message: string,
  system?: string,
  lang?: ReplyLang,
): Promise<{ text: string; provider: ProviderName } | null> {
  const replyLang = lang ?? detectMessageLang(message)
  if (replyLang === 'rw') {
    console.info('[ai] Kinyarwanda reply requested — cascade quality may vary by provider (Groq/Claude usually stronger than Gemini Flash).')
  }
  const fullSystem = withLanguage(system, replyLang)
  for (const provider of FAILOVER_CHAIN) {
    if (!provider.configured()) continue
    try {
      const text = await provider.generate({ message, system: fullSystem })
      return { text, provider: provider.name }
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.retryable : true
      console.error(`[ai] ${provider.name} failed (${retryable ? 'retryable' : 'fatal'})`)
      if (!retryable) throw err
    }
  }
  return null
}

/** After the Gemini agent fails, walk Groq → Claude → OpenAI → direct Gemini. */
export async function failoverAfterGemini(
  message: string,
  lang?: ReplyLang,
): Promise<{ text: string; provider: ProviderName } | null> {
  return generateWithFailover(message, undefined, lang ?? detectMessageLang(message))
}

export function adkFailureIsRetryable(status: number, detail: string): boolean {
  return status === 429 || status >= 500 || /quota|resource_exhausted|overloaded|rate limit|unavailable/i.test(detail)
}
