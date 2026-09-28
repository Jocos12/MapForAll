import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { isMcpUnavailable } from '@/lib/mcp'
import { getAdminUserById, readUserDocRaw, softDeleteAdminUser, updateAdminUser } from '@/lib/adminUsers'
import { deleteAvatarFiles } from '@/lib/adminAvatar'

export const runtime = 'nodejs'

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['client', 'business_owner', 'admin', 'moderator']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  avatar_url: z.string().max(500).nullable().optional(),
})

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'users-detail' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  try {
    const user = await getAdminUserById(id)
    if (!user) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const res = NextResponse.json({ user })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load user.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-patch' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const parsed = PatchBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const beforeDoc = await readUserDocRaw(id)
    if (!beforeDoc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const updated = await updateAdminUser(id, parsed.data)
    if (!updated) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const auditAction =
      parsed.data.role !== undefined ? 'user.role_change'
      : parsed.data.status === 'suspended' ? 'user.suspend'
      : 'user.update'

    await writeAudit({
      actor: gate.actor,
      action: auditAction,
      targetType: 'user',
      targetId: id,
      before: { role: beforeDoc.role, status: beforeDoc.status },
      after: { role: updated.role, status: updated.status },
    })

    const res = NextResponse.json({ user: updated })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update user.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-delete' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  try {
    const beforeDoc = await readUserDocRaw(id)
    if (!beforeDoc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const ok = await softDeleteAdminUser(id)
    if (!ok) {
      return NextResponse.json({ error: 'Cannot delete this account.', code: 'protected' }, { status: 403 })
    }

    await deleteAvatarFiles(id).catch(() => undefined)

    await writeAudit({
      actor: gate.actor,
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
      before: { email: beforeDoc.email },
    })

    const res = NextResponse.json({ ok: true })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not delete user.' }, { status: 500 })
  }
}
