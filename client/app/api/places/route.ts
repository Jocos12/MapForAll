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
import { buildTextMatchOr, filterByTextRelevance, textRelevance } from '@/lib/placeTextMatch'
import { getSession } from '@/lib/session'
import { MAX_OWNED_PLACES, findUserById, setOwnedPlaces } from '@/lib/users'
import { cleanWeek } from '@/lib/hours'
import { duplicateSearchToken, findDuplicatePlace, normalizePlaceLabel } from '@/lib/placeDedupe'
import { isPublished } from '@/lib/listingLifecycle'
import { claimPayloadSchema } from '@/lib/businessFormSchema'
import { logSpan } from '@/lib/devTiming'
import { invalidatePrefix, ttlGet, ttlSet } from '@/lib/ttlCache'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
      // name + description + tags for catalog text search (cahier search fidelity)
      {
        keys: { name: 'text', description: 'text', summary: 'text', tags: 'text', categories: 'text' },
        name: 'places_text_name_desc',
      },
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

const PUBLIC_HIDDEN = ['draft', 'submitted', 'in_review', 'pending', 'changes_requested', 'rejected', 'paused', 'archived']

export async function GET(req: NextRequest) {
  const started = Date.now()
  void ensurePlaceIndexes()
  const local = req.nextUrl.searchParams.get('local_business') === '1'
  const accessible = req.nextUrl.searchParams.get('accessible') === '1'
  const category = (req.nextUrl.searchParams.get('category') ?? '').trim().toLowerCase()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120)
  const cacheKey = `places:${req.nextUrl.search}`
  const cached = ttlGet<{ places: unknown[] }>(cacheKey)
  if (cached) {
    logSpan('api', 'GET /api/places cache', Date.now() - started)
    return NextResponse.json(cached)
  }
  const filter: Record<string, unknown> = {
    paused: { $ne: true },
    archived: { $ne: true },
    status: { $nin: PUBLIC_HIDDEN },
  }
  if (local) filter.local_business = true
  if (accessible) filter.accessible = true
  if (category) filter.categories = category
  if (q) {
    // Name (exact/phrase) + description/tags/address token+synonym match.
    // Exact name search is preserved via the phrase clause in buildTextMatchOr.
    const textOr = buildTextMatchOr(q)
    if (textOr.length) {
      filter.$and = [...(Array.isArray(filter.$and) ? filter.$and as unknown[] : []), { $or: textOr }]
    }
  }
  try {
    const sid = await mcpConnected()
    const texts = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'places',
      filter,
      projection: { photos: 0 },
      sort: { claimed_by_owner: -1, local_business: -1, created_at: -1 },
      limit: q ? 80 : 200,
    })
    let docs = extractDocs(texts)
    if (q) {
      // Drop weak / accidental matches (e.g. sushi must not pull a coffee shop).
      docs = filterByTextRelevance(
        docs.map((d) => ({
          ...d,
          name: typeof d.name === 'string' ? d.name : '',
          description: typeof d.description === 'string' ? d.description : '',
          summary: typeof d.summary === 'string' ? d.summary : '',
          address: typeof d.address === 'string' ? d.address : '',
          tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
          categories: Array.isArray(d.categories) ? d.categories.filter((t): t is string => typeof t === 'string') : [],
          local_business: d.local_business === true,
        })),
        q,
      ) as typeof docs
      docs = [...docs].sort((a, b) => {
        const sa = textRelevance({
          name: String(a.name ?? ''),
          description: String(a.description ?? ''),
          summary: String(a.summary ?? ''),
          tags: Array.isArray(a.tags) ? a.tags as string[] : [],
          local_business: a.local_business === true,
        }, q)
        const sb = textRelevance({
          name: String(b.name ?? ''),
          description: String(b.description ?? ''),
          summary: String(b.summary ?? ''),
          tags: Array.isArray(b.tags) ? b.tags as string[] : [],
          local_business: b.local_business === true,
        }, q)
        return sb - sa
      })
    }
    let places = docs
      .filter((doc) => isPublished(doc))
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
    if (q) places = places.slice(0, 40)
    const payload = { places }
    ttlSet(cacheKey, payload, 45_000)
    logSpan('api', 'GET /api/places', Date.now() - started)
    return NextResponse.json(payload)
  } catch (err) {
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable', places: [] }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not load places', places: [] }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
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
  const claim = body.claim === true
  if (claim) {
    const checked = claimPayloadSchema.safeParse({
      name,
      category,
      phone: typeof body.phone === 'string' ? body.phone : '',
      description: typeof body.description === 'string' ? body.description : '',
      address: typeof body.address === 'string' ? body.address : '',
      latitude,
      longitude,
      hoursWeek: body.hoursWeek ?? null,
      photos,
    })
    if (!checked.success) {
      const fields = [...new Set(checked.error.issues.map((issue) => String(issue.path[0] ?? 'form')))]
      return NextResponse.json({ error: 'Check the highlighted fields.', fields }, { status: 400 })
    }
  }
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
  const idempotencyKey = (req.headers.get('idempotency-key') ?? '').trim().slice(0, 80)
  // New listings wait for an admin. They are not on the public map until validated.
  const status = claim ? 'in_review' : 'pending'
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
    status,
    source: claim ? 'owner_claimed' : 'user_submitted',
    claimed_by_owner: claim,
    hours: hours || null,
    hours_week: week,
    hours_confirmed_at: week || hours ? createdAt : null,
    access_declared: rawAccess?.declared === true || entrance || access.toilet || access.parking,
    photo_url: null,
    photo_count: 0,
    added_by: session.uid,
    owner_id: claim ? session.uid : null,
    idempotency_key: idempotencyKey || null,
    confirmations_count: 0,
    views: 0,
    created_at: createdAt,
  }
  try {
    const sid = await mcpConnected()
    if (idempotencyKey && claim) {
      const prior = extractDocs(await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { idempotency_key: idempotencyKey, owner_id: session.uid },
        projection: { place_id: 1, status: 1 },
        limit: 1,
      }))[0]
      if (prior?.place_id) {
        return NextResponse.json({ ok: true, place_id: String(prior.place_id), status: prior.status ?? status, idempotent: true })
      }
    }
    const phoneDigits = cleanPhone(body.phone).replace(/\D/g, '')
    const googleId = typeof body.google_place_id === 'string' ? body.google_place_id.trim() : ''
    const token = duplicateSearchToken(name)
    const dupOr: Record<string, unknown>[] = []
    if (token) dupOr.push({ name: { $regex: escapeRegex(token), $options: 'i' } })
    if (phoneDigits.length >= 8) dupOr.push({ phone: { $regex: escapeRegex(phoneDigits.slice(-9)) } })
    if (googleId) dupOr.push({ google_place_id: googleId }, { maps_place_id: googleId }, { place_id: googleId })
    if (claim) dupOr.push({ owner_id: session.uid, name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' } })
    if (dupOr.length) {
      const existing = extractDocs(
        await mcpCall(sid, 'find', {
          database: DB,
          collection: 'places',
          filter: { $or: dupOr, status: { $ne: 'archived' } },
          projection: { name: 1, place_id: 1, address: 1, location: 1, google_place_id: 1, maps_place_id: 1, phone: 1, owner_id: 1, added_by: 1 },
          limit: 40,
        }),
      )
      const duplicate = findDuplicatePlace(
        { name, address: typeof doc.address === 'string' ? doc.address : undefined, coordinates: { lat: latitude, lng: longitude }, phone: phoneDigits, google_place_id: googleId },
        existing,
      )
      const sameOwner = existing.some((row) => (
        (row.owner_id === session.uid || row.added_by === session.uid)
        && normalizePlaceLabel(typeof row.name === 'string' ? row.name : '') === normalizePlaceLabel(name)
      ))
      const samePhone = !!phoneDigits && phoneDigits.length >= 8 && existing.some((row) => (
        typeof row.phone === 'string' && row.phone.replace(/\D/g, '') === phoneDigits
      ))
      const sameGoogle = !!googleId && existing.some((row) => row.google_place_id === googleId || row.maps_place_id === googleId || row.place_id === googleId)
      if (duplicate?.place_id || sameOwner || samePhone || sameGoogle) {
        const hit = duplicate?.place_id ?? existing[0]?.place_id
        return NextResponse.json(
          { error: 'This place already exists.', code: 'duplicate', place_id: hit ? String(hit) : undefined },
          { status: 409 },
        )
      }
    }
    invalidatePrefix('places:')
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'places', documents: [doc] })
    if (claim) await setOwnedPlaces(session.uid, [...ownedBefore, placeId])
    if (photos.length) await writePlacePhotos((tool, args) => mcpCall(sid, tool, args), DB, placeId, photos)
    return NextResponse.json({ ok: true, place_id: placeId, status })
  } catch (err) {
    console.error('[places POST]', err)
    if (isMcpUnavailable(err)) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Could not save this place.' }, { status: 500 })
  }
}
