import { NextRequest, NextResponse } from 'next/server'
import { sendMail, isSmtpConfigured, logSmtpConfigPresence, maskEmail } from '@/lib/mailer'
import { welcomeEmail, mailLang } from '@/lib/emailTemplates'

export const runtime = 'nodejs'

/**
 * Dev-only SMTP probe. Sends a short HTML message to the address in the body
 * (or SMTP_USER). Disabled in production.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  logSmtpConfigPresence()
  if (!isSmtpConfigured()) {
    return NextResponse.json({ ok: false, error: 'SMTP is not configured.' }, { status: 503 })
  }

  let body: { to?: unknown; lang?: unknown } = {}
  try {
    body = await req.json()
  } catch { /* empty body is fine */ }

  const to = typeof body.to === 'string' && body.to.includes('@')
    ? body.to.trim()
    : (process.env.SMTP_USER ?? '')
  if (!to) {
    return NextResponse.json({ ok: false, error: 'Provide { "to": "you@example.com" }.' }, { status: 400 })
  }

  const result = await sendMail(
    to,
    welcomeEmail({
      name: 'SMTP test',
      role: 'client',
      lang: mailLang(body.lang),
      loginUrl: process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/login`
        : 'http://localhost:3000/login',
    }),
  )

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'Impossible d’envoyer l’email, réessayez.', reason: result.reason },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true, to: maskEmail(to) })
}
