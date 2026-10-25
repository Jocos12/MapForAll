import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh, type AdminActor } from '@/lib/adminAuth'
import {
  DB,
  computeDuplicateHints,
  matchesFilters,
  sortPlaces,
  placeStatus,
  toAdminPlace,
  withPhotoProxy,
  type PlacesListQuery,
} from '@/lib/adminPlaces'
import { linkValidatedOwner, notifyAuthorModeration } from '@/lib/adminPlaceModeration'
import { writeAudit } from '@/lib/audit'
import { asId } from '@/lib/session'
import { chooseKeeper, mergedKeeperPatch } from '@/lib/listingMerge'
import { invalidatePrefix, ttlGet, ttlSet } from '@/lib/ttlCache'
import { logSpan } from '@/lib/devTiming'

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
  reason: z.string().max(500).optional().default(''),
  action: z.enum(['request_changes', 'merge']).optional(),
  merge_into: z.string().min(1).max(200).optional(),
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

const PlaceOp = z.object({
  op: z.enum(['delete', 'restore', 'pause', 'unpause', 'revert']),
  place_id: z.string().min(1).max(200),
  confirm: z.string().max(200).optional(),
  forever: z.boolean().optional(),
  override: z.boolean().optional(),
  status: z.string().max(40).optional(),
})

const PostBody = z.union([PlaceOp, ModerateBulk, ModerateSingle, AdminCreateBody])

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
    limit: 2000,
  })
  return extractDocs(texts)
}

function statusTotals(rows: Record<string, unknown>[]) {
  const totals = {
    all: 0, validated: 0, pending: 0, in_review: 0, changes_requested: 0,
    rejected: 0, paused: 0, archived: 0, draft: 0, deleted: 0,
  }
  for (const row of rows) {
    const status = placeStatus(row)
    if (status === 'deleted') totals.deleted += 1
    else if (status === 'archived') totals.archived += 1
    else if (status === 'paused') totals.paused += 1
    else if (status === 'pending') totals.pending += 1
    else if (status === 'in_review' || status === 'submitted') totals.in_review += 1
    else if (status === 'changes_requested') totals.changes_requested += 1
    else if (status === 'rejected') totals.rejected += 1
    else if (status === 'draft') totals.draft += 1
    else totals.validated += 1
    if (status !== 'deleted' && status !== 'archived') totals.all += 1
  }
  return totals
}

function buildPlaceMongoFilter(q: {
  status?: string
  category?: string
  source?: string
  local?: string
  accessible?: string
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {}
  if (q.status !== 'deleted') filter.deleted_at = { $exists: false }
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
  const started = Date.now()
  const cacheKey = `admin:places:${req.nextUrl.searchParams.toString()}`
  const cached = ttlGet<Record<string, unknown>>(cacheKey)
  if (cached) {
    const hit = NextResponse.json(cached)
    hit.headers.set('Cache-Control', 'private, max-age=15')
    logSpan('api', 'admin.places', Date.now() - started)
    return withSessionRefresh(hit, gate.refreshedCookie)
  }
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
    const counted = raw.filter((doc) => matchesFilters(doc, { ...listQuery, status: undefined, includeHidden: true }))
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
    const totals = statusTotals(counted)
    const body = { items, total, page: q.page, duplicatesHints, totals }
    ttlSet(cacheKey, body, 15_000)
    const res = NextResponse.json(body)
    res.headers.set('Cache-Control', 'private, max-age=20')
    logSpan('api', 'admin.places', Date.now() - started)
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
  mergeInto?: string,
) {
  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),
  )[0]
  if (!existing) return { ok: false as const, status: 404, error: 'Place not found.' }
  if (existing.deleted_at || existing.status === 'deleted') {
    return { ok: false as const, status: 409, error: 'This place is deleted.' }
  }
  const comment = reason.trim()
  if ((action === 'request_changes' || (status === 'rejected' && action !== 'merge')) && comment.length < 3) {
    return { ok: false as const, status: 400, error: 'A comment is required.' }
  }

  if (action === 'merge') {
    const targetId = mergeInto || ''
    if (!targetId || targetId === placeId) return { ok: false as const, status: 400, error: 'Choose the listing to keep.' }
    const other = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: targetId }, limit: 1 }),
    )[0]
    if (!other) return { ok: false as const, status: 404, error: 'Place not found.' }
    const { keeper, loser } = chooseKeeper(existing, other)
    const keeperId = String(keeper.place_id)
    const loserId = String(loser.place_id)
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: keeperId },
      update: { $set: mergedKeeperPatch(keeper, loser) },
    })
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: loserId },
      update: {
        $set: {
          status: 'archived',
          archived: true,
          paused: true,
          redirect_place_id: keeperId,
          moderated_at: new Date().toISOString(),
          moderated_by: gate.actor.uid,
        },
      },
    })
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'reviews',
      filter: { placeId: loserId },
      update: { $set: { placeId: keeperId } },
    }).catch(() => [])
    invalidatePrefix('places:')
    await writeAudit({
      actor: gate.actor,
      action: 'place.merge',
      targetType: 'place',
      targetId: keeperId,
      before: { status: existing.status, loser: loserId },
      after: { status: keeper.status ?? 'validated', redirect_place_id: keeperId, reason: comment },
    })
    return { ok: true as const, place_id: placeId, status: 'archived', kept: keeperId }
  }

  const effectiveStatus = action === 'request_changes' ? 'changes_requested' : status
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'places',
    filter: { place_id: placeId },
    update: {
      $set: {
        status: effectiveStatus,
        paused: false,
        rejection_reason: effectiveStatus === 'validated' ? '' : comment,
        moderated_at: new Date().toISOString(),
        moderated_by: gate.actor.uid,
        ...(effectiveStatus === 'validated'
          ? { validated_at: new Date().toISOString(), validated_by: gate.actor.uid }
          : {}),
      },
    },
  })
  invalidatePrefix('places:')
  if (effectiveStatus === 'validated') await linkValidatedOwner(placeId, existing)
  const placeName = typeof existing.name === 'string' ? existing.name : placeId
  const addedBy = typeof existing.owner_id === 'string' ? existing.owner_id : typeof existing.added_by === 'string' ? existing.added_by : undefined
  if (effectiveStatus === 'validated' || effectiveStatus === 'rejected' || effectiveStatus === 'changes_requested') {
    await notifyAuthorModeration({
      addedBy,
      placeName,
      status: effectiveStatus,
      reason: comment,
      appUrl: appOrigin(req),
    })
  }
  await writeAudit({
    actor: gate.actor,
    action: effectiveStatus === 'validated' ? 'place.validate' : effectiveStatus === 'changes_requested' ? 'place.request_changes' : 'place.reject',
    targetType: 'place',
    targetId: placeId,
    before: { status: existing.status ?? null },
    after: { status: effectiveStatus, reason: comment, action: action ?? null },
  })
  return { ok: true as const, place_id: placeId, status: effectiveStatus }
}

const REVERT_STATUSES = new Set(['draft', 'pending', 'submitted', 'in_review', 'validated', 'changes_requested', 'rejected', 'paused', 'archived'])

async function handlePlaceOp(
  gate: { actor: AdminActor },
  body: { op: string; place_id: string; confirm?: string; forever?: boolean; override?: boolean; status?: string },
) {
  const sid = await mcpConnected()
  const placeId = body.place_id
  const existing = extractDocs(await mcpCall(sid, 'find', {
    database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1,
  }))[0]
  if (!existing) return NextResponse.json({ error: 'Place not found.' }, { status: 404 })
  const name = typeof existing.name === 'string' ? existing.name : ''
  const before = { status: existing.status ?? null, paused: existing.paused === true, deleted_at: existing.deleted_at ?? null }

  if (body.op === 'delete') {
    const confirm = (body.confirm ?? '').trim()
    if (confirm !== name && confirm !== 'DELETE') {
      return NextResponse.json({ error: 'Type the place name or DELETE to confirm.' }, { status: 400 })
    }
    const openReport = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: 'place_reports',
      filter: { place_id: placeId, status: { $in: ['open', 'pending'] } },
      limit: 1,
    }).catch(() => []))[0]
    if ((openReport || existing.subscription_status === 'active') && !body.override) {
      return NextResponse.json({ error: 'Open reports or an active subscription block deletion unless you override.', code: 'blocked' }, { status: 409 })
    }
    if (body.forever) {
      if (gate.actor.role !== 'admin') return NextResponse.json({ error: 'Only an admin can delete forever.' }, { status: 403 })
      await mcpCall(sid, 'delete-many', { database: DB, collection: 'places', filter: { place_id: placeId } })
    } else {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'places',
        filter: { place_id: placeId },
        update: {
          $set: {
            status: 'deleted',
            deleted_at: new Date().toISOString(),
            deleted_by: gate.actor.uid,
            previous_status: typeof existing.status === 'string' ? existing.status : 'validated',
          },
        },
      })
    }
    invalidatePrefix('places:')
    invalidatePrefix('admin:places')
    await writeAudit({ actor: gate.actor, action: 'place.delete', targetType: 'place', targetId: placeId, before, after: { forever: !!body.forever }, meta: { reason: confirm } })
    return NextResponse.json({ ok: true, status: 'deleted' })
  }

  if (body.op === 'restore') {
    if (typeof existing.deleted_at !== 'string') return NextResponse.json({ error: 'This place is not deleted.' }, { status: 400 })
    const age = Date.now() - Date.parse(existing.deleted_at)
    if (Number.isFinite(age) && age > 30 * 86_400_000) {
      return NextResponse.json({ error: 'The 30-day restore window has passed.' }, { status: 410 })
    }
    const status = typeof existing.previous_status === 'string' ? existing.previous_status : 'validated'
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      update: { $set: { status }, $unset: { deleted_at: '', deleted_by: '' } },
    })
    invalidatePrefix('places:')
    await writeAudit({ actor: gate.actor, action: 'place.update', targetType: 'place', targetId: placeId, before, after: { status, restored: true } })
    return NextResponse.json({ ok: true, status })
  }

  if (body.op === 'pause' || body.op === 'unpause') {
    const paused = body.op === 'pause'
    await mcpCall(sid, 'update-many', {
      database: DB, collection: 'places', filter: { place_id: placeId }, update: { $set: { paused } },
    })
    invalidatePrefix('places:')
    await writeAudit({ actor: gate.actor, action: 'place.pause', targetType: 'place', targetId: placeId, before, after: { paused } })
    return NextResponse.json({ ok: true, paused })
  }

  if (body.op === 'revert') {
    const status = body.status ?? ''
    if (!REVERT_STATUSES.has(status) || existing.deleted_at) {
      return NextResponse.json({ error: 'That status change is not allowed.' }, { status: 409 })
    }
    await mcpCall(sid, 'update-many', {
      database: DB, collection: 'places', filter: { place_id: placeId }, update: { $set: { status, paused: status === 'paused' } },
    })
    invalidatePrefix('places:')
    await writeAudit({ actor: gate.actor, action: 'place.update', targetType: 'place', targetId: placeId, before, after: { status, undo: true } })
    return NextResponse.json({ ok: true, status })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-post' })
  if (!gate.ok) return gate.response

  const raw = await req.json().catch(() => null)
  const parsed = PostBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.', details: parsed.error.flatten() }, { status: 400 })
  }

  if ('op' in parsed.data) {
    return withSessionRefresh(await handlePlaceOp(gate, parsed.data), gate.refreshedCookie)
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
    const { status, reason, action, merge_into: mergeInto } = parsed.data
    const out = await moderateOne(sid, gate, req, placeId, status, reason ?? '', action, mergeInto)
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
    const res = NextResponse.json({ ok: true, place_id: placeId, status: out.status })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update this place.' }, { status: 500 })
  }
}
