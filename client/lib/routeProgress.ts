import { distanceKm, isValidCoord, type LatLng } from '@/lib/geo'
import type { TravelMode } from '@/lib/routing'

export type PathPoint = { lat: number; lng: number }

export type RouteStepLite = { instruction: string; distance: string; duration: string }

export type HeldRoute = {
  id: number
  path: PathPoint[]
  distance: string
  duration: string
  distanceMeters: number
  durationSeconds: number
  destinationName: string
  originLabel?: string
  origin?: PathPoint
  destination?: PathPoint
  mode?: TravelMode
  steps?: RouteStepLite[]
}

export type RouteProjection = {
  distanceFromPathM: number
  traveledM: number
  remainingM: number
  traveled: PathPoint[]
  remaining: PathPoint[]
}

export type NavFix = {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
  at: number
}

export type RouteSnapshot = {
  route: HeldRoute | null
  progress: RouteProjection | null
  recalculating: boolean
  arrived: boolean
}

const MAX_ACCURACY_M = 50
const MAX_SPEED_MPS = 55
const OFF_ROUTE_M = 50
const OFF_ROUTE_MS = 8000
const REROUTE_COOLDOWN_MS = 15000

let seq = 1
let route: HeldRoute | null = null
let progress: RouteProjection | null = null
let recalculating = false
let arrived = false
let snapshot: RouteSnapshot = { route: null, progress: null, recalculating: false, arrived: false }
const subscribers = new Set<() => void>()

let watchId: number | null = null
let watchConsumers = 0
let watchPaused = false
let lastAccepted: NavFix | null = null
let navFix: NavFix | null = null
const fixSubscribers = new Set<(fix: NavFix) => void>()

let offSince: number | null = null
let lastRerouteAt = 0

function publish() {
  snapshot = { route, progress, recalculating, arrived }
  subscribers.forEach((fn) => fn())
}

export function subscribeRoute(cb: () => void) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function getRouteSnapshot(): RouteSnapshot {
  return snapshot
}

export function getHeldRoute(): HeldRoute | null {
  return route
}

export function getRouteProgress(): RouteProjection | null {
  return progress
}

export function getNavFix(): NavFix | null {
  return navFix
}

export function commitHeldRoute(next: Omit<HeldRoute, 'id'>): HeldRoute {
  route = { ...next, id: seq++ }
  progress = null
  arrived = false
  recalculating = false
  offSince = null
  watchPaused = false
  publish()
  if (watchConsumers > 0) ensureWatch()
  return route
}

export function endHeldRoute() {
  route = null
  progress = null
  arrived = false
  recalculating = false
  offSince = null
  watchPaused = false
  publish()
}

export function setRouteProgress(next: RouteProjection | null) {
  progress = next
  publish()
}

export function setRecalculating(next: boolean) {
  if (recalculating === next) return
  recalculating = next
  publish()
}

export function markArrived() {
  if (arrived) return
  arrived = true
  recalculating = false
  watchPaused = true
  if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  publish()
}

export function pathLengthMeters(path: PathPoint[]): number {
  let meters = 0
  for (let i = 1; i < path.length; i++) meters += distanceKm(path[i - 1], path[i]) * 1000
  return meters
}

export function parseDistanceMeters(text: string): number {
  const km = text.match(/([\d.,]+)\s*km/i)
  if (km) return Number(km[1].replace(',', '.')) * 1000
  const meters = text.match(/([\d.,]+)\s*m/i)
  if (meters) return Number(meters[1].replace(',', '.'))
  return 0
}

export function parseDurationSeconds(text: string): number {
  const hours = text.match(/(\d+)\s*h/i)
  const mins = text.match(/(\d+)\s*min/i)
  if (hours || mins) return (hours ? Number(hours[1]) * 3600 : 0) + (mins ? Number(mins[1]) * 60 : 0)
  return 0
}

export function remainingSeconds(remainingM: number, totalM: number, totalSeconds: number, speedMps?: number | null): number {
  if (speedMps != null && speedMps > 0.5) return remainingM / speedMps
  if (totalM > 1 && totalSeconds > 0) return remainingM * (totalSeconds / totalM)
  return remainingM / 1.3
}

export function formatEtaClock(secondsFromNow: number, lang: string): string {
  const when = new Date(Date.now() + Math.max(0, secondsFromNow) * 1000)
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB'
  return when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function bearingDegrees(from: PathPoint, to: PathPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat))
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat))
    - Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng))
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** Nearest point on the polyline, plus the walked and remaining shapes. */
export function projectOnPath(point: PathPoint, path: PathPoint[]): RouteProjection | null {
  if (!isValidCoord(point) || path.length < 2) return null
  const lat0 = point.lat * Math.PI / 180
  const mPerLat = 111320
  const mPerLng = Math.max(1e-6, 111320 * Math.cos(lat0))
  const xy = (p: PathPoint) => ({ x: p.lng * mPerLng, y: p.lat * mPerLat })
  const origin = xy(point)
  let best = Number.POSITIVE_INFINITY
  let bestAlong = 0
  let bestPoint = path[0]
  let bestIndex = 0
  let cursor = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const segM = distanceKm(a, b) * 1000
    const A = xy(a)
    const B = xy(b)
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len2 = dx * dx + dy * dy
    const t = len2 < 1e-6 ? 0 : Math.min(1, Math.max(0, ((origin.x - A.x) * dx + (origin.y - A.y) * dy) / len2))
    const lat = a.lat + (b.lat - a.lat) * t
    const lng = a.lng + (b.lng - a.lng) * t
    const candidate = { lat, lng }
    const away = distanceKm(point, candidate) * 1000
    const along = cursor + segM * t
    if (away < best) {
      best = away
      bestAlong = along
      bestPoint = candidate
      bestIndex = i - 1
    }
    cursor += segM
  }
  const total = cursor
  const traveled = path.slice(0, bestIndex + 1)
  traveled.push(bestPoint)
  const remaining = [bestPoint, ...path.slice(bestIndex + 1)]
  return {
    distanceFromPathM: best,
    traveledM: bestAlong,
    remainingM: Math.max(0, total - bestAlong),
    traveled,
    remaining,
  }
}

/**
 * Off the line by more than 50 m (widened when the fix is less precise) for 8 s,
 * and at least 15 s since the last re-route.
 */
export function offRouteAction(distanceFromPathM: number, accuracy: number, now: number): 'on-route' | 'waiting' | 'reroute' {
  const limit = OFF_ROUTE_M + Math.max(0, accuracy - 10)
  if (distanceFromPathM <= limit) {
    offSince = null
    return 'on-route'
  }
  if (offSince == null) offSince = now
  if (now - offSince < OFF_ROUTE_MS) return 'waiting'
  if (now - lastRerouteAt < REROUTE_COOLDOWN_MS) return 'waiting'
  lastRerouteAt = now
  offSince = null
  return 'reroute'
}

function acceptFix(pos: GeolocationPosition): NavFix | null {
  const next: NavFix = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    heading: typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
    speed: typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
    at: pos.timestamp || Date.now(),
  }
  if (!isValidCoord(next) || !(next.accuracy <= MAX_ACCURACY_M)) return null
  if (lastAccepted) {
    const dt = Math.max(0.001, (next.at - lastAccepted.at) / 1000)
    const moved = distanceKm(lastAccepted, next) * 1000
    if (moved / dt > MAX_SPEED_MPS) return null
    if (next.heading == null && moved > 4) next.heading = bearingDegrees(lastAccepted, next)
  }
  lastAccepted = next
  return next
}

function ensureWatch() {
  if (watchPaused || watchId != null || typeof navigator === 'undefined' || !navigator.geolocation) return
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const fix = acceptFix(pos)
      if (!fix) return
      navFix = fix
      fixSubscribers.forEach((fn) => fn(fix))
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
  )
}

function stopWatch() {
  if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
}

/** One shared watch for every mounted map. Stops when the last subscriber leaves. */
export function subscribeNavFix(cb: (fix: NavFix) => void) {
  fixSubscribers.add(cb)
  watchConsumers += 1
  ensureWatch()
  return () => {
    fixSubscribers.delete(cb)
    watchConsumers = Math.max(0, watchConsumers - 1)
    if (watchConsumers === 0) stopWatch()
  }
}
