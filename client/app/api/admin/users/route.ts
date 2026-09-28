import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { isMcpUnavailable } from '@/lib/mcp'
import { isValidEmail } from '@/lib/password'
import { createAdminUser, listAdminUsers, updateAdminUser } from '@/lib/adminUsers'
import { saveAvatarBuffer, parseDataUrl } from '@/lib/adminAvatar'
import type { UserRole } from '@/lib/users'

export const runtime = 'nodejs'

const MIN_PASSWORD = 8

const ListQuery = z.object({
  q: z.string().max(120).optional(),
  role: z.enum(['client', 'business_owner', 'admin', 'moderator']).optional(),
  status: z.enum(['active', 'suspended', 'deleted', 'all']).optional().default('active'),
  sort: z.enum(['created_desc', 'created_asc', 'name', 'last_active', 'email']).optional().default('created_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(MIN_PASSWORD).max(200),
  role: z.enum(['client', 'business_owner', 'admin', 'moderator']),
  avatar_url: z.string().max(500).optional(),
  avatar_base64: z.string().max(3_000_000).optional(),
  lang: z.enum(['fr', 'en', 'rw']).optional(),
})

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'users-get' })
  if (!gate.ok) return gate.response
  const parsed = ListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const result = await listAdminUsers(parsed.data)
    const res = NextResponse.json(result)
    res.headers.set('Cache-Control', 'private, max-age=20')
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load users.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-create' })
  if (!gate.ok) return gate.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const parsed = CreateBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.', details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data
  if (!isValidEmail(data.email)) {
    return NextResponse.json({ error: 'Invalid email.' }, { status: 400 })
  }

  try {
    let avatarUrl: string | null = data.avatar_url?.trim() || null
    const result = await createAdminUser({
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role as UserRole,
      avatar_url: avatarUrl,
      lang: data.lang,
    })
    if (!result.ok) {
      return NextResponse.json({ error: 'Email already registered.', code: 'email_taken' }, { status: 409 })
    }

    if (data.avatar_base64) {
      const parsedImg = parseDataUrl(data.avatar_base64)
      if (parsedImg) {
        avatarUrl = await saveAvatarBuffer(result.user.user_id, parsedImg.mime, parsedImg.buffer)
        const updated = await updateAdminUser(result.user.user_id, { avatar_url: avatarUrl })
        if (updated) result.user = updated
      }
    }

    await writeAudit({
      actor: gate.actor,
      action: 'user.create',
      targetType: 'user',
      targetId: result.user.user_id,
      after: { email: result.user.email, role: result.user.role },
    })

    const res = NextResponse.json({ user: result.user })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not create user.' }, { status: 500 })
  }
}
