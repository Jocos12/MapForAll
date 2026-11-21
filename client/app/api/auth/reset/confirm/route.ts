import { NextRequest, NextResponse } from 'next/server'
import { bumpTokenVersion, setNewPassword } from '@/lib/users'
import { isMcpUnavailable } from '@/lib/mcp'
import { OTP_COOKIE_OPTS, verifyChallenge } from '@/lib/otp'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { RESET_COOKIE } from '@/lib/resetCookie'

export const runtime = 'nodejs'

const MIN_PASSWORD = 8

// Password reset, step 2: the emailed code and the new password in one
// request. A correct code sets the new password and signs out every other
// session (token version bump). The user then signs in normally.
export async function POST(req: NextRequest) {
  if (!rateLimit(`reset-confirm:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; password?: unknown }
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code.', code: 'incomplete' }, { status: 400 })
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, { status: 400 })
  }

  const challengeId = req.cookies.get(RESET_COOKIE)?.value
  // No reset request on this browser (or no account for that email):
  // the same "wrong code" answer as a real wrong code.
  if (!challengeId || !/^[a-f0-9]{48}$/.test(challengeId)) {
    return NextResponse.json({ error: 'Wrong code.', code: 'otp_wrong', remaining: 4 }, { status: 400 })
  }

  try {
    const result = await verifyChallenge(challengeId, code)
    switch (result.status) {
      case 'wrong':
        return NextResponse.json({ error: 'Wrong code.', code: 'otp_wrong', remaining: result.remaining }, { status: 400 })
      case 'locked':
        return NextResponse.json({ error: 'Too many wrong codes.', code: 'otp_locked', retry_after: result.retryAfterSec }, { status: 429 })
      case 'need_new_code':
        return NextResponse.json({ error: 'This code expired. Request a new one.', code: 'otp_expired' }, { status: 410 })
      case 'invalid': {
        const res = NextResponse.json({ error: 'Reset request expired.', code: 'otp_invalid' }, { status: 401 })
        res.cookies.set(RESET_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
        return res
      }
    }
    await setNewPassword(result.userId, password)
    await bumpTokenVersion(result.userId)
    const res = NextResponse.json({ ok: true })
    res.headers.set('Cache-Control', 'no-store')
    res.cookies.set(RESET_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
    return res
  } catch (err) {
    console.error('[auth/reset/confirm]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not reset the password. Please try again.' }, { status: 500 })
  }
}
