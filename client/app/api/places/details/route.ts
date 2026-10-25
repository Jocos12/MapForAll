import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY ?? ''
const FIELD_MASK = [
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'photos',
  'regularOpeningHours',
  'currentOpeningHours',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'accessibilityOptions',
  'priceLevel',
  'editorialSummary',
  'types',
].join(',')

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 80

type CacheEntry = { at: number; body: unknown }
const cache = new Map<string, CacheEntry>()

function remember(id: string, body: unknown) {
  cache.delete(id)
  cache.set(id, { at: Date.now(), body })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
}

function cached(id: string): unknown | null {
  const hit = cache.get(id)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(id)
    return null
  }
  cache.delete(id)
  cache.set(id, hit)
  return hit.body
}

const PRICE: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
}

function textOf(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const text = (value as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

function flag(source: unknown, key: string): boolean | null {
  if (!source || typeof source !== 'object' || !(key in source)) return null
  const value = (source as Record<string, unknown>)[key]
  if (value === true) return true
  if (value === false) return false
  return null
}

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get('placeId')?.trim() ?? ''
  if (!placeId || placeId.includes('/') || placeId.length > 320) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  }
  const hit = cached(placeId)
  if (hit) return NextResponse.json(hit)
  if (!KEY) {
    return NextResponse.json({ error: 'Server maps key not configured' }, { status: 500 })
  }

  let res: Response
  try {
    res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Places request failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const raw = await res.text()
  let data: Record<string, unknown> | null = null
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : null } catch { data = null }
  if (!res.ok || !data) {
    const err = data?.error
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: string }).message || 'Places request failed')
      : 'Places request failed'
    const status = res.status === 400 || res.status === 404 ? res.status
      : res.status === 401 || res.status === 403 ? 403
        : 502
    return NextResponse.json({ error: message }, { status })
  }

  const photos = Array.isArray(data.photos) ? data.photos : []
  const photoUrls = photos.slice(0, 5).flatMap((photo) => {
    if (!photo || typeof photo !== 'object' || !('name' in photo)) return []
    const name = String((photo as { name?: string }).name || '')
    if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/.test(name)) return []
    return [`/api/place-photo?name=${encodeURIComponent(name)}`]
  })
  const regular = (data.regularOpeningHours ?? {}) as { weekdayDescriptions?: unknown; openNow?: unknown }
  const current = (data.currentOpeningHours ?? {}) as { weekdayDescriptions?: unknown; openNow?: unknown }
  const weekdayText = Array.isArray(current.weekdayDescriptions) && current.weekdayDescriptions.length
    ? current.weekdayDescriptions.filter((line): line is string => typeof line === 'string')
    : Array.isArray(regular.weekdayDescriptions)
      ? regular.weekdayDescriptions.filter((line): line is string => typeof line === 'string')
      : []
  const location = (data.location ?? {}) as { latitude?: unknown; longitude?: unknown }
  const phone = typeof data.nationalPhoneNumber === 'string' && data.nationalPhoneNumber
    ? data.nationalPhoneNumber
    : typeof data.internationalPhoneNumber === 'string' ? data.internationalPhoneNumber : ''
  const body = {
    name: textOf(data.displayName),
    address: typeof data.formattedAddress === 'string' ? data.formattedAddress : '',
    lat: typeof location.latitude === 'number' ? location.latitude : null,
    lng: typeof location.longitude === 'number' ? location.longitude : null,
    rating: typeof data.rating === 'number' ? data.rating : null,
    ratingCount: typeof data.userRatingCount === 'number' ? data.userRatingCount : null,
    photos: photoUrls,
    openNow: typeof current.openNow === 'boolean' ? current.openNow : typeof regular.openNow === 'boolean' ? regular.openNow : null,
    weekdayText,
    todayIndex: new Date().getDay(),
    phone,
    website: typeof data.websiteUri === 'string' ? data.websiteUri : '',
    price: typeof data.priceLevel === 'string' ? PRICE[data.priceLevel] ?? null : null,
    summary: textOf(data.editorialSummary),
    accessibility: {
      entrance: flag(data.accessibilityOptions, 'wheelchairAccessibleEntrance'),
      toilet: flag(data.accessibilityOptions, 'wheelchairAccessibleRestroom'),
      parking: flag(data.accessibilityOptions, 'wheelchairAccessibleParking'),
      seating: flag(data.accessibilityOptions, 'wheelchairAccessibleSeating'),
    },
  }
  remember(placeId, body)
  return NextResponse.json(body)
}
