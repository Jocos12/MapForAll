/**
 * Minimal client for the MongoDB MCP HTTP server (localhost:3100 sidecar).
 * Shared by the auth routes. Mirrors the parsing the agent side does: results
 * come back either as `structuredContent` or as text wrapped in
 * <untrusted-user-data-…> security tags, and tool failures surface via
 * `result.isError` rather than a JSON-RPC error.
 */
const MCP_URL = process.env.MONGODB_MCP_URL ?? 'http://localhost:3100/mcp'

/** True when a failure is the MongoDB MCP sidecar being down or refusing the call. */
export function isMcpUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
  return /ECONNREFUSED|fetch failed|MCP|session ID|ENOTFOUND|ECONNRESET/i.test(`${message} ${cause}`)
}

// ── Cached, connected session ────────────────────────────────────────────────
// Opening a session is expensive: `initialize` + `connect` are two round trips
// that (re)authenticate to Atlas. Doing that on every read made community
// search / profile loads take seconds. We open ONE session per server process
// and reuse it. The sidecar keeps session state in memory for its lifetime, and
// it lives/dies with this process (co-located Cloud Run sidecar / local dev), so
// the id stays valid until a restart — at which point the cache clears anyway.
// Every session the sidecar opens holds its own Atlas connection pool and is
// never released, so routes must not open throwaway sessions per request.
let connectedSession: Promise<string> | null = null
let connectedSid: string | null = null

/** A cached, connected MCP session id, reused across calls. Opens once. */
export function mcpConnected(): Promise<string> {
  if (!connectedSession) {
    connectedSession = (async () => {
      const sid = await mcpSession()
      await ensureConnected(sid)
      connectedSid = sid
      return sid
    })().catch((err) => {
      connectedSession = null // let the next call retry a fresh handshake
      throw err
    })
  }
  return connectedSession
}

/** Drop the cached session so the next `mcpConnected()` re-handshakes. */
export function resetMcpSession(): void {
  connectedSession = null
  connectedSid = null
}

/** Forget `sid` only if it is still the cached one, so a stale caller cannot evict a fresh session. */
function dropSession(sid: string): void {
  if (connectedSid === sid) resetMcpSession()
}

/** Whether an MCP failure looks like a stale/unknown session (needs re-open). */
function isSessionError(status: number, text: string): boolean {
  if (status === 404 || status === 400) return true
  return /session/i.test(text) && /(not found|unknown|invalid|expired|no valid)/i.test(text)
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
    signal: AbortSignal.timeout(10_000),
  })
  // Drain the SSE body: a half-read response left on a keep-alive socket
  // corrupts the next request that reuses it (HPE_INVALID_CHUNK_SIZE).
  await res.text().catch(() => '')
  const sid = res.headers.get('mcp-session-id')
  if (!sid) throw new Error('MCP did not return a session ID')
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

// The sidecar routes each response by JSON-RPC id within a session; concurrent
// calls sharing one id collide and hang until the timeout.
let rpcSeq = 0

/**
 * Call an MCP tool. A stale session (sidecar restarted under a cached id) is
 * re-handshaked and the call replayed once, so a restart costs one round trip
 * instead of a failed request.
 */
export async function mcpCall(sid: string, name: string, args: Record<string, unknown>, replay = true): Promise<string[]> {
  const staleSession = async (detail: string): Promise<string[]> => {
    dropSession(sid)
    if (replay) {
      const fresh = await mcpConnected()
      if (fresh !== sid) return mcpCall(fresh, name, args, false)
    }
    throw new Error(`MCP session invalid (${detail}); retry`)
  }
  let res: Response
  let body: string
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: `c${++rpcSeq}`, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(20_000),
    })
    body = await res.text()
  } catch (err) {
    const detail = mcpFailureDetail(err)
    if (/session not found|session invalid|no valid session/i.test(detail)) return staleSession(detail)
    throw new Error(`MCP ${name} failed: ${detail}`)
  }
  if (!res.ok && isSessionError(res.status, body)) return staleSession(String(res.status))
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
      if (isSessionError(res.status, msg.error.message ?? '')) return staleSession(msg.error.message ?? String(res.status))
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

export async function ensureConnected(sid: string): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) return
  try {
    await mcpCall(sid, 'connect', { connectionString: uri }, false)
  } catch {
    /* already connected — ignore */
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
