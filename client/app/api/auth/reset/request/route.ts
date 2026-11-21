import { NextRequest, NextResponse } from 'next/server'
import { findUserByEmail } from '@/lib/users'
import { isValidEmail } from '@/lib/password'
import { isMcpUnavailable } from '@/lib/mcp'
import { maskEmail } from '@/lib/mailer'
import { mailLang } from '@/lib/emailTemplates'
import { OTP_COOKIE_OPTS, OTP_RESEND_SEC, OTP_TTL_MIN, dropChallenge, sendCodeFast, startChallenge } from '@/lib/otp'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { RESET_COOKIE } from '@/lib/resetCookie'

export const runtime = 'nodejs'

// Password reset, step 1: email a 6-digit code. The answer is the same
// whether or not the email has an account, so nobody can probe which
// emails are registered. Only a real account gets a code and a cookie.
export async function POST(req: NextRequest) {
  if (!rateLimit(`reset:${clientIp(req)}`, { capacity: 5, refillPerSec: 0.05 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; lang?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.', code: 'invalid_email' }, { status: 400 })
  }
  const generic = { ok: true, email: maskEmail(email), expires_in: OTP_TTL_MIN * 60, resend_in: OTP_RESEND_SEC }

  try {
    const user = await findUserByEmail(email)
    if (!user || user.status === 'suspended') return NextResponse.json(generic)

    const started = await startChallenge(user)
    if (started.status === 'locked') {
      return NextResponse.json({ error: 'Too many wrong codes. Try again later.', code: 'otp_locked', retry_after: started.retryAfterSec }, { status: 429 })
    }
    const sent = await sendCodeFast(user.email, user.name ?? user.email.split('@')[0], started.code, mailLang(body.lang), started.challengeId)
    if (sent.delivery === 'failed') {
      await dropChallenge(started.challengeId).catch(() => {})
      return NextResponse.json({ error: 'Could not send the email. Please try again.', code: 'email_failed' }, { status: 502 })
    }
    const res = NextResponse.json({ ...generic, ...(sent.delivery === 'demo' ? { demo_code: sent.code } : {}) })
    res.cookies.set(RESET_COOKIE, started.challengeId, OTP_COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[auth/reset/request]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not start the reset. Please try again.' }, { status: 500 })
  }
}
