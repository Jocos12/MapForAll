'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Car, ChevronRight, Footprints, Layers, LocateFixed, Map as MapIcon, Minus, Mountain, Navigation, Plus, Satellite, X } from 'lucide-react'
import type { Place } from '@/lib/types'
import type { TravelMode } from '@/lib/routing'
import { PlaceImage } from './PlaceImage'
import { useI18n } from './I18nProvider'

type LatLng = { lat: number; lng: number }

export interface SheetRouteInfo {
  distance: string
  duration: string
  destinationName: string
}

interface Props {
  title: string
  places: Place[]
  activeIndex: number | null
  activePlaceId?: string | null
  userLocation: LatLng | null
  /** Draw a route from the user to this place. */
  routeTo: (LatLng & { name: string }) | null
  routeMode: TravelMode
  onRouteModeChange: (mode: TravelMode) => void
  onEndRoute: () => void
  onRouteInfo?: (info: SheetRouteInfo | null) => void
  onSelect: (index: number) => void
  onDetails: (place: Place) => void
  onRoute: (index: number) => void
  onRequestLocation?: () => void
  locationPending?: boolean
  onClose: () => void
  /** Banners (route errors, location prompts) rendered under the top bar. */
  notices?: React.ReactNode
}

// Free map styles, no key and no billing. Routing: OSRM (routing.openstreetmap.de).
type LayerId = 'plan' | 'satellite' | 'hybrid' | 'relief'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
const LAYERS: Record<LayerId, { tiles: { url: string; opts: Record<string, unknown> }[] }> = {
  plan: { tiles: [{ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '© OpenStreetMap' } }] },
  satellite: { tiles: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, opts: { maxZoom: 19, maxNativeZoom: 18, attribution: ESRI_ATTR } }] },
  hybrid: {
    tiles: [
      { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, opts: { maxZoom: 19, maxNativeZoom: 18, attribution: ESRI_ATTR } },
      { url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, opts: { maxZoom: 19, maxNativeZoom: 18, opacity: 0.9 } },
      { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, opts: { maxZoom: 19, maxNativeZoom: 18 } },
    ],
  },
  relief: { tiles: [{ url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, maxNativeZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap · OpenTopoMap' } }] },
}
const LAYER_KEY = 'mfa_map_layer'
const OSRM: Record<string, string> = {
  WALK: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  BICYCLE: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
  DRIVE: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
}

function ensureLeafletCss() {
  if (document.querySelector('link[data-leaflet]')) return
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = '/vendor/leaflet/leaflet.css'
  css.dataset.leaflet = '1'
  document.head.appendChild(css)
}

function validCoord(p?: { lat?: number; lng?: number } | null): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)
}

function haversine(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180
  const h = 0.5 - Math.cos((b.lat - a.lat) * r) / 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * (1 - Math.cos((b.lng - a.lng) * r)) / 2
  return 12742000 * Math.asin(Math.sqrt(Math.max(h, 0)))
}

function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`
}

function fmtDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} h ${rest}` : `${h} h`
}

function pinHtml(n: number, active: boolean): string {
  return active
    ? `<span class="ios-pin ios-pin-active">${n}</span>`
    : `<span class="ios-pin">${n}</span>`
}

/**
 * iOS-style full-screen map sheet (Leaflet + OpenStreetMap). Numbered pins,
 * your position, a route line to the selected place, glass controls and a
 * swipeable card row. Replaces the Google map inside the chat portal.
 */
export function MapSheet({
  title,
  places,
  activeIndex,
  activePlaceId,
  userLocation,
  routeTo,
  routeMode,
  onRouteModeChange,
  onEndRoute,
  onRouteInfo,
  onSelect,
  onDetails,
  onRoute,
  onRequestLocation,
  locationPending,
  onClose,
  notices,
}: Props) {
  const { lang } = useI18n()
  const tr = (fr: string, en: string) => (lang === 'en' ? en : fr)
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const LRef = useRef<typeof import('leaflet') | null>(null)
  const pinsLayer = useRef<import('leaflet').LayerGroup | null>(null)
  const userLayer = useRef<import('leaflet').LayerGroup | null>(null)
  const routeLayer = useRef<import('leaflet').LayerGroup | null>(null)
  const baseLayer = useRef<import('leaflet').LayerGroup | null>(null)
  const [layer, setLayer] = useState<LayerId>(() => {
    try {
      const saved = localStorage.getItem(LAYER_KEY) as LayerId | null
      return saved && saved in LAYERS ? saved : 'plan'
    } catch {
      return 'plan'
    }
  })
  const cardsRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState<{ distance: number; duration: number } | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeFailed, setRouteFailed] = useState(false)

  const pinned = useMemo(
    () => places.map((p, i) => ({ place: p, index: i })).filter(({ place }) => validCoord(place.coordinates)),
    [places],
  )
  const pinKey = pinned.map(({ place }) => `${place.place_id}:${place.coordinates.lat},${place.coordinates.lng}`).join('|')

  const isActive = (place: Place, index: number) =>
    activePlaceId ? place.place_id === activePlaceId : activeIndex === index

  // ── Create the map once ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ensureLeafletCss()
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !el.current) return
      LRef.current = L
      const map = L.map(el.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.5 })
      map.attributionControl.setPrefix(false)
      map.attributionControl.setPosition('topright')
      baseLayer.current = L.layerGroup().addTo(map)
      map.setView([-1.9441, 30.0619], 13)
      routeLayer.current = L.layerGroup().addTo(map)
      pinsLayer.current = L.layerGroup().addTo(map)
      userLayer.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setReady(true)
      window.setTimeout(() => map.invalidateSize(), 60)
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Base map style (Plan / Satellite / Hybride / Relief)
  useEffect(() => {
    const L = LRef.current
    if (!ready || !L || !baseLayer.current) return
    baseLayer.current.clearLayers()
    LAYERS[layer].tiles.forEach(({ url, opts }) => L.tileLayer(url, opts).addTo(baseLayer.current!))
    try { localStorage.setItem(LAYER_KEY, layer) } catch { /* private mode */ }
  }, [ready, layer])

  const padding = () => {
    const bottom = (cardsRef.current?.offsetHeight ?? 0) + 40
    return { paddingTopLeft: [40, 90] as [number, number], paddingBottomRight: [40, bottom] as [number, number] }
  }

  // ── Pins ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!ready || !L || !map || !pinsLayer.current) return
    pinsLayer.current.clearLayers()
    pinned.forEach(({ place, index }) => {
      const active = isActive(place, index)
      const icon = L.divIcon({
        className: 'ios-pin-wrap',
        html: pinHtml(index + 1, active),
        iconSize: active ? [40, 40] : [30, 30],
        iconAnchor: active ? [20, 20] : [15, 15],
      })
      const marker = L.marker([place.coordinates.lat, place.coordinates.lng], {
        icon,
        zIndexOffset: active ? 1000 : 0,
        title: place.name,
        keyboard: true,
      })
      marker.on('click', () => onSelect(index))
      marker.addTo(pinsLayer.current!)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey, activeIndex, activePlaceId])

  // Fit all pins when the result set changes.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!ready || !L || !map || !pinned.length) return
    const pts = pinned.map(({ place }) => [place.coordinates.lat, place.coordinates.lng] as [number, number])
    if (pts.length === 1) map.setView(pts[0], 16)
    else map.fitBounds(L.latLngBounds(pts), { ...padding(), maxZoom: 16 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey])

  // Fly to the selected place and bring its card into view.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const hit = pinned.find(({ place, index }) => isActive(place, index))
    if (!hit) return
    if (!routeTo) map.flyTo([hit.place.coordinates.lat, hit.place.coordinates.lng], Math.max(map.getZoom(), 15), { duration: 0.6 })
    const card = cardsRef.current?.querySelector<HTMLElement>(`[data-card="${hit.index}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeIndex, activePlaceId])

  // ── You are here ─────────────────────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current
    if (!ready || !L || !userLayer.current) return
    userLayer.current.clearLayers()
    if (!validCoord(userLocation)) return
    L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({ className: 'ios-pin-wrap', html: '<span class="ios-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(userLayer.current)
  }, [ready, userLocation])

  // ── Route (OSRM) ─────────────────────────────────────────────────────────
  const routeKey = routeTo && validCoord(userLocation)
    ? `${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}>${routeTo.lat.toFixed(5)},${routeTo.lng.toFixed(5)}:${routeMode}`
    : ''
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!ready || !L || !map || !routeLayer.current) return
    routeLayer.current.clearLayers()
    setRoute(null)
    setRouteFailed(false)
    if (!routeKey || !routeTo || !validCoord(userLocation)) {
      onRouteInfo?.(null)
      return
    }
    const ctrl = new AbortController()
    const base = OSRM[routeMode] ?? OSRM.WALK
    const url = `${base}/${userLocation.lng},${userLocation.lat};${routeTo.lng},${routeTo.lat}?overview=full&geometries=geojson`
    setRouteLoading(true)
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        const best = data?.routes?.[0]
        const coords: [number, number][] = (best?.geometry?.coordinates ?? []).map((c: [number, number]) => [c[1], c[0]])
        if (!best || coords.length < 2) throw new Error('no route')
        L.polyline(coords, { color: '#FFFFFF', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current!)
        L.polyline(coords, { color: '#FF6A00', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current!)
        map.fitBounds(L.latLngBounds(coords), { ...padding(), maxZoom: 17 })
        setRoute({ distance: best.distance, duration: best.duration })
        onRouteInfo?.({ distance: fmtDistance(best.distance), duration: fmtDuration(best.duration), destinationName: routeTo.name })
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        // Fallback: straight dashed line so the user still sees direction.
        const line: [number, number][] = [[userLocation.lat, userLocation.lng], [routeTo.lat, routeTo.lng]]
        L.polyline(line, { color: '#FF6A00', weight: 4, dashArray: '2 10', lineCap: 'round' }).addTo(routeLayer.current!)
        map.fitBounds(L.latLngBounds(line), { ...padding(), maxZoom: 16 })
        setRouteFailed(true)
        const d = haversine(userLocation, routeTo)
        onRouteInfo?.({ distance: fmtDistance(d), duration: '', destinationName: routeTo.name })
      })
      .finally(() => setRouteLoading(false))
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeKey])

  const zoom = (delta: number) => mapRef.current?.setZoom((mapRef.current?.getZoom() ?? 13) + delta)
  const locate = () => {
    if (validCoord(userLocation)) mapRef.current?.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 0.6 })
    else onRequestLocation?.()
  }

  const distanceTo = (place: Place) =>
    place.distance || (validCoord(userLocation) && validCoord(place.coordinates) ? fmtDistance(haversine(userLocation, place.coordinates)) : '')

  return (
    <div className="ios-sheetmap absolute inset-0">
      {/* Leaflet owns the classes of the inner element: keep its className static,
          or React wipes "leaflet-container" and the tiles collapse to 0 px. */}
      <div className={`${layer === 'plan' ? 'ios-minimap ' : ''}absolute inset-0 z-0`}>
        <div ref={el} className="absolute inset-0 bg-[var(--ios-fill)]" />
      </div>

      {/* Map style switcher */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+64px)] z-[600] flex justify-center px-3 sm:top-[calc(env(safe-area-inset-top,0px)+16px)]">
        <div className="ios-glass-strong pointer-events-auto relative grid grid-cols-4 rounded-full p-1" role="radiogroup" aria-label={tr('Style de carte', 'Map style')}>
          <span
            aria-hidden
            className="absolute bottom-1 left-1 top-1 w-[calc(25%-2px)] rounded-full bg-[var(--ios-tint)] shadow-[0_3px_10px_rgba(255,106,0,0.4)] transition-transform duration-300 ease-[var(--ios-spring)]"
            style={{ transform: `translateX(${(['plan', 'satellite', 'hybrid', 'relief'] as LayerId[]).indexOf(layer) * 100}%)` }}
          />
          {([
            ['plan', MapIcon, tr('Plan', 'Map')],
            ['satellite', Satellite, 'Satellite'],
            ['hybrid', Layers, tr('Réaliste', 'Hybrid')],
            ['relief', Mountain, tr('Relief', 'Terrain')],
          ] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={layer === id}
              onClick={() => setLayer(id)}
              className={`relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold tracking-[-0.01em] transition-colors sm:px-3.5 ${layer === id ? 'text-white' : 'text-[var(--ios-label)]'}`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[600] flex items-center justify-between gap-3 p-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] sm:p-4">
        <div className="ios-glass-strong pointer-events-auto flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4">
          <span className="ios-avatar-ai h-7 w-7 text-[10px]">MF</span>
          <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ios-label)]">{title}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('Fermer la carte', 'Close map')}
          className="ios-glass-strong pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--ios-label)] transition-transform active:scale-90"
        >
          <X className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>

      {notices && (
        <div className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top,0px)+116px)] z-[600] flex flex-col items-center gap-2 sm:top-[calc(env(safe-area-inset-top,0px)+72px)]">
          {notices}
        </div>
      )}

      {/* Map controls */}
      <div className="absolute right-3 top-1/2 z-[600] flex -translate-y-1/2 flex-col gap-2 sm:right-4">
        <div className="ios-glass-strong flex flex-col overflow-hidden rounded-[18px]">
          <button type="button" onClick={() => zoom(1)} aria-label="Zoom +" className="flex h-11 w-11 items-center justify-center text-[var(--ios-label)] active:bg-[var(--ios-fill)]">
            <Plus className="h-5 w-5" />
          </button>
          <span className="mx-2.5 h-px bg-[var(--ios-separator)]" />
          <button type="button" onClick={() => zoom(-1)} aria-label="Zoom −" className="flex h-11 w-11 items-center justify-center text-[var(--ios-label)] active:bg-[var(--ios-fill)]">
            <Minus className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={locate}
          disabled={locationPending}
          aria-label={tr('Ma position', 'My location')}
          className="ios-glass-strong flex h-11 w-11 items-center justify-center rounded-full text-[var(--ios-blue)] disabled:opacity-50"
        >
          {validCoord(userLocation) ? <Navigation className="h-5 w-5 fill-current" /> : <LocateFixed className={`h-5 w-5 ${locationPending ? 'animate-pulse' : ''}`} />}
        </button>
      </div>

      {/* Bottom: route card + place cards */}
      <div ref={cardsRef} className="absolute inset-x-0 bottom-0 z-[600] pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        {routeTo && (
          <div className="mx-auto mb-2.5 w-[min(560px,calc(100%-24px))]">
            <div className="ios-glass-strong ios-rise flex items-center gap-3 rounded-[22px] p-2.5 pl-3.5">
              <div className="ios-segmented shrink-0 !grid-cols-2">
                <span aria-hidden className="ios-segmented-thumb" style={{ transform: routeMode === 'DRIVE' ? 'translateX(100%)' : 'translateX(0)' }} />
                <button type="button" onClick={() => onRouteModeChange('WALK')} aria-pressed={routeMode !== 'DRIVE'} aria-label={tr('À pied', 'Walk')} className="!px-3">
                  <Footprints className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => onRouteModeChange('DRIVE')} aria-pressed={routeMode === 'DRIVE'} aria-label={tr('En voiture', 'Drive')} className="!px-3">
                  <Car className="h-4 w-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                {!validCoord(userLocation) ? (
                  <button type="button" onClick={onRequestLocation} className="text-left text-[14px] font-semibold text-[var(--ios-blue)]">
                    {locationPending ? tr('Localisation…', 'Locating…') : tr('Active ta position pour l’itinéraire', 'Turn on location for directions')}
                  </button>
                ) : routeLoading ? (
                  <p className="text-[15px] font-semibold text-[var(--ios-label-2)]">{tr('Calcul de l’itinéraire…', 'Finding route…')}</p>
                ) : (
                  <p className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[var(--ios-label)]">
                    {route ? fmtDuration(route.duration) : routeFailed ? tr('À vol d’oiseau', 'Straight line') : ''}
                    {route || routeFailed ? (
                      <span className="ml-1.5 text-[15px] font-normal text-[var(--ios-label-2)]">
                        · {fmtDistance(route ? route.distance : haversine(userLocation, routeTo))}
                      </span>
                    ) : null}
                  </p>
                )}
                <p className="truncate text-[13px] text-[var(--ios-label-2)]">{tr('Vers', 'To')} {routeTo.name}</p>
              </div>
              <button type="button" onClick={onEndRoute} className="ios-pill h-9 shrink-0 text-[14px]">
                {tr('Terminer', 'End')}
              </button>
            </div>
          </div>
        )}

        {places.length > 0 && (
          <div className="ios-carousel mx-auto max-w-[1100px] px-3 sm:px-4">
            {places.map((place, index) => {
              const active = isActive(place, index)
              const category = place.categories?.[0]?.replace(/_/g, ' ')
              const dist = distanceTo(place)
              return (
                <article
                  key={`${place.place_id}-${index}`}
                  data-card={index}
                  data-active={active}
                  className="ios-card ios-glass-strong flex w-[300px] items-stretch gap-3 !bg-[var(--ios-glass-strong)] p-2.5 sm:w-[340px]"
                >
                  <button type="button" onClick={() => onSelect(index)} className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[16px] bg-[var(--ios-fill)]" aria-label={place.name}>
                    <PlaceImage place={place} width={200} height={200} className="h-full w-full object-cover" />
                    <span className={`absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${active ? 'bg-[var(--ios-tint)] text-white' : 'bg-white/90 text-black'}`}>
                      {index + 1}
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <button type="button" onClick={() => onSelect(index)} className="min-w-0 text-left">
                      <p className="truncate text-[16px] font-semibold tracking-[-0.02em] text-[var(--ios-label)]">{place.name}</p>
                      <p className="truncate text-[13px] capitalize text-[var(--ios-label-2)]">
                        {[category, dist].filter(Boolean).join(' · ') || place.address}
                      </p>
                    </button>
                    <div className="mt-auto flex items-center gap-1.5 pt-2">
                      <button type="button" onClick={() => onRoute(index)} className="ios-btn-tint h-8 flex-1 px-3 text-[13px]">
                        <Navigation className="h-3.5 w-3.5 fill-current" />
                        {tr('Itinéraire', 'Directions')}
                      </button>
                      <button type="button" onClick={() => onDetails(place)} className="ios-pill h-8 !px-3 text-[13px]">
                        {tr('Détails', 'Details')}
                        <ChevronRight className="-mr-1 h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
