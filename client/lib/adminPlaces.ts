import { toClientPlace, type PlaceCategory } from '@/lib/places'

export const DB = process.env.MONGODB_DATABASE ?? 'hodari'
export const DUPLICATE_METERS = 150

export const SECTOR_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  Nyarugenge: { lat: -1.944, lng: 30.061 },
  Nyamirambo: { lat: -1.978, lng: 30.045 },
  Muhima: { lat: -1.937, lng: 30.059 },
  Kimihurura: { lat: -1.949, lng: 30.089 },
  Kacyiru: { lat: -1.944, lng: 30.092 },
  Remera: { lat: -1.957, lng: 30.108 },
  Gisozi: { lat: -1.931, lng: 30.061 },
  Kimironko: { lat: -1.95, lng: 30.126 },
  Kicukiro: { lat: -1.978, lng: 30.105 },
  Gatenga: { lat: -1.99, lng: 30.1 },
  Gikondo: { lat: -1.97, lng: 30.085 },
  Kibagabaga: { lat: -1.935, lng: 30.11 },
}

export const SECTOR_NAMES = Object.keys(SECTOR_CENTROIDS)

export function normalizePlaceName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function coordsOf(doc: Record<string, unknown>): [number, number] | null {
  const c = (doc.location as { coordinates?: unknown[] } | undefined)?.coordinates
  if (typeof c?.[0] === 'number' && typeof c?.[1] === 'number') return [c[0], c[1]]
  if (typeof doc.longitude === 'number' && typeof doc.latitude === 'number') return [doc.longitude, doc.latitude]
  return null
}

export function metersBetween(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function resolveSector(raw: Record<string, unknown>): string {
  if (typeof raw.sector === 'string' && raw.sector.trim()) return raw.sector.trim()
  const here = coordsOf(raw)
  if (here) {
    let best = 'Kigali'
    let bestD = Infinity
    for (const [name, c] of Object.entries(SECTOR_CENTROIDS)) {
      const d = metersBetween(here, [c.lng, c.lat])
      if (d < bestD) {
        bestD = d
        best = name
      }
    }
    if (bestD <= 4_000) return best
  }
  if (typeof raw.address === 'string' && raw.address.trim()) {
    return raw.address.split(',')[0]?.trim() || 'Kigali'
  }
  return 'Kigali'
}

export type AdminPlaceRow = NonNullable<ReturnType<typeof toClientPlace>> & {
  sector: string
  archived?: boolean
  lang_content?: Record<string, { name?: string; summary?: string }>
  rejection_reason?: string
  moderated_at?: string
  moderated_by?: string
}

export function withPhotoProxy<T extends { place_id: string; photo_url?: string }>(p: T): T {
  if (p.photo_url?.startsWith('data:image/')) {
    return { ...p, photo_url: `/api/places/photo?placeId=${encodeURIComponent(p.place_id)}&i=0` }
  }
  return p
}

export function toAdminPlace(doc: Record<string, unknown>): AdminPlaceRow | null {
  const base = toClientPlace(doc)
  if (!base) return null
  const lang = doc.lang_content
  const lang_content =
    lang && typeof lang === 'object' && !Array.isArray(lang)
      ? (lang as AdminPlaceRow['lang_content'])
      : undefined
  return {
    ...base,
    sector: resolveSector(doc),
    archived: doc.archived === true || base.status === 'archived',
    lang_content,
    rejection_reason: typeof doc.rejection_reason === 'string' ? doc.rejection_reason : base.rejection_reason,
    moderated_at: typeof doc.moderated_at === 'string' ? doc.moderated_at : undefined,
    moderated_by: typeof doc.moderated_by === 'string' ? doc.moderated_by : undefined,
  }
}

export type DuplicateHint = {
  place_id: string
  name: string
  matches: { place_id: string; name: string; distance_m: number }[]
}

export function computeDuplicateHints(
  docs: Record<string, unknown>[],
  ids?: Set<string>,
): DuplicateHint[] {
  const rows = docs
    .map((doc) => {
      const id = typeof doc.place_id === 'string' ? doc.place_id : ''
      const name = typeof doc.name === 'string' ? doc.name : ''
      const norm = normalizePlaceName(name)
      const coords = coordsOf(doc)
      if (!id || !norm || !coords) return null
      if (ids && !ids.has(id)) return null
      return { place_id: id, name, norm, coords }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const hints: DuplicateHint[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i]
    const matches: DuplicateHint['matches'] = []
    for (let j = 0; j < rows.length; j += 1) {
      if (i === j) continue
      const b = rows[j]
      if (a.norm !== b.norm) continue
      const d = metersBetween(a.coords, b.coords)
      if (d <= DUPLICATE_METERS) {
        matches.push({ place_id: b.place_id, name: b.name, distance_m: Math.round(d) })
      }
    }
    if (matches.length) {
      matches.sort((x, y) => x.distance_m - y.distance_m)
      hints.push({ place_id: a.place_id, name: a.name, matches })
    }
  }
  return hints
}

export type PlacesListQuery = {
  status?: string
  category?: string
  source?: string
  local?: boolean
  accessible?: boolean
  sector?: string
  q?: string
  sort?: string
  page: number
  limit: number
}

export function placeStatus(raw: Record<string, unknown>): string {
  if (raw.archived === true) return 'archived'
  return typeof raw.status === 'string' ? raw.status : 'validated'
}

export function matchesFilters(raw: Record<string, unknown>, q: PlacesListQuery): boolean {
  const status = placeStatus(raw)
  if (q.status) {
    if (q.status === 'validated') {
      if (status !== 'validated' && status !== '') return false
    } else if (status !== q.status) return false
  } else if (status === 'archived') {
    return false
  }
  if (q.category) {
    const cats = Array.isArray(raw.categories) ? raw.categories : []
    if (!cats.some((c) => typeof c === 'string' && c.toLowerCase() === q.category)) return false
  }
  if (q.source) {
    const src = typeof raw.source === 'string' ? raw.source : 'official'
    if (src !== q.source) return false
  }
  if (q.local === true && raw.local_business !== true) return false
  if (q.accessible === true) {
    const access = raw.access as { entrance?: boolean } | undefined
    if (raw.accessible !== true && access?.entrance !== true) return false
  }
  if (q.sector && resolveSector(raw) !== q.sector) return false
  if (q.q) {
    const needle = q.q.toLowerCase()
    const name = typeof raw.name === 'string' ? raw.name.toLowerCase() : ''
    const addr = typeof raw.address === 'string' ? raw.address.toLowerCase() : ''
    const id = typeof raw.place_id === 'string' ? raw.place_id.toLowerCase() : ''
    if (!name.includes(needle) && !addr.includes(needle) && !id.includes(needle)) return false
  }
  return true
}

export function sortPlaces(a: AdminPlaceRow, b: AdminPlaceRow, sort: string): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'views':
      return (b.views ?? 0) - (a.views ?? 0)
    case 'status':
      return (a.status ?? '').localeCompare(b.status ?? '')
    case 'created_asc':
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    case 'created_desc':
    default:
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  }
}

export function categoryOk(value: string): value is PlaceCategory {
  return ['market', 'restaurant', 'cafe', 'shop', 'pharmacy', 'hotel', 'clinic', 'attraction', 'other'].includes(value)
}
