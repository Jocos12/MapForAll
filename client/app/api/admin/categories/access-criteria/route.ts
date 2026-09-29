import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { DB, toAccessCriterion } from '@/lib/adminCategories'

export const runtime = 'nodejs'

const DEFAULT_CRITERIA = [
  { label_en: 'Step-free entrance', label_fr: 'Entrée de plain-pied', label_rw: 'Inzira idafite intambwe' },
  { label_en: 'Accessible toilet', label_fr: 'Toilettes accessibles', label_rw: 'Ubwiherero bugerwaho' },
  { label_en: 'Reserved parking', label_fr: 'Place de parking réservée', label_rw: 'Parikingi yabigenewe' },
  { label_en: 'Wide doorway', label_fr: 'Porte large', label_rw: 'Umunzii mugari' },
]

const CriterionBody = z.object({
  label_fr: z.string().min(1).max(120),
  label_en: z.string().min(1).max(120),
  label_rw: z.string().min(1).max(120),
})

const PatchBody = z.union([
  CriterionBody.partial().extend({ criterion_id: z.string().min(1).max(80) }),
  z.object({ reorder: z.array(z.string().min(1).max(80)).min(1).max(50) }),
])

async function ensureSeeded(sid: string) {
  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'admin_access_criteria', limit: 1 }),
  )
  if (existing.length) return
  const docs = DEFAULT_CRITERIA.map((c, order) => ({
    criterion_id: `acc_${order + 1}`,
    ...c,
    order,
    created_at: new Date().toISOString(),
  }))
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'admin_access_criteria', documents: docs })
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'access-criteria-get' })
  if (!gate.ok) return gate.response
  try {
    const sid = await mcpConnected()
    await ensureSeeded(sid)
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'admin_access_criteria',
        filter: {},
        sort: { order: 1 },
        limit: 100,
      }),
    )
    const items = raw.map(toAccessCriterion).filter((c): c is NonNullable<typeof c> => !!c)
    return withSessionRefresh(NextResponse.json({ items }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load criteria.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'access-criteria-post' })
  if (!gate.ok) return gate.response
  const body = CriterionBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    await ensureSeeded(sid)
    const rows = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'admin_access_criteria', limit: 200 }),
    )
    const criterion_id = `acc_${Date.now().toString(36)}`
    const doc = { criterion_id, ...body.data, order: rows.length, created_at: new Date().toISOString() }
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'admin_access_criteria', documents: [doc] })
    await writeAudit({
      actor: gate.actor,
      action: 'category.update',
      targetType: 'access_criterion',
      targetId: criterion_id,
      meta: { op: 'create' },
    })
    return withSessionRefresh(NextResponse.json({ criterion: toAccessCriterion(doc) }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not create criterion.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'access-criteria-patch' })
  if (!gate.ok) return gate.response
  const body = PatchBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    if ('reorder' in body.data) {
      for (const [order, criterion_id] of body.data.reorder.entries()) {
        await mcpCall(sid, 'update-many', {
          database: DB,
          collection: 'admin_access_criteria',
          filter: { criterion_id },
          update: { $set: { order } },
        })
      }
      const raw = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'admin_access_criteria',
          sort: { order: 1 },
          limit: 100,
        }),
      )
      const items = raw.map(toAccessCriterion).filter((c): c is NonNullable<typeof c> => !!c)
      return withSessionRefresh(NextResponse.json({ items }), gate.refreshedCookie)
    }
    const { criterion_id, ...patch } = body.data
    if (!criterion_id) return NextResponse.json({ error: 'criterion_id required.' }, { status: 400 })
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'admin_access_criteria',
      filter: { criterion_id },
      update: { $set: { ...patch, updated_at: new Date().toISOString() } },
    })
    return withSessionRefresh(NextResponse.json({ ok: true }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update criteria.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'access-criteria-del' })
  if (!gate.ok) return gate.response
  const criterion_id = req.nextUrl.searchParams.get('criterion_id')?.trim()
  if (!criterion_id) return NextResponse.json({ error: 'criterion_id required.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'delete-many', {
      database: DB,
      collection: 'admin_access_criteria',
      filter: { criterion_id },
    })
    return withSessionRefresh(NextResponse.json({ ok: true }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not delete criterion.' }, { status: 500 })
  }
}
