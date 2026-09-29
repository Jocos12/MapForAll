import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import {
  DB,
  countPlacesByCategory,
  defaultCategories,
  toAdminCategory,
  type AdminCategory,
} from '@/lib/adminCategories'

export const runtime = 'nodejs'

const CategoryBody = z.object({
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  name_fr: z.string().min(1).max(80),
  name_en: z.string().min(1).max(80),
  name_rw: z.string().min(1).max(80),
  icon: z.string().min(1).max(40).optional().default('map-pin'),
  color: z.string().min(4).max(20).optional().default('#E8672A'),
})

const PatchBody = z.union([
  CategoryBody.partial().extend({ category_id: z.string().min(1).max(80) }),
  z.object({ reorder: z.array(z.string().min(1).max(80)).min(1).max(50) }),
])

async function ensureSeeded(sid: string): Promise<void> {
  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'admin_categories', limit: 1 }),
  )
  if (existing.length) return
  const docs = defaultCategories().map((c) => ({ ...c, created_at: new Date().toISOString() }))
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'admin_categories', documents: docs })
}

async function listCategories(sid: string): Promise<AdminCategory[]> {
  await ensureSeeded(sid)
  const raw = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'admin_categories',
      filter: {},
      sort: { order: 1 },
      limit: 100,
    }),
  )
  const places = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter: {},
      projection: { categories: 1 },
      limit: 5000,
    }),
  )
  const counts = countPlacesByCategory(places)
  return raw
    .map(toAdminCategory)
    .filter((c): c is AdminCategory => !!c)
    .map((c) => ({ ...c, place_count: counts.get(c.slug.toLowerCase()) ?? 0 }))
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'categories-get' })
  if (!gate.ok) return gate.response
  try {
    const sid = await mcpConnected()
    const items = await listCategories(sid)
    return withSessionRefresh(NextResponse.json({ items }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load categories.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'categories-post' })
  if (!gate.ok) return gate.response
  const body = CategoryBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    await ensureSeeded(sid)
    const category_id = `cat_${body.data.slug}_${Date.now().toString(36)}`
    const existing = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'admin_categories',
        filter: { slug: body.data.slug },
        limit: 1,
      }),
    )
    if (existing.length) return NextResponse.json({ error: 'Slug already exists.' }, { status: 409 })
    const orderRows = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'admin_categories', limit: 200 }),
    )
    const doc = {
      category_id,
      ...body.data,
      order: orderRows.length,
      created_at: new Date().toISOString(),
    }
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'admin_categories', documents: [doc] })
    await writeAudit({
      actor: gate.actor,
      action: 'category.update',
      targetType: 'category',
      targetId: category_id,
      after: doc,
      meta: { op: 'create' },
    })
    return withSessionRefresh(NextResponse.json({ category: toAdminCategory(doc) }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not create category.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'categories-patch' })
  if (!gate.ok) return gate.response
  const body = PatchBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    if ('reorder' in body.data) {
      for (const [order, category_id] of body.data.reorder.entries()) {
        await mcpCall(sid, 'update-many', {
          database: DB,
          collection: 'admin_categories',
          filter: { category_id },
          update: { $set: { order } },
        })
      }
      await writeAudit({
        actor: gate.actor,
        action: 'category.update',
        targetType: 'category',
        targetId: 'reorder',
        meta: { order: body.data.reorder },
      })
      const items = await listCategories(sid)
      return withSessionRefresh(NextResponse.json({ items }), gate.refreshedCookie)
    }
    const { category_id, ...patch } = body.data
    if (!category_id) return NextResponse.json({ error: 'category_id required.' }, { status: 400 })
    const $set = { ...patch, updated_at: new Date().toISOString() }
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'admin_categories',
      filter: { category_id },
      update: { $set },
    })
    await writeAudit({
      actor: gate.actor,
      action: 'category.update',
      targetType: 'category',
      targetId: category_id,
      after: $set,
      meta: { op: 'update' },
    })
    const doc = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'admin_categories', filter: { category_id }, limit: 1 }),
    )[0]
    return withSessionRefresh(NextResponse.json({ category: doc ? toAdminCategory(doc) : null }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update categories.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'categories-del' })
  if (!gate.ok) return gate.response
  const category_id = req.nextUrl.searchParams.get('category_id')?.trim()
  if (!category_id) return NextResponse.json({ error: 'category_id required.' }, { status: 400 })
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'delete-many', {
      database: DB,
      collection: 'admin_categories',
      filter: { category_id },
    })
    await writeAudit({
      actor: gate.actor,
      action: 'category.update',
      targetType: 'category',
      targetId: category_id,
      meta: { op: 'delete' },
    })
    return withSessionRefresh(NextResponse.json({ ok: true }), gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not delete category.' }, { status: 500 })
  }
}
