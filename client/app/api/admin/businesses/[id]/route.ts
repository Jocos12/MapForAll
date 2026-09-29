import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh, type AdminActor } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { toAdminPlace, withPhotoProxy, DB as PlacesDb } from '@/lib/adminPlaces'
import {
  completenessChecklist,
  completenessScore,
  DB,
  isClaimedBusiness,
  toAdminBusinessRow,
} from '@/lib/adminBusinesses'
import { linkValidatedOwner, notifyAuthorModeration } from '@/lib/adminPlaceModeration'
import { mailLang, placeSuspendedEmail } from '@/lib/emailTemplates'
import { sendMail } from '@/lib/mailer'
import { findUserById } from '@/lib/users'
import { asId } from '@/lib/session'

export const runtime = 'nodejs'

const ActionBody = z.object({
  action: z.enum(['approve', 'reject', 'suspend', 'revoke_local_badge']),
  reason: z.string().max(280).optional().default(''),
})

type RouteCtx = { params: Promise<{ id: string }> }

function appOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  return req.nextUrl.origin
}

async function loadPlace(sid: string, placeId: string) {
  return (
    extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),
    )[0] ?? null
  )
}

async function notifyOwner(
  doc: Record<string, unknown>,
  kind: 'validated' | 'rejected' | 'suspended',
  reason: string,
  appUrl: string,
) {
  const addedBy = typeof doc.added_by === 'string' ? doc.added_by : undefined
  if (!addedBy) return
  const owner = await findUserById(addedBy).catch(() => null)
  if (!owner?.email) return
  const placeName = typeof doc.name === 'string' ? doc.name : 'Listing'
  const lang = mailLang(owner.languages?.[0])
  if (kind === 'suspended') {
    await sendMail(
      owner.email,
      placeSuspendedEmail({
        name: owner.name ?? owner.email.split('@')[0],
        placeName,
        reason,
        lang,
        appUrl,
      }),
    )
    return
  }
  await notifyAuthorModeration({ addedBy, placeName, status: kind, reason, appUrl })
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'businesses-id-get' })
  if (!gate.ok) return gate.response
  let placeId: string
  try {
    placeId = asId((await ctx.params).id, 'id')
  } catch {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 })
  }
  try {
    const sid = await mcpConnected()
    const doc = await loadPlace(sid, placeId)
    if (!doc || !isClaimedBusiness(doc)) {
      return NextResponse.json({ error: 'Business not found.' }, { status: 404 })
    }
    const place = toAdminPlace(doc)
    const row = toAdminBusinessRow(doc)
    let owner: { user_id: string; name: string | null; email: string } | null = null
    if (typeof doc.added_by === 'string') {
      const u = await findUserById(doc.added_by).catch(() => null)
      if (u) owner = { user_id: u.user_id, name: u.name, email: u.email }
    }
    return withSessionRefresh(
      NextResponse.json({
        business: row,
        place: place ? withPhotoProxy(place) : null,
        checklist: completenessChecklist(doc),
        completeness: completenessScore(doc),
        owner,
        proof_document:
          typeof doc.proof_document === 'string'
            ? doc.proof_document
            : typeof doc.ownership_proof === 'string'
              ? doc.ownership_proof
              : null,
      }),
      gate.refreshedCookie,
    )
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load business.' }, { status: 500 })
  }
}

async function applyAction(
  actor: AdminActor,
  placeId: string,
  action: z.infer<typeof ActionBody>['action'],
  reason: string,
  req: NextRequest,
) {
  const sid = await mcpConnected()
  const before = await loadPlace(sid, placeId)
  if (!before || !isClaimedBusiness(before)) {
    return NextResponse.json({ error: 'Business not found.' }, { status: 404 })
  }
  const appUrl = `${appOrigin(req)}/business/dashboard?place=${encodeURIComponent(placeId)}`
  const now = new Date().toISOString()
  const $set: Record<string, unknown> = { moderated_at: now, moderated_by: actor.uid }
  let auditAction: 'business.approve' | 'business.reject' | 'business.suspend' | 'business.revoke_badge' = 'business.approve'
  let afterStatus = typeof before.status === 'string' ? before.status : 'pending'

  if (action === 'approve') {
    $set.status = 'validated'
    $set.rejection_reason = null
    $set.paused = false
    auditAction = 'business.approve'
    afterStatus = 'validated'
  } else if (action === 'reject') {
    $set.status = 'rejected'
    $set.rejection_reason = reason.trim() || 'moderation'
    auditAction = 'business.reject'
    afterStatus = 'rejected'
  } else if (action === 'suspend') {
    $set.status = 'suspended'
    $set.paused = true
    $set.rejection_reason = reason.trim() || 'suspended'
    auditAction = 'business.suspend'
    afterStatus = 'suspended'
  } else {
    $set.local_business = false
    auditAction = 'business.revoke_badge'
  }

  await mcpCall(sid, 'update-many', {
    database: PlacesDb,
    collection: 'places',
    filter: { place_id: placeId },
    update: { $set },
  })

  const after = { ...before, ...$set }
  if (action === 'approve') await linkValidatedOwner(placeId, before)
  if (action === 'approve') await notifyOwner(before, 'validated', reason, appUrl)
  if (action === 'reject') await notifyOwner(before, 'rejected', reason, appUrl)
  if (action === 'suspend') await notifyOwner(before, 'suspended', reason, appUrl)

  await writeAudit({
    actor,
    action: auditAction,
    targetType: 'business',
    targetId: placeId,
    before: { status: before.status, local_business: before.local_business },
    after: { status: afterStatus, local_business: after.local_business },
    meta: reason ? { reason } : undefined,
  })

  const doc = await loadPlace(sid, placeId)
  const place = doc ? toAdminPlace(doc) : null
  return NextResponse.json({
    ok: true,
    business: doc ? toAdminBusinessRow(doc) : null,
    place: place ? withPhotoProxy(place) : null,
  })
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'businesses-id-patch' })
  if (!gate.ok) return gate.response
  let placeId: string
  try {
    placeId = asId((await ctx.params).id, 'id')
  } catch {
    return NextResponse.json({ error: 'Invalid id.' }, { status: 400 })
  }
  const body = ActionBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  try {
    const res = await applyAction(gate.actor, placeId, body.data.action, body.data.reason, req)
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    console.error('[admin/businesses/patch]', err)
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 })
  }
}
