export const PLACE_CATEGORIES = ['market', 'restaurant', 'cafe', 'shop', 'pharmacy', 'attraction', 'other'] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

const PHOTO_LIMIT = 150_000

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
    accessible: doc.accessible === true,
    status: typeof doc.status === 'string' ? doc.status : 'validated',
    source: typeof doc.source === 'string' ? doc.source : 'official',
    added_by: typeof doc.added_by === 'string' ? doc.added_by : undefined,
    confirmations_count: typeof doc.confirmations_count === 'number' ? doc.confirmations_count : 0,
    created_at: typeof doc.created_at === 'string' ? doc.created_at : undefined,
    rejection_reason: typeof doc.rejection_reason === 'string' ? doc.rejection_reason : undefined,
  }
}

export { PHOTO_LIMIT }
