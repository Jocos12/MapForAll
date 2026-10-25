import crypto from 'node:crypto'

function secret(): string {
  return process.env.HODARI_SESSION_SECRET ?? ''
}

/** Absolute lifetime: even an active session must sign in again after this. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, seconds
/** Business owners and other accounts: 7 days of inactivity. Admins: 12 hours. */
export const OWNER_IDLE_MS = 7 * 24 * 60 * 60 * 1000
export const ADMIN_IDLE_MS = 12 * 60 * 60 * 1000
export const SESSION_IDLE_SEC = Math.floor(OWNER_IDLE_MS / 1000)

export function idleWindowMs(role?: string | null): number {
  if (role === 'admin' || role === 'moderator') return ADMIN_IDLE_MS
  return OWNER_IDLE_MS
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
  /** This browser's session. Another account's login does not share it. */
  sid?: string
  role?: string
  /** Absolute expiry for this session (ms). */
  exp?: number
}

export type CookieReason = 'missing' | 'bad_signature' | 'expired' | 'revoked'

export type CookieVerdict =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: CookieReason }

export function encodeSession(payload: SessionPayload): string {
  const key = secret()
  if (!key) throw new Error('HODARI_SESSION_SECRET is not configured')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function signSession(uid: string, email: string | undefined, tokenVersion: number, role?: string): string {
  const now = Date.now()
  return encodeSession({
    uid,
    email,
    tv: Number.isFinite(tokenVersion) ? tokenVersion : 0,
    scope: 'session',
    iat: now,
    last: now,
    role,
    sid: crypto.randomBytes(16).toString('hex'),
    exp: now + idleWindowMs(role),
  })
}

/** True when this payload is past its own expiry. `now` is injectable for tests. */
export function sessionExpired(payload: SessionPayload, now = Date.now()): boolean {
  if (typeof payload.iat === 'number' && now - payload.iat > SESSION_MAX_AGE * 1000) return true
  if (typeof payload.exp === 'number') return now > payload.exp
  const last = typeof payload.last === 'number' ? payload.last : payload.iat
  return now - last > idleWindowMs(payload.role)
}

export function classifyCookie(token: string | undefined | null): CookieVerdict {
  if (!token) return { ok: false, reason: 'missing' }
  const key = secret()
  if (!key) return { ok: false, reason: 'bad_signature' }
  const dot = token.indexOf('.')
  if (dot < 1) return { ok: false, reason: 'bad_signature' }
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload> & {
      tv?: number
      scope?: string
    }
    if (!payload.uid || typeof payload.uid !== 'string') return { ok: false, reason: 'bad_signature' }
    const scope = payload.scope === 'session' || payload.scope === undefined ? 'session' : null
    if (scope !== 'session') return { ok: false, reason: 'revoked' }
    const last = typeof payload.last === 'number' ? payload.last : payload.iat
    const parsed: SessionPayload = {
      uid: payload.uid,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      tv: typeof payload.tv === 'number' ? payload.tv : 0,
      scope: 'session',
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      last: typeof last === 'number' ? last : undefined,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    }
    if (!parsed.iat || sessionExpired(parsed)) return { ok: false, reason: 'expired' }
    return { ok: true, payload: parsed }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  const verdict = classifyCookie(token)
  return verdict.ok ? verdict.payload : null
}
