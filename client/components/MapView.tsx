'use client'

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { APIProvider, Map, Map3D, Marker3D, MapMode, AltitudeMode, AdvancedMarker, InfoWindow, Pin, useMap, useMap3D, useMapsLibrary } from '@vis.gl/react-google-maps'
import { Accessibility, AlertCircle, Bike, Bookmark, Car, ChevronLeft, Clock, Compass, Earth, ExternalLink, Footprints, Globe, Image as ImageIcon, Map as MapGlyph, MapPin, Maximize2, Minimize2, Navigation, Plus, Rotate3d, RotateCcw, RotateCw, Satellite, Share2, Star, Store, Users, X } from 'lucide-react'
import type { ItineraryStop, Place, Theme } from '@/lib/types'
import type { CustomRouteConfig, MapAnnotations, TravelMode } from '@/lib/mapActions'
import type { CommunityMapPin, CommunityFriend } from '@/components/community/useCommunityMapLayer'
import {
  distanceKm,
  isValidCoord,
  shouldIncludeUserInBounds,
  type LatLng,
} from '@/lib/geo'
import { PlaceImage } from './PlaceImage'
import { hasStepFreeEntrance } from '@/lib/access'
import { PlaceBadges } from './PlaceBadges'
import { PlaceRatePopover, reviewLabel, type ReviewSummary } from './PlaceReviews'
import { cinematicMapKeys } from '@/lib/animationMemory'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useI18n } from '@/components/I18nProvider'
import { focusRing } from '@/lib/design/tokens'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
const ROUTE_ORANGE = '#F56A00'
/** Navigation blue. A white casing keeps the 5px line readable on pale and dark roads. */
const ROUTE_BLUE = '#1A73E8'
const KIGALI_DEFAULT: LatLng = { lat: -1.9441, lng: 30.0619 }
const DEFAULT_ZOOM = 13

/** 3D camera defaults — vector maps get true perspective, raster falls back to 45° imagery. */
const VECTOR_3D_TILT = 55
const RASTER_3D_TILT = 45
const DEFAULT_3D_HEADING = 20

type FitPadding = number | { top: number; right: number; bottom: number; left: number }

/**
 * Per-map cancel hooks so programmatic fits (PreciseMapFit / MapZoomFocus /
 * route fitBounds) never fight the cinematic camera animations.
 */
const cameraInterrupts = new WeakMap<google.maps.Map, () => void>()

function cancelCameraMotion(map: google.maps.Map | null | undefined) {
  if (!map) return
  cameraInterrupts.get(map)?.()
}

/** Once the user gestures on the map, never auto-orbit again this session. */
let orbitStoppedForSession = false

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Draw a walking/driving line with the Routes library, not the deprecated Directions service. */
function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

function formatMillis(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function routesTravelMode(mode: TravelMode): 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' {
  if (mode === 'DRIVE' || mode === 'BICYCLE' || mode === 'TRANSIT') return mode
  return 'WALK'
}

function latLngPath(path: unknown): google.maps.LatLngLiteral[] {
  if (!Array.isArray(path)) return []
  const out: google.maps.LatLngLiteral[] = []
  for (const point of path) {
    if (!point || typeof point !== 'object') continue
    const raw = point as { lat?: unknown; lng?: unknown }
    const lat = typeof raw.lat === 'function' ? (point as google.maps.LatLng).lat() : raw.lat
    const lng = typeof raw.lng === 'function' ? (point as google.maps.LatLng).lng() : raw.lng
    if (typeof lat === 'number' && typeof lng === 'number') out.push({ lat, lng })
  }
  return out
}

/** Routes API (Route.computeRoutes). Falls back to the server key if the browser key is refused. */
async function computeDrawnRoute(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode,
): Promise<{ path: google.maps.LatLngLiteral[]; distance: string; duration: string; steps?: RouteStep[] } | null> {
  const travelMode = routesTravelMode(mode)
  try {
    const lib = (await google.maps.importLibrary('routes')) as unknown as {
      Route: {
        computeRoutes: (request: Record<string, unknown>) => Promise<{
          routes?: Array<{ path?: unknown; distanceMeters?: number; durationMillis?: number }>
        }>
      }
    }
    const { routes } = await lib.Route.computeRoutes({
      origin,
      destination,
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis'],
    })
    const route = routes?.[0]
    const path = latLngPath(route?.path)
    if (path.length >= 2) {
      return {
        path,
        distance: route?.distanceMeters != null ? formatMeters(route.distanceMeters) : '',
        duration: route?.durationMillis != null ? formatMillis(route.durationMillis) : '',
      }
    }
  } catch {
    /* The browser key may not be allowed to call Routes. The server route uses the server key. */
  }

  const res = await fetch('/api/directions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination, travelMode }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { distance?: string; duration?: string; polyline?: string; steps?: RouteStep[] }
  if (!data.polyline) return null
  if (!google.maps.geometry?.encoding) {
    try { await google.maps.importLibrary('geometry') } catch { return null }
  }
  if (!google.maps.geometry?.encoding) return null
  const path = google.maps.geometry.encoding
    .decodePath(data.polyline)
    .map((p) => ({ lat: p.lat(), lng: p.lng() }))
  if (path.length < 2) return null
  return { path, distance: data.distance ?? '', duration: data.duration ?? '', steps: data.steps }
}

type PaintedRoute = { setMap: (map: google.maps.Map | null) => void }

function paintRoute(map: google.maps.Map, path: google.maps.LatLngLiteral[], mode: TravelMode = 'WALK'): PaintedRoute {
  // geodesic stays off: the Routes path already follows the roads. Extra
  // interpolation bows the line off the street at high zoom.
  const weight = mode === 'DRIVE' ? 7 : 6
  const dashed = mode === 'BICYCLE'
  const casing = new google.maps.Polyline({
    map,
    path,
    geodesic: false,
    strokeColor: '#ffffff',
    strokeOpacity: 0.95,
    strokeWeight: weight + 4,
    zIndex: 8,
  })
  const line = new google.maps.Polyline({
    map,
    path,
    geodesic: false,
    strokeColor: ROUTE_BLUE,
    strokeOpacity: dashed ? 0 : 1,
    strokeWeight: weight,
    zIndex: 9,
    icons: dashed
      ? [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: ROUTE_BLUE, scale: 3 },
          offset: '0',
          repeat: '14px',
        }]
      : undefined,
  })
  // Vector maps drop ground polylines when tilt or the basemap type changes
  // (3D restore after fitBounds, satellite hybrid). Re-attach on that change.
  let sig = `${map.getTilt() ?? 0}|${map.getMapTypeId() ?? ''}`
  const idle = map.addListener('idle', () => {
    const next = `${map.getTilt() ?? 0}|${map.getMapTypeId() ?? ''}`
    if (next === sig) return
    sig = next
    casing.setMap(null)
    line.setMap(null)
    casing.setMap(map)
    line.setMap(map)
  })
  return {
    setMap(next) {
      idle.remove()
      casing.setMap(next)
      line.setMap(next)
    },
  }
}

type RouteStep = { instruction: string; distance: string; duration: string }

type DrawnPath = {
  path: google.maps.LatLngLiteral[]
  distance: string
  duration: string
  destinationName: string
  originLabel?: string
  origin?: LatLng
  destination?: LatLng
  mode?: TravelMode
  steps?: RouteStep[]
}

/**
 * Pin colors by category. Café and restaurant stay brand orange, parks green.
 * Accessibility and local-business stay on the badge, so a park is not green
 * only because it is accessible.
 */
function categoryPinColor(item: Place): string {
  const blob = `${(item.categories ?? []).join(' ')} ${item.name ?? ''}`.toLowerCase()
  if (/park|garden|parc|nature|forest/.test(blob)) return '#1F7A4D'
  if (/pharmacy|hospital|clinic|health|doctor/.test(blob)) return '#C0392B'
  if (/museum|attraction|landmark|tourist|memorial/.test(blob)) return '#5B4DFF'
  if (/hotel|lodging|hostel/.test(blob)) return '#1A56C4'
  if (/market|shop|store|mall|boutique/.test(blob)) return '#C45C26'
  if (/cafe|coffee|restaurant|food|bar|bakery|burger|pizza/.test(blob)) return '#E8672A'
  return '#F56A00'
}

type RouteJob =
  | {
      kind: 'points'
      origin: LatLng
      destination: LatLng
      mode: TravelMode
      destinationName: string
      originLabel?: string
    }
  | {
      kind: 'place'
      query: string
      destination: LatLng
      mode: TravelMode
      destinationName: string
      originLabel: string
    }
  | {
      kind: 'stops'
      mode?: TravelMode
      stops: Array<{ coordinates: LatLng; name: string; encoded?: string; distance?: string; duration?: string }>
    }

function routeJobKey(job: RouteJob | null): string {
  if (!job) return ''
  if (job.kind === 'stops') {
    return `${job.mode ?? 'WALK'}:${job.stops.map((s) => `${s.coordinates.lat.toFixed(5)},${s.coordinates.lng.toFixed(5)}`).join('|')}`
  }
  const origin = job.kind === 'points'
    ? `${job.origin.lat.toFixed(5)},${job.origin.lng.toFixed(5)}`
    : job.query
  return `${job.kind}:${origin}:${job.destination.lat.toFixed(5)},${job.destination.lng.toFixed(5)}:${job.mode}`
}

async function drawLeg(origin: LatLng, destination: LatLng, mode: TravelMode, allowAlt = true) {
  const modes: TravelMode[] = [mode]
  if (allowAlt && mode !== 'BICYCLE') modes.push(mode === 'DRIVE' ? 'WALK' : 'DRIVE')
  for (const travel of modes) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 700))
      const drawn = await computeDrawnRoute(origin, destination, travel)
      if (drawn) return { ...drawn, mode: travel }
    }
  }
  return null
}

function pathCenter(path: google.maps.LatLngLiteral[]): LatLng {
  let lat = 0
  let lng = 0
  for (const p of path) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / path.length, lng: lng / path.length }
}

function routeChipText(drawn: DrawnPath, lang: string): string {
  let meters = 0
  for (let i = 1; i < drawn.path.length; i++) meters += distanceKm(drawn.path[i - 1], drawn.path[i]) * 1000
  const distance = drawn.distance || (meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`)
  const duration = drawn.duration || `${Math.max(1, Math.round(meters / 83.333))} min`
  const pretty = (value: string) => (lang === 'fr' ? value.replace(/\./g, ',') : value)
  return `${pretty(distance)} · ${pretty(duration)}`
}

function frameRangeMeters(path: google.maps.LatLngLiteral[]): number {
  const mid = pathCenter(path)
  let max = 0
  for (const p of path) {
    const meters = distanceKm(mid, p) * 1000
    if (meters > max) max = meters
  }
  const ends = distanceKm(path[0], path[path.length - 1]) * 1000
  return Math.min(20000, Math.max(1600, Math.max(ends * 2.1, max * 4.6)))
}

function routeActionLabel(mode: TravelMode, t: (key: string) => string): string {
  if (mode === 'DRIVE') return t('map.routeDrive')
  if (mode === 'BICYCLE') return t('map.routeBike')
  return t('map.routeWalk')
}

const TRAVEL_MODES: { id: TravelMode; labelKey: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'WALK', labelKey: 'map.modeWalk', icon: Footprints },
  { id: 'BICYCLE', labelKey: 'map.modeBike', icon: Bike },
  { id: 'DRIVE', labelKey: 'map.modeDrive', icon: Car },
]

/** Computes the road path once, for every view mode. Does not need a Map instance. */
function RouteComputer({
  job,
  onDrawn,
  onRouteInfo,
  onRouteError,
}: {
  job: RouteJob | null
  onDrawn: (drawn: DrawnPath | null) => void
  onRouteInfo?: (info: RouteInfo | null) => void
  onRouteError?: (message: string | null) => void
}) {
  const key = routeJobKey(job)

  useEffect(() => {
    if (!job) {
      onDrawn(null)
      return
    }
    let cancelled = false

    void (async () => {
      if (job.kind === 'stops') {
        const stops = job.stops.filter((s) => isValidCoord(s.coordinates))
        if (stops.length < 2) return
        const mode = job.mode ?? 'WALK'
        const path: google.maps.LatLngLiteral[] = []
        const steps: RouteStep[] = []
        let distance = ''
        let duration = ''
        for (let i = 1; i < stops.length; i++) {
          if (cancelled) return
          const prev = stops[i - 1]
          const next = stops[i]
          if (mode === 'WALK' && next.encoded) {
            if (!google.maps.geometry?.encoding) {
              try { await google.maps.importLibrary('geometry') } catch { /* server path below */ }
            }
            if (google.maps.geometry?.encoding) {
              const decoded = google.maps.geometry.encoding.decodePath(next.encoded).map((p) => ({ lat: p.lat(), lng: p.lng() }))
              if (decoded.length >= 2) {
                path.push(...decoded)
                distance = next.distance || distance
                duration = next.duration || duration
                continue
              }
            }
          }
          const drawn = await drawLeg(prev.coordinates, next.coordinates, mode, mode !== 'BICYCLE')
          if (cancelled) return
          if (!drawn) continue
          path.push(...drawn.path)
          if (drawn.steps?.length) steps.push(...drawn.steps)
          distance = drawn.distance || next.distance || distance
          duration = drawn.duration || next.duration || duration
        }
        if (cancelled) return
        if (path.length < 2) {
          onRouteError?.(mode === 'BICYCLE' ? 'mode-unsupported' : 'Could not draw that route.')
          if (mode === 'WALK') onDrawn(null)
          return
        }
        const drawn: DrawnPath = {
          path,
          distance,
          duration,
          destinationName: stops[stops.length - 1].name,
          mode,
          steps,
        }
        onDrawn(drawn)
        onRouteInfo?.({ distance, duration, destinationName: drawn.destinationName })
        return
      }

      let origin: LatLng | null = job.kind === 'points' ? job.origin : null
      if (job.kind === 'place') {
        const pair = job.query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
        if (pair) {
          origin = { lat: Number(pair[1]), lng: Number(pair[2]) }
        } else {
          try {
            const res = await fetch(`/api/place-photos?q=${encodeURIComponent(job.query)}`)
            const data = res.ok ? await res.json() as { place?: { coordinates?: { lat?: number; lng?: number } } } : null
            const coords = data?.place?.coordinates
            if (typeof coords?.lat === 'number' && typeof coords?.lng === 'number') {
              origin = { lat: coords.lat, lng: coords.lng }
            }
          } catch { /* reported below */ }
        }
      }
      if (cancelled) return
      if (!origin || !isValidCoord(origin) || !isValidCoord(job.destination)) {
        onRouteError?.(job.kind === 'place' ? `Could not find "${job.query}" on the map.` : 'Invalid map coordinates for this route.')
        onDrawn(null)
        return
      }
      const drawn = await drawLeg(origin, job.destination, job.mode, job.mode !== 'BICYCLE')
      if (cancelled) return
      if (!drawn) {
        onRouteError?.(job.mode === 'BICYCLE' ? 'mode-unsupported' : 'Could not draw that route. Routes API may not be enabled for this Maps key.')
        return
      }
      const result: DrawnPath = {
        path: drawn.path,
        distance: drawn.distance,
        duration: drawn.duration,
        destinationName: job.destinationName,
        originLabel: job.originLabel,
        origin,
        destination: job.destination,
        mode: drawn.mode,
        steps: drawn.steps,
      }
      onDrawn(result)
      onRouteInfo?.({
        distance: result.distance,
        duration: result.duration,
        destinationName: result.destinationName,
        originLabel: result.originLabel,
      })
    })()

    return () => {
      cancelled = true
    }
    // key captures the job contents; callbacks are stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return null
}

/** Classic polyline on the vector map: Map, 3D tilt, and Satellite share this layer. */
function VectorRouteLine({ path, mode = 'WALK' }: { path: google.maps.LatLngLiteral[]; mode?: TravelMode }) {
  const map = useMap()
  const sig = `${mode}:${path.length}:${path[0]?.lat.toFixed(5)}:${path[path.length - 1]?.lng.toFixed(5)}`

  useEffect(() => {
    if (!map || path.length < 2) return
    const painted = paintRoute(map, path, mode)
    const bounds = new google.maps.LatLngBounds()
    path.forEach((p) => bounds.extend(p))
    cancelCameraMotion(map)
    map.fitBounds(bounds, { top: 150, right: 80, bottom: 230, left: 56 })
    return () => painted.setMap(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig])

  return null
}

/**
 * Photorealistic Map3D uses a different renderer. A google.maps.Polyline on the
 * vector map is not in that scene. Polyline3DElement is the line for this view.
 */
function RouteLine3D({ path, mode = 'WALK' }: { path: google.maps.LatLngLiteral[]; mode?: TravelMode }) {
  const maps3d = useMapsLibrary('maps3d')
  const map3d = useMap3D()
  const sig = `${mode}:${path.length}:${path[0]?.lat.toFixed(5)}:${path[path.length - 1]?.lng.toFixed(5)}`

  useEffect(() => {
    if (!maps3d || !map3d || path.length < 2) return
    const lib = maps3d as unknown as {
      Polyline3DElement: new (o: {
        path: google.maps.LatLngAltitudeLiteral[]
        strokeColor: string
        strokeWidth: number
        altitudeMode: google.maps.maps3d.AltitudeMode
        drawsOccludedSegments: boolean
      }) => HTMLElement
      AltitudeMode: typeof google.maps.maps3d.AltitudeMode
    }
    const linePath = path.map((p) => ({ lat: p.lat, lng: p.lng, altitude: 0 }))
    const make = (strokeColor: string, strokeWidth: number) => new lib.Polyline3DElement({
      path: linePath,
      strokeColor,
      strokeWidth,
      altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
      drawsOccludedSegments: true,
    })
    const casing = make('#ffffff', mode === 'DRIVE' ? 12 : 10)
    const line = make(ROUTE_BLUE, mode === 'DRIVE' ? 8 : 6)
    const els = [casing, line]
    els.forEach((el) => map3d.append(el))

    const center = pathCenter(path)
    map3d.flyCameraTo?.({
      endCamera: {
        center: { lat: center.lat, lng: center.lng, altitude: 0 },
        range: frameRangeMeters(path),
        tilt: 42,
        heading: 0,
      },
      durationMillis: 1200,
    })

    return () => {
      els.forEach((el) => { try { el.remove() } catch { /* gone */ } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps3d, map3d, sig])

  return null
}

function boundsSpanKm(bounds: google.maps.LatLngBounds): number {
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  return distanceKm({ lat: sw.lat(), lng: sw.lng() }, { lat: ne.lat(), lng: ne.lng() })
}

function clampZoomAfterFit(map: google.maps.Map, minZoom: number, maxZoom: number) {
  const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
    const z = map.getZoom()
    if (z == null) return
    if (z < minZoom) map.setZoom(minZoom)
    else if (z > maxZoom) map.setZoom(maxZoom)
  })
  return () => google.maps.event.removeListener(listener)
}

function fitMapPrecisely(
  map: google.maps.Map,
  markers: LatLng[],
  opts: {
    padding?: FitPadding
    minZoom?: number
    maxZoom?: number
    maxSpanKm?: number
    focus?: LatLng | null
    userLocation?: LatLng | null
    includeUser?: boolean
  } = {},
) {
  const valid = markers.filter(isValidCoord)
  if (valid.length === 0) return

  const minZoom = opts.minZoom ?? 15
  const maxZoom = opts.maxZoom ?? 17
  const maxSpanKm = opts.maxSpanKm ?? 32
  const padding = opts.padding ?? 48

  const fitUser =
    opts.includeUser &&
    opts.userLocation &&
    isValidCoord(opts.userLocation) &&
    shouldIncludeUserInBounds(opts.userLocation, valid)

  if (valid.length === 1 && !fitUser) {
    map.setCenter(valid[0])
    map.setZoom(maxZoom)
    return
  }

  const bounds = new google.maps.LatLngBounds()
  for (const m of valid) bounds.extend(m)
  if (fitUser && opts.userLocation) bounds.extend(opts.userLocation)

  const span = boundsSpanKm(bounds)
  if (span > maxSpanKm) {
    const focus =
      opts.focus && isValidCoord(opts.focus)
        ? opts.focus
        : fitUser && opts.userLocation
          ? opts.userLocation
          : valid[0]
    map.setCenter(focus)
    map.setZoom(minZoom)
    return
  }

  const pad =
    typeof padding === 'number'
      ? { top: padding, right: padding, bottom: padding, left: padding }
      : padding
  map.fitBounds(bounds, pad)
  clampZoomAfterFit(map, minZoom, maxZoom)
}

export type MapViewSize = 'compact' | 'full'

export interface RouteInfo {
  distance: string
  duration: string
  destinationName: string
  originLabel?: string
}

interface Props {
  places: Place[]
  itinerary: ItineraryStop[] | null
  /** AI-drawn map annotations (colored pins, circles, extra markers). */
  annotations?: MapAnnotations
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  userLocation: { lat: number; lng: number } | null
  theme: Theme
  showUserLocation?: boolean
  routeFromUser?: boolean
  customRoute?: CustomRouteConfig | null
  routeMode?: TravelMode
  onRouteInfo?: (info: RouteInfo | null) => void
  onRouteError?: (message: string | null) => void
  zoomFocusOnActive?: boolean
  size?: MapViewSize
  /** True while the AI is still generating — suppresses the cinematic camera
   *  glide/orbit/fly until the task finishes, so it doesn't fight the user. */
  aiBusy?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  selectedPlace?: Place | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  bottomSlot?: React.ReactNode
  hideInlinePlaceCard?: boolean
  onDirections?: () => void
  routeInfo?: RouteInfo | null
  /** Optional bar rendered above the map canvas (voice mode). */
  header?: ReactNode
  /** Full-map marker action bubble (opens the full details panel / saves / routes). */
  onPlaceFullDetails?: (place: Place) => void
  onPlaceSave?: (place: Place) => void
  onPlaceRoute?: (index: number) => void
  onRouteModeChange?: (mode: TravelMode) => void
  onRequestLocation?: () => void
  locationPending?: boolean
  savedPlaceIds?: Set<string>
  /** Community layer: shared pins (with owner attribution) drawn as distinct blue markers. */
  communityPins?: CommunityMapPin[]
  /** Community layer: accepted connections sharing a fresh location (avatar + presence ring). */
  communityFriends?: CommunityFriend[]
  /** Community layer toggle state — the control renders when the handler is given. */
  communityLayerOn?: boolean
  onToggleCommunityLayer?: () => void
  /** Open a traveller's profile sheet (pin attribution link / friend marker tap). */
  onOpenProfile?: (handle: string) => void
  /** One-shot center request from the community panel (shared-pin tap). */
  communityFocus?: LatLng | null
  /** Share action on the marker bubble / realistic card (opens the share picker). */
  onPlaceShare?: (place: Place) => void
  /** Map tap while the add-place sheet is open. */
  onMapClick?: (pos: { lat: number; lng: number }) => void
  /** Marker info card. Opened by a pin click, closed by the map background or the card's close button. */
  placeCardOpen?: boolean
  onPlaceCardClose?: () => void
  /** Floating “add a place” control. */
  onAddPlace?: () => void
}


function markerSetKey(markers: LatLng[], userLocation: LatLng | null, includeUser: boolean): string {
  const pts = markers.filter(isValidCoord).map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).sort()
  const user =
    includeUser && userLocation && isValidCoord(userLocation)
      ? `${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}`
      : ''
  return `${pts.join('|')}|u:${user}`
}

/** Center on place pins — not the user's GPS when results are in a different city. */
function PlacesMapCenter({ places }: { places: LatLng[] }) {
  const map = useMap()
  const placesKey = places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  const lastCenterKey = useRef('')

  useEffect(() => {
    if (!map || places.length === 0) return

    const valid = places.filter(isValidCoord)
    if (valid.length === 0) return

    // Only re-center when the place set actually changes — not on unrelated
    // re-renders (e.g. map-mode switches), which would stomp the camera.
    if (lastCenterKey.current === placesKey) return
    lastCenterKey.current = placesKey

    cancelCameraMotion(map)
    const first = valid[0]
    map.setCenter(first)
    map.setZoom(15)

    if (valid.length > 1) {
      const bounds = new google.maps.LatLngBounds()
      valid.forEach((c) => bounds.extend(c))
      map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 })
    }
  }, [map, placesKey, places])

  return null
}

function PreciseMapFit({
  markers,
  userLocation,
  includeUser,
  focus,
  size,
}: {
  markers: LatLng[]
  userLocation: LatLng | null
  includeUser: boolean
  focus?: LatLng | null
  size: MapViewSize
}) {
  const map = useMap()
  const lastFitKey = useRef('')

  useEffect(() => {
    if (!map || markers.length === 0) return
    const valid = markers.filter(isValidCoord)
    if (valid.length === 0) return

    const fitKey = `${markerSetKey(valid, userLocation, includeUser)}|${size}`
    if (lastFitKey.current === fitKey) return
    lastFitKey.current = fitKey

    cancelCameraMotion(map)
    const isFull = size === 'full'
    fitMapPrecisely(map, valid, {
      padding: isFull
        ? { top: 96, right: 44, bottom: 220, left: 44 }
        : 36,
      minZoom: 15,
      maxZoom: isFull ? 17 : 18,
      maxSpanKm: isFull ? 28 : 32,
      focus,
      userLocation,
      includeUser,
    })
  }, [map, markers, userLocation, includeUser, focus?.lat, focus?.lng, size])

  return null
}

function MapZoomFocus({
  position,
  enabled,
  targetZoom = 16,
}: {
  position: LatLng | null
  enabled: boolean
  targetZoom?: number
}) {
  const map = useMap()
  const lastFocusKey = useRef('')

  useEffect(() => {
    if (!map || !enabled || !position || !isValidCoord(position)) {
      if (!enabled) lastFocusKey.current = ''
      return
    }
    const focusKey = `${position.lat.toFixed(5)},${position.lng.toFixed(5)}@${targetZoom}`
    if (lastFocusKey.current === focusKey) return
    lastFocusKey.current = focusKey
    cancelCameraMotion(map)
    map.setCenter(position)
    map.setZoom(targetZoom)
  }, [map, position?.lat, position?.lng, enabled, targetZoom])

  return null
}

type MapDisplayMode = '3d' | 'map' | 'satellite' | 'realistic'

const MAP_MODE_OPTIONS: {
  id: MapDisplayMode
  label: string
  icon: ComponentType<{ className?: string }>
}[] = [
  { id: '3d', label: '3D', icon: Rotate3d },
  { id: 'map', label: 'Map', icon: MapGlyph },
  { id: 'satellite', label: 'Satellite', icon: Satellite },
  // Photorealistic Google 3D (Map3DElement). Coverage is US-centric today —
  // which fits the 11 US World Cup host cities; elsewhere it shows a plain globe.
  { id: 'realistic', label: 'Realistic', icon: Earth },
]

function MapUiOptions({ fullControls }: { fullControls: boolean }) {
  const map = useMap()
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    if (fullControls) {
      map.setOptions({
        // Custom +/- buttons replace the native stack so they stay visible
        // on the compact side map, where the default controls were hidden.
        zoomControl: false,
        scrollwheel: true,
        gestureHandling: 'auto',
        streetViewControl: !isMobile,
        fullscreenControl: !isMobile,
        mapTypeControl: false,
        // Custom rotate cluster replaces the native compass widget; vector
        // maps then rotate/tilt freely via Ctrl+drag (two fingers on touch).
        rotateControl: false,
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
      })
    } else {
      map.setOptions({
        zoomControl: false,
        scrollwheel: true,
        gestureHandling: 'auto',
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        rotateControl: false,
        headingInteractionEnabled: false,
        tiltInteractionEnabled: false,
      })
    }
  }, [map, fullControls, isMobile])

  return null
}

/** Segmented pill control — brand-styled replacement for the old map-type <select>. */
function MapModeControl({
  mode,
  onChange,
}: {
  mode: MapDisplayMode
  onChange: (mode: MapDisplayMode) => void
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-[58] -translate-x-1/2">
      <div
        role="group"
        aria-label="Map mode"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-gray-200 bg-white/95 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
      >
        {MAP_MODE_OPTIONS.map((opt) => {
          const active = mode === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              aria-label={opt.label}
              title={opt.label}
              onClick={() => onChange(opt.id)}
              className={`flex items-center justify-center rounded-full text-[13px] font-medium tracking-tight transition-colors motion-reduce:transition-none max-sm:h-10 max-sm:w-10 sm:px-3.5 sm:py-1.5 ${focusRing} ${
                active
                  ? 'bg-[#F56A00] text-white'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10'
              }`}
            >
              {/* Below sm the pill must fit 320px: icons only. Abbreviations
                  ("Sat", "Real") are ambiguous and a scroll row hides modes,
                  so each mode keeps a distinct glyph + title/aria label. */}
              <opt.icon className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Right-edge rotate cluster for the 3D vector map: 45° steps left/right
 * (smoothly tweened) and a compass reset back to north. Manual rotation is a
 * camera takeover, so it permanently stops the ambient orbit like any other
 * user gesture. Hidden in satellite mode — raster imagery snaps heading to
 * 90° steps and free rotation reads as broken there.
 */
function MapRotateControls() {
  const map = useMap()
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const rotateTo = (target: number, from: number) => {
    if (!map) return
    if (prefersReducedMotion()) {
      map.setHeading(((target % 360) + 360) % 360)
      return
    }
    const duration = 350
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3) // cubic ease-out
      map.setHeading(from + (target - from) * e)
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const handleRotate = (delta: number | 'north') => {
    if (!map) return
    orbitStoppedForSession = true
    cancelCameraMotion(map)
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    const from = map.getHeading() ?? 0
    // Reset spins through the shorter arc back to north.
    const target = delta === 'north' ? (((from % 360) + 360) % 360 > 180 ? Math.ceil(from / 360) * 360 : Math.floor(from / 360) * 360) : from + delta
    rotateTo(target, from)
  }

  const buttonClass =
    'flex h-10 w-10 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-gray-100 motion-reduce:transition-none dark:text-gray-200 dark:hover:bg-white/10'

  return (
    <div className="pointer-events-none absolute right-4 top-1/2 z-[58] -translate-y-1/2">
      <div
        role="group"
        aria-label="Rotate map"
        className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-full border border-gray-200 bg-white/95 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
      >
        <button type="button" aria-label="Rotate left" title="Rotate left 45°" onClick={() => handleRotate(-45)} className={buttonClass}>
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Face north" title="Reset to north" onClick={() => handleRotate('north')} className={buttonClass}>
          <Compass className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Rotate right" title="Rotate right 45°" onClick={() => handleRotate(45)} className={buttonClass}>
          <RotateCw className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function MapZoomControls({ compact }: { compact: boolean }) {
  const map = useMap()
  const zoomBy = (delta: number) => {
    if (!map) return
    orbitStoppedForSession = true
    cancelCameraMotion(map)
    const next = (map.getZoom() ?? DEFAULT_ZOOM) + delta
    map.setZoom(Math.min(20, Math.max(3, next)))
  }
  const buttonClass =
    'flex h-10 w-10 items-center justify-center text-[18px] font-medium leading-none text-gray-800 transition-colors hover:bg-gray-100 motion-reduce:transition-none dark:text-gray-100 dark:hover:bg-white/10'

  return (
    <div className={`pointer-events-none absolute z-[58] ${compact ? 'bottom-20 right-3' : 'bottom-24 right-4 max-md:bottom-28'}`}>
      <div
        role="group"
        aria-label="Zoom"
        className="pointer-events-auto flex flex-col overflow-hidden rounded-full border border-gray-200 bg-white/95 shadow-[0_2px_12px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[#15151a]/95"
      >
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1)} className={buttonClass}>
          +
        </button>
        <div className="mx-2 h-px bg-gray-200 dark:bg-white/10" />
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-1)} className={buttonClass}>
          −
        </button>
      </div>
    </div>
  )
}

/**
 * Cloud Map ID. Create a vector Map ID with this exact name in
 * Google Cloud Console → Map Management, and attach it to the browser key.
 * Day and night use the Map `colorScheme` prop, not a JSON style sheet.
 * Override with NEXT_PUBLIC_GOOGLE_MAP_ID once the cloud ID exists.
 */
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID?.trim() || 'mapforall-map'

function applyDisplayMode(
  map: google.maps.Map,
  mode: MapDisplayMode,
  size: MapViewSize,
  isVector: boolean | null,
  routeHold = false,
) {
  // A mapId forbids custom map types (StyledMapType / setMapTypeId('basemap')).
  // Built-in roadmap and hybrid are the only type switches left.
  const aerial = mode === 'satellite' || (mode === '3d' && size === 'full' && isVector === false)
  const nextType = aerial ? 'hybrid' : 'roadmap'
  if (map.getMapTypeId() !== nextType) map.setMapTypeId(nextType)
  if (mode === '3d' && size === 'full') {
    // A route needs a shallower tilt so the street line stays in view.
    const tilt = isVector === false ? RASTER_3D_TILT : routeHold ? 42 : VECTOR_3D_TILT
    map.setTilt(tilt)
    map.setHeading(isVector === false ? 0 : DEFAULT_3D_HEADING)
    return
  }
  map.setTilt(0)
  map.setHeading(0)
}

/**
 * Applies the selected display mode to the map. 3D prefers vector rendering
 * (roadmap, tilt 55); if the map falls back to raster it uses hybrid + tilt 45
 * so 45° aerial imagery still gives a 3D feel. Compact maps stay flat.
 *
 * Re-applies tilt after programmatic fitBounds (which resets tilt to 0) via an
 * idle listener — without this the map looks flat even in 3D mode.
 */
function MapModeController({ mode, size, routeHold = false }: { mode: MapDisplayMode; size: MapViewSize; routeHold?: boolean }) {
  const map = useMap()
  const [isVector, setIsVector] = useState<boolean | null>(null)

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const update = () => {
      const rt = map.getRenderingType?.()
      if (rt === 'VECTOR') setIsVector(true)
      else if (rt === 'RASTER') setIsVector(false)
    }
    update()
    const listener = map.addListener('renderingtype_changed', update)
    return () => listener.remove()
  }, [map])

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    cancelCameraMotion(map)
    applyDisplayMode(map, mode, size, isVector, routeHold)
  }, [map, mode, isVector, size, routeHold])

  // fitBounds / setZoom reset tilt to 0 — restore 3D perspective once the fit settles.
  useEffect(() => {
    if (!map || typeof google === 'undefined' || mode !== '3d' || size !== 'full') return
    const listener = map.addListener('idle', () => {
      const tilt = map.getTilt() ?? 0
      if (tilt < 10) applyDisplayMode(map, mode, size, isVector, routeHold)
    })
    return () => listener.remove()
  }, [map, mode, size, isVector, routeHold])

  return null
}

/**
 * Cinematic camera for 3D mode: glides to the active place (~1s cubic
 * ease-out via rAF + moveCamera) and slowly orbits (~1°/100ms) once the map
 * is idle. Orbit stops permanently for the session on any user gesture and
 * never runs when prefers-reduced-motion is set. Registered in
 * `cameraInterrupts` so programmatic fits always cancel it first.
 */
function CinematicCamera({
  focus,
  enabled,
  glideCenter,
  resetKey,
}: {
  focus: LatLng | null
  enabled: boolean
  /** False when MapZoomFocus owns centering — avoids fighting it. */
  glideCenter: boolean
  /** Changes when the marker set changes, so the orbit re-arms after refits. */
  resetKey: string
}) {
  const map = useMap()
  const rafRef = useRef<number | null>(null)
  const idleRef = useRef<google.maps.MapsEventListener | null>(null)

  // Register the cancel hook for this map so fits can interrupt us.
  useEffect(() => {
    if (!map) return
    const cancel = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      idleRef.current?.remove()
      idleRef.current = null
    }
    cameraInterrupts.set(map, cancel)
    return () => {
      cancel()
      cameraInterrupts.delete(map)
    }
  }, [map])

  // Any user gesture on the map permanently disables auto-orbit this session.
  useEffect(() => {
    if (!map || !enabled || typeof google === 'undefined') return
    const stop = () => {
      orbitStoppedForSession = true
      cancelCameraMotion(map)
    }
    const div = map.getDiv()
    const drag = map.addListener('dragstart', stop)
    div.addEventListener('wheel', stop, { passive: true })
    div.addEventListener('pointerdown', stop, { passive: true })
    return () => {
      drag.remove()
      div.removeEventListener('wheel', stop)
      div.removeEventListener('pointerdown', stop)
    }
  }, [map, enabled])

  const focusKey =
    focus && isValidCoord(focus) ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : ''

  useEffect(() => {
    if (!map || !enabled || typeof google === 'undefined') return
    const reduceMotion = prefersReducedMotion()

    cancelCameraMotion(map)

    const moveCamera = (cam: google.maps.CameraOptions) => {
      if (typeof map.moveCamera === 'function') {
        map.moveCamera(cam)
      } else {
        if (cam.center) map.setCenter(cam.center)
        if (cam.tilt != null) map.setTilt(cam.tilt)
        if (cam.heading != null) map.setHeading(cam.heading)
      }
    }

    const startOrbit = () => {
      if (orbitStoppedForSession || reduceMotion) return
      // Raster maps snap heading to 90° steps — orbit only on vector.
      if (map.getRenderingType?.() !== 'VECTOR') return
      // Wait for PreciseMapFit / MapZoomFocus / route fits to settle first.
      idleRef.current?.remove()
      idleRef.current = google.maps.event.addListenerOnce(map, 'idle', () => {
        let last = performance.now()
        const step = (now: number) => {
          if (orbitStoppedForSession) {
            rafRef.current = null
            return
          }
          const dt = now - last
          last = now
          // ~1° per 100ms
          moveCamera({ heading: ((map.getHeading() ?? 0) + dt * 0.01) % 360 })
          rafRef.current = requestAnimationFrame(step)
        }
        rafRef.current = requestAnimationFrame(step)
      })
    }

    const target = focus && isValidCoord(focus) ? focus : null

    // Don't replay the cinematic glide/orbit when the map merely remounts
    // (switching chat <-> full map, or page <-> page) for a marker set + focus
    // we've already animated this session — snap into place instead. A new
    // search or a different focused pin produces a new key and animates.
    const cinematicKey = `${resetKey}|${focusKey}`
    if (cinematicKey.trim() !== '|' && cinematicMapKeys.has(cinematicKey)) {
      if (target && glideCenter) {
        const settledTilt = map.getRenderingType?.() === 'RASTER' ? RASTER_3D_TILT : VECTOR_3D_TILT
        moveCamera({ center: target, tilt: settledTilt })
      }
      return () => cancelCameraMotion(map)
    }
    cinematicMapKeys.add(cinematicKey)

    if (!target || !glideCenter) {
      startOrbit()
      return () => cancelCameraMotion(map)
    }

    if (reduceMotion) {
      // No animation — but the focused place should still be centered.
      moveCamera({ center: target })
      return () => cancelCameraMotion(map)
    }

    const center = map.getCenter()
    const from = {
      lat: center?.lat() ?? target.lat,
      lng: center?.lng() ?? target.lng,
      tilt: map.getTilt() ?? 0,
    }
    const toTilt = map.getRenderingType?.() === 'RASTER' ? RASTER_3D_TILT : VECTOR_3D_TILT
    const duration = 1000
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3) // cubic ease-out
      moveCamera({
        center: {
          lat: from.lat + (target.lat - from.lat) * e,
          lng: from.lng + (target.lng - from.lng) * e,
        },
        tilt: from.tilt + (toTilt - from.tilt) * e,
      })
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        startOrbit()
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelCameraMotion(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, glideCenter, focusKey, resetKey])

  return null
}


type PlaceDetail = Place & { photos?: string[]; open?: boolean; price?: string }

function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function estimateWalkMin(km: number): number {
  return Math.max(1, Math.round((km / 5) * 60))
}

function MapPlaceholder({
  place,
  userLocation,
  empty = false,
  routeInfo,
  onDirections,
  className,
}: {
  place?: Place | null
  userLocation?: LatLng | null
  empty?: boolean
  routeInfo?: RouteInfo | null
  onDirections?: () => void
  className?: string
}) {
  const km =
    place?.coordinates && userLocation && isValidCoord(userLocation) && isValidCoord(place.coordinates)
      ? distanceKm(userLocation, place.coordinates)
      : null
  const distanceLabel = routeInfo?.distance ?? (km != null ? formatDistanceKm(km) : null)
  const durationLabel = routeInfo?.duration ?? (km != null ? `${estimateWalkMin(km)} min` : null)

  if (empty || !place) {
    return (
      <div
        className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] ${className ?? ''}`}
        style={{ minHeight: 200, width: '100%', position: 'relative' }}
      >
        <MapPin className="h-12 w-12 text-[#F56A00]" strokeWidth={1.5} />
        <p className="text-[14px] font-medium tracking-tight text-gray-900 dark:text-gray-100">Ask me where to go</p>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">I&apos;ll show places on the map</p>
      </div>
    )
  }

  return (
    <div
      className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] ${className ?? ''}`}
      style={{ minHeight: 200, width: '100%', position: 'relative' }}
    >
      <MapPin className="h-10 w-10 text-[#F56A00]" strokeWidth={1.5} />
      <p className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">{place.name}</p>
      <PlaceBadges place={place} />
      <div className="flex flex-wrap items-center justify-center gap-3 text-[13px] text-gray-500 dark:text-gray-400">
        {distanceLabel && <span>{distanceLabel}</span>}
        {durationLabel && <span>{durationLabel}</span>}
      </div>
      {onDirections && (
        <button
          type="button"
          onClick={onDirections}
          className="mt-2 rounded-full bg-[#F56A00] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] motion-reduce:transition-none"
        >
          Directions
        </button>
      )}
    </div>
  )
}

function PlaceDetailBox({ place }: { place: PlaceDetail }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      {place.photos && place.photos.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {place.photos.map((photo, i) => (
            <PlaceImage
              key={`${photo}-${i}`}
              place={{ ...place, photos: [photo] }}
              className="h-16 w-24 shrink-0 rounded-lg object-cover"
              width={192}
              height={128}
            />
          ))}
        </div>
      )}
      <p className="text-[13px] font-medium text-gray-900 dark:text-white">{place.name}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{place.address}</p>
      <div className="mt-1 flex items-center gap-2">
        {place.rating != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-amber-600">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            {place.rating}
          </span>
        )}
        {(place.price ?? place.price_level) && (
          <span className="text-[11px] text-gray-400">{place.price ?? place.price_level}</span>
        )}
        {place.open != null && (
          <span className={`text-[11px] ${place.open ? 'text-green-600' : 'text-red-500'}`}>
            {place.open ? 'Open now' : 'Closed'}
          </span>
        )}
      </div>
    </div>
  )
}

function UserAccuracyHalo({ location }: { location: LatLng }) {
  const map = useMap()
  const radius = Math.min(250, Math.max(28, location.accuracy && location.accuracy > 0 ? location.accuracy : 48))
  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const circle = new google.maps.Circle({
      map,
      center: { lat: location.lat, lng: location.lng },
      radius,
      fillColor: '#4285F4',
      fillOpacity: 0.16,
      strokeColor: '#4285F4',
      strokeOpacity: 0.45,
      strokeWeight: 1,
      clickable: false,
      zIndex: 40,
    })
    return () => circle.setMap(null)
  }, [map, location.lat, location.lng, radius])
  return null
}

function MapMarkers({
  markers,
  activeStopIndex,
  onMarkerClick,
  showUserLocation,
  userLocation,
  colors = {},
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  showUserLocation: boolean
  userLocation: LatLng | null
  numberedStops?: boolean
  /** place_id -> color, recolors the AI-highlighted pins. */
  colors?: Record<string, string>
}) {
  // Track coordinates already drawn so a duplicate entry (same place returned
  // twice, or a stop that repeats a place) doesn't stack a second static pin
  // under the active/glowing one — the "two markers, one bouncing one not" bug.
  const seenCoords = new Set<string>()

  return (
    <>
      {showUserLocation && userLocation && isValidCoord(userLocation) && (
        <>
          <UserAccuracyHalo location={userLocation} />
          <AdvancedMarker
            position={userLocation}
            title="Your location"
            zIndex={1000}
            collisionBehavior={typeof google === 'undefined' ? undefined : google.maps.CollisionBehavior.REQUIRED}
          >
            <span className="user-loc" aria-hidden>
              <span className="user-loc__pulse" />
              <span className="user-loc__dot" />
            </span>
          </AdvancedMarker>
        </>
      )}

      {markers.map((item, i) => {
        const coords = 'coordinates' in item ? item.coordinates : (item as Place).coordinates
        const name = 'name' in item ? item.name : (item as Place).name
        const isActive = activeStopIndex === i
        const pid = 'place_id' in item ? item.place_id : ''
        const hl = pid ? colors[pid] : undefined
        const flags = item as Place
        const stepFree = hasStepFreeEntrance(flags)
        const pending = flags.status === 'pending'
        const border = categoryPinColor(flags)

        // A plain (inactive, un-highlighted) pin that sits exactly on top of a
        // marker we've already rendered is a visual duplicate — skip it.
        const coordKey = isValidCoord(coords) ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : ''
        const dup = coordKey !== '' && seenCoords.has(coordKey)
        if (coordKey) seenCoords.add(coordKey)
        if (dup && !isActive && !hl) return null

        return (
          <AdvancedMarker
            key={`${pid ? pid : 'm'}-${i}`}
            position={coords}
            title={name}
            zIndex={hl ? 6 : isActive ? 5 : 1}
            collisionBehavior={typeof google === 'undefined' ? undefined : google.maps.CollisionBehavior.REQUIRED}
            onClick={() => onMarkerClick(i)}
          >
            {/* Keep the same DOM when a pin becomes active. Swapping the Pin
                for a glow badge makes Google Maps reparent the node, then React
                crashes on removeChild. */}
            <span
              className={`${isActive || hl ? 'hodari-glow-marker' : 'hodari-pin'}${pending ? ' hodari-pin--pending' : ''}`}
              style={{ '--mk': hl || border } as React.CSSProperties}
            >
              <span className="hodari-glow-marker__ring" aria-hidden />
              <span className="hodari-glow-marker__dot">{i + 1}</span>
              <span className="hodari-glow-marker__tip" aria-hidden />
              <span className={`hodari-pin__badge ${flags.local_business || stepFree || pending ? '' : 'invisible'}`}>
                {pending ? (
                  <Clock className="h-3 w-3 text-neutral-500" strokeWidth={1.75} aria-hidden />
                ) : (
                  <>
                    <Accessibility className={`h-3 w-3 text-[#0F6E56] ${stepFree ? '' : 'hidden'}`} aria-hidden />
                    <Store className={`h-3 w-3 text-[#C45C26] ${!stepFree && flags.local_business ? '' : 'hidden'}`} aria-hidden />
                  </>
                )}
              </span>
            </span>
          </AdvancedMarker>
        )
      })}
    </>
  )
}

/**
 * Glowing, gently bouncing marker for AI-highlighted places — visually distinct
 * from the plain numbered pins and Google's POI icons, so a marked place pops.
 */
function GlowMarkerContent({ color, glyph }: { color: string; glyph: string }) {
  return (
    <div className="hodari-glow-marker" style={{ '--mk': color } as React.CSSProperties}>
      <span className="hodari-glow-marker__ring" aria-hidden />
      <span className="hodari-glow-marker__dot">{glyph}</span>
      <span className="hodari-glow-marker__tip" aria-hidden />
    </div>
  )
}

/** Extra AI-placed markers (places not in the current list, e.g. an anchor). */
function AnnotationMarkers({ markers, placeCoords = [] }: { markers: MapAnnotations['markers']; placeCoords?: LatLng[] }) {
  // A highlighted place already renders its own (recolored) numbered marker, so
  // skip any annotation marker that sits on top of one — otherwise you see TWO
  // markers stacked at the same spot.
  const onAPlace = (c: LatLng) =>
    placeCoords.some((p) => Math.abs(p.lat - c.lat) < 2e-4 && Math.abs(p.lng - c.lng) < 2e-4)
  return (
    <>
      {markers
        .filter((m) => isValidCoord(m.coordinates) && !onAPlace(m.coordinates))
        .map((m) => (
          <AdvancedMarker key={`anno-${m.id}`} position={m.coordinates} title={m.name} zIndex={7}>
            <GlowMarkerContent color={m.color} glyph="★" />
          </AdvancedMarker>
        ))}
    </>
  )
}

/**
 * Community shared pins — visually distinct from the orange numbered result
 * pins: a blue-ringed round badge carrying the sharer's avatar emoji. Follows
 * the AnnotationMarkers dedup rule: a shared pin that sits exactly on top of a
 * current result marker is skipped, so the stacked-pin fix (535d429) holds.
 */
const COMMUNITY_BLUE = '#2E7DF6'

function CommunityPinMarkers({
  pins,
  placeCoords = [],
  onSelect,
}: {
  pins: CommunityMapPin[]
  placeCoords?: LatLng[]
  onSelect: (pinId: string) => void
}) {
  const onAPlace = (c: LatLng) =>
    placeCoords.some((p) => Math.abs(p.lat - c.lat) < 2e-4 && Math.abs(p.lng - c.lng) < 2e-4)
  // One marker per spot: if several shared pins stack (same place shared by
  // two people), keep the first — the bubble still names its sharer.
  const seen = new Set<string>()
  return (
    <>
      {pins
        .filter((p) => isValidCoord({ lat: p.lat, lng: p.lng }) && !onAPlace({ lat: p.lat, lng: p.lng }))
        .filter((p) => {
          const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((pin) => (
          <AdvancedMarker
            key={`cpin-${pin.pin_id}`}
            position={{ lat: pin.lat, lng: pin.lng }}
            title={pin.owner ? `${pin.name} — shared by @${pin.owner.handle}` : pin.name}
            zIndex={4}
            onClick={() => onSelect(pin.pin_id)}
          >
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white text-[15px] leading-none shadow-md"
              style={{ borderColor: COMMUNITY_BLUE }}
            >
              <span aria-hidden>{pin.owner?.avatar_emoji ?? '📍'}</span>
            </div>
          </AdvancedMarker>
        ))}
    </>
  )
}

/** Info card for a selected community pin — attribution links to the profile sheet. */
function CommunityPinBubble({
  pin,
  onOpenProfile,
}: {
  pin: CommunityMapPin
  onOpenProfile?: (handle: string) => void
}) {
  return (
    <div className="min-w-[180px] max-w-[250px] px-1 pb-1 pt-0.5">
      <p className="mb-1 pr-5 text-[13px] font-semibold leading-snug text-gray-900">{pin.name}</p>
      {pin.note && (
        <p className="mb-1.5 text-[12px] leading-snug text-gray-600">&ldquo;{pin.note}&rdquo;</p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {pin.owner ? (
          <button
            type="button"
            title={`Open @${pin.owner.handle}'s profile`}
            onClick={() => onOpenProfile?.(pin.owner!.handle)}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:border-[#2E7DF6]/60 hover:text-[#2E7DF6]"
          >
            <span aria-hidden>{pin.owner.avatar_emoji}</span>
            shared by @{pin.owner.handle}
          </button>
        ) : (
          <span className="text-[11px] text-gray-500">Shared pin</span>
        )}
        {pin.rating != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-amber-600">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            {pin.rating}
          </span>
        )}
      </div>
      {pin.address && <p className="mt-1 text-[11px] text-gray-500">{pin.address}</p>}
    </div>
  )
}

/**
 * Connections sharing their live location — small avatar-emoji badges with a
 * presence ring (green online / gray away). Tapping one opens their profile.
 */
function CommunityFriendMarkers({
  friends,
  onOpenProfile,
}: {
  friends: CommunityFriend[]
  onOpenProfile?: (handle: string) => void
}) {
  return (
    <>
      {friends
        .filter((f) => isValidCoord({ lat: f.lat, lng: f.lng }))
        .map((f) => (
          <AdvancedMarker
            key={`cfriend-${f.user_id}`}
            position={{ lat: f.lat, lng: f.lng }}
            title={`@${f.handle}${f.online ? ' — online' : ''}`}
            zIndex={8}
            onClick={() => onOpenProfile?.(f.handle)}
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-[13px] leading-none shadow-md"
              style={{ borderColor: f.online ? '#1FA463' : '#9CA3AF' }}
            >
              <span aria-hidden>{f.avatar_emoji}</span>
            </div>
          </AdvancedMarker>
        ))}
    </>
  )
}

/** Round map control toggling the community layer (shared pins + connections). */
function CommunityLayerToggle({
  on,
  onToggle,
  compact,
}: {
  on: boolean
  onToggle: () => void
  compact: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Hide community layer' : 'Show community layer'}
      title={on ? 'Hide shared pins & connections' : 'Show shared pins & connections'}
      onClick={onToggle}
      className={`absolute z-[58] flex items-center justify-center rounded-full border shadow-md backdrop-blur transition-colors motion-reduce:transition-none ${
        compact ? 'right-2 top-11 h-8 w-8' : 'right-4 top-20 h-10 w-10 max-md:top-36'
      } ${
        on
          ? 'border-[#2E7DF6]/60 bg-white/95 text-[#2E7DF6] dark:border-[#2E7DF6]/60 dark:bg-[#15151a]/95'
          : 'border-gray-200 bg-white/95 text-gray-600 hover:text-[#2E7DF6] dark:border-white/10 dark:bg-[#15151a]/95 dark:text-gray-300'
      }`}
    >
      <Users className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  )
}

function categoryLabel(raw: string | undefined, t: (key: string) => string): string | null {
  if (!raw) return null
  const key = raw.toLowerCase().replace(/\s+/g, '_')
  const translated = t(`categories.${key}`)
  return translated !== `categories.${key}` ? translated : raw.replace(/_/g, ' ')
}

/** Name, photo, rating and a route button. Desktop anchors it to the pin; mobile uses a bottom sheet. */
export function PlaceInfoCard({
  place,
  index,
  onClose,
  onRoute,
  onRate,
  onSave,
  saved = false,
  routeMode = 'WALK',
  reviewSummary,
  className = '',
}: {
  place: Place
  index: number
  onClose: () => void
  onRoute?: (index: number) => void
  onRate?: (place: Place) => void
  onSave?: (place: Place) => void
  saved?: boolean
  routeMode?: TravelMode
  reviewSummary?: ReviewSummary | null
  className?: string
}) {
  const { t, lang } = useI18n()
  const scored = reviewSummary && reviewSummary.count > 0 && reviewSummary.average != null
    ? reviewLabel(reviewSummary.count, reviewSummary.average, lang)
    : null
  // A later setState inside the InfoWindow makes Google Maps reparent the node
  // and React then crashes with removeChild. Use the photo already on the place.
  const photoUrl = place.photo_url ?? place.photos?.[0] ?? null
  const category = categoryLabel(place.categories?.[0], t)

  return (
    <div className={`relative min-w-[220px] max-w-[280px] text-gray-900 ${className}`}>
      {photoUrl ? (
        <PlaceImage
          place={{ ...place, photo_url: photoUrl, photos: [photoUrl] }}
          className="mb-2 h-24 w-full rounded-lg object-cover shadow-[0_10px_28px_rgba(0,0,0,0.28)]"
          width={560}
          height={240}
        />
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('placeCard.close')}
        className="absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-gray-600 shadow-sm transition-colors duration-150 hover:bg-gray-200 hover:text-gray-900"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="min-w-0 pr-8">
        <p className="text-[14px] font-semibold leading-snug">{place.name}</p>
        {category && <p className="mt-0.5 text-[12px] text-gray-500">{category}</p>}
        <PlaceBadges place={place} className="mt-1" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
        {place.rating != null && (
          <span className="inline-flex items-center gap-0.5 text-amber-700">
            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
            {place.rating}
          </span>
        )}
        {place.open_now != null && (
          <span className={place.open_now ? 'text-[#0F6E56]' : 'text-red-600'}>
            {place.open_now ? t('placeCard.open') : t('placeCard.closed')}
          </span>
        )}
        {place.price_level && <span>{place.price_level}</span>}
      </div>
      {place.address && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500">{place.address}</p>}
      {onSave && (
        <button
          type="button"
          onClick={() => onSave(place)}
          title={saved ? t('placeCard.saved') : t('placeCard.save')}
          aria-label={saved ? t('placeCard.saved') : t('placeCard.save')}
          aria-pressed={saved}
          className={`mt-2 inline-flex items-center gap-1 text-[12px] font-medium ${saved ? 'text-[#F56A00]' : 'text-gray-600'}`}
        >
          <Bookmark className={`h-3.5 w-3.5 ${saved ? 'fill-[#F56A00]' : ''}`} />
          {saved ? t('placeCard.saved') : t('placeCard.save')}
        </button>
      )}
      {onRate && (
        <button
          type="button"
          onClick={() => onRate(place)}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-amber-700"
          title={t('placeCard.rate')}
          aria-label={scored ?? t('placeCard.rate')}
        >
          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
          {scored ?? t('placeCard.rate')}
        </button>
      )}
      {onRoute && (
        <button
          type="button"
          title={routeActionLabel(routeMode, t)}
          aria-label={routeActionLabel(routeMode, t)}
          onClick={() => onRoute(index)}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#F56A00] px-3 py-2 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#d45500]"
        >
          <Navigation className="h-3.5 w-3.5" />
          {routeActionLabel(routeMode, t)}
        </button>
      )}
    </div>
  )
}

/** Compact action bubble shown on the selected marker (full map). */
function PlaceBubble({
  place,
  index,
  saved,
  reviewSummary,
  onFullDetails,
  onSave,
  onRate,
  onRoute,
  onShare,
}: {
  place: Place
  index: number
  saved: boolean
  reviewSummary?: ReviewSummary | null
  onFullDetails?: (place: Place) => void
  onSave?: (place: Place) => void
  onRate?: (place: Place) => void
  onRoute?: (index: number) => void
  onShare?: (place: Place) => void
}) {
  const { t, lang } = useI18n()
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:border-[#F56A00]/50 hover:text-[#F56A00] max-md:h-10 max-md:w-10'
  const scored = reviewSummary && reviewSummary.count > 0 && reviewSummary.average != null
    ? reviewLabel(reviewSummary.count, reviewSummary.average, lang)
    : null
  return (
    <div className="min-w-[170px] max-w-[240px] px-1 pb-1 pt-0.5">
      <p className="mb-2 pr-5 text-[13px] font-semibold leading-snug text-gray-900">{place.name}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {onFullDetails && (
          <button type="button" title="Full details & photos" className={btn} onClick={() => onFullDetails(place)}>
            <ImageIcon className="h-4 w-4" />
          </button>
        )}
        {onSave && (
          <button
            type="button"
            title={saved ? t('placeCard.saved') : t('placeCard.save')}
            aria-label={saved ? t('placeCard.saved') : t('placeCard.save')}
            className={`${btn} ${saved ? 'border-[#F56A00]/60 text-[#F56A00]' : ''}`}
            onClick={() => onSave(place)}
          >
            <Bookmark className={`h-4 w-4 ${saved ? 'fill-[#F56A00]' : ''}`} />
          </button>
        )}
        {onRate && (
          <button
            type="button"
            title={t('placeCard.rate')}
            aria-label={scored ?? t('placeCard.rate')}
            className={`${btn} ${scored ? 'w-auto gap-1 px-2 text-[11px] font-medium text-amber-700' : ''}`}
            onClick={() => onRate(place)}
          >
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
            {scored ? <span>{scored.replace('★ ', '')}</span> : null}
          </button>
        )}
        {onRoute && (
          <button
            type="button"
            title={routeActionLabel('WALK', t)}
            aria-label={routeActionLabel('WALK', t)}
            className={btn}
            onClick={() => onRoute(index)}
          >
            <Navigation className="h-4 w-4" />
          </button>
        )}
        {onShare && (
          <button type="button" title="Share with connections" className={btn} onClick={() => onShare(place)}>
            <Share2 className="h-4 w-4" />
          </button>
        )}
        {place.website && (
          <a href={place.website} target="_blank" rel="noopener noreferrer" title="Website" className={btn}>
            <Globe className="h-4 w-4" />
          </a>
        )}
        {place.maps_url && (
          <a href={place.maps_url} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" className={btn}>
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Draws AI highlight circles with native google.maps.Circle overlays. Each
 * highlight gets a soft outer "glow" ring plus a crisp inner ring, and the pair
 * gently pulses (unless reduced motion) so the highlighted area reads clearly.
 */
function MapCircles({ circles }: { circles: MapAnnotations['circles'] }) {
  const map = useMap()
  const ref = useRef<google.maps.Circle[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    ref.current.forEach((c) => c.setMap(null))
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)

    const valid = circles.filter((c) => isValidCoord(c.center) && c.radiusM > 0)
    const created: google.maps.Circle[] = []
    for (const c of valid) {
      // Soft outer glow.
      created.push(
        new google.maps.Circle({
          map,
          center: c.center,
          radius: c.radiusM,
          strokeColor: c.color,
          strokeOpacity: 0.35,
          strokeWeight: 9,
          fillColor: c.color,
          fillOpacity: 0.08,
          clickable: false,
          zIndex: 1,
        }),
      )
      // Crisp inner ring.
      created.push(
        new google.maps.Circle({
          map,
          center: c.center,
          radius: c.radiusM,
          strokeColor: c.color,
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: c.color,
          fillOpacity: 0.06,
          clickable: false,
          zIndex: 2,
        }),
      )
    }
    ref.current = created

    if (!prefersReducedMotion() && created.length > 0) {
      const start = performance.now()
      const tick = (now: number) => {
        const t = (now - start) / 1000
        const wave = (Math.sin(t * 1.6) + 1) / 2 // 0..1
        for (let i = 0; i < created.length; i += 2) {
          created[i]?.setOptions({ strokeOpacity: 0.2 + wave * 0.3, strokeWeight: 7 + wave * 6 })
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      ref.current.forEach((c) => c.setMap(null))
      ref.current = []
    }
  }, [map, circles])

  return null
}

/**
 * Photorealistic "Realistic" 3D view via Google Map3DElement (full map only).
 * Renders the same place markers and flies the camera to the selected one.
 * Coverage is strongest in US cities (11 of the 16 World Cup hosts); elsewhere
 * it falls back to a plain 3D globe.
 */
const NAMED_COLORS: Record<string, string> = {
  red: '#E5484D', green: '#1FA463', blue: '#3B82F6', yellow: '#F5C518',
  orange: '#F56A00', purple: '#8B5CF6', pink: '#EC4899', white: '#FFFFFF',
}
function toHexColor(c?: string): string {
  if (!c) return ROUTE_ORANGE
  if (c.startsWith('#')) return c
  return NAMED_COLORS[c.toLowerCase()] ?? ROUTE_ORANGE
}
/** Translucent fill (hex8) for a circle on the 3D map. */
function fillColorFor(c?: string): string {
  const h = toHexColor(c)
  return h.length >= 7 ? `${h.slice(0, 7)}33` : h // ~20% alpha
}
/** A ring of ~72 lat/lng points approximating a circle (maps3d has no Circle). */
function circleRing(center: LatLng, radiusM: number, n = 72): google.maps.LatLngLiteral[] {
  const pts: google.maps.LatLngLiteral[] = []
  const lat0 = (center.lat * Math.PI) / 180
  for (let i = 0; i <= n; i++) {
    const ang = (i / n) * 2 * Math.PI
    const dLat = (radiusM * Math.cos(ang)) / 111320
    const dLng = (radiusM * Math.sin(ang)) / (111320 * Math.cos(lat0))
    pts.push({ lat: center.lat + dLat, lng: center.lng + dLng })
  }
  return pts
}

function realisticTilesMissing(startedAt: number): boolean {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const keyhole = entries.filter((entry) => entry.name.includes('keyhole-pa.googleapis.com'))
  if (keyhole.some((entry) => entry.responseStatus === 200)) return false
  const recentFails = keyhole.filter((entry) => entry.startTime >= startedAt - 50 && (entry.responseStatus === 0 || entry.responseStatus >= 400))
  return recentFails.length >= 2
}

/** Photorealistic tiles stay black when GetViewportInfo or keyhole tiles fail, or when the area has no 3D coverage. */
function RealisticTileWatch({ onUnavailable }: { onUnavailable: () => void }) {
  const map3d = useMap3D()
  const fired = useRef(false)
  useEffect(() => {
    if (!map3d || fired.current) return
    const started = performance.now()
    const fail = () => {
      if (fired.current) return
      fired.current = true
      onUnavailable()
    }
    const onError = () => fail()
    map3d.addEventListener('gmp-error', onError)
    map3d.addEventListener('error', onError)
    const timer = window.setTimeout(() => {
      if (realisticTilesMissing(started)) fail()
    }, 8000)
    return () => {
      window.clearTimeout(timer)
      map3d.removeEventListener('gmp-error', onError)
      map3d.removeEventListener('error', onError)
    }
  }, [map3d, onUnavailable])
  return null
}

function UserLocation3D({ location }: { location: LatLng }) {
  const maps3d = useMapsLibrary('maps3d')
  const map3d = useMap3D()
  useEffect(() => {
    if (!maps3d || !map3d || !isValidCoord(location)) return
    const lib = maps3d as unknown as {
      Polygon3DElement: new (o: google.maps.maps3d.Polygon3DElementOptions) => HTMLElement & {
        path?: google.maps.LatLngLiteral[]
      }
      AltitudeMode: typeof google.maps.maps3d.AltitudeMode
    }
    const accuracy = Math.min(250, Math.max(28, location.accuracy && location.accuracy > 0 ? location.accuracy : 48))
    const halo = new lib.Polygon3DElement({
      path: circleRing(location, accuracy),
      fillColor: '#4285F466',
      strokeColor: '#4285F4',
      strokeWidth: 4,
      altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
      drawsOccludedSegments: true,
    })
    const dot = new lib.Polygon3DElement({
      path: circleRing(location, 16),
      fillColor: '#4285F4',
      strokeColor: '#ffffff',
      strokeWidth: 3,
      altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
      drawsOccludedSegments: true,
    })
    map3d.append(halo)
    map3d.append(dot)
    const reduce = prefersReducedMotion()
    let frame = 0
    const pulse = reduce ? 0 : window.setInterval(() => {
      frame += 1
      const scale = 1 + 0.22 * (0.5 + 0.5 * Math.sin(frame / 2))
      try { dot.path = circleRing(location, 16 * scale) } catch { /* static dot */ }
    }, 180)
    return () => {
      if (pulse) window.clearInterval(pulse)
      try { halo.remove() } catch { /* gone */ }
      try { dot.remove() } catch { /* gone */ }
    }
  }, [maps3d, map3d, location.lat, location.lng, location.accuracy])
  return null
}

function Map3DView({
  markers,
  activeStopIndex,
  onMarkerClick,
  annotations,
  aiBusy = false,
  routePath = null,
  routeMode = 'WALK',
  holdCamera = false,
  userLocation = null,
  showUserLocation = true,
  onTilesUnavailable,
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  annotations?: MapAnnotations
  aiBusy?: boolean
  routePath?: google.maps.LatLngLiteral[] | null
  routeMode?: TravelMode
  holdCamera?: boolean
  userLocation?: LatLng | null
  showUserLocation?: boolean
  onTilesUnavailable?: () => void
}) {
  const first = markers.find((m) => isValidCoord(m.coordinates))?.coordinates
  const center: google.maps.LatLngAltitudeLiteral = first
    ? { lat: first.lat, lng: first.lng, altitude: 0 }
    : { lat: 40.8135, lng: -74.0745, altitude: 0 } // MetLife Stadium — US default

  return (
    <Map3D
      className="h-full w-full"
      defaultCenter={center}
      defaultRange={2800}
      defaultTilt={48}
      mode={MapMode.SATELLITE}
    >
      {markers.map((p, i) =>
        isValidCoord(p.coordinates) ? (
          <Marker3D
            key={`m3d-${p.place_id || p.name}-${i}`}
            position={{ lat: p.coordinates.lat, lng: p.coordinates.lng, altitude: 45 }}
            altitudeMode={AltitudeMode.RELATIVE_TO_GROUND}
            extruded
            label={String(i + 1)}
            onClick={() => onMarkerClick(i)}
          />
        ) : null,
      )}
      {/* AI-placed highlight markers (★) that aren't in the result list. */}
      {(annotations?.markers ?? []).filter((m) => isValidCoord(m.coordinates)).map((m) => (
        <Marker3D
          key={`anno3d-${m.id}`}
          position={{ lat: m.coordinates.lat, lng: m.coordinates.lng, altitude: 50 }}
          altitudeMode={AltitudeMode.RELATIVE_TO_GROUND}
          extruded
          label="★"
        />
      ))}
      {/* AI-drawn circles — rendered as ground polygons so they show in 3D too. */}
      <Circles3D circles={annotations?.circles ?? []} />
      {showUserLocation && userLocation && isValidCoord(userLocation) && <UserLocation3D location={userLocation} />}
      {onTilesUnavailable && <RealisticTileWatch onUnavailable={onTilesUnavailable} />}
      {routePath && routePath.length >= 2 && <RouteLine3D path={routePath} mode={routeMode} />}
      <Fly3DToActive markers={markers} activeStopIndex={activeStopIndex} enabled={!aiBusy && !holdCamera && !(routePath && routePath.length >= 2)} />
    </Map3D>
  )
}

/**
 * Floating photo + details card for the photorealistic ("Realistic") map. The
 * Map3DElement can't host an InfoWindow like the vector map's PlaceBubble, so a
 * clicked marker had no detail box in 3D. This overlay restores parity: it
 * shows the selected place's photos, name, rating and the same quick actions.
 */
function RealisticPlaceCard({
  place,
  index,
  saved,
  reviewSummary,
  routeMode = 'WALK',
  onClose,
  onFullDetails,
  onSave,
  onRate,
  onRoute,
  onShare,
}: {
  place: PlaceDetail
  index: number
  saved: boolean
  reviewSummary?: ReviewSummary | null
  routeMode?: TravelMode
  onClose: () => void
  onFullDetails?: (place: Place) => void
  onSave?: (place: Place) => void
  onRate?: (place: Place) => void
  onRoute?: (index: number) => void
  onShare?: (place: Place) => void
}) {
  const { t, lang } = useI18n()
  const scored = reviewSummary && reviewSummary.count > 0 && reviewSummary.average != null
    ? reviewLabel(reviewSummary.count, reviewSummary.average, lang)
    : null
  const photos = place.photos && place.photos.length > 0
    ? place.photos
    : place.photo_url
      ? [place.photo_url]
      : []
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:border-[#F56A00]/50 hover:text-[#F56A00] max-md:h-10 max-md:w-10 dark:border-white/15 dark:text-gray-300'

  return (
    // Mobile: bottom-44 lifts the card above the chat bottom sheet's peek.
    <div className="pointer-events-none absolute bottom-44 left-1/2 z-[58] w-[min(320px,calc(100%-2rem))] -translate-x-1/2 md:bottom-24">
      <div className="pointer-events-auto rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 max-md:h-9 max-md:w-9"
        >
          <span aria-hidden className="text-[13px] leading-none">×</span>
        </button>
        {photos.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto">
            {photos.map((photo, i) => (
              <PlaceImage
                key={`${photo}-${i}`}
                place={{ ...place, photos: [photo], photo_url: undefined }}
                className="h-20 w-28 shrink-0 rounded-lg object-cover"
                width={224}
                height={160}
              />
            ))}
          </div>
        )}
        <p className="pr-6 text-[13px] font-semibold leading-snug text-gray-900 dark:text-white">{place.name}</p>
        <PlaceBadges place={place} className="mt-1" />
        {place.address && (
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{place.address}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {place.rating != null && (
            <span className="flex items-center gap-0.5 text-[11px] text-amber-600">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              {place.rating}
            </span>
          )}
          {(place.price ?? place.price_level) && (
            <span className="text-[11px] text-gray-400">{place.price ?? place.price_level}</span>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {onFullDetails && (
            <button type="button" title="Full details & photos" className={btn} onClick={() => onFullDetails(place)}>
              <ImageIcon className="h-4 w-4" />
            </button>
          )}
          {onSave && (
            <button
              type="button"
              title={saved ? t('placeCard.saved') : t('placeCard.save')}
              aria-label={saved ? t('placeCard.saved') : t('placeCard.save')}
              aria-pressed={saved}
              className={`${btn} ${saved ? 'border-[#F56A00]/60 text-[#F56A00]' : ''}`}
              onClick={() => onSave(place)}
            >
              <Bookmark className={`h-4 w-4 ${saved ? 'fill-[#F56A00]' : ''}`} />
            </button>
          )}
          {onRate && (
            <button
              type="button"
              title={t('placeCard.rate')}
              aria-label={scored ?? t('placeCard.rate')}
              className={`${btn} ${scored ? 'w-auto gap-1 px-2 text-[11px] font-medium text-amber-600' : ''}`}
              onClick={() => onRate(place)}
            >
              <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
              {scored ? <span>{scored.replace('★ ', '')}</span> : null}
            </button>
          )}
          {onRoute && (
            <button
              type="button"
              title={routeActionLabel(routeMode, t)}
              aria-label={routeActionLabel(routeMode, t)}
              className={btn}
              onClick={() => onRoute(index)}
            >
              <Navigation className="h-4 w-4" />
            </button>
          )}
          {onShare && (
            <button type="button" title="Share with connections" className={btn} onClick={() => onShare(place)}>
              <Share2 className="h-4 w-4" />
            </button>
          )}
          {place.website && (
            <a href={place.website} target="_blank" rel="noopener noreferrer" title="Website" className={btn}>
              <Globe className="h-4 w-4" />
            </a>
          )}
          {place.maps_url && (
            <a href={place.maps_url} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" className={btn}>
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Draws annotation circles on the photorealistic map. maps3d has no Circle
 * primitive and vis.gl ships no Polygon3D component, so we create
 * Polygon3DElement rings imperatively and append them to the Map3DElement.
 */
function Circles3D({ circles }: { circles: MapAnnotations['circles'] }) {
  const maps3d = useMapsLibrary('maps3d')
  const map3d = useMap3D()
  const polysRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!maps3d || !map3d) return
    const lib = maps3d as unknown as {
      Polygon3DElement: new (o: google.maps.maps3d.Polygon3DElementOptions) => HTMLElement
      AltitudeMode: typeof google.maps.maps3d.AltitudeMode
    }
    polysRef.current.forEach((p) => { try { p.remove() } catch { /* gone */ } })
    polysRef.current = []
    for (const c of circles) {
      if (!isValidCoord(c.center) || !(c.radiusM > 0)) continue
      const poly = new lib.Polygon3DElement({
        path: circleRing(c.center, c.radiusM),
        fillColor: fillColorFor(c.color),
        strokeColor: toHexColor(c.color),
        strokeWidth: 6,
        altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
        drawsOccludedSegments: true,
      })
      map3d.append(poly)
      polysRef.current.push(poly)
    }
    return () => {
      polysRef.current.forEach((p) => { try { p.remove() } catch { /* gone */ } })
      polysRef.current = []
    }
  }, [maps3d, map3d, circles])

  return null
}

/** Smooth camera fly to the selected marker on the 3D map. */
function Fly3DToActive({
  markers,
  activeStopIndex,
  enabled = true,
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
  /** False while the AI is still working — don't fly mid-task (dizzying). */
  enabled?: boolean
}) {
  const map3d = useMap3D()
  useEffect(() => {
    if (!enabled || activeStopIndex == null || !map3d?.flyCameraTo) return
    const p = markers[activeStopIndex]
    if (!p || !isValidCoord(p.coordinates)) return
    map3d.flyCameraTo({
      endCamera: {
        center: { lat: p.coordinates.lat, lng: p.coordinates.lng, altitude: 0 },
        range: 2200,
        tilt: 48,
      },
      durationMillis: 2200,
    })
  }, [activeStopIndex, markers, map3d, enabled])
  return null
}

function MapCanvas({
  places,
  itinerary,
  annotations,
  activeStopIndex,
  onMarkerClick,
  userLocation,
  showUserLocation = true,
  routeFromUser = false,
  customRoute = null,
  routeMode = 'WALK',
  theme,
  onRouteInfo,
  onRouteError,
  zoomFocusOnActive = false,
  size = 'full',
  aiBusy = false,
  onPlaceFullDetails,
  onPlaceSave,
  onPlaceRoute,
  onRouteModeChange,
  onRequestLocation,
  locationPending = false,
  savedPlaceIds,
  communityPins,
  communityFriends,
  communityLayerOn = false,
  onToggleCommunityLayer,
  onOpenProfile,
  communityFocus,
  onPlaceShare,
  onMapClick,
  placeCardOpen = false,
  onPlaceCardClose,
  routeInfo = null,
}: Omit<Props, 'onExpand' | 'onCollapse' | 'selectedPlace' | 'loading' | 'error' | 'onRetry' | 'bottomSlot' | 'onAddPlace'>) {
  const { t, lang } = useI18n()
  const isMobile = useIsMobile()
  const skipMapClose = useRef(false)
  const markers = itinerary ?? places
  const placeCoords = markers
    .map((m) => m.coordinates)
    .filter(isValidCoord)
  // When there are no search results, center/fit on the AI's annotations instead
  // (e.g. "show me the stadium" → a circled venue with no place list).
  const annoCoords = [
    ...(annotations?.markers ?? []).map((m) => m.coordinates),
    ...(annotations?.circles ?? []).map((c) => c.center),
  ].filter(isValidCoord)
  // Community pins only anchor the camera when nothing else is on the map
  // (layer toggled on with no active search) — they never affect result fits.
  const communityCoords = (communityPins ?? [])
    .map((p) => ({ lat: p.lat, lng: p.lng }))
    .filter(isValidCoord)
  const markerCoords =
    placeCoords.length > 0 ? placeCoords : annoCoords.length > 0 ? annoCoords : communityCoords
  const firstPlace = markerCoords[0]
  const defaultCenter = firstPlace ?? KIGALI_DEFAULT
  const initialZoom = markerCoords.length > 0 ? 15 : DEFAULT_ZOOM
  const focusIndex = activeStopIndex ?? (markers.length > 0 ? 0 : null)
  const focusPos =
    focusIndex !== null && markers[focusIndex]
      ? markers[focusIndex].coordinates
      : null
  const isCompact = size === 'compact'
  const usePreciseFit = !zoomFocusOnActive && markerCoords.length > 0
  const useFocus =
    !!focusPos &&
    isValidCoord(focusPos) &&
    (zoomFocusOnActive || (isCompact && markerCoords.length === 1))
  const focusZoom = isCompact ? 17 : 16

  const routeDestIndex = customRoute?.destinationIndex ?? activeStopIndex
  const routeDestination =
    routeDestIndex !== null && markers[routeDestIndex]
      ? markers[routeDestIndex]
      : null

  // 3D vector perspective by default in full mode; compact stays flat.
  const [mapMode, setMapMode] = useState<MapDisplayMode>('3d')
  const [realisticNotice, setRealisticNotice] = useState(false)
  const [modeNotice, setModeNotice] = useState(false)
  const is3D = !isCompact && mapMode === '3d'
  const realistic = !isCompact && mapMode === 'realistic'
  const handleRealisticDown = useCallback(() => {
    setMapMode('satellite')
    setRealisticNotice(true)
  }, [])
  useEffect(() => {
    if (!realisticNotice) return
    const timer = window.setTimeout(() => setRealisticNotice(false), 7000)
    return () => window.clearTimeout(timer)
  }, [realisticNotice])
  const [routeDraw, setRouteDraw] = useState<DrawnPath | null>(null)
  useEffect(() => {
    if (!modeNotice) return
    const timer = window.setTimeout(() => setModeNotice(false), 5000)
    return () => window.clearTimeout(timer)
  }, [modeNotice])
  const [routeHint, setRouteHint] = useState(false)
  const [routeDetailOpen, setRouteDetailOpen] = useState(false)
  const [routeSteps, setRouteSteps] = useState<RouteStep[] | null>(null)
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null)
  const [ratePlace, setRatePlace] = useState<Place | null>(null)
  const activePlaceId = activeStopIndex !== null && markers[activeStopIndex] ? markers[activeStopIndex].place_id : ''
  useEffect(() => {
    setRatePlace(null)
    if (!activePlaceId) {
      setReviewSummary(null)
      return
    }
    let cancelled = false
    void fetch(`/api/reviews?placeId=${encodeURIComponent(activePlaceId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ReviewSummary | null) => { if (!cancelled && data) setReviewSummary(data) })
      .catch(() => { if (!cancelled) setReviewSummary(null) })
    return () => { cancelled = true }
  }, [activePlaceId])
  useEffect(() => {
    if (!ratePlace) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setRatePlace(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ratePlace])
  useEffect(() => {
    setRouteDetailOpen(false)
    setRouteSteps(null)
  }, [routeDraw?.destinationName, routeDraw?.distance, routeDraw?.path.length])

  const routeJob: RouteJob | null = (() => {
    if (
      routeFromUser &&
      userLocation &&
      isValidCoord(userLocation) &&
      routeDestination &&
      isValidCoord(routeDestination.coordinates)
    ) {
      return {
        kind: 'points' as const,
        origin: userLocation,
        destination: routeDestination.coordinates,
        mode: routeMode,
        destinationName: routeDestination.name,
        originLabel: 'you',
      }
    }
    if (customRoute?.from === 'landmark' && customRoute.landmark && routeDestination && isValidCoord(routeDestination.coordinates)) {
      const label = customRoute.landmark.split(',')[0]
      if (customRoute.originPoint && isValidCoord(customRoute.originPoint)) {
        return {
          kind: 'points' as const,
          origin: customRoute.originPoint,
          destination: routeDestination.coordinates,
          mode: customRoute.mode,
          destinationName: routeDestination.name,
          originLabel: label,
        }
      }
      return {
        kind: 'place' as const,
        query: customRoute.landmark,
        destination: routeDestination.coordinates,
        mode: customRoute.mode,
        destinationName: routeDestination.name,
        originLabel: label,
      }
    }
    if (itinerary && itinerary.length >= 2 && !routeFromUser && !customRoute) {
      return {
        kind: 'stops' as const,
        mode: routeMode,
        stops: itinerary.map((s) => ({
          coordinates: s.coordinates,
          name: s.name,
          encoded: s.travel_from_prev?.encoded_polyline,
          distance: s.travel_from_prev?.distance,
          duration: s.travel_from_prev?.duration,
        })),
      }
    }
    return null
  })()

  const routePlaceIndex =
    activeStopIndex !== null && markers[activeStopIndex] && isValidCoord(markers[activeStopIndex].coordinates)
      ? activeStopIndex
      : null

  // Marker action bubble (full map): a small popup on the selected marker with
  // quick actions, instead of slamming the full details panel open every click.
  const [bubbleOpen, setBubbleOpen] = useState(true)
  useEffect(() => { setBubbleOpen(true) }, [activeStopIndex])

  // Community layer: selected shared pin (its own info bubble, independent of
  // the result-marker bubble so the two never fight).
  const [selectedCommunityPinId, setSelectedCommunityPinId] = useState<string | null>(null)
  const selectedCommunityPin =
    selectedCommunityPinId != null
      ? (communityPins ?? []).find((p) => p.pin_id === selectedCommunityPinId) ?? null
      : null
  const activePlace = activeStopIndex !== null ? markers[activeStopIndex] : null
  const showBubble =
    !isMobile &&
    !isCompact &&
    placeCardOpen &&
    bubbleOpen &&
    activeStopIndex !== null &&
    !!activePlace &&
    isValidCoord(activePlace.coordinates)
  // Only an explicit active selection triggers the cinematic glide — never
  // the initial fallback focus, so PreciseMapFit owns the first framing.
  const activePos =
    activeStopIndex !== null &&
    markers[activeStopIndex] &&
    isValidCoord(markers[activeStopIndex].coordinates)
      ? markers[activeStopIndex].coordinates
      : null
  const cameraResetKey = markerCoords
    .map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`)
    .join(';')

  const handleRouteError = (message: string | null) => {
    if (message === 'mode-unsupported') {
      setModeNotice(true)
      const previous = routeDraw?.mode ?? 'WALK'
      if (previous !== routeMode) onRouteModeChange?.(previous)
      return
    }
    onRouteError?.(message)
  }

  return (
    <APIProvider
      apiKey={API_KEY}
      libraries={['geometry', 'places', 'routes']}
      version="beta"
      onError={(err) => console.error('[map] Google Maps API failed to load', err)}
    >
      <RouteComputer job={routeJob} onDrawn={setRouteDraw} onRouteInfo={onRouteInfo} onRouteError={handleRouteError} />
      {realistic ? (
        <>
          <Map3DView
            markers={markers}
            activeStopIndex={activeStopIndex}
            onMarkerClick={onMarkerClick}
            annotations={annotations}
            aiBusy={aiBusy}
            routePath={routeDraw?.path ?? null}
            routeMode={routeDraw?.mode ?? routeMode}
            holdCamera={routeFromUser || !!routeDraw}
            userLocation={userLocation}
            showUserLocation={showUserLocation}
            onTilesUnavailable={handleRealisticDown}
          />
          {showBubble && activePlace && (
            <RealisticPlaceCard
              place={activePlace as PlaceDetail}
              index={activeStopIndex as number}
              saved={!!savedPlaceIds?.has((activePlace as Place).place_id)}
              reviewSummary={reviewSummary}
              routeMode={routeMode}
              onClose={() => setBubbleOpen(false)}
              onFullDetails={onPlaceFullDetails}
              onSave={onPlaceSave}
              onRate={setRatePlace}
              onRoute={onPlaceRoute}
              onShare={onPlaceShare}
            />
          )}
        </>
      ) : (
      <Map
        defaultCenter={defaultCenter}
        defaultZoom={markerCoords.length > 0 ? (isCompact ? 17 : initialZoom) : DEFAULT_ZOOM}
        defaultTilt={isCompact ? 0 : VECTOR_3D_TILT}
        defaultHeading={isCompact ? 0 : DEFAULT_3D_HEADING}
        renderingType="VECTOR"
        mapId={MAP_ID}
        colorScheme={theme === 'dark' ? 'DARK' : 'LIGHT'}
        className="h-full w-full"
        style={{ width: '100%', height: '100%', display: 'block' }}
        gestureHandling="auto"
        scrollwheel
        disableDefaultUI
        zoomControl={false}
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        clickableIcons={false}
        onClick={(event) => {
          if (skipMapClose.current) {
            skipMapClose.current = false
            return
          }
          onPlaceCardClose?.()
          const latLng = event.detail.latLng
          if (!onMapClick || !latLng) return
          onMapClick({ lat: latLng.lat, lng: latLng.lng })
        }}
      >
        <MapUiOptions fullControls={size === 'full'} />
        <MapModeController mode={mapMode} size={size} routeHold={!!routeDraw} />
        {markerCoords.length > 0 && !routeDraw && <PlacesMapCenter places={markerCoords} />}
        {usePreciseFit && !useFocus && !routeDraw && (
          <PreciseMapFit
            markers={markerCoords}
            userLocation={userLocation}
            includeUser={showUserLocation}
            focus={focusPos ?? null}
            size={size}
          />
        )}
        <MapZoomFocus position={focusPos ?? null} enabled={useFocus && !routeDraw} targetZoom={focusZoom} />
        <CinematicCamera
          focus={activePos}
          enabled={is3D && markerCoords.length > 0 && !aiBusy && !routeDraw}
          glideCenter={!useFocus}
          resetKey={cameraResetKey}
        />

        <MapMarkers
          markers={markers}
          activeStopIndex={activeStopIndex}
          onMarkerClick={(index) => {
            skipMapClose.current = true
            setBubbleOpen(true)
            onMarkerClick(index)
          }}
          showUserLocation={showUserLocation}
          userLocation={userLocation}
          colors={annotations?.colors}
        />

        {annotations && annotations.markers.length > 0 && (
          <AnnotationMarkers markers={annotations.markers} placeCoords={markerCoords} />
        )}
        {annotations && annotations.circles.length > 0 && <MapCircles circles={annotations.circles} />}

        {/* Community layer: shared pins + connections' live positions. */}
        {communityPins && communityPins.length > 0 && (
          <CommunityPinMarkers
            pins={communityPins}
            placeCoords={placeCoords}
            onSelect={setSelectedCommunityPinId}
          />
        )}
        {selectedCommunityPin && (
          <InfoWindow
            position={{ lat: selectedCommunityPin.lat, lng: selectedCommunityPin.lng }}
            pixelOffset={[0, -36]}
            headerDisabled
            onCloseClick={() => setSelectedCommunityPinId(null)}
          >
            <CommunityPinBubble pin={selectedCommunityPin} onOpenProfile={onOpenProfile} />
          </InfoWindow>
        )}
        {communityFriends && communityFriends.length > 0 && (
          <CommunityFriendMarkers friends={communityFriends} onOpenProfile={onOpenProfile} />
        )}
        {communityFocus && isValidCoord(communityFocus) && (
          <MapZoomFocus position={communityFocus} enabled targetZoom={16} />
        )}

        {showBubble && activePlace && (
          <InfoWindow
            position={activePlace.coordinates}
            pixelOffset={[0, -46]}
            headerDisabled
            onCloseClick={() => { setBubbleOpen(false); onPlaceCardClose?.() }}
          >
            <PlaceInfoCard
              place={activePlace as Place}
              index={activeStopIndex as number}
              saved={!!savedPlaceIds?.has((activePlace as Place).place_id)}
              reviewSummary={reviewSummary}
              routeMode={routeMode}
              onClose={() => { setBubbleOpen(false); onPlaceCardClose?.() }}
              onSave={onPlaceSave}
              onRate={setRatePlace}
              onRoute={onPlaceRoute}
            />
          </InfoWindow>
        )}

        {routeDraw && routeDraw.path.length >= 2 && <VectorRouteLine path={routeDraw.path} mode={routeDraw.mode} />}
      </Map>
      )}
      {size === 'full' && (
        <MapModeControl
          mode={mapMode}
          onChange={(next) => {
            if (next === 'realistic') setRealisticNotice(false)
            setMapMode(next)
          }}
        />
      )}
      {realisticNotice && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-[60] -translate-x-1/2 rounded-full bg-black/75 px-3 py-1.5 text-[12px] font-medium text-white shadow-md">
          {t('map.realisticFallback')}
        </div>
      )}
      {showUserLocation && !userLocation && onRequestLocation && (
        <button
          type="button"
          onClick={onRequestLocation}
          disabled={locationPending}
          className="absolute bottom-28 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[#4285F4]/40 bg-white/95 px-3.5 py-2 text-[13px] font-medium text-[#1A56C4] shadow-md disabled:opacity-70 dark:bg-[#15151a]/95 dark:text-[#8ab4f8]"
        >
          {locationPending ? t('map.locating') : t('map.enableLocation')}
        </button>
      )}
      {routeDraw && routeDraw.path.length >= 2 && (
        <div className={`absolute left-1/2 z-[58] flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 flex-col items-center ${realisticNotice ? 'top-28' : 'top-16'}`}>
          <div className="flex items-center gap-1">
            <div
              role="group"
              aria-label={t('map.travelMode')}
              className="flex items-center gap-0.5 rounded-full border border-gray-200 bg-white/95 p-0.5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95"
            >
              {TRAVEL_MODES.map((opt) => {
                const active = routeMode === opt.id
                const Icon = opt.icon
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    title={t(opt.labelKey)}
                    aria-label={t(opt.labelKey)}
                    onClick={() => onRouteModeChange?.(opt.id)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      active ? 'bg-[#F56A00] text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          <button
            type="button"
            aria-expanded={routeDetailOpen}
            onClick={() => {
              const next = !routeDetailOpen
              setRouteDetailOpen(next)
              if (!next || routeSteps || !routeDraw.origin || !routeDraw.destination) return
              const origin = routeDraw.origin
              const destination = routeDraw.destination
              const mode = routeDraw.mode ?? routeMode
              void fetch('/api/directions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origin, destination, travelMode: routesTravelMode(mode) }),
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((data: { steps?: RouteStep[] } | null) => {
                  setRouteSteps(Array.isArray(data?.steps) ? data.steps : [])
                })
                .catch(() => setRouteSteps([]))
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/95 px-3.5 py-1.5 text-[13px] font-medium text-gray-900 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95 dark:text-gray-100"
          >
            {routeMode === 'DRIVE' ? <Car className="h-3.5 w-3.5" aria-hidden /> : routeMode === 'BICYCLE' ? <Bike className="h-3.5 w-3.5" aria-hidden /> : <Footprints className="h-3.5 w-3.5" aria-hidden />}
            {routeChipText({
              ...routeDraw,
              distance: routeInfo?.distance || routeDraw.distance,
              duration: routeInfo?.duration || routeDraw.duration,
            }, lang)}
          </button>
          </div>
          {modeNotice && (
            <p className="mt-1 rounded-full bg-black/70 px-3 py-1 text-[12px] text-white">{t('map.modeUnavailable')}</p>
          )}
          {routeDetailOpen && (
            <div className="mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white/95 p-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95">
              <p className="text-[12px] font-medium text-gray-900 dark:text-gray-100">{t('map.routeDetail')}</p>
              {(routeDraw.steps?.length ? routeDraw.steps : routeSteps)?.length ? (
                <ol className="mt-2 flex flex-col gap-1.5">
                  {(routeDraw.steps?.length ? routeDraw.steps : routeSteps)!.map((step, index) => (
                    <li key={`${step.instruction}-${index}`} className="text-[12px] leading-snug text-gray-700 dark:text-gray-200">
                      <span className="text-gray-400">{index + 1}. </span>
                      {step.instruction}
                      <span className="text-gray-500"> · {lang === 'fr' ? step.distance.replace(/\./g, ',') : step.distance} · {step.duration}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">{t('map.routeNoStreets')}</p>
              )}
              {(activePlace as Place | null)?.accessible && (
                <p className="mt-2 inline-flex rounded-full bg-[#0F6E56]/15 px-2 py-0.5 text-[11px] font-medium text-[#0F6E56] dark:text-[#3DDC97]">
                  {t('map.arrivalAccessible')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {onPlaceRoute && (
        <div className={`pointer-events-none absolute z-[58] flex flex-col items-end gap-2 ${isCompact ? 'bottom-36 right-3' : 'bottom-40 right-4 max-md:bottom-44'}`}>
          {routeHint && (
            <div className="pointer-events-none max-w-[14rem] rounded-xl border border-gray-200 bg-white/95 px-3 py-1.5 text-[12px] text-gray-800 shadow-md dark:border-white/10 dark:bg-[#15151a]/95 dark:text-gray-100">
              {t('map.routeNeedPlace')}
            </div>
          )}
          <button
            type="button"
            aria-label={routePlaceIndex == null ? t('map.routeNeedPlace') : t('map.route')}
            title={routePlaceIndex == null ? t('map.routeNeedPlace') : t('map.route')}
            aria-disabled={routePlaceIndex == null}
            onClick={() => {
              if (routePlaceIndex == null) {
                setRouteHint(true)
                window.setTimeout(() => setRouteHint(false), 2500)
                return
              }
              onPlaceRoute(routePlaceIndex)
            }}
            className={`pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border shadow-md backdrop-blur transition-colors motion-reduce:transition-none ${
              routePlaceIndex == null
                ? 'border-gray-200 bg-white/80 text-gray-400 dark:border-white/10 dark:bg-[#15151a]/80 dark:text-gray-500'
                : 'border-gray-200 bg-white/95 text-[#1A73E8] hover:bg-gray-100 dark:border-white/10 dark:bg-[#15151a]/95 dark:text-[#8ab4f8] dark:hover:bg-white/10'
            }`}
          >
            <Navigation className="h-4 w-4" />
          </button>
        </div>
      )}
      {size === 'full' && !realistic && mapMode !== 'satellite' && <MapRotateControls />}
      {!realistic && <MapZoomControls compact={isCompact} />}
      {onToggleCommunityLayer && (
        <CommunityLayerToggle on={communityLayerOn} onToggle={onToggleCommunityLayer} compact={isCompact} />
      )}
      {ratePlace && (
        <div className="absolute bottom-28 left-1/2 z-[70] -translate-x-1/2">
          <PlaceRatePopover
            placeId={ratePlace.place_id}
            initial={reviewSummary}
            onSaved={setReviewSummary}
            onClose={() => setRatePlace(null)}
          />
        </div>
      )}
    </APIProvider>
  )
}

export function MapView({
  size = 'full',
  onExpand,
  onCollapse,
  selectedPlace,
  loading = false,
  error = null,
  onRetry,
  bottomSlot,
  hideInlinePlaceCard = false,
  onDirections,
  routeInfo = null,
  header,
  onAddPlace,
  ...canvasProps
}: Props) {
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const { places, itinerary } = canvasProps
  const hasData =
    (itinerary?.length ?? 0) > 0 ||
    places.length > 0 ||
    (canvasProps.annotations?.markers?.length ?? 0) > 0 ||
    (canvasProps.annotations?.circles?.length ?? 0) > 0 ||
    (canvasProps.communityPins?.length ?? 0) > 0 ||
    (canvasProps.communityFriends?.length ?? 0) > 0
  const fallbackPlace = selectedPlace ?? places[0] ?? itinerary?.[0] ?? null
  const compactPx = 220
  const mapHeight = size === 'compact' ? 'h-full min-h-[220px]' : 'h-full'
  const mapMinHeight = size === 'compact' ? compactPx : 200

  if (loading) {
    return (
      <div className={`flex ${mapHeight} w-full flex-col gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[#15151a]`}>
        <div className="min-h-[140px] flex-1 animate-pulse rounded-xl bg-black/[0.06] motion-reduce:animate-none dark:bg-white/10" />
        <div className="h-14 animate-pulse rounded-xl bg-black/[0.06] motion-reduce:animate-none dark:bg-white/10" />
        <div className="h-14 w-4/5 animate-pulse rounded-xl bg-black/[0.06] motion-reduce:animate-none dark:bg-white/10" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex ${mapHeight} w-full flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]`}>
        <AlertCircle className="h-6 w-6 text-red-500" />
        <p className="text-[13px] font-medium tracking-tight text-gray-900 dark:text-gray-100">Map unavailable</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-[#F56A00] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] motion-reduce:transition-none"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  if (!hasData) {
    return (
      <MapPlaceholder
        empty
        className={mapHeight}
      />
    )
  }

  if (!API_KEY) {
    return (
      <MapPlaceholder
        place={fallbackPlace as Place | null}
        userLocation={canvasProps.userLocation}
        routeInfo={routeInfo}
        onDirections={onDirections}
        className={mapHeight}
      />
    )
  }

  return (
    <div
      className={size === 'full' ? 'fixed inset-0 z-50 flex flex-col bg-bg' : 'relative h-full w-full'}
      style={size === 'compact' ? { width: '100%', height: '100%', minHeight: compactPx, display: 'block' } : undefined}
    >
      {size === 'full' && header}
      <div
        className={`relative ${size === 'full' ? 'min-h-0 flex-1' : mapHeight} w-full overflow-hidden ${size === 'compact' && !onCollapse ? 'rounded-xl' : ''}`}
        style={size === 'compact' ? { width: '100%', height: '100%', minHeight: compactPx, display: 'block' } : { minHeight: size === 'full' ? 0 : mapMinHeight }}
      >
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label={t('map.fullscreen')}
            title={t('map.fullscreen')}
            className="absolute right-16 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-md transition-colors duration-150 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-900/95 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
        {onCollapse && typeof document !== 'undefined' && createPortal(
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('map.exitFullscreen')}
            title={t('map.exitFullscreen')}
            className="fixed right-16 top-[max(0.75rem,env(safe-area-inset-top))] z-[400] flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-md transition-colors duration-150 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-900/95 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <Minimize2 className="h-4 w-4" />
          </button>,
          document.body,
        )}
        <div className="absolute inset-0">
          <MapCanvas {...canvasProps} size={size} routeInfo={routeInfo} />
        </div>
        {size === 'compact' && !isMobile && canvasProps.placeCardOpen && canvasProps.activeStopIndex != null && places[canvasProps.activeStopIndex] && (
          <div className="place-card-in absolute left-3 top-14 z-[80] w-[min(280px,calc(100%-1.5rem))] rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
            <PlaceInfoCard
              place={places[canvasProps.activeStopIndex]}
              index={canvasProps.activeStopIndex}
              saved={!!canvasProps.savedPlaceIds?.has(places[canvasProps.activeStopIndex].place_id)}
              routeMode={canvasProps.routeMode}
              onClose={() => canvasProps.onPlaceCardClose?.()}
              onSave={canvasProps.onPlaceSave}
              onRoute={canvasProps.onPlaceRoute}
            />
          </div>
        )}
        {onAddPlace && (
          <button
            type="button"
            onClick={onAddPlace}
            aria-label={t('add.open')}
            className="absolute bottom-4 right-4 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-[#F56A00] text-white shadow-[0_10px_24px_-8px_rgba(245,106,0,0.8)] transition-transform hover:scale-105 hover:bg-terracotta"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>
      {size === 'compact' && selectedPlace && !hideInlinePlaceCard && <PlaceDetailBox place={selectedPlace} />}
      {size === 'full' && bottomSlot && (
        <div className="absolute bottom-0 left-0 right-0 z-[55] overflow-x-auto border-t border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          {bottomSlot}
        </div>
      )}
    </div>
  )
}
