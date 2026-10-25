/**
 * Server-side identity + input hardening (see SECURITY_HARDENING.md, P0.1/P0.2).
 *
 * - `asId()` coerces untrusted ids to safe strings.
 * - Session tokens are HMAC-signed (httpOnly cookie). Payload carries
 *   `uid`, `tv` (tokenVersion), `scope: "session"`, and activity stamps.
 * - Signature-only checks are sync (middleware / layouts edge cases).
 * - Full auth (`resolveSession`) also checks `token_version` and
 *   `last_active_at` in Mongo so logout invalidates every outstanding token.
 *
 * Node runtime only (uses `node:crypto`). Do not import from Edge middleware
 * that cannot use node:crypto — this project's middleware runs with
 * `runtime: 'nodejs'`.
 */
import type { NextRequest } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import {
  classifyCookie,
  encodeSession,
  idleWindowMs,
  verifySession,
  SESSION_IDLE_SEC,
  type CookieReason,
  type SessionPayload,
} from '@/lib/sessionRules'

export {
  classifyCookie,
  idleWindowMs,
  sessionExpired,
  signSession,
  verifySession,
  ADMIN_IDLE_MS,
  OWNER_IDLE_MS,
  SESSION_IDLE_SEC,
  SESSION_MAX_AGE,
} from '@/lib/sessionRules'
export type { CookieReason, CookieVerdict, SessionPayload } from '@/lib/sessionRules'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
export const SESSION_COOKIE = 'hodari_session'
/** Extend lastSeen at most once per minute. */
const REFRESH_AFTER_MS = 60_000
const TOUCH_THROTTLE_MS = 60_000
/** Happy-path auth meta. A database outage may keep using it for five minutes. */
const AUTH_FRESH_MS = 60_000
const AUTH_STALE_MS = 5 * 60_000

export function asId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  const v = value.trim()
  if (!v || v.length > 200) throw new Error(`Invalid ${field}`)
  return v
}

export function asIdOrNull(value: unknown): string | null {
  try {
    return asId(value)
  } catch {
    return null
  }
}

/**
 * Re-sign with a fresher `last` only after the payload already passed
 * signature checks. Middleware must NOT call this for revoked tokens without
 * a DB check — prefer resolving via `resolveSession` in API routes.
 */
export function refreshSession(token: string | undefined | null): string | null {
  const payload = verifySession(token)
  if (!payload) return null
  const now = Date.now()
  if (now - (payload.last ?? payload.iat) < REFRESH_AFTER_MS) return null
  return encodeSession({ ...payload, last: now, exp: now + idleWindowMs(payload.role) })
}

const lastTouched = new Map<string, number>()

type AuthCacheEntry = {
  uid: string
  email?: string
  tv: number
  role: string | null
  status: string
  cachedAt: number
}

type AuthCache = Map<string, AuthCacheEntry>

function authCache(): AuthCache {
  const g = globalThis as typeof globalThis & { __hodariAuthCache?: AuthCache }
  if (!g.__hodariAuthCache) g.__hodariAuthCache = new Map()
  return g.__hodariAuthCache
}

function cacheKey(payload: SessionPayload): string {
  return payload.sid ?? `${payload.uid}:${payload.tv}:${payload.iat}`
}

/** Drop cached auth for this user (logout, role change, suspension). */
export function invalidateAuthCache(userId: string): void {
  const cache = authCache()
  for (const [key, entry] of cache) {
    if (entry.uid === userId) cache.delete(key)
  }
}

export class SessionUnavailableError extends Error {
  constructor(reason: string) {
    super(`MCP unavailable: ${reason}`)
    this.name = 'SessionUnavailableError'
  }
}

async function loadAuthMeta(userId: string): Promise<{ token_version: number; last_active_at: number | null; role: string | null; status: string } | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { user_id: userId },
      projection: { token_version: 1, last_active_at: 1, user_id: 1, role: 1, status: 1 },
      limit: 1,
    }),
  )
  const doc = docs[0]
  if (!doc) return null
  const tv = typeof doc.token_version === 'number' ? doc.token_version : 0
  let last: number | null = null
  if (typeof doc.last_active_at === 'string') {
    const ms = Date.parse(doc.last_active_at)
    if (Number.isFinite(ms)) last = ms
  }
  return {
    token_version: tv,
    last_active_at: last,
    role: typeof doc.role === 'string' ? doc.role : null,
    status: typeof doc.status === 'string' ? doc.status : 'active',
  }
}

async function touchActive(userId: string, login = false): Promise<void> {
  const now = Date.now()
  if (!login && now - (lastTouched.get(userId) ?? 0) < TOUCH_THROTTLE_MS) return
  lastTouched.set(userId, now)
  const stamp = new Date(now).toISOString()
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: login ? { last_active_at: stamp, last_login_at: stamp } : { last_active_at: stamp } },
  })
}

export type ResolvedSession = {
  uid: string
  email?: string
  tv: number
  role: string | null
  refreshedCookie?: string
}

export type SessionVerdict =
  | { ok: true; session: ResolvedSession }
  | { ok: false; kind: 'auth'; reason: CookieReason }
  | { ok: false; kind: 'infra'; reason: string }

function refreshed(payload: SessionPayload, now: number): string | undefined {
  if (now - (payload.last ?? payload.iat) < REFRESH_AFTER_MS) return undefined
  return encodeSession({ ...payload, last: now, exp: now + idleWindowMs(payload.role) })
}

function fromCache(payload: SessionPayload, entry: AuthCacheEntry, now: number): SessionVerdict {
  return {
    ok: true,
    session: {
      uid: payload.uid,
      email: payload.email ?? entry.email,
      tv: payload.tv,
      role: entry.role ?? payload.role ?? null,
      refreshedCookie: refreshed(payload, now),
    },
  }
}

/**
 * Signature is checked first. A database failure never looks like expiry:
 * a fresh cache is used, then a cache up to five minutes old, otherwise `infra`.
 */
export async function resolveSessionDetailed(raw: string | undefined | null): Promise<SessionVerdict> {
  const cookie = classifyCookie(raw)
  if (!cookie.ok) return { ok: false, kind: 'auth', reason: cookie.reason }
  const payload = cookie.payload
  const now = Date.now()
  const cached = authCache().get(cacheKey(payload))
  if (cached && cached.tv === payload.tv && cached.uid === payload.uid && now - cached.cachedAt < AUTH_FRESH_MS) {
    if (cached.status === 'suspended' || cached.status === 'deleted') {
      return { ok: false, kind: 'auth', reason: 'revoked' }
    }
    void touchActive(payload.uid).catch((err) => console.error('[session] touch', err instanceof Error ? err.message : err))
    return fromCache(payload, cached, now)
  }

  try {
    const meta = await loadAuthMeta(payload.uid)
    if (!meta) return { ok: false, kind: 'auth', reason: 'revoked' }
    if (payload.tv !== meta.token_version) {
      invalidateAuthCache(payload.uid)
      return { ok: false, kind: 'auth', reason: 'revoked' }
    }
    if (meta.status === 'suspended' || meta.status === 'deleted') {
      invalidateAuthCache(payload.uid)
      return { ok: false, kind: 'auth', reason: 'revoked' }
    }
    const role = meta.role ?? payload.role ?? null
    const lastSeen = meta.last_active_at ?? payload.last ?? payload.iat
    if (now - lastSeen > idleWindowMs(role)) return { ok: false, kind: 'auth', reason: 'expired' }
    authCache().set(cacheKey(payload), {
      uid: payload.uid,
      email: payload.email,
      tv: payload.tv,
      role,
      status: meta.status,
      cachedAt: now,
    })
    void touchActive(payload.uid).catch((err) => console.error('[session] touch', err instanceof Error ? err.message : err))
    return {
      ok: true,
      session: {
        uid: payload.uid,
        email: payload.email,
        tv: payload.tv,
        role,
        refreshedCookie: refreshed({ ...payload, role: role ?? payload.role }, now),
      },
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[session] infrastructure ${reason}`)
    if (cached && cached.tv === payload.tv && cached.uid === payload.uid && now - cached.cachedAt < AUTH_STALE_MS) {
      if (cached.status === 'suspended' || cached.status === 'deleted') {
        return { ok: false, kind: 'auth', reason: 'revoked' }
      }
      return fromCache(payload, cached, now)
    }
    return { ok: false, kind: 'infra', reason }
  }
}

export async function resolveSessionToken(raw: string | undefined | null): Promise<ResolvedSession | null> {
  const verdict = await resolveSessionDetailed(raw)
  if (verdict.ok) return verdict.session
  if (verdict.kind === 'infra') throw new SessionUnavailableError(verdict.reason)
  return null
}

export async function resolveSession(req: NextRequest): Promise<ResolvedSession | null> {
  return resolveSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Full auth check. Infrastructure failures throw {@link SessionUnavailableError} instead of looking logged out. */
export async function getSession(req: NextRequest): Promise<{ uid: string; email?: string; role: string | null; refreshedCookie?: string } | null> {
  const verdict = await resolveSessionDetailed(req.cookies.get(SESSION_COOKIE)?.value)
  if (verdict.ok) return verdict.session
  if (verdict.kind === 'infra') throw new SessionUnavailableError(verdict.reason)
  if (verdict.reason !== 'missing') console.info(`[session] logout reason=${verdict.reason}`)
  return null
}

export async function getSessionUser(req: NextRequest): Promise<string | null> {
  return (await getSession(req))?.uid ?? null
}

/** Best-effort row so one browser's session can expire without touching another account. */
export async function rememberSession(token: string): Promise<void> {
  const verdict = classifyCookie(token)
  if (!verdict.ok || !verdict.payload.sid) return
  const payload = verdict.payload
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: 'sessions',
      documents: [{
        session_id: payload.sid,
        user_id: payload.uid,
        role: payload.role ?? 'client',
        expires_at: new Date(payload.exp ?? Date.now() + idleWindowMs(payload.role)).toISOString(),
        last_seen: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }],
    })
  } catch (err) {
    if (!isMcpUnavailable(err)) console.error('[session] remember failed', err instanceof Error ? err.message : err)
  }
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === 'production' || process.env.PUBLIC_BASE_URL?.startsWith('https://') ? true : false,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_IDLE_SEC,
}
