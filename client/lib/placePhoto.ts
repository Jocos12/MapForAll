/** Shared photo-proxy URL rules for the place-photo route and the client. */

export const PHOTO_REF_MAX = 2000
export const PHOTO_WIDTH_MIN = 100
export const PHOTO_WIDTH_MAX = 1600
export const PHOTO_WIDTH_DEFAULT = 600
export const PLACEHOLDER_PATH = '/place-photo-placeholder.svg'

/** A real photo from the local set, used when a listing has no owner or Google picture yet. */
export function fallbackPlacePhoto(name?: string, categories?: string[]): string {
  const text = `${name ?? ''} ${(categories ?? []).join(' ')}`.toLowerCase()
  if (/market|super|shop|duka|tomato|vegetable|legume|grocery/.test(text)) return '/landing/kigali-market-real.jpg'
  if (/caf|coffee|chocolate/.test(text)) return '/landing/kigali-table.jpg'
  if (/hotel|lodg|auberge/.test(text)) return '/landing/kigali-view-real.jpg'
  if (/phone|electronic|iphone/.test(text)) return '/landing/kigali-street-real.jpg'
  if (/restaurant|resto/.test(text)) return '/landing/kigali-city-real.jpg'
  return '/landing/kigali-hills.jpg'
}
export const PHOTO_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800'

const REF_RE = /^[A-Za-z0-9_\-/.]+$/
const PID_RE = /^[A-Za-z0-9_\-.:]{1,320}$/

export type RefValidation = 'ok' | 'missing' | 'too_long' | 'bad_charset' | 'pid_only'

export function validatePhotoRef(ref: string): RefValidation {
  if (!ref) return 'missing'
  if (ref.length > PHOTO_REF_MAX) return 'too_long'
  if (!REF_RE.test(ref)) return 'bad_charset'
  return 'ok'
}

export function isNewPhotoName(ref: string): boolean {
  return ref.startsWith('places/')
}

export function validPlaceId(pid: string): boolean {
  return Boolean(pid) && PID_RE.test(pid) && !pid.includes('..')
}

export function parsePhotoWidth(raw: string | null | undefined): { ok: boolean; width: number; reason: string } {
  if (raw == null || raw === '') return { ok: true, width: PHOTO_WIDTH_DEFAULT, reason: 'default' }
  if (!/^\d+$/.test(raw)) return { ok: false, width: PHOTO_WIDTH_DEFAULT, reason: 'width_invalid' }
  const width = Number(raw)
  if (width < PHOTO_WIDTH_MIN || width > PHOTO_WIDTH_MAX) {
    return { ok: false, width: PHOTO_WIDTH_DEFAULT, reason: 'width_out_of_range' }
  }
  return { ok: true, width, reason: 'ok' }
}

export function clampPhotoWidth(width?: number): number {
  if (width == null || !Number.isFinite(width)) return PHOTO_WIDTH_DEFAULT
  return Math.min(PHOTO_WIDTH_MAX, Math.max(PHOTO_WIDTH_MIN, Math.round(width)))
}

export function proxyPhotoUrl(ref: string, placeId?: string, width: number = PHOTO_WIDTH_DEFAULT): string {
  const params = new URLSearchParams()
  if (ref) params.set('ref', ref)
  if (placeId && validPlaceId(placeId)) params.set('pid', placeId)
  params.set('w', String(clampPhotoWidth(width)))
  return `/api/place-photo?${params.toString()}`
}

function isCatalogPlaceId(id: string): boolean {
  return (
    id.startsWith('kgl_') ||
    id.startsWith('user_') ||
    id.startsWith('pin:') ||
    id.startsWith('__') ||
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(id)
  )
}

/** Google place id to pass as `pid`, skipping internal catalog ids. */
export function googlePlaceId(place: {
  place_id?: string
  google_place_id?: string
  maps_place_id?: string
}): string {
  for (const id of [place.google_place_id, place.maps_place_id, place.place_id]) {
    if (!id || isCatalogPlaceId(id) || !validPlaceId(id)) continue
    return id
  }
  return ''
}

export function isStaleGooglePhoto(url: string): boolean {
  return /googleusercontent\.com|maps\.googleapis\.com\/maps\/api\/place\/photo|places\.googleapis\.com\/v1\//.test(url)
}

function isLocalPhoto(url: string): boolean {
  return (
    url.startsWith('data:image/') ||
    url.startsWith('/api/places/photo') ||
    url.startsWith('/landing/') ||
    (url.startsWith('/') && !url.startsWith('/api/place-photo'))
  )
}

/** Keep an existing proxy URL, but attach place id and width so a stale ref can be refreshed. */
export function withPhotoParams(url: string, placeId: string, width: number): string {
  const splitAt = url.indexOf('?')
  const path = splitAt >= 0 ? url.slice(0, splitAt) : url
  const params = new URLSearchParams(splitAt >= 0 ? url.slice(splitAt + 1) : '')
  if (placeId && validPlaceId(placeId) && !params.get('pid')) params.set('pid', placeId)
  if (!params.get('w')) params.set('w', String(clampPhotoWidth(width)))
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/**
 * Owner photos first, then Google photos. Resource names (`places/.../photos/...`)
 * become proxy URLs so a card never treats them as a page path.
 */
export function placePhotoList(
  place: {
    place_id?: string
    google_place_id?: string
    maps_place_id?: string
    photo_url?: string | null
    photos?: string[] | null
    photo_reference?: string | null
  },
  width: number = PHOTO_WIDTH_DEFAULT,
): string[] {
  const pid = googlePlaceId(place)
  const w = clampPhotoWidth(width)
  const locals: string[] = []
  const google: string[] = []

  const push = (bucket: string[], url: string) => {
    if (!url || locals.includes(url) || google.includes(url)) return
    bucket.push(url)
  }

  const asGoogle = (value: string): string | null => {
    const token = value.trim()
    if (!token) return null
    if (token.startsWith('/api/place-photo')) return withPhotoParams(token, pid, w)
    if (isStaleGooglePhoto(token)) return pid ? proxyPhotoUrl('', pid, w) : null
    if (token.startsWith('places/') && token.length <= PHOTO_REF_MAX) return proxyPhotoUrl(token, pid, w)
    if (validatePhotoRef(token) === 'ok' && token.length >= 20 && !token.includes('/')) return proxyPhotoUrl(token, pid, w)
    if (token.startsWith('http://') || token.startsWith('https://')) return token
    return null
  }

  const consider = (value?: string | null) => {
    if (!value) return
    if (isLocalPhoto(value)) {
      push(locals, value)
      return
    }
    const remote = asGoogle(value)
    if (remote) push(google, remote)
  }

  consider(place.photo_url)
  for (const photo of place.photos ?? []) consider(photo)
  const ref = (place.photo_reference ?? '').trim()
  if (ref) {
    const remote = asGoogle(ref)
    if (remote) push(google, remote)
  }
  const ordered = [...locals, ...google]
  if (!ordered.length && pid) ordered.push(proxyPhotoUrl('', pid, w))
  return ordered.slice(0, 6)
}

export function resolvePlacePhotoSrc(
  place: {
    place_id?: string
    google_place_id?: string
    maps_place_id?: string
    photo_url?: string | null
    photos?: string[] | null
    photo_reference?: string | null
  },
  width: number = PHOTO_WIDTH_DEFAULT,
): string | null {
  return placePhotoList(place, width)[0] ?? null
}
