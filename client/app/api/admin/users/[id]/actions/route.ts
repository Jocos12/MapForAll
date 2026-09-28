import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { isSmtpConfigured, sendMail } from '@/lib/mailer'
import { mailLang, welcomeEmail, withAdminMailOverrides } from '@/lib/emailTemplates'
import { appUrl } from '@/lib/oauth'
import { isMcpUnavailable } from '@/lib/mcp'
import { bumpTokenVersion } from '@/lib/users'
import { getAdminUserById, readUserDocRaw, setUserPasswordHash } from '@/lib/adminUsers'
import type { UserRole } from '@/lib/users'

export const runtime = 'nodejs'

const Body = z.object({
  action: z.enum(['force_logout', 'reset_password', 'resend_welcome']),
})

type RouteCtx = { params: Promise<{ id: string }> }

function tempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function welcomeRole(role: UserRole): 'client' | 'business_owner' | 'admin' {
  if (role === 'business_owner') return 'business_owner'
  if (role === 'admin' || role === 'moderator') return 'admin'
  return 'client'
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-actions' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  try {
    const doc = await readUserDocRaw(id)
    if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const user = await getAdminUserById(id)
    if (!user) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const action = parsed.data.action

    if (action === 'force_logout') {
      await bumpTokenVersion(id)
      await writeAudit({
        actor: gate.actor,
        action: 'user.force_logout',
        targetType: 'user',
        targetId: id,
      })
      const res = NextResponse.json({ ok: true })
      return withSessionRefresh(res, gate.refreshedCookie)
    }

    if (action === 'reset_password') {
      const plain = tempPassword()
      await setUserPasswordHash(id, plain)
      await bumpTokenVersion(id)

      let emailed = false
      if (isSmtpConfigured()) {
        const lang = mailLang(doc.lang)
        const loginUrl = appUrl(req, `/login?email=${encodeURIComponent(user.email)}`)
        const mail = await sendMail(user.email, {
          subject: lang === 'fr' ? 'Nouveau mot de passe MapForAll' : 'Your MapForAll temporary password',
          html: `<p>${user.name ?? user.email},</p><p>Your temporary password: <strong>${plain}</strong></p><p><a href="${loginUrl}">Sign in</a></p>`,
          text: `Temporary password: ${plain}\nSign in: ${loginUrl}`,
        })
        emailed = mail.ok
      }

      await writeAudit({
        actor: gate.actor,
        action: 'user.update',
        targetType: 'user',
        targetId: id,
        meta: { reset_password: true, emailed },
      })

      const res = NextResponse.json({
        ok: true,
        emailed,
        ...(emailed ? {} : { temporary_password: plain }),
      })
      return withSessionRefresh(res, gate.refreshedCookie)
    }

    if (action === 'resend_welcome') {
      const lang = mailLang(doc.lang)
      const displayName = user.name ?? user.email
      const content = await withAdminMailOverrides(
        'welcome',
        welcomeEmail({
          name: displayName,
          role: welcomeRole(user.role),
          lang,
          loginUrl: appUrl(req, `/login?email=${encodeURIComponent(user.email)}`),
        }),
        { name: displayName },
        lang,
      )
      const mail = await sendMail(user.email, content)
      await writeAudit({
        actor: gate.actor,
        action: 'user.update',
        targetType: 'user',
        targetId: id,
        meta: { resend_welcome: true, sent: mail.ok },
      })
      const res = NextResponse.json({ ok: true, sent: mail.ok })
      return withSessionRefresh(res, gate.refreshedCookie)
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 })
  }
}
