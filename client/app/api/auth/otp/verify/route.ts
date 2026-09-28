import { NextRequest, NextResponse } from 'next/server'
import { destinationFor, findUserById, getTokenVersion, touchUserActivity } from '@/lib/users'
import { isMcpUnavailable } from '@/lib/mcp'
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, signSession } from '@/lib/session'
import { OTP_COOKIE, OTP_COOKIE_OPTS, verifyChallenge } from '@/lib/otp'

export const runtime = 'nodejs'

// Step 2 of 2: the emailed code. Only a correct, unexpired, unused code for
// this browser's challenge issues the session cookie (scope=session + tv).
export async function POST(req: NextRequest) {
  const challengeId = req.cookies.get(OTP_COOKIE)?.value
  if (!challengeId || !/^[a-f0-9]{48}$/.test(challengeId)) {
    return NextResponse.json({ error: 'Sign-in request expired.', code: 'otp_invalid' }, { status: 401 })
  }

  let body: { code?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : ''
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code.', code: 'incomplete' }, { status: 400 })
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
        const res = NextResponse.json({ error: 'Sign-in request expired.', code: 'otp_invalid' }, { status: 401 })
        res.cookies.set(OTP_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
        return res
      }
    }

    const user = await findUserById(result.userId)
    if (!user) return NextResponse.json({ error: 'Sign-in request expired.', code: 'otp_invalid' }, { status: 401 })
    const tv = await getTokenVersion(user.user_id)
    void touchUserActivity(user.user_id, true).catch((err) => console.error('[auth/otp/verify] activity', err))

    const res = NextResponse.json({
      ok: true,
      redirect: await destinationFor(user),
      user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role },
    })
    res.headers.set('Cache-Control', 'no-store')
    res.cookies.set(SESSION_COOKIE, signSession(user.user_id, user.email, tv), SESSION_COOKIE_OPTS)
    res.cookies.set(OTP_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
    return res
  } catch (err) {
    console.error('[auth/otp/verify]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 500 })
  }
}
