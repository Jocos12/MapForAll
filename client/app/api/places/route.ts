import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { accessDetail } from '@/lib/access'
import {
  MAX_PHOTOS,
  PHOTO_LIMIT,
  PLACE_CATEGORIES,
  cleanPhone,
  cleanPhotos,
  cleanTags,
  cleanText,
  toClientPlace,
  writePlacePhotos,
} from '@/lib/places'
import { getSession } from '@/lib/session'
import { MAX_OWNED_PLACES, findUserById, setOwnedPlaces } from '@/lib/users'
import { cleanWeek } from '@/lib/hours'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

let placeIndexesOnce: Promise<void> | null = null

/**
 * Best-effort indexes for the filters the map search actually uses. Opt-in: on
 * the MCP HTTP sidecar a create-index can stall the shared session for 20 s and
 * time out the map query running next to it.
 */
function ensurePlaceIndexes(): void {
  if (process.env.HODARI_ENSURE_INDEXES !== '1' || placeIndexesOnce) return
  placeIndexesOnce = (async () => {
    const sid = await mcpConnected()
    const specs: Array<{ keys: Record<string, unknown>; name: string }> = [
      { keys: { categories: 1 }, name: 'places_categories' },
      { keys: { local_business: 1 }, name: 'places_local_business' },
      { keys: { accessible: 1 }, name: 'places_accessible' },
      { keys: { location: '2dsphere' }, name: 'places_location_2dsphere' },
    ]
    for (const spec of specs) {
      try {
        await mcpCall(sid, 'create-index', {
          database: DB,
          collection: 'places',
          definition: [{ type: 'classic', keys: spec.keys }],
          name: spec.name,
        })
      } catch (err) {
        console.warn(`[places] create-index ${spec.name} failed (non-fatal)`, err)
      }
    }
  })().catch((err) => {
    console.warn('[places] index bootstrap failed (will retry next call)', err)
    placeIndexesOnce = null
  })
}

export async function GET(req: NextRequest) {
  void ensurePlaceIndexes()
  const local = req.nextUrl.searchParams.get('local_business') === '1'
  const accessible = req.nextUrl.searchParams.get('accessible') === '1'
  const category = (req.nextUrl.searchParams.get('category') ?? '').trim().toLowerCase()
  const session = getSession(req)
  const statusOr: Record<string, unknown>[] = [
    { status: 'validated' },
    { status: { $exists: false } },
  ]
  if (session) statusOr.push({ status: 'pending', added_by: session.uid })
  const filter: Record<string, unknown> = { $or: statusOr, paused: { $ne: true } }
  if (local) filter.local_business = true
  if (accessible) filter.accessible = true
  if (category) filter.categories = category
  try {
    const sid = await mcpConnected()
    const texts = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter,
      projection: { photos: 0 },
      sort: { claimed_by_owner: -1, created_at: -1 },
      limit: 200,
    })
    let places = extractDocs(texts)
      .map(toClientPlace)
      .filter((place): place is NonNullable<typeof place> => place !== null)
      .map((place) => (place.photo_url?.startsWith('data:image/')
        ? { ...place, photo_url: `/api/places/photo?placeId=${encodeURIComponent(place.place_id)}&i=0` }
        : place))
    if (accessible) {
      places = places
        .filter((place) => accessDetail(place).entrance)
        .sort((a, b) => {
          const score = accessDetail(b).score - accessDetail(a).score
          if (score !== 0) return score
          return (b.access_confirmations ?? 0) - (a.access_confirmations ?? 0)
        })
    }
    return NextResponse.json({ places })
  } catch (err) {
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable', places: [] }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not load places', places: [] }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in to add a place.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const latitude = Number(body.latitude)
  const longitude = Number(body.longitude)
  if (!name || name.length > 120) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (!PLACE_CATEGORIES.includes(category as (typeof PLACE_CATEGORIES)[number])) {
    return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'A map position is required.' }, { status: 400 })
  }
  const single = typeof body.photo_url === 'string' ? body.photo_url : ''
  if (single && (single.length > PHOTO_LIMIT || !single.startsWith('data:image/'))) {
    return NextResponse.json({ error: 'Photo must be a small image.' }, { status: 400 })
  }
  const photos = cleanPhotos(body.photos) ?? (single ? [single] : [])
  if (Array.isArray(body.photos) && photos.length !== Math.min(body.photos.length, MAX_PHOTOS)) {
    return NextResponse.json({ error: 'Each photo must be a small image.' }, { status: 400 })
  }
  const photo = photos[0] ?? ''
  const claim = body.claim === true
  let ownedBefore: string[] = []
  if (claim) {
    const owner = await findUserById(session.uid)
    if (owner?.role !== 'business_owner') {
      return NextResponse.json({ error: 'Only a business owner can claim a place.' }, { status: 403 })
    }
    if (owner.owned_place_ids.length >= MAX_OWNED_PLACES) {
      return NextResponse.json({ error: `A business account can manage up to ${MAX_OWNED_PLACES} listings.` }, { status: 409 })
    }
    ownedBefore = owner.owned_place_ids
  }
  const hours = typeof body.hours === 'string' ? body.hours.trim().slice(0, 160) : ''
  const rawAccess = body.access && typeof body.access === 'object' ? body.access as Record<string, unknown> : null
  const entrance = rawAccess ? rawAccess.entrance === true : body.accessible === true
  const access = {
    entrance,
    toilet: rawAccess?.toilet === true,
    parking: rawAccess?.parking === true,
  }

  const week = cleanWeek(body.hoursWeek)
  const createdAt = new Date().toISOString()
  const placeId = `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const doc = {
    place_id: placeId,
    name,
    city: 'Kigali',
    country: 'Rwanda',
    categories: [category],
    description: cleanText(body.description, 400) || name,
    address: cleanText(body.address, 200) || null,
    phone: cleanPhone(body.phone) || null,
    tags: cleanTags(body.tags),
    photos: [],
    paused: false,
    recommends: [],
    location: { type: 'Point', coordinates: [longitude, latitude] },
    local_business: claim ? true : body.local_business === true,
    accessible: entrance,
    access,
    status: 'pending',
    source: claim ? 'owner_claimed' : 'user_submitted',
    claimed_by_owner: claim,
    hours: hours || null,
    hours_week: week,
    hours_confirmed_at: week || hours ? createdAt : null,
    access_declared: rawAccess?.declared === true || entrance || access.toilet || access.parking,
    photo_url: null,
    added_by: session.uid,
    confirmations_count: 0,
    views: 0,
    created_at: createdAt,
  }
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'places', documents: [doc] })
    if (claim) await setOwnedPlaces(session.uid, [...ownedBefore, placeId])
    if (photos.length) await writePlacePhotos((tool, args) => mcpCall(sid, tool, args), DB, placeId, photos)
    return NextResponse.json({ ok: true, place_id: placeId, status: 'pending' })
  } catch (err) {
    console.error('[places POST]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not save this place.' }, { status: 500 })
  }
}
