import { NextRequest } from 'next/server'
import { asId, getSession } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { consume, refund, isUnlimited, unlimitedEntitlement, type Identity } from '@/lib/billing'
import { adkAuthHeaders } from '@/lib/gcpAuth'
import { failoverAfterGemini, adkFailureIsRetryable } from '@/lib/ai/providers'

// Full pipeline (Planner → Explorer → Itinerary) can exceed 2 minutes locally.
export const maxDuration = 300
export const runtime = 'nodejs'

const ADK_BASE = process.env.ADK_BASE_URL ?? 'http://localhost:8000'
const APP_NAME = process.env.ADK_APP_NAME ?? 'hodari'
const MAX_USER_TURNS = 8
const REPLY_CACHE_TTL_MS = 30 * 60_000

type AdkEvent = {
  author?: string
  content?: { role?: string; parts?: Array<{ text?: string; functionCall?: unknown; function_call?: unknown }> }
}

const replyCache = new Map<string, { at: number; body: Uint8Array }>()

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 280)
}

function skipReplyCache(message: string): boolean {
  return /\b(itin[eé]raire|comment aller|trajet|directions|route to|walking route|drive to)\b/i.test(message)
}

function eventText(event: AdkEvent): string {
  return (event.content?.parts ?? []).map((part) => part.text ?? '').join('').trim()
}

function isTextEvent(event: AdkEvent): boolean {
  const parts = event.content?.parts ?? []
  if (parts.some((part) => part.functionCall || part.function_call)) return false
  return eventText(event).length > 0
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Keep the last 8 user turns. Older turns become one short note, not a second model call. */
async function trimAdkHistory(userId: string, sessionId: string, headers: HeadersInit) {
  const sessionUrl = `${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`
  const res = await fetch(sessionUrl, { headers, signal: AbortSignal.timeout(2000) }).catch(() => null)
  if (!res?.ok) return
  const session = await res.json().catch(() => null) as { state?: Record<string, unknown>; events?: AdkEvent[] } | null
  const events = session?.events ?? []
  const textual = events.filter(isTextEvent)
  const userTurns = textual.filter((event) => event.author === 'user')
  if (userTurns.length <= MAX_USER_TURNS) return

  const keep = userTurns[userTurns.length - MAX_USER_TURNS]
  const keepFrom = textual.indexOf(keep)
  const older = textual
    .slice(0, keepFrom)
    .filter((event) => event.author === 'user')
    .slice(-12)
    .map((event) => eventText(event).slice(0, 140))
  const recent = textual.slice(keepFrom).slice(-16).map((event, index) => {
    const user = event.author === 'user'
    return {
      invocation_id: `trim-recent-${index}`,
      author: user ? 'user' : 'model',
      content: {
        role: user ? 'user' : 'model',
        parts: [{ text: eventText(event).slice(0, 1200) }],
      },
    }
  })
  const seeded = [
    {
      invocation_id: 'trim-summary-user',
      author: 'user',
      content: {
        role: 'user',
        parts: [{ text: `Compressed earlier turns: ${older.join(' · ')}` }],
      },
    },
    {
      invocation_id: 'trim-summary-model',
      author: 'model',
      content: {
        role: 'model',
        parts: [{ text: 'Noted. I will use that background and focus on the latest request.' }],
      },
    },
    ...recent,
  ]

  await fetch(sessionUrl, { method: 'DELETE', headers }).catch(() => null)
  await fetch(`${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session_id: sessionId, state: session?.state ?? {}, events: seeded }),
  }).catch(() => null)
}

export async function POST(req: NextRequest) {
  // Chat runs the agent pipeline (Gemini + Maps tokens) — throttle per IP so a
  // single client can't drive runaway cost.
  const rl = rateLimit(`chat:${clientIp(req)}`, { capacity: 12, refillPerSec: 0.2 })
  if (!rl.allowed) {
    return new Response('Too many requests. Please slow down.', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = await req.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message : ''

  // Identity is resolved first so a repeated question can be served from the
  // process cache without another agent run. The key includes the user id.
  const sessionEarly = getSession(req)
  let cacheUser = ''
  try {
    cacheUser = sessionEarly?.uid ?? asId(body.userId, 'userId')
  } catch {
    cacheUser = ''
  }
  const cacheKey = cacheUser ? `${cacheUser}::${normalizeMessage(message)}` : ''
  const cached = cacheKey ? replyCache.get(cacheKey) : undefined
  if (cached && Date.now() - cached.at < REPLY_CACHE_TTL_MS && !skipReplyCache(message)) {
    return new Response(Buffer.from(cached.body), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Hodari-Cache': 'hit',
      },
    })
  }

  // Identity is server-authoritative: a signed-in member from the session
  // cookie, otherwise an anonymous guest keyed by IP. The body userId is only a
  // session-scoping fallback for the ADK run; it never grants entitlement.
  const session = getSession(req)
  let userId: string
  let sessionId: string
  try {
    userId = session?.uid ?? asId(body.userId, 'userId')
    sessionId = asId(body.sessionId, 'sessionId')
  } catch {
    return new Response('Missing or invalid userId/sessionId', { status: 400 })
  }

  const identity: Identity = session
    ? { kind: 'user', userId: session.uid }
    : { kind: 'guest', key: `guest:${clientIp(req)}` }

  // ── Metering: spend one generation (or refuse with a gate) ────────────────
  // Owner/staff allowlist bypasses metering entirely.
  const owner = isUnlimited(session?.email)
  const spend = owner
    ? { ok: true as const, usedCredit: false, entitlement: unlimitedEntitlement() }
    : await consume(identity)
  if (!spend.ok) {
    const status = spend.gate === 'login' ? 401 : 402
    return new Response(
      JSON.stringify({
        error:
          spend.gate === 'login'
            ? 'You’ve used your free previews. Sign in to keep exploring.'
            : 'You’re out of generations. Add credits to continue.',
        gate: spend.gate,
        entitlement: spend.entitlement,
      }),
      { status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const adkHeaders = await adkAuthHeaders({ 'Content-Type': 'application/json' })

  await trimAdkHistory(userId, sessionId, adkHeaders)

  // Ensure the session exists before running.
  await fetch(
    `${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'POST', headers: adkHeaders, body: '{}' },
  ).catch(() => {/* session may already exist */})

  const adkRes = await fetch(`${ADK_BASE}/run_sse`, {
    method: 'POST',
    headers: adkHeaders,
    // Propagate client aborts (Stop button) so the upstream agent run is cancelled too.
    signal: req.signal,
    body: JSON.stringify({
      app_name: APP_NAME,
      user_id: userId,
      session_id: sessionId,
      new_message: { role: 'user', parts: [{ text: message }] },
      streaming: true,
    }),
  }).catch(() => null)

  if (!adkRes || !adkRes.ok || !adkRes.body) {
    const detail = !adkRes
      ? 'no response from agent'
      : adkRes.ok
        ? 'no stream body from agent'
        : (await adkRes.text().catch(() => '')).slice(0, 300)
    const status = adkRes?.status ?? 0
    if (adkFailureIsRetryable(status, detail)) {
      try {
        const fallback = await failoverAfterGemini(message)
        if (fallback) {
          console.error(`[ai] Gemini agent unavailable (${status}); answered with ${fallback.provider}`)
          const payload = JSON.stringify({
            author: 'hodari',
            content: { parts: [{ text: fallback.text }] },
          })
          return new Response(`data: ${payload}\n\n`, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              'X-Accel-Buffering': 'no',
              'X-Hodari-Provider': fallback.provider,
              'X-Hodari-Free-Remaining': String(spend.entitlement.freeRemaining),
              'X-Hodari-Credits': String(spend.entitlement.credits),
            },
          })
        }
      } catch (err) {
        console.error('[ai] fallback failed', err)
      }
    }
    // The run never started — give the generation back (unless we failed open
    // or this is an owner who never spent one).
    if (!owner && !spend.degraded) await refund(identity, spend.usedCredit)
    return new Response(
      `Agent unreachable (${status}${detail ? `: ${detail}` : ''})`,
      { status: 502 },
    )
  }

  const [clientBody, cacheBody] = adkRes.body.tee()
  if (cacheKey && !skipReplyCache(message)) {
    void (async () => {
      const reader = cacheBody.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > 400_000) return
        chunks.push(value)
      }
      const bodyBytes = concatBytes(chunks)
      const text = new TextDecoder().decode(bodyBytes)
      if (!text.includes('"text"')) return
      if (/Je n'ai pas pu|couldn't draw|quota|réessayer|try again|unavailable/i.test(text)) return
      replyCache.set(cacheKey, { at: Date.now(), body: bodyBytes })
      if (replyCache.size > 40) {
        const oldest = replyCache.keys().next().value
        if (oldest) replyCache.delete(oldest)
      }
    })()
  } else {
    void cacheBody.cancel().catch(() => undefined)
  }

  return new Response(clientBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      // Let the client update its quota pill without a refetch.
      'X-Hodari-Free-Remaining': String(spend.entitlement.freeRemaining),
      'X-Hodari-Credits': String(spend.entitlement.credits),
    },
  })
}
