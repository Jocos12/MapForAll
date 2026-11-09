import { NextRequest, NextResponse } from 'next/server'
import {
  PHOTO_CACHE_CONTROL,
  isNewPhotoName,
  parsePhotoWidth,
  validPlaceId,
  validatePhotoRef,
  type RefValidation,
} from '@/lib/placePhoto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = (process.env.GOOGLE_MAPS_SERVER_KEY ?? '').trim()
const TIMEOUT_MS = 4000
const MAX_CACHE = 300

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Photo unavailable"><rect width="640" height="360" fill="#e7e5e4"/><rect x="292" y="140" width="56" height="44" rx="6" fill="none" stroke="#a8a29e" stroke-width="2"/><circle cx="310" cy="156" r="5" fill="#a8a29e"/><path d="M300 176l12-12 8 8 6-6 14 10" fill="none" stroke="#a8a29e" stroke-width="2" stroke-linejoin="round"/></svg>`

type UpstreamKind = 'places_new' | 'legacy' | 'places_refresh'
type CacheEntry = { contentType: string; bytes: Uint8Array }

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry | null>>()
const logged = new Set<string>()

function remember(key: string, entry: CacheEntry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
}

function cached(key: string): CacheEntry | null {
  const hit = cache.get(key)
  if (!hit) return null
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function excerptOf(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/key=[^&\s"]+/gi, 'key=REDACTED').trim().slice(0, 160)
}

/** One line per ref + upstream outcome, so a hot card does not spam the console. */
function logFailure(ref: string, validation: string, upstream: string, status: number, body: string) {
  const key = `${ref}|${upstream}|${status}|${validation}`
  if (logged.has(key)) return
  logged.add(key)
  if (logged.size > 500) {
    const first = logged.values().next().value
    if (first) logged.delete(first)
  }
  console.warn(
    '[place-photo] refLen=%d refPrefix=%s validation=%s upstream=%s status=%s body=%s',
    ref.length,
    ref.slice(0, 12),
    validation,
    upstream,
    status,
    body || '-',
  )
}

function placeholder(reason: string) {
  return new NextResponse(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Place-Photo-Reason': reason.slice(0, 180),
    },
  })
}

function imageResponse(entry: CacheEntry) {
  return new NextResponse(Buffer.from(entry.bytes), {
    status: 200,
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': PHOTO_CACHE_CONTROL,
    },
  })
}

function mediaUrl(name: string, width: number): string {
  const path = name.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://places.googleapis.com/v1/${path}/media?maxWidthPx=${width}&key=${encodeURIComponent(KEY)}`
}

function legacyUrl(ref: string, width: number): string {
  return (
    'https://maps.googleapis.com/maps/api/place/photo' +
    `?photoreference=${encodeURIComponent(ref)}&maxwidth=${width}&key=${encodeURIComponent(KEY)}`
  )
}

type UpstreamResult =
  | { ok: true; status: number; contentType: string; bytes: Uint8Array }
  | { ok: false; status: number; excerpt: string }

/** Follow Google's photo redirects on the server and keep the API key off the CDN request. */
async function readImage(url: string, kind: UpstreamKind): Promise<UpstreamResult> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current = url
  let headers: Record<string, string> | undefined =
    kind === 'legacy' ? undefined : { 'X-Goog-Api-Key': KEY }
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, { redirect: 'manual', signal, headers })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { ok: false, status: res.status, excerpt: 'redirect without location' }
        current = new URL(location, current).toString()
        headers = undefined
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (res.ok && contentType.startsWith('image/')) {
        return { ok: true, status: res.status, contentType, bytes }
      }
      return { ok: false, status: res.status, excerpt: excerptOf(new TextDecoder().decode(bytes.slice(0, 240))) }
    }
    return { ok: false, status: 0, excerpt: 'too many redirects' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return { ok: false, status: 0, excerpt: excerptOf(message) }
  }
}

async function freshPhotoName(pid: string, avoid: string): Promise<{ name: string } | { status: number; excerpt: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(pid)}`, {
      signal,
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'photos',
      },
    })
    const raw = await res.text()
    if (!res.ok) return { status: res.status, excerpt: excerptOf(raw) }
    let data: { photos?: Array<{ name?: string }> } | null = null
    try { data = raw ? JSON.parse(raw) as { photos?: Array<{ name?: string }> } : null } catch { data = null }
    const names = (data?.photos ?? [])
      .map((photo) => (typeof photo?.name === 'string' ? photo.name : ''))
      .filter((name) => name.startsWith('places/') && name !== avoid)
    if (!names[0]) return { status: res.status, excerpt: 'no fresh photo' }
    return { name: names[0] }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return { status: 0, excerpt: excerptOf(message) }
  }
}

function placeIdFromName(ref: string): string {
  if (!isNewPhotoName(ref)) return ''
  const id = ref.split('/')[1] ?? ''
  return validPlaceId(id) ? id : ''
}

export async function GET(req: NextRequest) {
  const ref = (req.nextUrl.searchParams.get('ref') ?? req.nextUrl.searchParams.get('name') ?? '').trim()
  const pidParam = (req.nextUrl.searchParams.get('pid') ?? '').trim()
  const widthParsed = parsePhotoWidth(req.nextUrl.searchParams.get('w'))
  const refStatus: RefValidation = ref ? validatePhotoRef(ref) : 'missing'
  const validation = !widthParsed.ok
    ? widthParsed.reason
    : refStatus === 'ok'
      ? 'ok'
      : ref
        ? refStatus
        : validPlaceId(pidParam)
          ? 'pid_only'
          : 'missing'

  if (!widthParsed.ok) {
    logFailure(ref, validation, 'none', 0, widthParsed.reason)
    return placeholder(widthParsed.reason)
  }
  if (ref && refStatus !== 'ok') {
    logFailure(ref, refStatus, 'none', 0, refStatus)
  }

  const usableRef = refStatus === 'ok' ? ref : ''
  const pid = validPlaceId(pidParam) ? pidParam : placeIdFromName(usableRef)
  if (!usableRef && !pid) {
    logFailure(ref, validation, 'none', 0, 'ref or pid required')
    return placeholder(validation === 'missing' ? 'ref or pid required' : validation)
  }
  if (!KEY) {
    logFailure(ref || pid, validation, 'none', 0, 'maps key not configured')
    return placeholder('maps key not configured')
  }

  const cacheKey = `${usableRef || `pid:${pid}`}\n${widthParsed.width}`
  const hit = cached(cacheKey)
  if (hit) return imageResponse(hit)

  let pending = inflight.get(cacheKey)
  if (!pending) {
    pending = loadPhoto(usableRef, pid, widthParsed.width, validation).finally(() => {
      inflight.delete(cacheKey)
    })
    inflight.set(cacheKey, pending)
  }
  const loaded = await pending
  if (!loaded) return placeholder('photo unavailable')
  return imageResponse(loaded)
}

async function loadPhoto(ref: string, pid: string, width: number, validation: string): Promise<CacheEntry | null> {
  const cacheKey = `${ref || `pid:${pid}`}\n${width}`
  if (ref) {
    const kind: UpstreamKind = isNewPhotoName(ref) ? 'places_new' : 'legacy'
    const upstream = await readImage(kind === 'places_new' ? mediaUrl(ref, width) : legacyUrl(ref, width), kind)
    if (upstream.ok) {
      const entry = { contentType: upstream.contentType, bytes: upstream.bytes }
      remember(cacheKey, entry)
      return entry
    }
    logFailure(ref, validation, kind, upstream.status, upstream.excerpt)
    // Legacy Place Photo is often disabled, and both ref formats expire.
    // A place id lets us fetch a current Places API (New) photo name.
    if (!pid) return null
  }

  const looked = await freshPhotoName(pid, isNewPhotoName(ref) ? ref : '')
  if (!('name' in looked)) {
    logFailure(ref || pid, validation, 'places_refresh', looked.status, looked.excerpt)
    return null
  }
  const media = await readImage(mediaUrl(looked.name, width), 'places_refresh')
  if (!media.ok) {
    logFailure(ref || pid, validation, 'places_refresh', media.status, media.excerpt)
    return null
  }
  const entry = { contentType: media.contentType, bytes: media.bytes }
  remember(cacheKey, entry)
  return entry
}
