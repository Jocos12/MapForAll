/**
 * Email one-time codes for the second sign-in step.
 *
 * A challenge is created once the password is verified. Only an HMAC of the
 * code is stored (keyed with the session secret and bound to the challenge
 * id), so a database leak doesn't reveal live codes. The challenge id lives
 * in an httpOnly cookie, tying the code to the browser that entered the
 * password.
 */
import crypto from 'node:crypto'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'
import { sendMail } from '@/lib/mailer'
import { otpEmail, withAdminMailOverrides, type MailLang } from '@/lib/emailTemplates'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COLLECTION = 'otp_challenges'
const SECRET = process.env.HODARI_SESSION_SECRET ?? ''

export const OTP_COOKIE = 'hodari_otp'
export const OTP_TTL_MIN = 10
export const OTP_RESEND_SEC = 60
export const OTP_MAX_ATTEMPTS = 5
export const OTP_LOCK_MIN = 10
/** Codes per challenge; after that the user signs in with the password again. */
const OTP_MAX_SENDS = 5

import { SESSION_COOKIE_OPTS } from '@/lib/session'

export const OTP_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: SESSION_COOKIE_OPTS.secure,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 60 * 30,
}

interface Challenge {
  challenge_id: string
  user_id: string
  email: string
  name: string
  code_hash: string
  expires_at: number
  attempts: number
  locked_until: number | null
  last_sent_at: number
  sends: number
  consumed: boolean
  created_at: string
}

function hashCode(challengeId: string, code: string): string {
  if (!SECRET) throw new Error('HODARI_SESSION_SECRET is not configured')
  return crypto.createHmac('sha256', SECRET).update(`${challengeId}:${code}`).digest('hex')
}

function newCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function secondsUntil(ms: number): number {
  return Math.max(1, Math.ceil((ms - Date.now()) / 1000))
}

/**
 * On-screen code only when explicitly enabled for local/demo use.
 * Never in production, never by default.
 */
export function demoFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_FALLBACK === 'true'
}

async function load(sid: string, challengeId: string): Promise<Challenge | null> {
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: COLLECTION, filter: { challenge_id: challengeId }, limit: 1 }),
  )
  return (docs[0] as unknown as Challenge) ?? null
}

async function patch(sid: string, challengeId: string, set: Partial<Challenge>): Promise<void> {
  await mcpCall(sid, 'update-many', { database: DB, collection: COLLECTION, filter: { challenge_id: challengeId }, update: { $set: set } })
}

export type StartResult =
  | { status: 'ok'; challengeId: string; code: string }
  | { status: 'locked'; retryAfterSec: number }

/** New challenge for a user whose password was just verified. An active lock carries over. */
export async function startChallenge(user: { user_id: string; email: string; name: string | null }): Promise<StartResult> {
  const sid = await mcpConnected()
  const now = Date.now()
  const locked = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB, collection: COLLECTION, filter: { user_id: user.user_id, locked_until: { $gt: now } }, limit: 1,
    }),
  )[0] as unknown as Challenge | undefined
  if (locked?.locked_until) return { status: 'locked', retryAfterSec: secondsUntil(locked.locked_until) }

  await mcpCall(sid, 'delete-many', { database: DB, collection: COLLECTION, filter: { user_id: user.user_id } })
  const challengeId = crypto.randomBytes(24).toString('hex')
  const code = newCode()
  const doc: Challenge = {
    challenge_id: challengeId,
    user_id: user.user_id,
    email: user.email,
    name: user.name ?? user.email.split('@')[0],
    code_hash: hashCode(challengeId, code),
    expires_at: now + OTP_TTL_MIN * 60_000,
    attempts: 0,
    locked_until: null,
    last_sent_at: now,
    sends: 1,
    consumed: false,
    created_at: new Date(now).toISOString(),
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: COLLECTION, documents: [doc] })
  return { status: 'ok', challengeId, code }
}

export type Delivery = { delivery: 'email' } | { delivery: 'demo'; code: string } | { delivery: 'failed' }

/** Email the code; fall back to showing it on screen only where the demo mode is allowed. */
export async function deliverCode(to: string, name: string, code: string, lang: MailLang): Promise<Delivery> {
  const sent = await sendMail(
    to,
    await withAdminMailOverrides('otp', otpEmail({ name, code, lang, minutes: OTP_TTL_MIN }), {
      name,
      code,
      minutes: String(OTP_TTL_MIN),
    }, lang),
  )
  if (sent.ok) return { delivery: 'email' }
  if (demoFallbackAllowed()) {
    console.warn('[otp] email not delivered; showing the code on screen (demo fallback)')
    return { delivery: 'demo', code }
  }
  return { delivery: 'failed' }
}

export type VerifyResult =
  | { status: 'ok'; userId: string }
  | { status: 'wrong'; remaining: number }
  | { status: 'locked'; retryAfterSec: number }
  | { status: 'need_new_code' }
  | { status: 'invalid' }

export async function verifyChallenge(challengeId: string, code: string): Promise<VerifyResult> {
  const sid = await mcpConnected()
  const doc = await load(sid, challengeId)
  if (!doc || doc.consumed) return { status: 'invalid' }
  const now = Date.now()
  if (doc.locked_until && doc.locked_until > now) return { status: 'locked', retryAfterSec: secondsUntil(doc.locked_until) }
  if (doc.attempts >= OTP_MAX_ATTEMPTS || doc.expires_at < now) return { status: 'need_new_code' }

  if (!sameHash(hashCode(challengeId, code), doc.code_hash)) {
    const attempts = doc.attempts + 1
    if (attempts >= OTP_MAX_ATTEMPTS) {
      const until = now + OTP_LOCK_MIN * 60_000
      await patch(sid, challengeId, { attempts, locked_until: until })
      return { status: 'locked', retryAfterSec: secondsUntil(until) }
    }
    await patch(sid, challengeId, { attempts })
    return { status: 'wrong', remaining: OTP_MAX_ATTEMPTS - attempts }
  }

  await patch(sid, challengeId, { consumed: true })
  return { status: 'ok', userId: doc.user_id }
}

export type ResendResult =
  | { status: 'ok'; code: string; email: string; name: string }
  | { status: 'wait'; retryAfterSec: number }
  | { status: 'locked'; retryAfterSec: number }
  | { status: 'too_many' }
  | { status: 'invalid' }

/** Replace the code (new expiry, attempts reset) once the resend delay and any lock have passed. */
export async function resendChallenge(challengeId: string): Promise<ResendResult> {
  const sid = await mcpConnected()
  const doc = await load(sid, challengeId)
  if (!doc || doc.consumed) return { status: 'invalid' }
  const now = Date.now()
  if (doc.locked_until && doc.locked_until > now) return { status: 'locked', retryAfterSec: secondsUntil(doc.locked_until) }
  const nextAllowed = doc.last_sent_at + OTP_RESEND_SEC * 1000
  if (nextAllowed > now) return { status: 'wait', retryAfterSec: secondsUntil(nextAllowed) }
  if (doc.sends >= OTP_MAX_SENDS) return { status: 'too_many' }

  const code = newCode()
  await patch(sid, challengeId, {
    code_hash: hashCode(challengeId, code),
    expires_at: now + OTP_TTL_MIN * 60_000,
    attempts: 0,
    locked_until: null,
    last_sent_at: now,
    sends: doc.sends + 1,
  })
  return { status: 'ok', code, email: doc.email, name: doc.name }
}

/** Undo a challenge whose code could not be delivered, so a retry isn't blocked by the resend delay. */
export async function dropChallenge(challengeId: string): Promise<void> {
  const sid = await mcpConnected()
  await mcpCall(sid, 'delete-many', { database: DB, collection: COLLECTION, filter: { challenge_id: challengeId } })
}
