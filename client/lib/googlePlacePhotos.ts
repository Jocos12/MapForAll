/** Find a Google place within 200 m and return its photo resource names. */

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export function photosAreFresh(fetchedAt: unknown, now = Date.now()): boolean {
  if (typeof fetchedAt !== 'string' && typeof fetchedAt !== 'number') return false
  const at = new Date(fetchedAt).getTime()
  return Number.isFinite(at) && now - at < MONTH_MS
}

export async function googlePhotosNear(
  name: string,
  lat: number,
  lng: number,
  key: string,
): Promise<{ placeId: string; names: string[] } | null> {
  if (!key || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.photos',
    },
    body: JSON.stringify({
      textQuery: name,
      pageSize: 5,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: 200 },
      },
    }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => null)
  if (!res?.ok) return null
  const data = await res.json().catch(() => null) as { places?: Array<{ id?: string; photos?: Array<{ name?: string }> }> } | null
  const hit = data?.places?.find((place) => (place.photos?.length ?? 0) > 0) ?? data?.places?.[0]
  if (!hit?.id) return null
  const names = (hit.photos ?? [])
    .map((photo) => (typeof photo.name === 'string' ? photo.name : ''))
    .filter((photoName) => photoName.startsWith('places/'))
    .slice(0, 4)
  return { placeId: hit.id, names }
}
