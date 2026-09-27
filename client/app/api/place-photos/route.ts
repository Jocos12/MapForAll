import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

const KEY =
  process.env.GOOGLE_MAPS_SERVER_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  ''

const KIGALI = { lat: -1.9441, lng: 30.0619 }
const DETAIL_TTL_MS = 30 * 60_000
const detailCache = new Map<string, { at: number; body: unknown }>()

function cachedDetail(key: string): unknown | null {
  const hit = detailCache.get(key)
  if (!hit || Date.now() - hit.at > DETAIL_TTL_MS) return null
  return hit.body
}

function rememberDetail(key: string, body: unknown) {
  detailCache.set(key, { at: Date.now(), body })
  if (detailCache.size > 80) {
    const oldest = detailCache.keys().next().value
    if (oldest) detailCache.delete(oldest)
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

type PhotoRef = { photo_reference?: string; html_attributions?: string[] }

/** Internal ids (kgl_, custom slugs). Google Place IDs are mixed-case and have no word underscores. */
function isCatalogId(id: string): boolean {
  return (
    id.startsWith('kgl_') ||
    id.startsWith('user_') ||
    id.startsWith('pin:') ||
    id.startsWith('__') ||
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(id)
  )
}

function humanizeId(id: string): string {
  return id.replace(/^custom_/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function placeholderFor(label: string): string {
  const text = label.toLowerCase()
  if (/market|super|shop|duka|caplaki|kimironko|nyabugogo|galette|simba|viva|frulep|sawa/.test(text)) {
    return '/landing/kigali-market-real.jpg'
  }
  if (/caf|coffee|java|bourbon|question|joint|ndoli/.test(text)) return '/landing/kigali-table.jpg'
  if (/pharm/.test(text)) return '/landing/kigali-street-real.jpg'
  if (/hotel|stadium|memorial|library|centre|center/.test(text)) return '/landing/kigali-view-real.jpg'
  return '/landing/kigali-hills.jpg'
}

function storedPhotoUrls(doc: Record<string, unknown>): string[] {
  const urls: string[] = []
  const push = (value: unknown) => {
    if (typeof value !== 'string' || !value) return
    if (!urls.includes(value)) urls.push(value)
  }
  push(doc.photo_url)
  if (Array.isArray(doc.photos)) doc.photos.forEach(push)
  return urls.slice(0, 4)
}

async function findCatalogPlace(placeId: string): Promise<Record<string, unknown> | null> {
  const sid = await mcpConnected()
  const docs = extractDocs(await mcpCall(sid, 'find', {
    database: DB,
    collection: 'places',
    filter: { place_id: placeId },
    limit: 1,
  }))
  return docs[0] ?? null
}

async function rememberCatalogPhotos(placeId: string, photoUrls: string[]) {
  if (!photoUrls.length) return
  const sid = await mcpConnected()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'places',
    filter: { place_id: placeId },
    update: { $set: { photo_url: photoUrls[0], photos: photoUrls } },
  })
}

async function photosForName(query: string): Promise<{ photoUrls: string[]; attribution: string }> {
  if (!KEY || !query.trim()) return { photoUrls: [], attribution: '' }
  const searchUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&location=${KIGALI.lat},${KIGALI.lng}&radius=20000` +
    `&key=${KEY}`
  const searchRes = await fetch(searchUrl)
  const search = await searchRes.json()
  const hit = (search.results ?? []).find((row: { photos?: PhotoRef[] }) => (row.photos?.length ?? 0) > 0)
    ?? search.results?.[0]
  if (search.status !== 'OK' || !hit) return { photoUrls: [], attribution: '' }
  const details = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(hit.place_id)}` +
      `&fields=${encodeURIComponent('photos')}` +
      `&key=${KEY}`,
  ).then((r) => r.json()).catch(() => null)
  const photos = (details?.status === 'OK' ? details.result?.photos : null) ?? hit.photos
  return photoFields(photos)
}

function photoFields(photos: PhotoRef[] | undefined) {
  const refs = (photos ?? []).filter((p) => p.photo_reference).slice(0, 4)
  const photoUrls = refs.map((p) => `/api/place-photo?ref=${encodeURIComponent(p.photo_reference as string)}`)
  const attribution = stripTags(refs.flatMap((p) => p.html_attributions ?? []).find(Boolean) ?? '')
  return { photoUrls, attribution }
}

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get('placeId')
  const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!placeId && !query) {
    return NextResponse.json({ error: 'placeId or q required' }, { status: 400 })
  }
  if (!KEY) {
    if (!placeId) {
      return NextResponse.json({ name: query, photoUrls: [placeholderFor(query)], attribution: '' })
    }
    const payload = { name: humanizeId(placeId), photoUrls: [placeholderFor(placeId)], attribution: '' }
    return NextResponse.json(payload)
  }

  const cacheKey = placeId ? `id:${placeId}` : `q:${query.toLowerCase()}`
  const cached = cachedDetail(cacheKey)
  if (cached) return NextResponse.json(cached)

  if (!placeId && query) {
    const searchUrl =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(query)}` +
      `&location=${KIGALI.lat},${KIGALI.lng}&radius=20000` +
      `&key=${KEY}`
    const searchRes = await fetch(searchUrl)
    const search = await searchRes.json()
    const hit = (search.results ?? []).find((row: { photos?: PhotoRef[] }) => (row.photos?.length ?? 0) > 0)
      ?? search.results?.[0]
    if (search.status !== 'OK' || !hit) {
      const payload = { name: query, photoUrls: [placeholderFor(query)], attribution: '' }
      rememberDetail(cacheKey, payload)
      return NextResponse.json(payload)
    }
    const details = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(hit.place_id)}` +
        `&fields=${encodeURIComponent('photos')}` +
        `&key=${KEY}`,
    ).then((r) => r.json()).catch(() => null)
    const photos = (details?.status === 'OK' ? details.result?.photos : null) ?? hit.photos
    const { photoUrls, attribution } = photoFields(photos)
    const loc = hit.geometry?.location
    const payload = {
      name: hit.name,
      rating: hit.rating,
      address: hit.formatted_address,
      formatted_address: hit.formatted_address,
      photoUrls,
      attribution,
      place: {
        place_id: hit.place_id,
        name: hit.name,
        address: hit.formatted_address ?? '',
        coordinates: {
          lat: typeof loc?.lat === 'number' ? loc.lat : KIGALI.lat,
          lng: typeof loc?.lng === 'number' ? loc.lng : KIGALI.lng,
        },
        categories: [],
        rating: hit.rating,
        photo_url: photoUrls[0],
        photos: photoUrls,
      },
    }
    rememberDetail(cacheKey, payload)
    if (typeof hit.place_id === 'string') rememberDetail(`id:${hit.place_id}`, payload)
    return NextResponse.json(payload)
  }

  if (!placeId) {
    return NextResponse.json({ error: 'placeId required' }, { status: 400 })
  }

  if (isCatalogId(placeId)) {
    try {
      const doc = await findCatalogPlace(placeId)
      const name = doc && typeof doc.name === 'string' ? doc.name : humanizeId(placeId)
      let photoUrls = doc ? storedPhotoUrls(doc) : []
      let attribution = ''
      if (!photoUrls.length && KEY) {
        const looked = await photosForName(`${name} Kigali`)
        photoUrls = looked.photoUrls
        attribution = looked.attribution
        if (photoUrls.length && doc) {
          try { await rememberCatalogPhotos(placeId, photoUrls) } catch { /* the response still carries the photos */ }
        }
      }
      if (!photoUrls.length) photoUrls = [placeholderFor(name)]
      const payload = {
        name,
        rating: doc && typeof doc.rating === 'number' ? doc.rating : undefined,
        address: doc && typeof doc.address === 'string' ? doc.address : 'Kigali',
        photoUrls,
        attribution,
      }
      if (photoUrls.length) rememberDetail(cacheKey, payload)
      return NextResponse.json(payload)
    } catch (err) {
      console.error('[place-photos]', placeId, err)
      const name = humanizeId(placeId)
      const payload = { name, photoUrls: [placeholderFor(name)], attribution: '' }
      rememberDetail(cacheKey, payload)
      return NextResponse.json(payload)
    }
  }

  const fields = [
    'name',
    'rating',
    'user_ratings_total',
    'formatted_address',
    'opening_hours',
    'price_level',
    'photos',
    'url',
    'website',
  ].join(',')

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&key=${KEY}`

  try {
    const res = await fetch(url)
    const data = await res.json()

    if (data.status !== 'OK' || !data.result) {
      try {
        const doc = await findCatalogPlace(placeId)
        const stored = doc ? storedPhotoUrls(doc) : []
        if (stored.length) {
          return NextResponse.json({
            name: typeof doc?.name === 'string' ? doc.name : placeId,
            photoUrls: stored,
            attribution: '',
          })
        }
      } catch { /* placeholder below */ }
      const name = humanizeId(placeId)
      const payload = { name, photoUrls: [placeholderFor(name)], attribution: '' }
      rememberDetail(cacheKey, payload)
      return NextResponse.json(payload)
    }

    const r = data.result as {
      name?: string
      rating?: number
      formatted_address?: string
      price_level?: number
      opening_hours?: { open_now?: boolean; weekday_text?: string[] }
      photos?: PhotoRef[]
      url?: string
      website?: string
      user_ratings_total?: number
    }

    const fieldsOut = photoFields(r.photos)
    const photoUrls = fieldsOut.photoUrls.length ? fieldsOut.photoUrls : [placeholderFor(r.name || placeId)]

    const payload = {
      name: r.name,
      rating: r.rating,
      ratingCount: r.user_ratings_total,
      address: r.formatted_address,
      formatted_address: r.formatted_address,
      price_level: r.price_level,
      priceLevel: r.price_level,
      opening_hours: r.opening_hours,
      isOpen: r.opening_hours?.open_now ?? null,
      maps_url: r.url,
      website: r.website,
      photoUrls,
      attribution: fieldsOut.attribution,
    }
    if (fieldsOut.photoUrls.length) rememberDetail(cacheKey, payload)
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[place-photos]', placeId, err)
    const name = humanizeId(placeId)
    const payload = { name, photoUrls: [placeholderFor(name)], attribution: '' }
    return NextResponse.json(payload)
  }
}
