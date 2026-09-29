import { NextRequest, NextResponse } from 'next/server'
import { createUserWithPassword, isPublicRole } from '@/lib/users'
import { isValidEmail } from '@/lib/password'
import { isMcpUnavailable } from '@/lib/mcp'
import { sendMail } from '@/lib/mailer'
import { mailLang, welcomeEmail, withAdminMailOverrides } from '@/lib/emailTemplates'
import { appUrl } from '@/lib/oauth'
import { clientIp, rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'

const MIN_PASSWORD = 8

// Register a new email/password user and send the welcome email. No session
// is issued here: the user signs in afterwards (password + emailed code).
export async function POST(req: NextRequest) {
  if (!rateLimit(`signup:${clientIp(req)}`, { capacity: 8, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }

  let body: { name?: unknown; email?: unknown; password?: unknown; role?: unknown; lang?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.', code: 'invalid' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = isPublicRole(body.role) ? body.role : null
  const lang = mailLang(body.lang)

  if (!role) return NextResponse.json({ error: 'Choose how you will use MapForAll.', code: 'role_required' }, { status: 400 })
  if (!name || name.length > 120) return NextResponse.json({ error: 'Please enter your name.', code: 'name_required' }, { status: 400 })
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Please enter a valid email address.', code: 'invalid_email' }, { status: 400 })
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, { status: 400 })
  }

  try {
    const result = await createUserWithPassword(email, name, password, role, lang)
    if (!result.ok) {
      return NextResponse.json({ error: 'An account with this email already exists. Try signing in.', code: 'email_taken' }, { status: 409 })
    }
    const { user } = result
    const displayName = user.name ?? name
    const welcome = await sendMail(
      user.email,
      await withAdminMailOverrides(
        'welcome',
        welcomeEmail({
          name: displayName,
          role: user.role,
          lang,
          loginUrl: appUrl(req, `/login?email=${encodeURIComponent(user.email)}`),
        }),
        { name: displayName },
        lang,
      ),
    )
    return NextResponse.json({
      ok: true,
      welcome_sent: welcome.ok,
      user: { name: user.name, email: user.email, role: user.role },
    })
  } catch (err) {
    console.error('[auth/signup]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'The account database is unavailable. Please try again in a moment.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not create your account. Please try again.' }, { status: 500 })
  }
}
