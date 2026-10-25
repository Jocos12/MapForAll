/**
 * Minimal client for the MongoDB MCP HTTP server (localhost:3100 sidecar).
 * One session per process, stored on globalThis so Fast Refresh does not
 * open a second session or forget the current one.
 */
import { logSpan } from '@/lib/devTiming'

const MCP_URL = process.env.MONGODB_MCP_URL ?? 'http://localhost:3100/mcp'
const CALL_TIMEOUT_MS = 3_000
const BREAKER_THRESHOLD = 2
const BREAKER_OPEN_MS = 15_000
const PING_MS = 45_000

type McpState = {
  session: Promise<string> | null
  sid: string | null
  rpcSeq: number
  breakerFailures: number
  breakerUntil: number
  ping: ReturnType<typeof setInterval> | null
  health: 'idle' | 'ok' | 'failed'
}

function state(): McpState {
  const g = globalThis as typeof globalThis & { __mcpState?: McpState }
  if (!g.__mcpState) {
    g.__mcpState = {
      session: null,
      sid: null,
      rpcSeq: 0,
      breakerFailures: 0,
      breakerUntil: 0,
      ping: null,
      health: 'idle',
    }
  }
  return g.__mcpState
}

export class McpSessionError extends Error {
  constructor(detail: string) {
    super(`MCP session invalid (${detail})`)
    this.name = 'McpSessionError'
  }
}

function isTransientMcp(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /timeout|aborted|AbortError|ECONNREFUSED|fetch failed|ECONNRESET|ENOTFOUND|circuit open|session invalid/i.test(message)
}

function isSessionErr(err: unknown): boolean {
  return err instanceof McpSessionError || /session invalid|session not found|no valid session/i.test(err instanceof Error ? err.message : String(err))
}

function assertBreaker(): void {
  if (Date.now() < state().breakerUntil) throw new Error('MCP circuit open')
}

function noteMcpFailure(err: unknown): void {
  const s = state()
  if (Date.now() < s.breakerUntil) return
  if (!isTransientMcp(err)) return
  s.breakerFailures += 1
  if (s.breakerFailures >= BREAKER_THRESHOLD) {
    s.breakerUntil = Date.now() + BREAKER_OPEN_MS
    console.error(`[mcp] circuit open for ${BREAKER_OPEN_MS}ms after ${s.breakerFailures} failures`)
  }
}

function noteMcpSuccess(): void {
  const s = state()
  s.breakerFailures = 0
  s.breakerUntil = 0
}

/** True when a failure is the MongoDB MCP sidecar being down or refusing the call. */
export function isMcpUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
  return /ECONNREFUSED|fetch failed|MCP|session ID|session invalid|ENOTFOUND|ECONNRESET|circuit open|timed out|TimeoutError|aborted/i.test(`${message} ${cause}`)
}

function isSessionError(status: number, text: string): boolean {
  if (status === 404 || status === 400) return true
  return /session/i.test(text) && /(not found|unknown|invalid|expired|no valid)/i.test(text)
}

/** Drop the cached session. The next call opens one new session. */
export function resetMcpSession(reason = 'reset'): void {
  const s = state()
  if (s.sid || s.session) console.info(`[mcp] session recreated (${reason})`)
  s.session = null
  s.sid = null
}

function startPing(): void {
  const s = state()
  if (s.ping) return
  s.ping = setInterval(() => { void pingSession() }, PING_MS)
  s.ping.unref?.()
}

async function pingSession(): Promise<void> {
  const s = state()
  if (!s.sid || Date.now() < s.breakerUntil) return
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': s.sid,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: `p${++s.rpcSeq}`, method: 'ping' }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const text = await res.text().catch(() => '')
    if (isSessionError(res.status, text)) resetMcpSession(`ping ${res.status}`)
  } catch (err) {
    console.error('[mcp] ping failed', err instanceof Error ? err.message : err)
  }
}

async function mcpSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hodari-client', version: '1.0' } },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  await res.text().catch(() => '')
  const sid = res.headers.get('mcp-session-id')
  if (!res.ok || !sid) throw new Error(sid ? `MCP initialize failed (${res.status})` : 'MCP did not return a session ID')
  return sid
}

function mcpFailureDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const bits = [err.message]
  const cause = err.cause
  if (cause instanceof Error) bits.push(cause.message)
  for (const source of [err, cause]) {
    if (!source || typeof source !== 'object' || !('data' in source)) continue
    const data = (source as { data?: unknown }).data
    if (typeof data === 'string' && data) bits.push(data)
  }
  return bits.join(' | ')
}

async function mcpCallOnce(sid: string, name: string, args: Record<string, unknown>): Promise<string[]> {
  const s = state()
  let res: Response
  let body: string
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: `c${++s.rpcSeq}`, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    body = await res.text()
  } catch (err) {
    const detail = mcpFailureDetail(err)
    if (/session not found|session invalid|no valid session/i.test(detail)) throw new McpSessionError(detail)
    throw new Error(`MCP ${name} failed: ${detail}`)
  }
  if (!res.ok && isSessionError(res.status, body)) throw new McpSessionError(String(res.status))
  const payloads = body.includes('data:')
    ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [body]
  for (const payload of payloads) {
    let msg: { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } }
    try {
      msg = JSON.parse(payload)
    } catch {
      continue
    }
    if (msg.error) {
      if (isSessionError(res.status, msg.error.message ?? '')) throw new McpSessionError(msg.error.message ?? String(res.status))
      throw new Error(msg.error.message ?? 'MCP tool error')
    }
    if (msg.result?.content) {
      const texts = msg.result.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string)
      if (msg.result.isError) throw new Error(texts.join(' ') || 'MongoDB MCP returned an error')
      return texts
    }
  }
  return []
}

async function handshake(): Promise<string> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  state().sid = sid
  startPing()
  if (state().health !== 'ok') {
    state().health = 'ok'
    console.info('[mcp] health OK')
  }
  return sid
}

/** A cached, connected MCP session id. One initialize per process, shared by a mutex. */
export function mcpConnected(): Promise<string> {
  const s = state()
  if (s.sid && s.session) return s.session
  if (!s.session) {
    s.session = handshake().catch((err) => {
      s.session = null
      s.sid = null
      if (s.health !== 'failed') {
        s.health = 'failed'
        console.error('[mcp] health FAILED', err instanceof Error ? err.message : err)
      }
      throw err
    })
  }
  return s.session
}

/**
 * Call an MCP tool. A stale session is dropped and the call is retried once.
 * A timeout is retried once. Neither path loops.
 */
export async function mcpCall(sid: string, name: string, args: Record<string, unknown>, replay = true): Promise<string[]> {
  assertBreaker()
  const started = Date.now()
  const run = (id: string) => mcpCallOnce(id, name, args)
  try {
    try {
      const out = await run(sid)
      noteMcpSuccess()
      logSpan('mcp', name, Date.now() - started)
      return out
    } catch (err) {
      if (!replay) throw err
      if (isSessionErr(err)) {
        resetMcpSession(err instanceof Error ? err.message : 'session invalid')
        const fresh = await mcpConnected()
        const out = await run(fresh)
        noteMcpSuccess()
        logSpan('mcp', `${name} retry`, Date.now() - started)
        return out
      }
      if (!isTransientMcp(err)) throw err
      const out = await run(sid)
      noteMcpSuccess()
      logSpan('mcp', `${name} retry`, Date.now() - started)
      return out
    }
  } catch (err) {
    noteMcpFailure(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[mcp] ${name} failed: ${message}`)
    logSpan('mcp', `${name} error`, Date.now() - started)
    throw err
  }
}

export async function ensureConnected(sid: string): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) return
  try {
    await mcpCallOnce(sid, 'connect', { connectionString: uri })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/already connected|already been connected/i.test(message)) return
    console.error('[mcp] connect failed', message)
    throw err
  }
}

/** Extract a document array from MCP text items (raw JSON or untrusted-data wrapped). */
export function extractDocs(texts: string[]): Array<Record<string, unknown>> {
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed)) return parsed
    } catch { /* not raw JSON */ }
    const blocks = t.match(/<untrusted-user-data-[^>]+>([\s\S]*?)<\/untrusted-user-data-[^>]+>/g) ?? []
    for (const block of blocks) {
      const inner = block.replace(/<untrusted-user-data-[^>]+>/, '').replace(/<\/untrusted-user-data-[^>]+>/, '').trim()
      try {
        const parsed = JSON.parse(inner)
        if (Array.isArray(parsed)) return parsed
      } catch { /* skip */ }
    }
  }
  return []
}
