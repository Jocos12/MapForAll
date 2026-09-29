import { NextRequest, NextResponse } from 'next/server'
import { verifyUserPassword } from '@/lib/users'
import { isValidEmail } from '@/lib/password'
import { isMcpUnavailable } from '@/lib/mcp'
import { maskEmail } from '@/lib/mailer'
import { mailLang } from '@/lib/emailTemplates'
import { OTP_COOKIE, OTP_COOKIE_OPTS, OTP_RESEND_SEC, OTP_TTL_MIN, deliverCode, dropChallenge, startChallenge } from '@/lib/otp'
import { clientIp, rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'

// Step 1 of 2. A wrong email, wrong password, or a Google-only account (no
// password set) all return the same generic error so we never reveal which
// emails exist or how they signed up. A correct password issues NO session:
// it emails a one-time code, and /api/auth/otp/verify signs the user in.
const GENERIC_ERROR = 'Wrong email or password.'

export async function POST(req: NextRequest) {
  if (!rateLimit(`login:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }

  let body: { email?: unknown; password?: unknown; lang?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.', code: 'invalid_email' }, { status: 400 })
  }
  if (!password) {
    return NextResponse.json({ error: GENERIC_ERROR, code: 'bad_credentials' }, { status: 401 })
  }

  try {
    const user = await verifyUserPassword(email, password)
    if (!user) return NextResponse.json({ error: GENERIC_ERROR, code: 'bad_credentials' }, { status: 401 })

    const started = await startChallenge(user)
    if (started.status === 'locked') {
      return NextResponse.json(
        { error: 'Too many wrong codes. Try again later.', code: 'otp_locked', retry_after: started.retryAfterSec },
        { status: 429 },
      )
    }

    const sent = await deliverCode(user.email, user.name ?? user.email.split('@')[0], started.code, mailLang(body.lang))
    if (sent.delivery === 'failed') {
      await dropChallenge(started.challengeId).catch(() => {})
      return NextResponse.json({ error: 'Could not send the email. Please try again.', code: 'email_failed' }, { status: 502 })
    }

    const res = NextResponse.json({
      ok: true,
      step: 'otp',
      email: maskEmail(user.email),
      expires_in: OTP_TTL_MIN * 60,
      resend_in: OTP_RESEND_SEC,
      delivery: sent.delivery,
      ...(sent.delivery === 'demo' ? { demo_code: sent.code } : {}),
    })
    res.cookies.set(OTP_COOKIE, started.challengeId, OTP_COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[auth/login]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
