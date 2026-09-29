import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh, type AdminActor } from '@/lib/adminAuth'
import {
  DB,
  computeDuplicateHints,
  matchesFilters,
  sortPlaces,
  toAdminPlace,
  withPhotoProxy,
  type PlacesListQuery,
} from '@/lib/adminPlaces'
import { linkValidatedOwner, notifyAuthorModeration } from '@/lib/adminPlaceModeration'
import { writeAudit } from '@/lib/audit'
import { asId } from '@/lib/session'

export const runtime = 'nodejs'

const ListQuery = z.object({
  status: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  local: z.enum(['0', '1']).optional(),
  accessible: z.enum(['0', '1']).optional(),
  sector: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'name', 'views', 'status']).optional().default('created_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  legacy: z.enum(['pending']).optional(),
})

const ModerateSingle = z.object({
  place_id: z.string().min(1).max(200),
  status: z.enum(['validated', 'rejected']),
  reason: z.string().max(280).optional().default(''),
  action: z.enum(['request_changes', 'merge']).optional(),
})

const ModerateBulk = z.object({
  place_ids: z.array(z.string().min(1).max(200)).min(1).max(100),
  status: z.enum(['validated', 'rejected']),
  reason: z.string().max(280).optional().default(''),
  action: z.enum(['request_changes', 'merge']).optional(),
})

const AdminCreateBody = z.object({
  create: z.literal(true),
  name: z.string().min(2).max(120),
  category: z.string().min(1).max(40),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(200).optional(),
  local_business: z.boolean().optional(),
  accessible: z.boolean().optional(),
  status: z.enum(['pending', 'validated']).optional().default('validated'),
})

const PostBody = z.union([ModerateBulk, ModerateSingle, AdminCreateBody])

function appOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  return req.nextUrl.origin
}

async function loadRawPlaces(sid: string, filter: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  const texts = await mcpCall(sid, 'find', {
    database: DB,
    collection: 'places',
    filter,
    projection: { photos: 0 },
    sort: { created_at: -1 },
    limit: 800,
  })
  return extractDocs(texts)
}

function buildPlaceMongoFilter(q: {
  status?: string
  category?: string
  source?: string
  local?: string
  accessible?: string
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {}
  if (q.status === 'pending') filter.status = 'pending'
  else if (q.status === 'rejected') filter.status = 'rejected'
  else if (q.status === 'archived') filter.archived = true
  else if (q.status === 'validated') {
    filter.$or = [{ status: 'validated' }, { status: { $exists: false } }, { status: null }]
    filter.archived = { $ne: true }
  } else {
    filter.archived = { $ne: true }
  }
  if (q.category) filter.categories = q.category.toLowerCase()
  if (q.source) filter.source = q.source
  if (q.local === '1') filter.local_business = true
  if (q.accessible === '1') filter.accessible = true
  return filter
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-get' })
  if (!gate.ok) return gate.response
  const parsed = ListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.', details: parsed.error.flatten() }, { status: 400 })
  }
  const q = parsed.data
  try {
    const sid = await mcpConnected()
    const mongoFilter = buildPlaceMongoFilter({
      status: q.legacy === 'pending' ? 'pending' : q.status,
      category: q.category,
      source: q.source,
      local: q.local,
      accessible: q.accessible,
    })
    const raw = await loadRawPlaces(sid, mongoFilter)
    const listQuery: PlacesListQuery = {
      status: q.legacy === 'pending' ? 'pending' : q.status,
      category: q.category?.toLowerCase(),
      source: q.source,
      local: q.local === '1' ? true : undefined,
      accessible: q.accessible === '1' ? true : undefined,
      sector: q.sector,
      q: q.q?.trim().toLowerCase(),
      sort: q.sort,
      page: q.page,
      limit: q.limit,
    }
    const filtered = raw.filter((doc) => matchesFilters(doc, listQuery))
    const itemsAll = filtered
      .map(toAdminPlace)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map(withPhotoProxy)
      .sort((a, b) => sortPlaces(a, b, q.sort))
    const total = itemsAll.length
    const start = (q.page - 1) * q.limit
    const items = itemsAll.slice(start, start + q.limit)
    const idSet = new Set(items.map((p) => p.place_id))
    const duplicatesHints = computeDuplicateHints(raw, idSet)
    const res = NextResponse.json({ items, total, page: q.page, duplicatesHints })
    res.headers.set('Cache-Control', 'private, max-age=20')
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load places.' }, { status: 500 })
  }
}

async function moderateOne(
  sid: string,
  gate: { actor: AdminActor },
  req: NextRequest,
  placeId: string,
  status: 'validated' | 'rejected',
  reason: string,
  action?: 'request_changes' | 'merge',
) {
  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),
  )[0]
  if (!existing) return { ok: false as const, status: 404, error: 'Place not found.' }
  const effectiveStatus = action === 'request_changes' && status === 'rejected' ? 'pending' : status
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'places',
    filter: { place_id: placeId },
    update: {
      $set: {
        status: effectiveStatus,
        rejection_reason: status === 'rejected' ? reason : '',
        moderated_at: new Date().toISOString(),
        moderated_by: gate.actor.uid,
        ...(action === 'merge' ? { merge_note: reason || 'merge_requested' } : {}),
      },
    },
  })
  if (status === 'validated') await linkValidatedOwner(placeId, existing)
  if (status === 'validated' || status === 'rejected') {
    const placeName = typeof existing.name === 'string' ? existing.name : placeId
    await notifyAuthorModeration({
      addedBy: typeof existing.added_by === 'string' ? existing.added_by : undefined,
      placeName,
      status,
      reason,
      appUrl: appOrigin(req),
    })
  }
  await writeAudit({
    actor: gate.actor,
    action: status === 'validated' ? 'place.validate' : 'place.reject',
    targetType: 'place',
    targetId: placeId,
    before: existing ? { status: existing.status } : null,
    after: { status: effectiveStatus, reason, action: action ?? null },
  })
  return { ok: true as const, place_id: placeId, status: effectiveStatus }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-post' })
  if (!gate.ok) return gate.response

  const raw = await req.json().catch(() => null)
  const parsed = PostBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.', details: parsed.error.flatten() }, { status: 400 })
  }

  if ('create' in parsed.data && parsed.data.create) {
    const adminGate = await requireAdmin(req, { minRole: 'admin', rateKey: 'places-create' })
    if (!adminGate.ok) return adminGate.response
    const body = parsed.data
    const placeId = `adm_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const createdAt = new Date().toISOString()
    const doc = {
      place_id: placeId,
      name: body.name.trim(),
      city: 'Kigali',
      country: 'Rwanda',
      categories: [body.category],
      description: body.name.trim(),
      address: body.address?.trim() || null,
      location: { type: 'Point', coordinates: [body.longitude, body.latitude] },
      local_business: body.local_business === true,
      accessible: body.accessible === true,
      access: { entrance: body.accessible === true, toilet: false, parking: false },
      status: body.status,
      source: 'admin',
      paused: false,
      archived: false,
      created_at: createdAt,
      added_by: gate.actor.uid,
      views: 0,
      confirmations_count: 0,
    }
    try {
      const sid = await mcpConnected()
      await mcpCall(sid, 'insert-many', { database: DB, collection: 'places', documents: [doc] })
      await writeAudit({
        actor: gate.actor,
        action: 'place.update',
        targetType: 'place',
        targetId: placeId,
        after: { create: true, status: body.status },
      })
      const res = NextResponse.json({ ok: true, place_id: placeId })
      return withSessionRefresh(res, gate.refreshedCookie)
    } catch (err) {
      if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
      return NextResponse.json({ error: 'Could not create place.' }, { status: 500 })
    }
  }

  try {
    const sid = await mcpConnected()
    if ('place_ids' in parsed.data) {
      const { place_ids, status, reason, action } = parsed.data
      const results = []
      for (const id of place_ids) {
        let placeId: string
        try {
          placeId = asId(id, 'place_id')
        } catch {
          results.push({ place_id: id, ok: false, error: 'invalid_id' })
          continue
        }
        const out = await moderateOne(sid, gate, req, placeId, status, reason ?? '', action)
        results.push(out.ok ? { place_id: placeId, ok: true, status: out.status } : { place_id: placeId, ok: false, error: out.error })
      }
      const res = NextResponse.json({ ok: true, results })
      return withSessionRefresh(res, gate.refreshedCookie)
    }

    if (!('place_id' in parsed.data)) {
      return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
    }
    let placeId: string
    try {
      placeId = asId(parsed.data.place_id, 'place_id')
    } catch {
      return NextResponse.json({ error: 'Missing place.' }, { status: 400 })
    }
    const { status, reason, action } = parsed.data
    const out = await moderateOne(sid, gate, req, placeId, status, reason ?? '', action)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    const res = NextResponse.json({ ok: true, place_id: placeId, status: out.status })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update this place.' }, { status: 500 })
  }
}
