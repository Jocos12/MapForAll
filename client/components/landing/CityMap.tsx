'use client'

/**
 * Real Leaflet map of Kigali, reused by every "movement" scene of the
 * ConnectRwanda AI landing page (hero film, live buses, navigation,
 * accessibility). One component, several layers and camera moves:
 *
 *  layers.lines / buses : three bus lines on real roads (OSRM geometry,
 *                         straight-line fallback) with buses moving on them
 *  layers.journey       : door-to-door trip (walk → bus 302 → walk) drawn
 *                         progressively with a traveller marker
 *  layers.access        : accessibility markers on real Kigali landmarks
 *  layers.you           : the visitor's position in Remera
 *  camera / follow      : fly to a view, or follow a bus of a given line
 *
 * Leaflet is loaded on the client only. Bus positions are a simulation for
 * the presentation (no live feed yet). Text labels come from props.
 */

import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'

export type Pal = {
  bg: string; surface: string; text: string; muted: string; line: string
  blue: string; green: string; yellow: string; violet: string; red: string
}
export type LL = [number, number]
export type Layers = { lines?: boolean; buses?: boolean; journey?: boolean; access?: boolean; you?: boolean }
export type Camera = { center: LL; zoom: number }
export type MapLabels = { you: string; confirmed: string; min: string; dest: string }

function ensureLeafletCss() {
  if (document.querySelector('link[data-leaflet]')) return
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = '/vendor/leaflet/leaflet.css'
  css.dataset.leaflet = '1'
  document.head.appendChild(css)
}

const TILES = {
  dark: {
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ref: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  },
  light: {
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ref: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  },
}
const ATTRIBUTION = 'Tiles © Esri · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Routes OSRM'

export const LINES: { id: string; color: 'blue' | 'yellow' | 'green'; to: string; stops: { name: string; at: LL }[] }[] = [
  {
    id: '302', color: 'blue', to: 'Kimironko',
    stops: [
      { name: 'Nyabugogo', at: [-1.9399, 30.0443] },
      { name: 'Mu Mujyi (CBD)', at: [-1.9447, 30.0602] },
      { name: 'Kimihurura', at: [-1.9527, 30.0878] },
      { name: 'Remera', at: [-1.9586, 30.1064] },
      { name: 'Kimironko', at: [-1.9497, 30.1254] },
    ],
  },
  {
    id: '205', color: 'yellow', to: 'Kicukiro',
    stops: [
      { name: 'Kacyiru', at: [-1.9358, 30.0853] },
      { name: 'Kimihurura', at: [-1.9527, 30.0878] },
      { name: 'Sonatubes', at: [-1.9688, 30.1003] },
      { name: 'Kicukiro Centre', at: [-1.9791, 30.1031] },
    ],
  },
  {
    id: '101', color: 'green', to: 'Kibagabaga',
    stops: [
      { name: 'Nyamirambo', at: [-1.9789, 30.0434] },
      { name: 'Mu Mujyi (CBD)', at: [-1.9447, 30.0602] },
      { name: 'Kacyiru', at: [-1.9358, 30.0853] },
      { name: 'Kibagabaga', at: [-1.9302, 30.1105] },
    ],
  },
]

export const ACCESS_TYPES = ['stepfree', 'ramp', 'toilet', 'stairs'] as const
export type AccessType = (typeof ACCESS_TYPES)[number]
const ACCESS_POINTS: { name: string; at: LL; type: AccessType }[] = [
  { name: 'Kigali Convention Centre', at: [-1.9545, 30.0932], type: 'stepfree' },
  { name: 'King Faisal Hospital', at: [-1.9442, 30.0950], type: 'stepfree' },
  { name: 'Kigali City Tower', at: [-1.9443, 30.0606], type: 'stepfree' },
  { name: 'Kimironko Market', at: [-1.9493, 30.1259], type: 'ramp' },
  { name: 'Amahoro Stadium', at: [-1.9556, 30.1168], type: 'toilet' },
  { name: 'Nyabugogo Bus Park', at: [-1.9393, 30.0447], type: 'stairs' },
  { name: 'Kigali Heights', at: [-1.9530, 30.0915], type: 'toilet' },
  { name: 'Remera Bus Stop', at: [-1.9586, 30.1064], type: 'ramp' },
  { name: 'Kacyiru Police Hospital', at: [-1.9370, 30.0870], type: 'stepfree' },
  { name: 'Nyamirambo Stadium', at: [-1.9764, 30.0446], type: 'stairs' },
  { name: 'Kicukiro Centre', at: [-1.9791, 30.1031], type: 'ramp' },
]
export const ACCESS_COLOR: Record<AccessType, 'green' | 'yellow' | 'blue' | 'red'> = { stepfree: 'green', ramp: 'yellow', toilet: 'blue', stairs: 'red' }
const ACCESS_GLYPH: Record<AccessType, string> = {
  stepfree: '<circle cx="12" cy="4" r="1.6"/><path d="M9 7.5l3-1 2 4h3M12 6.5l-1 5.5h4l2 5M10 10.5a5 5 0 1 0 5 6.5"/>',
  ramp: '<path d="M3 18h18L3 8z"/>',
  toilet: '<path d="M7 3v18M17 3v4a3 3 0 0 1-6 0V3M14 10v11"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
}

/* Door-to-door journey used by the navigation scenes. */
const JOURNEY = {
  from: [-1.9632, 30.1036] as LL,          // home, Remera
  board: [-1.9586, 30.1064] as LL,         // Remera stop
  alight: [-1.9497, 30.1254] as LL,        // Kimironko stop
  to: [-1.9480, 30.1281] as LL,            // Kimironko Market
}
export const JOURNEY_CAMERA: Camera = { center: [-1.9555, 30.1160], zoom: 14.6 }

/* geometry helpers */
type Prep = { path: LL[]; cum: number[]; total: number }
function dist(a: LL, b: LL) {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = b[0] - a[0]
  return Math.sqrt(x * x + y * y)
}
function prepare(path: LL[]): Prep {
  const cum = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]))
  return { path, cum, total: cum[cum.length - 1] || 1e-9 }
}
function atDistance(p: Prep, d: number): { pt: LL; i: number } {
  const dd = Math.max(0, Math.min(d, p.total))
  let i = 1
  while (i < p.cum.length - 1 && p.cum[i] < dd) i++
  const a = p.path[i - 1], b = p.path[i] ?? a
  const seg = p.cum[i] - p.cum[i - 1] || 1
  const k = (dd - p.cum[i - 1]) / seg
  return { pt: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], i }
}
function pointAt(p: Prep, f: number): LL {
  return atDistance(p, (((f % 1) + 1) % 1) * p.total).pt
}
function sliceTo(p: Prep, d: number): LL[] {
  if (d <= 0) return []
  const { pt, i } = atDistance(p, d)
  return [...p.path.slice(0, i), pt]
}

const geoCache = new Map<string, Promise<LL[]>>()
function roadGeometry(stops: LL[], profile: 'car' | 'foot' = 'car'): Promise<LL[]> {
  const key = `cr_osrm_${profile}_${stops.map((s) => s.join(',')).join(';')}`
  const hit = geoCache.get(key)
  if (hit) return hit
  const job = (async () => {
    try {
      const cached = sessionStorage.getItem(key)
      if (cached) return JSON.parse(cached) as LL[]
    } catch { /* storage unavailable */ }
    try {
      const coords = stops.map(([lat, lng]) => `${lng},${lat}`).join(';')
      const base = profile === 'foot'
        ? 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
        : 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 6000)
      const res = await fetch(`${base}/${coords}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      window.clearTimeout(timer)
      const json = await res.json()
      const line: LL[] = json?.routes?.[0]?.geometry?.coordinates?.map((c: number[]) => [c[1], c[0]])
      if (line?.length > 1) {
        try { sessionStorage.setItem(key, JSON.stringify(line)) } catch { /* ignore */ }
        return line
      }
    } catch { /* offline or blocked: straight segments */ }
    return stops
  })()
  geoCache.set(key, job)
  return job
}

type Props = {
  theme: 'dark' | 'light'
  pal: Pal
  labels: MapLabels
  layers: Layers
  hidden?: AccessType[]
  camera?: Camera | null
  fit?: 'lines' | 'access' | 'journey'
  follow?: string | null
  interactive?: boolean
  className?: string
}

type Bus = { marker: Leaflet.Marker; prep: Prep; f: number; speed: number; line: string }

export default function CityMap({ theme, pal, labels, layers, hidden = [], camera = null, fit = 'lines', follow = null, interactive = true, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const L = useRef<typeof Leaflet | null>(null)
  const tiles = useRef<Leaflet.TileLayer[]>([])
  const groups = useRef<Record<'lines' | 'buses' | 'journey' | 'access' | 'you', Leaflet.LayerGroup> | null>(null)
  const buses = useRef<Bus[]>([])
  const access = useRef<{ type: AccessType; marker: Leaflet.Marker }[]>([])
  const journey = useRef<{ segs: { prep: Prep; line: Leaflet.Polyline; start: number }[]; total: number; traveller: Leaflet.Marker; mode: string } | null>(null)
  const bounds = useRef<Record<string, LL[]>>({})
  const visible = useRef(false)
  const live = useRef({ layers, follow, hidden })
  live.current = { layers, follow, hidden }
  const [ready, setReady] = useState(false)
  const [built, setBuilt] = useState(0)

  /* map instance */
  useEffect(() => {
    let cancelled = false
    ensureLeafletCss()
    import('leaflet').then((mod) => {
      if (cancelled || !box.current) return
      const Lf = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as typeof Leaflet)
      L.current = Lf
      const m = Lf.map(box.current, {
        center: [-1.951, 30.085], zoom: 13, zoomSnap: 0.1,
        zoomControl: false, attributionControl: true, scrollWheelZoom: false,
        dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive,
        fadeAnimation: true, zoomAnimation: true, inertia: true,
      })
      const labelsPane = m.createPane('crLabels')
      labelsPane.style.zIndex = '450'
      labelsPane.style.pointerEvents = 'none'
      m.attributionControl.setPrefix(false)
      m.attributionControl.addAttribution(ATTRIBUTION)
      if (interactive) Lf.control.zoom({ position: 'topright' }).addTo(m)
      map.current = m
      groups.current = { lines: Lf.layerGroup(), buses: Lf.layerGroup(), journey: Lf.layerGroup(), access: Lf.layerGroup(), you: Lf.layerGroup() }
      setReady(true)
    })
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting }, { threshold: 0.02 })
    if (box.current) io.observe(box.current)
    const ro = new ResizeObserver(() => map.current?.invalidateSize({ pan: false }))
    if (box.current) ro.observe(box.current)
    return () => {
      cancelled = true
      io.disconnect()
      ro.disconnect()
      map.current?.remove()
      map.current = null
    }
  }, [interactive])

  /* tiles follow the theme */
  useEffect(() => {
    const Lf = L.current, m = map.current
    if (!ready || !Lf || !m) return
    tiles.current.forEach((t) => t.remove())
    const set = TILES[theme]
    tiles.current = [
      Lf.tileLayer(set.base, { maxZoom: 16, detectRetina: interactive, updateWhenZooming: false, keepBuffer: 1 }).addTo(m),
      Lf.tileLayer(set.ref, { maxZoom: 16, detectRetina: interactive, updateWhenZooming: false, keepBuffer: 1, pane: 'crLabels' }).addTo(m),
    ]
  }, [ready, theme, interactive])

  /* build every layer's content (colours depend on the palette) */
  useEffect(() => {
    const Lf = L.current, g = groups.current
    if (!ready || !Lf || !g) return
    let alive = true
    Object.values(g).forEach((x) => x.clearLayers())
    buses.current = []
    access.current = []
    journey.current = null

    // you
    Lf.marker(JOURNEY.from, {
      icon: Lf.divIcon({ className: 'cr-leaf', html: `<span class="cr-you" style="--c:${pal.blue}"><i></i></span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 600,
    }).bindTooltip(labels.you, { direction: 'top', offset: [0, -10], permanent: true, className: 'cr-tip' }).addTo(g.you)

    // access
    access.current = ACCESS_POINTS.map((p) => {
      const color = pal[ACCESS_COLOR[p.type]]
      const marker = Lf.marker(p.at, {
        icon: Lf.divIcon({
          className: 'cr-leaf',
          html: `<span class="cr-a11y" style="--c:${color}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#050A16" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ACCESS_GLYPH[p.type]}</svg></span>`,
          iconSize: [34, 34], iconAnchor: [17, 17],
        }),
      }).bindTooltip(p.name, { direction: 'top', offset: [0, -16], className: 'cr-tip' })
      if (!live.current.hidden.includes(p.type)) marker.addTo(g.access)
      return { type: p.type, marker }
    })
    bounds.current.access = ACCESS_POINTS.map((p) => p.at)

    // lines + buses
    Promise.all(LINES.map(async (line) => ({ line, geo: await roadGeometry(line.stops.map((s) => s.at)) }))).then((res) => {
      if (!alive) return
      const all: LL[] = []
      res.forEach(({ line, geo }, li) => {
        const color = pal[line.color]
        Lf.polyline(geo, { color, weight: 12, opacity: 0.16, lineCap: 'round', interactive: false }).addTo(g.lines)
        Lf.polyline(geo, { color, weight: 4.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g.lines)
        all.push(...geo)
        line.stops.forEach((s) => {
          Lf.circleMarker(s.at, { radius: 6, color, weight: 3, fillColor: pal.bg, fillOpacity: 1 })
            .bindTooltip(s.name, { direction: 'top', offset: [0, -6], className: 'cr-tip' })
            .addTo(g.lines)
        })
        const prep = prepare(geo)
        ;[0.12 + li * 0.17, 0.58 + li * 0.11].forEach((f, bi) => {
          const marker = Lf.marker(pointAt(prep, f), {
            icon: Lf.divIcon({ className: 'cr-leaf', html: `<span class="cr-bus" style="--c:${color}">${line.id}</span>`, iconSize: [40, 22], iconAnchor: [20, 11] }),
            zIndexOffset: 400,
          }).addTo(g.buses)
          const eta = 2 + ((li * 3 + bi * 5) % 9)
          marker.bindTooltip(`<b>${line.id}</b> → ${line.to} · ${eta} ${labels.min}`, { direction: 'top', offset: [0, -12], className: 'cr-tip' })
          buses.current.push({ marker, prep, f, speed: (0.000022 + li * 0.000004) * (bi ? 1.1 : 1), line: line.id })
        })
      })
      bounds.current.lines = all
      setBuilt((n) => n + 1)
    })

    // journey: walk → bus → walk
    Promise.all([
      roadGeometry([JOURNEY.from, JOURNEY.board], 'foot'),
      roadGeometry([JOURNEY.board, JOURNEY.alight], 'car'),
      roadGeometry([JOURNEY.alight, JOURNEY.to], 'foot'),
    ]).then(([w1, ride, w2]) => {
      if (!alive) return
      const parts: { path: LL[]; color: string; dash?: string; weight: number }[] = [
        { path: w1, color: pal.green, dash: '2 9', weight: 5 },
        { path: ride, color: pal.blue, weight: 6 },
        { path: w2, color: pal.green, dash: '2 9', weight: 5 },
      ]
      let start = 0
      const segs = parts.map((p) => {
        Lf.polyline(p.path, { color: p.color, weight: p.weight + 6, opacity: 0.12, dashArray: p.dash, lineCap: 'round', interactive: false }).addTo(g.journey)
        const line = Lf.polyline([], { color: p.color, weight: p.weight, opacity: 1, dashArray: p.dash, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g.journey)
        const prep = prepare(p.path)
        const seg = { prep, line, start }
        start += prep.total
        return seg
      })
      ;[JOURNEY.board, JOURNEY.alight].forEach((s) => Lf.circleMarker(s, { radius: 6, color: pal.blue, weight: 3, fillColor: pal.bg, fillOpacity: 1 }).addTo(g.journey))
      Lf.marker(JOURNEY.to, {
        icon: Lf.divIcon({ className: 'cr-leaf', html: `<span class="cr-dest" style="--c:${pal.yellow}"></span>`, iconSize: [26, 34], iconAnchor: [13, 32] }),
        zIndexOffset: 500,
      }).bindTooltip(labels.dest, { direction: 'top', offset: [0, -30], permanent: true, className: 'cr-tip' }).addTo(g.journey)
      const traveller = Lf.marker(JOURNEY.from, {
        icon: Lf.divIcon({ className: 'cr-leaf', html: `<span class="cr-walker" style="--c:${pal.green}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 700,
      }).addTo(g.journey)
      journey.current = { segs, total: start, traveller, mode: 'walk' }
      bounds.current.journey = [...w1, ...ride, ...w2]
      setBuilt((n) => n + 1)
    })

    return () => { alive = false }
  }, [ready, pal, labels])

  /* show / hide layers */
  useEffect(() => {
    const m = map.current, g = groups.current
    if (!ready || !m || !g) return
    ;(Object.keys(g) as (keyof typeof g)[]).forEach((k) => {
      const on = !!layers[k]
      if (on && !m.hasLayer(g[k])) g[k].addTo(m)
      if (!on && m.hasLayer(g[k])) m.removeLayer(g[k])
    })
  }, [ready, layers.lines, layers.buses, layers.journey, layers.access, layers.you, built]) // eslint-disable-line react-hooks/exhaustive-deps

  /* access filters */
  useEffect(() => {
    const g = groups.current
    if (!g) return
    access.current.forEach(({ type, marker }) => {
      const off = hidden.includes(type)
      if (off && g.access.hasLayer(marker)) g.access.removeLayer(marker)
      if (!off && !g.access.hasLayer(marker)) g.access.addLayer(marker)
    })
  }, [hidden, built])

  /* camera: explicit view, or fit to a layer once its data exists */
  const fitted = useRef(false)
  useEffect(() => {
    const Lf = L.current, m = map.current
    if (!ready || !Lf || !m) return
    if (camera) {
      m.flyTo(camera.center, camera.zoom, { duration: 1.8, easeLinearity: 0.2 })
      return
    }
    const pts = bounds.current[fit]
    if (pts?.length && !fitted.current) {
      fitted.current = true
      m.fitBounds(Lf.latLngBounds(pts), { padding: [36, 36], animate: false })
    }
  }, [ready, camera?.center[0], camera?.center[1], camera?.zoom, fit, built]) // eslint-disable-line react-hooks/exhaustive-deps

  /* following a bus: zoom in once, the animation loop keeps it centred */
  useEffect(() => {
    const Lf = L.current, m = map.current
    if (!ready || !Lf || !m) return
    if (follow) m.setZoom(15, { animate: true })
    else if (bounds.current.lines?.length && fit === 'lines' && !camera) m.flyToBounds(Lf.latLngBounds(bounds.current.lines), { padding: [36, 36], duration: 1.2 })
  }, [follow]) // eslint-disable-line react-hooks/exhaustive-deps

  /* one animation loop for buses, journey and camera follow */
  useEffect(() => {
    const m = map.current, g = groups.current, Lf = L.current
    if (!ready || !m || !g || !Lf) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    let jt = 0
    const JOURNEY_MS = 9000, HOLD_MS = 1800
    const step = (now: number) => {
      // ~30 fps is plenty for markers and keeps the page light
      if (now - last < 32) { raf = requestAnimationFrame(step); return }
      const dt = Math.min(now - last, 80)
      last = now
      if (visible.current && !document.hidden) {
        const { layers: ly, follow: fl } = live.current
        if (ly.buses && !reduce) {
          for (const b of buses.current) {
            b.f += b.speed * dt
            b.marker.setLatLng(pointAt(b.prep, b.f))
          }
        }
        if (fl) {
          const b = buses.current.find((x) => x.line === fl)
          if (b) m.panTo(b.marker.getLatLng(), { animate: false })
        }
        const j = journey.current
        if (ly.journey && j) {
          jt = reduce ? JOURNEY_MS : (jt + dt) % (JOURNEY_MS + HOLD_MS)
          const d = Math.min(jt / JOURNEY_MS, 1) * j.total
          let pos: LL = JOURNEY.from
          let mode = 'walk'
          j.segs.forEach((s, i) => {
            const local = d - s.start
            const pts = local >= s.prep.total ? s.prep.path : sliceTo(s.prep, local)
            s.line.setLatLngs(pts)
            if (local > 0 && local <= s.prep.total) { pos = atDistance(s.prep, local).pt; mode = i === 1 ? 'bus' : 'walk' }
            if (local > s.prep.total && i === j.segs.length - 1) pos = s.prep.path[s.prep.path.length - 1]
          })
          j.traveller.setLatLng(pos)
          if (mode !== j.mode) {
            j.mode = mode
            j.traveller.setIcon(Lf.divIcon({
              className: 'cr-leaf',
              html: mode === 'bus' ? `<span class="cr-bus" style="--c:${pal.blue}">302</span>` : `<span class="cr-walker" style="--c:${pal.green}"></span>`,
              iconSize: mode === 'bus' ? [40, 22] : [18, 18], iconAnchor: mode === 'bus' ? [20, 11] : [9, 9],
            }))
          }
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ready, pal, built])

  /* "confirmed by the community" pulses on the accessibility layer */
  useEffect(() => {
    const Lf = L.current, m = map.current, g = groups.current
    if (!ready || !Lf || !m || !g || !layers.access) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let i = 0
    const id = window.setInterval(() => {
      const shown = access.current.filter((x) => g.access.hasLayer(x.marker))
      if (!shown.length || !visible.current) return
      const target = shown[i % shown.length]
      i += 3
      const el = target.marker.getElement()?.querySelector('.cr-a11y') as HTMLElement | null
      if (el) { el.classList.remove('cr-pulse'); void el.offsetWidth; el.classList.add('cr-pulse') }
      const popup = Lf.popup({ closeButton: false, autoPan: false, offset: [0, -14], className: 'cr-pop' })
        .setLatLng(target.marker.getLatLng())
        .setContent(`<b>+1</b> ${labels.confirmed}`)
      popup.openOn(m)
      window.setTimeout(() => m.closePopup(popup), 2200)
    }, 3200)
    return () => window.clearInterval(id)
  }, [ready, layers.access, labels])

  return <div ref={box} className={`cr-map ${className}`} role="region" aria-label="Kigali map" />
}
