import { cleanWeek } from '@/lib/hours'

export const PLACE_CATEGORIES = ['market', 'restaurant', 'cafe', 'shop', 'pharmacy', 'hotel', 'clinic', 'attraction', 'other'] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

/** The MongoDB MCP HTTP server rejects request bodies over 100 KB, so one photo per call must fit. */
const PHOTO_LIMIT = 90_000

export function isAdminEmail(email?: string | null): boolean {
  const list = (process.env.HODARI_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

export function toClientPlace(doc: Record<string, unknown>) {
  const location = doc.location as { coordinates?: unknown } | undefined
  const coords = Array.isArray(location?.coordinates) ? location.coordinates : null
  const lng = typeof coords?.[0] === 'number' ? coords[0] : typeof doc.longitude === 'number' ? doc.longitude : null
  const lat = typeof coords?.[1] === 'number' ? coords[1] : typeof doc.latitude === 'number' ? doc.latitude : null
  const name = typeof doc.name === 'string' ? doc.name.trim() : ''
  const placeId = typeof doc.place_id === 'string' ? doc.place_id : ''
  if (!name || !placeId || lat == null || lng == null) return null
  const summary = typeof doc.summary === 'string' ? doc.summary : typeof doc.description === 'string' ? doc.description : ''
  return {
    place_id: placeId,
    name,
    address: typeof doc.address === 'string' ? doc.address : `${typeof doc.city === 'string' ? doc.city : 'Kigali'}`,
    coordinates: { lat, lng },
    categories: Array.isArray(doc.categories) ? doc.categories.filter((c): c is string => typeof c === 'string') : [],
    city: typeof doc.city === 'string' ? doc.city : 'Kigali',
    rating: typeof doc.rating === 'number' ? doc.rating : undefined,
    summary: summary || undefined,
    photo_url: typeof doc.photo_url === 'string' && doc.photo_url ? doc.photo_url : undefined,
    local_business: doc.local_business === true,
    accessible: doc.accessible === true || (doc.access as { entrance?: boolean } | undefined)?.entrance === true,
    access: readAccess(doc.access),
    access_confirmations: typeof doc.access_confirmations === 'number' ? doc.access_confirmations : 0,
    access_disputes: typeof doc.access_disputes === 'number' ? doc.access_disputes : 0,
    status: typeof doc.status === 'string' ? doc.status : 'validated',
    source: typeof doc.source === 'string' ? doc.source : 'official',
    added_by: typeof doc.added_by === 'string' ? doc.added_by : undefined,
    claimed_by_owner: doc.claimed_by_owner === true,
    hours: typeof doc.hours === 'string' ? doc.hours : undefined,
    hours_week: cleanWeek(doc.hours_week) ?? undefined,
    confirmations_count: typeof doc.confirmations_count === 'number' ? doc.confirmations_count : 0,
    views: typeof doc.views === 'number' ? doc.views : 0,
    created_at: typeof doc.created_at === 'string' ? doc.created_at : undefined,
    rejection_reason: typeof doc.rejection_reason === 'string' ? doc.rejection_reason : undefined,
    phone: typeof doc.phone === 'string' && doc.phone ? doc.phone : undefined,
    tags: stringList(doc.tags),
    photos: Array.from(
      { length: Math.max(0, (typeof doc.photo_count === 'number' ? doc.photo_count : storedPhotos(doc).length) - 1) },
      (_, i) => `/api/places/photo?placeId=${encodeURIComponent(placeId)}&i=${i + 1}`,
    ),
    paused: doc.paused === true,
    recommends: stringList(doc.recommends),
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : []
}

/** Photos stored on an owner listing; `photo_url` is always the cover (index 0). */
export function storedPhotos(doc: Record<string, unknown>): string[] {
  const list = stringList(doc.photos).filter((url) => url.startsWith('data:image/'))
  if (list.length) return list
  return typeof doc.photo_url === 'string' && doc.photo_url.startsWith('data:image/') ? [doc.photo_url] : []
}

export const MAX_PHOTOS = 4
export const MAX_TAGS = 8
export const MAX_RECOMMENDS = 5

export function cleanPhotos(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const list = value
    .filter((url): url is string => typeof url === 'string' && url.startsWith('data:image/') && url.length <= PHOTO_LIMIT)
    .slice(0, MAX_PHOTOS)
  return list
}

export function cleanTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim().replace(/^#/, '').slice(0, 24)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function cleanPhone(value: unknown): string {
  const text = cleanText(value, 30)
  return /^[+\d][\d\s().-]{5,}$/.test(text) ? text : ''
}

/** Writes photos one MCP call at a time (cover first) so no request crosses the size cap. */
export async function writePlacePhotos(
  call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  db: string,
  placeId: string,
  photos: string[],
): Promise<void> {
  await call('update-many', {
    database: db,
    collection: 'places',
    filter: { place_id: placeId },
    update: { $set: { photos: [], photo_url: null, photo_count: photos.length } },
  })
  for (const [index, url] of photos.entries()) {
    const updates: Record<string, unknown>[] = [{ $push: { photos: url } }]
    if (index === 0) updates.unshift({ $set: { photo_url: url } })
    for (const update of updates) {
      await call('update-many', { database: db, collection: 'places', filter: { place_id: placeId }, update })
    }
  }
}

/** Visible on the public map: validated (or legacy rows without status) and not paused. */
export function isPublicPlace(doc: Record<string, unknown>): boolean {
  const status = typeof doc.status === 'string' ? doc.status : 'validated'
  return status === 'validated' && doc.paused !== true
}

function readAccess(value: unknown): { entrance: boolean; toilet: boolean; parking: boolean } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as { entrance?: unknown; toilet?: unknown; parking?: unknown }
  return {
    entrance: row.entrance === true,
    toilet: row.toilet === true,
    parking: row.parking === true,
  }
}

export { PHOTO_LIMIT }
