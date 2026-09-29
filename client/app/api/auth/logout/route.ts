import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, verifySession } from '@/lib/session'
import { bumpTokenVersion } from '@/lib/users'
import { OTP_COOKIE, OTP_COOKIE_OPTS } from '@/lib/otp'

export const runtime = 'nodejs'

/**
 * Invalidate every outstanding session for this user (token_version++) and
 * clear the session + OTP cookies with the same attributes used at set time.
 */
export async function POST(req: NextRequest) {
  const payload = verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (payload?.uid) {
    try {
      await bumpTokenVersion(payload.uid)
    } catch (err) {
      console.error('[auth/logout] bumpTokenVersion', err)
    }
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTS, maxAge: 0 })
  res.cookies.set(OTP_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
