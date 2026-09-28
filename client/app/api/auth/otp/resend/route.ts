import { NextRequest, NextResponse } from 'next/server'
import { isMcpUnavailable } from '@/lib/mcp'
import { mailLang } from '@/lib/emailTemplates'
import { OTP_COOKIE, OTP_COOKIE_OPTS, OTP_RESEND_SEC, OTP_TTL_MIN, deliverCode, resendChallenge } from '@/lib/otp'

// A fresh code for the current challenge, after the resend delay.
export async function POST(req: NextRequest) {
  const challengeId = req.cookies.get(OTP_COOKIE)?.value
  if (!challengeId || !/^[a-f0-9]{48}$/.test(challengeId)) {
    return NextResponse.json({ error: 'Sign-in request expired.', code: 'otp_invalid' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { lang?: unknown }

  try {
    const result = await resendChallenge(challengeId)
    switch (result.status) {
      case 'wait':
        return NextResponse.json({ error: 'Please wait before asking again.', code: 'otp_wait', retry_after: result.retryAfterSec }, { status: 429 })
      case 'locked':
        return NextResponse.json({ error: 'Too many wrong codes.', code: 'otp_locked', retry_after: result.retryAfterSec }, { status: 429 })
      case 'too_many':
      case 'invalid': {
        const code = result.status === 'too_many' ? 'otp_too_many' : 'otp_invalid'
        const res = NextResponse.json({ error: 'Please sign in again.', code }, { status: 401 })
        res.cookies.set(OTP_COOKIE, '', { ...OTP_COOKIE_OPTS, maxAge: 0 })
        return res
      }
    }

    const sent = await deliverCode(result.email, result.name, result.code, mailLang(body.lang))
    if (sent.delivery === 'failed') {
      return NextResponse.json({ error: 'Could not send the email. Please try again.', code: 'email_failed' }, { status: 502 })
    }
    return NextResponse.json({
      ok: true,
      expires_in: OTP_TTL_MIN * 60,
      resend_in: OTP_RESEND_SEC,
      delivery: sent.delivery,
      ...(sent.delivery === 'demo' ? { demo_code: sent.code } : {}),
    })
  } catch (err) {
    console.error('[auth/otp/resend]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not send a new code. Please try again.' }, { status: 500 })
  }
}
