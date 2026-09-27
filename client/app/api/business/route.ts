import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace, reviewKey } from '@/lib/business'
import { cleanWeek, sameWeek } from '@/lib/hours'
import {
  MAX_RECOMMENDS,
  PLACE_CATEGORIES,
  cleanPhone,
  cleanPhotos,
  cleanTags,
  cleanText,
  isPublicPlace,
  storedPhotos,
  toClientPlace,
  writePlacePhotos,
} from '@/lib/places'
import { getSession } from '@/lib/session'
import { setOwnedPlaces } from '@/lib/users'

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function editable(doc: Record<string, unknown>) {
  const access = (doc.access ?? {}) as Record<string, unknown>
  const coords = (doc.location as { coordinates?: unknown[] } | undefined)?.coordinates
  const entrance = access.entrance === true || doc.accessible === true
  const toilet = access.toilet === true
  const parking = access.parking === true
  return {
    name: typeof doc.name === 'string' ? doc.name : '',
    category: Array.isArray(doc.categories) && typeof doc.categories[0] === 'string' ? doc.categories[0] : 'other',
    description: typeof doc.description === 'string' && doc.description !== doc.name ? doc.description : '',
    address: typeof doc.address === 'string' ? doc.address : '',
    phone: typeof doc.phone === 'string' ? doc.phone : '',
    hours: typeof doc.hours === 'string' ? doc.hours : '',
    hoursWeek: cleanWeek(doc.hours_week),
    tags: Array.isArray(doc.tags) ? doc.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    photos: storedPhotos(doc),
    access: {
      entrance,
      toilet,
      parking,
      declared: doc.access_declared === true || entrance || toilet || parking,
    },
    latitude: typeof coords?.[1] === 'number' ? coords[1] : null,
    longitude: typeof coords?.[0] === 'number' ? coords[0] : null,
  }
}

async function safeFind(sid: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  try {
    return extractDocs(await mcpCall(sid, 'find', { database: DB, ...args }))
  } catch (err) {
    console.warn('[business] lookup failed', args.collection, err)
    return []
  }
}

/** The MCP server caps `find` at 100 documents, so every counter is grouped in the database. */
async function safeAggregate(sid: string, collection: string, pipeline: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  try {
    return extractDocs(await mcpCall(sid, 'aggregate', { database: DB, collection, pipeline }))
  } catch (err) {
    console.warn('[business] aggregate failed', collection, err)
    return []
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&')
}

const RWANDA = { south: -2.85, north: -1.04, west: 28.85, east: 30.9 }
const DUPLICATE_METERS = 150

function metersBetween(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

function coordsOf(doc: Record<string, unknown>): [number, number] | null {
  const c = (doc.location as { coordinates?: unknown[] } | undefined)?.coordinates
  return typeof c?.[0] === 'number' && typeof c?.[1] === 'number' ? [c[0], c[1]] : null
}

/**
 * The same four points the moderators look at, run automatically on the listing
 * as submitted. `true` means the check passes; moderators still decide.
 */
function prechecks(doc: Record<string, unknown>, twins: Record<string, unknown>[]) {
  const form = editable(doc)
  const text = `${form.name} ${form.description}`
  const letters = form.name.replace(/[^a-zA-ZÀ-ÿ]/g, '')
  const shouting = letters.length >= 6 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.8
  const here = coordsOf(doc)
  return {
    duplicate: !here || !twins.some((row) => {
      const there = coordsOf(row)
      return !!there && metersBetween(here, there) <= DUPLICATE_METERS
    }),
    spam: !/(https?:\/\/|www\.|\S+@\S+\.\S+)/i.test(text) && !/(.)\1{4,}/.test(text) && !shouting,
    consistent: form.name.trim().length >= 2 && !!form.category && (!!form.address.trim() || form.description.trim().length >= 10),
    position: !!here && here[1] >= RWANDA.south && here[1] <= RWANDA.north && here[0] >= RWANDA.west && here[0] <= RWANDA.east,
  }
}

export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) {
    if (result.response.status === 404) return NextResponse.json({ owned: false, place: null, places: [] })
    return result.response
  }
  const { sid, doc, placeId, places } = result.owned
  if (req.nextUrl.searchParams.get('summary') === '1') return NextResponse.json({ owned: true, places })

  const since90 = new Date(Date.now() - 89 * 86_400_000)
  const recommendIds = Array.isArray(doc.recommends)
    ? doc.recommends.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECOMMENDS)
    : []
  const name = typeof doc.name === 'string' ? doc.name.trim() : ''
  const [viewRows, sourceRows, confirmRows, ratingRows, reviewRows, recommendRows, recommendedByRows, twinRows] = await Promise.all([
    safeAggregate(sid, 'place_views', [
      { $match: { placeId, day: { $gte: dayKey(since90) } } },
      { $group: { _id: { day: '$day', source: '$source' }, count: { $sum: 1 } } },
    ]),
    safeAggregate(sid, 'place_views', [{ $match: { placeId } }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
    safeAggregate(sid, 'place_exists', [{ $match: { placeId } }, { $count: 'n' }]),
    safeAggregate(sid, 'reviews', [
      { $match: { placeId, rating: { $type: 'number' } } },
      { $group: { _id: { $min: [5, { $max: [1, { $round: ['$rating', 0] }] }] }, count: { $sum: 1 } } },
    ]),
    safeFind(sid, { collection: 'reviews', filter: { placeId }, sort: { createdAt: -1 }, limit: 100 }),
    recommendIds.length
      ? safeFind(sid, { collection: 'places', filter: { place_id: { $in: recommendIds } }, projection: { _id: 0, photo_url: 0, photos: 0 }, limit: MAX_RECOMMENDS })
      : Promise.resolve([]),
    safeFind(sid, {
      collection: 'places',
      filter: { recommends: placeId, place_id: { $ne: placeId } },
      projection: { _id: 0, place_id: 1, status: 1, paused: 1 },
      limit: 200,
    }),
    name
      ? safeFind(sid, {
          collection: 'places',
          filter: { place_id: { $ne: placeId }, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
          projection: { _id: 0, place_id: 1, location: 1 },
          limit: 20,
        })
      : Promise.resolve([]),
  ])

  const perDay = new Map<string, { app: number; link: number }>()
  for (const row of viewRows) {
    const key = row._id as { day?: unknown; source?: unknown } | null
    if (typeof key?.day !== 'string') continue
    const slot = perDay.get(key.day) ?? { app: 0, link: 0 }
    if (key.source === 'link') slot.link += count(row.count)
    else slot.app += count(row.count)
    perDay.set(key.day, slot)
  }
  const daily90 = Array.from({ length: 90 }, (_, i) => {
    const day = dayKey(new Date(since90.getTime() + i * 86_400_000))
    const slot = perDay.get(day) ?? { app: 0, link: 0 }
    return { day, count: slot.app + slot.link, app: slot.app, link: slot.link }
  })
  const daily = daily90.slice(-30).map(({ day, count: n }) => ({ day, count: n }))

  const histogram = [0, 0, 0, 0, 0]
  for (const row of ratingRows) {
    const stars = Number(row._id)
    if (stars >= 1 && stars <= 5) histogram[stars - 1] = count(row.count)
  }
  const reviews = reviewRows
    .filter((row) => typeof row.userId === 'string' && typeof row.rating === 'number')
    .map((row) => {
      const rating = Math.min(5, Math.max(1, Math.round(row.rating as number)))
      return {
        key: reviewKey(placeId, row.userId as string),
        firstName: typeof row.firstName === 'string' && row.firstName ? row.firstName : 'Visiteur',
        rating,
        comment: typeof row.comment === 'string' ? row.comment : '',
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
        reply: typeof row.ownerReply === 'string' && row.ownerReply
          ? { text: row.ownerReply, at: typeof row.ownerReplyAt === 'string' ? row.ownerReplyAt : '' }
          : null,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const reviewCount = histogram.reduce((sum, n) => sum + n, 0)
  const average = reviewCount
    ? Math.round((histogram.reduce((sum, n, i) => sum + n * (i + 1), 0) / reviewCount) * 10) / 10
    : null
  const views30 = daily.reduce((sum, row) => sum + row.count, 0)
  const views7 = daily.slice(-7).reduce((sum, row) => sum + row.count, 0)
  const viewsPrev7 = daily.slice(-14, -7).reduce((sum, row) => sum + row.count, 0)

  const reach = { app: 0, link: 0 }
  for (const row of sourceRows) {
    if (row._id === 'app' || row._id === 'link') reach[row._id] = count(row.count)
  }
  const dateOf = (value: unknown) => (typeof value === 'string' && value ? value : null)

  const byId = new Map(recommendRows.map((row) => [row.place_id, row]))
  const recommends = recommendIds
    .map((id) => byId.get(id))
    .filter((row): row is Record<string, unknown> => !!row)
    .map((row) => ({
      place_id: row.place_id as string,
      name: typeof row.name === 'string' ? row.name : '',
      categories: Array.isArray(row.categories) ? row.categories : [],
    }))

  return NextResponse.json({
    owned: true,
    places,
    place: toClientPlace(doc),
    form: editable(doc),
    hoursConfirmedAt: typeof doc.hours_confirmed_at === 'string' ? doc.hours_confirmed_at : null,
    recommendedBy: recommendedByRows.filter(isPublicPlace).length,
    checks: prechecks(doc, twinRows),
    timeline: {
      createdAt: dateOf(doc.created_at),
      moderatedAt: dateOf(doc.moderated_at),
      resubmittedAt: dateOf(doc.resubmitted_at),
    },
    stats: {
      reach,
      views: Math.max(typeof doc.views === 'number' ? doc.views : 0, views30),
      views7,
      viewsPrev7,
      views30,
      daily,
      daily90,
      confirmations: count(confirmRows[0]?.n),
      reviewCount,
      average,
      histogram,
    },
    reviews,
    recommends,
  })
}

const SUBSTANTIAL = ['name', 'category', 'address', 'location'] as const

export async function PATCH(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, doc, placeId } = result.owned
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const before = editable(doc)
  const set: Record<string, unknown> = {}
  const changed = new Set<string>()
  const now = new Date().toISOString()
  let nextPhotos: string[] | null = null

  if ('name' in body) {
    const name = cleanText(body.name, 120)
    if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
    if (name !== before.name) { set.name = name; changed.add('name') }
  }
  if ('category' in body) {
    const category = cleanText(body.category, 40)
    if (!PLACE_CATEGORIES.includes(category as (typeof PLACE_CATEGORIES)[number])) {
      return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })
    }
    if (category !== before.category) { set.categories = [category]; changed.add('category') }
  }
  if ('address' in body) {
    const address = cleanText(body.address, 200)
    if (address !== before.address) { set.address = address || null; changed.add('address') }
  }
  if ('latitude' in body && 'longitude' in body) {
    const lat = Number(body.latitude)
    const lng = Number(body.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: 'A map position is required.' }, { status: 400 })
    }
    if (lat !== before.latitude || lng !== before.longitude) {
      set.location = { type: 'Point', coordinates: [lng, lat] }
      changed.add('location')
    }
  }
  if ('description' in body) {
    const description = cleanText(body.description, 400)
    if (description !== before.description) { set.description = description || set.name || before.name; changed.add('description') }
  }
  if ('hoursWeek' in body && body.hoursWeek != null) {
    const week = cleanWeek(body.hoursWeek)
    if (!week) return NextResponse.json({ error: 'Invalid opening hours.' }, { status: 400 })
    const summary = cleanText(body.hours, 160)
    if (!sameWeek(week, before.hoursWeek) || (summary && summary !== before.hours)) {
      set.hours_week = week
      if (summary) set.hours = summary
      set.hours_confirmed_at = now
      changed.add('hours')
    }
  } else if ('hours' in body) {
    const hours = cleanText(body.hours, 160)
    if (hours !== before.hours) { set.hours = hours || null; set.hours_confirmed_at = now; changed.add('hours') }
  }
  if (body.confirmHours === true) {
    set.hours_confirmed_at = now
    changed.add('hoursConfirmed')
  }
  if ('phone' in body) {
    const raw = cleanText(body.phone, 30)
    const phone = cleanPhone(raw)
    if (raw && !phone) return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 })
    if (phone !== before.phone) { set.phone = phone || null; changed.add('phone') }
  }
  if ('tags' in body) {
    const tags = cleanTags(body.tags)
    if (tags.join('|') !== before.tags.join('|')) { set.tags = tags; changed.add('tags') }
  }
  if ('photos' in body) {
    const photos = cleanPhotos(body.photos)
    if (!photos || (Array.isArray(body.photos) && photos.length !== Math.min(body.photos.length, 4))) {
      return NextResponse.json({ error: 'Each photo must be a small image.' }, { status: 400 })
    }
    if (photos.join('|') !== before.photos.join('|')) {
      nextPhotos = photos
      changed.add('photos')
    }
  }
  if (body.access && typeof body.access === 'object') {
    const raw = body.access as Record<string, unknown>
    const access = { entrance: raw.entrance === true, toilet: raw.toilet === true, parking: raw.parking === true }
    const declared = raw.declared === true || access.entrance || access.toilet || access.parking
    const prior = { entrance: before.access.entrance, toilet: before.access.toilet, parking: before.access.parking }
    if (JSON.stringify(access) !== JSON.stringify(prior) || declared !== before.access.declared) {
      set.access = access
      set.accessible = access.entrance
      set.access_declared = declared
      changed.add('access')
    }
  }
  if ('recommends' in body) {
    const ids = Array.isArray(body.recommends)
      ? [...new Set(body.recommends.filter((id): id is string => typeof id === 'string' && !!id && id.length <= 160 && id !== placeId))].slice(0, MAX_RECOMMENDS)
      : []
    const found = ids.length
      ? extractDocs(await mcpCall(sid, 'find', {
          database: DB,
          collection: 'places',
          filter: { place_id: { $in: ids } },
          projection: { _id: 0, place_id: 1, status: 1, paused: 1 },
          limit: MAX_RECOMMENDS,
        }))
      : []
    const valid = new Set(found.filter(isPublicPlace).map((row) => row.place_id))
    set.recommends = ids.filter((id) => valid.has(id))
    changed.add('recommends')
  }

  if (changed.size === 0) {
    return NextResponse.json({ ok: true, changed: [], status: doc.status ?? 'pending', remoderated: false })
  }

  const substantial = SUBSTANTIAL.some((field) => changed.has(field))
  const previous = typeof doc.status === 'string' ? doc.status : 'validated'
  const contentEdit = [...changed].some((field) => field !== 'recommends' && field !== 'hoursConfirmed')
  let status = previous
  if (substantial || (previous === 'rejected' && contentEdit)) {
    status = 'pending'
    set.status = 'pending'
    set.rejection_reason = ''
    set.resubmitted_at = now
  }
  set.updated_at = now

  try {
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: placeId },
      update: { $set: set },
    })
    if (nextPhotos) await writePlacePhotos((tool, args) => mcpCall(sid, tool, args), DB, placeId, nextPhotos)
    return NextResponse.json({
      ok: true,
      changed: [...changed],
      status,
      remoderated: status === 'pending' && previous !== 'pending',
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save your changes.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, doc, placeId, user } = result.owned
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const mode = body.mode

  try {
    if (mode === 'pause' || mode === 'resume') {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'places',
        filter: { place_id: placeId },
        update: { $set: { paused: mode === 'pause', updated_at: new Date().toISOString() } },
      })
      return NextResponse.json({ ok: true, paused: mode === 'pause' })
    }
    if (mode === 'close') {
      const typed = cleanText(body.confirmName, 120).toLowerCase()
      const name = (typeof doc.name === 'string' ? doc.name : '').trim().toLowerCase()
      if (!typed || typed !== name) {
        return NextResponse.json({ error: 'Type the exact business name to confirm.' }, { status: 400 })
      }
      await mcpCall(sid, 'delete-many', { database: DB, collection: 'places', filter: { place_id: placeId } })
      await Promise.all(
        ['reviews', 'place_views', 'place_exists', 'access_votes'].map((collection) =>
          mcpCall(sid, 'delete-many', { database: DB, collection, filter: { placeId } }).catch((err) => {
            console.warn('[business] cleanup failed', collection, err)
          }),
        ),
      )
      const remaining = user.owned_place_ids.filter((id) => id !== placeId)
      await setOwnedPlaces(user.user_id, remaining)
      return NextResponse.json({ ok: true, closed: true, remaining: remaining.length })
    }
    return NextResponse.json({ error: 'Mode must be pause, resume or close.' }, { status: 400 })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update your listing.' }, { status: 500 })
  }
}
