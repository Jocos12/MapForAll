/**
 * Client safety net for the same venue arriving twice (catalog + Maps).
 * Rules match agents/hodari/tools/place_dedupe.py.
 */

const NAME_DISTANCE_M = 150
const SIMILAR_DISTANCE_M = 30
const NAME_SIMILARITY = 0.85
const NOISE = new Set(['hotel', 'restaurant', 'cafe', 'the', 'le', 'la'])
const GOOGLE_SOURCES = new Set(['official', 'maps', 'google', 'google_maps'])

export interface PlaceLike {
  place_id?: string
  name?: string
  address?: string | null
  coordinates?: { lat?: number; lng?: number }
  location?: { coordinates?: unknown[] }
  latitude?: number
  longitude?: number
  google_place_id?: string
  maps_place_id?: string
  rating?: number | null
  user_ratings_total?: number
  personalization_score?: number
  local_business?: boolean
  accessible?: boolean
  access?: { entrance?: boolean; toilet?: boolean; parking?: boolean }
  source?: string
  sources?: string[]
  photo_url?: string
  photos?: string[]
  hours?: string | null
  hours_week?: unknown
  summary?: string
  description?: string
  phone?: string | null
  website?: string
}

export function normalizePlaceLabel(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarityLabel(value: string | null | undefined): string {
  return normalizePlaceLabel(value)
    .split(' ')
    .filter((word) => word && !NOISE.has(word))
    .join(' ')
}

function coordsOf(place: PlaceLike): { lat: number; lng: number } | null {
  const direct = place.coordinates
  let lat = direct?.lat
  let lng = direct?.lng
  const raw = place.location?.coordinates
  if ((lat == null || lng == null) && Array.isArray(raw) && raw.length >= 2) {
    const nextLng = raw[0]
    const nextLat = raw[1]
    if (typeof nextLng === 'number' && typeof nextLat === 'number') {
      lng = nextLng
      lat = nextLat
    }
  }
  if ((lat == null || lng == null) && typeof place.latitude === 'number' && typeof place.longitude === 'number') {
    lat = place.latitude
    lng = place.longitude
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function identityIds(place: PlaceLike): string[] {
  const found: string[] = []
  for (const field of ['place_id', 'google_place_id', 'maps_place_id'] as const) {
    const value = place[field]
    if (typeof value === 'string') {
      const token = value.trim()
      if (token && !token.startsWith('__') && !found.includes(token)) found.push(token)
    }
  }
  return found
}

function matchCount(a: string, b: string): number {
  if (!a || !b) return 0
  let best = 0
  let bestI = 0
  let bestJ = 0
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0
      while (a[i + k] && b[j + k] && a[i + k] === b[j + k]) k += 1
      if (k > best) {
        best = k
        bestI = i
        bestJ = j
      }
    }
  }
  if (!best) return 0
  return (
    best +
    matchCount(a.slice(0, bestI), b.slice(0, bestJ)) +
    matchCount(a.slice(bestI + best), b.slice(bestJ + best))
  )
}

function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const total = a.length + b.length
  if (!total) return 1
  return (2 * matchCount(a, b)) / total
}

function addressesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizePlaceLabel(left)
  const b = normalizePlaceLabel(right)
  if (!a || !b) return false
  if (a === b) return true
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  return long.endsWith(` ${short}`)
}

export function samePlace(left: PlaceLike, right: PlaceLike): boolean {
  const shared = identityIds(left).filter((id) => identityIds(right).includes(id))
  if (shared.length) return true

  const nameLeft = normalizePlaceLabel(left.name)
  const nameRight = normalizePlaceLabel(right.name)
  const addrLeft = normalizePlaceLabel(left.address)
  const addrRight = normalizePlaceLabel(right.address)
  if (nameLeft && nameLeft === nameRight && addressesMatch(left.address, right.address)) return true

  const a = coordsOf(left)
  const b = coordsOf(right)
  const distance = a && b ? metersBetween(a, b) : null
  if (nameLeft && nameLeft === nameRight && distance != null && distance < NAME_DISTANCE_M) return true
  if (distance != null && distance < SIMILAR_DISTANCE_M) {
    const simLeft = similarityLabel(left.name)
    const simRight = similarityLabel(right.name)
    if (simLeft && simRight && nameSimilarity(simLeft, simRight) >= NAME_SIMILARITY) return true
  }
  return false
}

function blank(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0)
}

function isGoogle(place: PlaceLike): boolean {
  const source = String(place.source || '').toLowerCase()
  if (GOOGLE_SOURCES.has(source)) return true
  return identityIds(place).some((id) => id.startsWith('ChIJ') && !id.includes('_hodari_'))
}

function ratingOf(place: PlaceLike): number | null {
  return typeof place.rating === 'number' && Number.isFinite(place.rating) ? place.rating : null
}

function reviewCount(place: PlaceLike): number {
  return typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0
}

function sourcesOf(place: PlaceLike): string[] {
  const found: string[] = []
  if (Array.isArray(place.sources)) {
    for (const item of place.sources) {
      if (typeof item === 'string' && item && !found.includes(item)) found.push(item)
    }
  }
  if (typeof place.source === 'string' && place.source && !found.includes(place.source)) found.push(place.source)
  return found.length ? found : ['unknown']
}

function richness(place: PlaceLike): number {
  let score = 0
  if (place.photo_url || (place.photos && place.photos.length)) score += 3
  if (ratingOf(place) != null) score += 2
  if (place.hours || place.hours_week) score += 2
  if (place.access || place.accessible) score += 2
  const pid = place.place_id || ''
  if (pid && !pid.startsWith('user_') && !pid.includes('_hodari_')) score += 2
  if (place.summary || place.description) score += 1
  if (place.address) score += 1
  if (place.phone || place.website) score += 1
  return score
}

function mergePlaces<T extends PlaceLike>(left: T, right: T): T {
  const primary = richness(left) >= richness(right) ? left : right
  const secondary = primary === left ? right : left
  const merged: T = { ...primary }
  const bag = merged as Record<string, unknown>
  for (const [key, value] of Object.entries(secondary)) {
    if (key === 'sources' || key === 'source') continue
    if (blank(bag[key]) && !blank(value)) bag[key] = value
  }
  merged.local_business = Boolean(left.local_business) || Boolean(right.local_business)
  merged.accessible = Boolean(left.accessible) || Boolean(right.accessible)
  const access = {
    entrance: Boolean(left.access?.entrance) || Boolean(right.access?.entrance),
    toilet: Boolean(left.access?.toilet) || Boolean(right.access?.toilet),
    parking: Boolean(left.access?.parking) || Boolean(right.access?.parking),
  }
  if (left.access || right.access) {
    merged.access = access
    if (access.entrance) merged.accessible = true
  }
  const scores = [left.personalization_score, right.personalization_score].filter(
    (score): score is number => typeof score === 'number' && Number.isFinite(score),
  )
  if (scores.length) merged.personalization_score = Math.max(...scores)
  const google = [left, right].filter((place) => isGoogle(place) && ratingOf(place) != null)
  if (google.length) {
    const chosen = google.reduce((best, place) =>
      reviewCount(place) > reviewCount(best) || (reviewCount(place) === reviewCount(best) && (ratingOf(place) || 0) > (ratingOf(best) || 0))
        ? place
        : best,
    )
    merged.rating = ratingOf(chosen)
    if (reviewCount(chosen)) merged.user_ratings_total = reviewCount(chosen)
  }
  const sources: string[] = []
  for (const label of [...sourcesOf(left), ...sourcesOf(right)]) {
    if (!sources.includes(label)) sources.push(label)
  }
  merged.sources = sources
  if (!merged.name) merged.name = secondary.name || primary.name
  return merged
}

/** Stable React key. Never the array index. */
export function placeKey(place: PlaceLike): string {
  const pid = typeof place.place_id === 'string' ? place.place_id.trim() : ''
  if (pid) return pid
  const name = normalizePlaceLabel(place.name) || 'place'
  const coords = coordsOf(place)
  if (coords) return `${name}:${coords.lat.toFixed(3)}:${coords.lng.toFixed(3)}`
  return name
}

export function dedupePlaces<T extends PlaceLike>(places: T[] | null | undefined, limit?: number): T[] {
  const kept: T[] = []
  for (const place of places || []) {
    if (!place || typeof place !== 'object') continue
    const matchAt = kept.findIndex((existing) => samePlace(existing, place))
    if (matchAt < 0) {
      kept.push({ ...place, sources: sourcesOf(place) })
    } else {
      kept[matchAt] = mergePlaces(kept[matchAt], place)
    }
  }
  const unique: T[] = []
  const seen = new Set<string>()
  for (const place of kept) {
    const key = placeKey(place)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(place)
  }
  return limit != null && limit >= 0 ? unique.slice(0, limit) : unique
}

export function findDuplicatePlace<T extends object>(candidate: PlaceLike, existing: T[]): T | null {
  return existing.find((place) => samePlace(candidate, place as PlaceLike)) ?? null
}

/** Longest distinctive token, for a narrow Mongo name lookup before the full compare. */
export function duplicateSearchToken(name: string): string {
  const words = normalizePlaceLabel(name)
    .split(' ')
    .filter((word) => word.length >= 3 && !NOISE.has(word))
  if (!words.length) return ''
  return words.reduce((best, word) => (word.length > best.length ? word : best))
}
