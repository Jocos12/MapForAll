import { NextRequest, NextResponse } from 'next/server'
import { distanceKm, isValidCoord } from '@/lib/geo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY ?? ''
const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps'
const MIN_SEPARATION_M = 30

type LatLng = { lat: number; lng: number }
type GoogleMode = 'WALK' | 'DRIVE' | 'TRANSIT' | 'BICYCLE'

function fail(httpStatus: number, status: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ status, message, error: message, ...extra }, { status: httpStatus })
}

function redact(value: string): string {
  return value.replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[redacted]')
}

/** Server-console record of a Routes API failure. Never includes the API key. */
function logGoogleFailure(requestBody: unknown, httpStatus: number, errorBody: unknown) {
  const body = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody)
  console.error('[directions] request body', redact(JSON.stringify(requestBody)))
  console.error('[directions] Google Routes API HTTP', httpStatus)
  console.error('[directions] Google Routes API error body', redact(body))
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

/** Accepts walking|driving|transit|bicycling and the Routes API enums. */
function googleMode(value: unknown): GoogleMode | null {
  if (value == null || value === '') return 'WALK'
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'walk' || raw === 'walking') return 'WALK'
  if (raw === 'drive' || raw === 'driving') return 'DRIVE'
  if (raw === 'transit') return 'TRANSIT'
  if (raw === 'bicycle' || raw === 'bicycling' || raw === 'cycling') return 'BICYCLE'
  return null
}

function coord(value: unknown): LatLng | null {
  if (!value || typeof value !== 'object') return null
  const lat = (value as { lat?: unknown }).lat
  const lng = (value as { lng?: unknown }).lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  const point = { lat, lng }
  // Finite, in range, and not the null island (0, 0).
  if (!isValidCoord(point)) return null
  return point
}

function parseDuration(value: unknown): number {
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.replace(/s$/, ''))
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const n = Number((value as { seconds?: unknown }).seconds)
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  return 0
}

type GoogleError = { code?: number; message?: string; status?: string }

function googleErrorOf(body: unknown): GoogleError {
  if (!body || typeof body !== 'object') {
    return { message: typeof body === 'string' ? body : '' }
  }
  const error = (body as { error?: GoogleError }).error
  if (!error || typeof error !== 'object') return {}
  return error
}

/**
 * 422 is only an empty route. Auth, quota, billing, and API restrictions
 * stay 403 (or 502 when Google itself failed). Bad input stays 400.
 */
function failureHttp(httpStatus: number, gStatus: string, message: string): number {
  const blob = `${gStatus} ${message}`.toUpperCase()
  if (gStatus === 'ZERO_RESULTS' || blob.includes('ZERO_RESULTS')) return 422
  const restricted =
    httpStatus === 401
    || httpStatus === 403
    || httpStatus === 429
    || gStatus === 'PERMISSION_DENIED'
    || gStatus === 'UNAUTHENTICATED'
    || gStatus === 'REQUEST_DENIED'
    || gStatus === 'RESOURCE_EXHAUSTED'
    || /BILLING|API_KEY|PERMISSION|QUOTA|RESOURCE_EXHAUSTED|RESTRICT/.test(blob)
  if (restricted) return httpStatus >= 500 ? 502 : 403
  if (httpStatus === 400 || gStatus === 'INVALID_ARGUMENT' || gStatus === 'FAILED_PRECONDITION') return 400
  return 502
}

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index <= encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index <= encoded.length)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

function boundsOf(encoded: string[]): { south: number; west: number; north: number; east: number } | null {
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  let any = false
  for (const line of encoded) {
    for (const point of decodePolyline(line)) {
      any = true
      south = Math.min(south, point.lat)
      north = Math.max(north, point.lat)
      west = Math.min(west, point.lng)
      east = Math.max(east, point.lng)
    }
  }
  return any ? { south, west, north, east } : null
}

export async function POST(req: NextRequest) {
  if (!SERVER_KEY) {
    console.error('[directions] GOOGLE_MAPS_SERVER_KEY is not set')
    return fail(500, 'NOT_CONFIGURED', 'Server maps key not configured')
  }

  let body: { origin?: unknown; destination?: unknown; travelMode?: unknown }
  try {
    body = await req.json()
  } catch {
    console.error('[directions] request body', 'invalid JSON')
    return fail(400, 'BAD_REQUEST', 'Request body must be JSON with origin, destination, and travelMode')
  }

  const requestBody = {
    origin: body.origin ?? null,
    destination: body.destination ?? null,
    travelMode: body.travelMode ?? 'walking',
  }
  const origin = coord(body.origin)
  const destination = coord(body.destination)
  if (!origin || !destination) {
    console.error('[directions] request body', redact(JSON.stringify(requestBody)))
    console.error('[directions] rejected', 'origin and destination must be finite lat/lng, not (0, 0)')
    return fail(400, 'BAD_REQUEST', 'origin and destination must be finite lat/lng, not (0, 0)')
  }
  const travelMode = googleMode(body.travelMode)
  if (!travelMode) {
    console.error('[directions] request body', redact(JSON.stringify(requestBody)))
    console.error('[directions] rejected', 'invalid travelMode')
    return fail(400, 'BAD_REQUEST', 'travelMode must be walking, driving, transit, or bicycling')
  }
  const apartM = distanceKm(origin, destination) * 1000
  if (!(apartM > MIN_SEPARATION_M)) {
    const message = `Origin and destination are ${Math.round(apartM)} m apart. They must be more than 30 m apart.`
    console.error('[directions] request body', redact(JSON.stringify(requestBody)))
    console.error('[directions] rejected', message)
    return fail(400, 'BAD_REQUEST', message)
  }

  const googleBody: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode,
    computeAlternativeRoutes: false,
    polylineQuality: 'HIGH_QUALITY',
    languageCode: 'en-US',
    units: 'METRIC',
  }
  if (travelMode === 'TRANSIT') googleBody.departureTime = new Date(Date.now() + 60_000).toISOString()

  let res: Response
  try {
    res = await fetch(ROUTES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': SERVER_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(googleBody),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Routes API request failed'
    logGoogleFailure(requestBody, 0, { error: { message, status: 'NETWORK' } })
    return fail(502, 'UPSTREAM', message.slice(0, 500))
  }

  const raw = await res.text()
  let data: { routes?: Array<Record<string, unknown>>; error?: GoogleError } | null = null
  try {
    data = raw ? JSON.parse(raw) as { routes?: Array<Record<string, unknown>>; error?: GoogleError } : null
  } catch {
    data = null
  }

  if (!res.ok) {
    const parsed = data ?? raw
    logGoogleFailure(requestBody, res.status, parsed)
    const g = googleErrorOf(data ?? raw)
    const message = (g.message || raw || 'Routes API request failed').replace(/\s+/g, ' ').trim().slice(0, 500)
    const status = g.status || 'UPSTREAM'
    return fail(failureHttp(res.status, status, message), status, message || 'Routes API request failed', {
      googleStatus: res.status,
    })
  }

  const route = data?.routes?.[0] as {
    duration?: unknown
    distanceMeters?: unknown
    polyline?: { encodedPolyline?: string }
    viewport?: { low?: { latitude?: number; longitude?: number }; high?: { latitude?: number; longitude?: number } }
    legs?: Array<{
      distanceMeters?: number
      duration?: unknown
      steps?: Array<{
        polyline?: { encodedPolyline?: string }
        distanceMeters?: number
        staticDuration?: string
        navigationInstruction?: { instructions?: string }
      }>
    }>
  } | undefined
  if (!route) {
    logGoogleFailure(requestBody, res.status, data ?? raw)
    const g = googleErrorOf(data)
    if (g.status && g.status !== 'ZERO_RESULTS') {
      const message = (g.message || 'Routes API request failed').slice(0, 500)
      return fail(failureHttp(res.status, g.status, message), g.status, message, { googleStatus: res.status })
    }
    return fail(422, 'ZERO_RESULTS', 'No route found for that origin, destination, and travel mode', {
      googleStatus: res.status,
    })
  }

  const leg = route.legs?.[0] ?? {}
  const distanceMeters: number = typeof route.distanceMeters === 'number'
    ? route.distanceMeters
    : (typeof leg.distanceMeters === 'number' ? leg.distanceMeters : 0)
  const durationSeconds: number = parseDuration(route.duration) || parseDuration(leg.duration)
  const stepPolylines: string[] = Array.isArray(leg.steps)
    ? leg.steps
        .map((step: { polyline?: { encodedPolyline?: string } }) => step.polyline?.encodedPolyline ?? '')
        .filter((encoded: string) => encoded.length > 0)
    : []
  const encodedPolyline: string = route.polyline?.encodedPolyline ?? stepPolylines[0] ?? ''
  const viewport = route.viewport as
    | { low?: { latitude?: number; longitude?: number }; high?: { latitude?: number; longitude?: number } }
    | undefined
  const low = viewport?.low
  const high = viewport?.high
  const bounds = (
    typeof low?.latitude === 'number' && typeof low.longitude === 'number'
    && typeof high?.latitude === 'number' && typeof high.longitude === 'number'
  )
    ? { south: low.latitude, west: low.longitude, north: high.latitude, east: high.longitude }
    : boundsOf(stepPolylines.length ? stepPolylines : [encodedPolyline])

  const steps = Array.isArray(leg.steps)
    ? leg.steps
        .map((step: { distanceMeters?: number; staticDuration?: string; navigationInstruction?: { instructions?: string } }) => {
          const instruction = step.navigationInstruction?.instructions?.trim() ?? ''
          if (!instruction) return null
          const seconds = parseInt(String(step.staticDuration ?? '0s').replace('s', ''), 10)
          return {
            instruction,
            distance: formatDistance(step.distanceMeters ?? 0),
            duration: formatDuration(Number.isFinite(seconds) ? seconds : 0),
          }
        })
        .filter((step: { instruction: string } | null): step is { instruction: string; distance: string; duration: string } => !!step)
    : []

  return NextResponse.json({
    status: 'OK',
    encodedPolyline,
    distanceMeters,
    durationSeconds,
    bounds,
    stepPolylines,
    steps,
    polyline: encodedPolyline,
    distance: formatDistance(distanceMeters),
    duration: formatDuration(durationSeconds),
  })
}
