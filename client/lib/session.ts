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
import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

const SECRET = process.env.HODARI_SESSION_SECRET ?? ''
const DB = process.env.MONGODB_DATABASE ?? 'hodari'
export const SESSION_COOKIE = 'hodari_session'
/** Absolute lifetime: even an active session must sign in again after this. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, seconds
/** Inactivity window from last_active_at / cookie `last`. */
export const SESSION_IDLE_SEC = 60 * 60 * 24 * (
  Number(process.env.HODARI_SESSION_IDLE_DAYS) > 0
    ? Number(process.env.HODARI_SESSION_IDLE_DAYS)
    : (Number(process.env.SESSION_INACTIVITY_DAYS) > 0 ? Number(process.env.SESSION_INACTIVITY_DAYS) : 7)
)
/** Cookie `last` is re-signed at most this often after a DB-validated request. */
const REFRESH_AFTER_MS = 5 * 60 * 1000
/** Persist last_active_at at most once per minute per user. */
const TOUCH_THROTTLE_MS = 60_000

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

export interface SessionPayload {
  uid: string
  email?: string
  /** token_version at issue time — must match the user document. */
  tv: number
  /** Only "session" tokens grant access; password step never issues one. */
  scope: 'session'
  iat: number
  /** Last authenticated activity (ms). */
  last?: number
}

function encode(payload: SessionPayload): string {
  if (!SECRET) throw new Error('HODARI_SESSION_SECRET is not configured')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function signSession(uid: string, email: string | undefined, tokenVersion: number): string {
  const now = Date.now()
  return encode({
    uid,
    email,
    tv: Number.isFinite(tokenVersion) ? tokenVersion : 0,
    scope: 'session',
    iat: now,
    last: now,
  })
}

/**
 * Signature + shape + absolute/idle age from the cookie alone.
 * Does NOT check token_version in the database — use `resolveSession` for that.
 */
export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || !SECRET) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload> & {
      // Legacy cookies issued before tv/scope existed.
      tv?: number
      scope?: string
    }
    if (!payload.uid || typeof payload.uid !== 'string') return null
    // Accept legacy tokens (no scope) as session with tv=0 so existing users
    // are not locked out until their next sign-in; logout still bumps tv.
    const scope = payload.scope === 'session' || payload.scope === undefined ? 'session' : null
    if (scope !== 'session') return null
    const now = Date.now()
    if (typeof payload.iat !== 'number' || now - payload.iat > SESSION_MAX_AGE * 1000) return null
    const last = typeof payload.last === 'number' ? payload.last : payload.iat
    if (now - last > SESSION_IDLE_SEC * 1000) return null
    return {
      uid: payload.uid,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      tv: typeof payload.tv === 'number' ? payload.tv : 0,
      scope: 'session',
      iat: payload.iat,
      last,
    }
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
  return encode({ ...payload, last: now })
}

const lastTouched = new Map<string, number>()

async function loadAuthMeta(userId: string): Promise<{ token_version: number; last_active_at: number | null } | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { user_id: userId },
      projection: { token_version: 1, last_active_at: 1, user_id: 1 },
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
  return { token_version: tv, last_active_at: last }
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

export type ResolvedSession = { uid: string; email?: string; tv: number; refreshedCookie?: string }

/**
 * Full session check for API routes and /api/auth/me:
 * signature + scope + token_version + inactivity (cookie and DB).
 */
export async function resolveSessionToken(raw: string | undefined | null): Promise<ResolvedSession | null> {
  const payload = verifySession(raw)
  if (!payload) return null

  let meta: { token_version: number; last_active_at: number | null } | null
  try {
    meta = await loadAuthMeta(payload.uid)
  } catch (err) {
    console.error('[session] loadAuthMeta failed', err)
    return null
  }
  if (!meta) return null
  if (payload.tv !== meta.token_version) return null

  const now = Date.now()
  if (meta.last_active_at != null && now - meta.last_active_at > SESSION_IDLE_SEC * 1000) return null

  void touchActive(payload.uid).catch((err) => console.error('[session] touch', err))

  let refreshedCookie: string | undefined
  if (now - (payload.last ?? payload.iat) >= REFRESH_AFTER_MS) {
    refreshedCookie = encode({ ...payload, last: now }) ?? undefined
  }

  return { uid: payload.uid, email: payload.email, tv: payload.tv, refreshedCookie }
}

export async function resolveSession(req: NextRequest): Promise<ResolvedSession | null> {
  return resolveSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Full auth check (signature + token_version + idle). Use on every protected API. */
export async function getSession(req: NextRequest): Promise<{ uid: string; email?: string; refreshedCookie?: string } | null> {
  const r = await resolveSession(req)
  return r ? { uid: r.uid, email: r.email, refreshedCookie: r.refreshedCookie } : null
}

export async function getSessionUser(req: NextRequest): Promise<string | null> {
  return (await resolveSession(req))?.uid ?? null
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === 'production' || process.env.PUBLIC_BASE_URL?.startsWith('https://') ? true : false,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_IDLE_SEC,
}
