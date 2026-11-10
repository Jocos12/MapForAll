'use client'

import { useEffect, useRef } from 'react'
import { Maximize2, MapPin } from 'lucide-react'
import type { Coordinates } from '@/lib/types'

interface Pin {
  name: string
  coordinates: Coordinates
}

interface Props {
  pins: Pin[]
  label: string
  onOpen: () => void
}

// Standard OpenStreetMap tiles: free, no key (CARTO now asks for one).
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function ensureLeafletCss() {
  if (document.querySelector('link[data-leaflet]')) return
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = '/vendor/leaflet/leaflet.css'
  css.dataset.leaflet = '1'
  document.head.appendChild(css)
}

/**
 * Compact, non-interactive map card shown inside the conversation under an AI
 * answer (OpenStreetMap tiles — free, no key). Tapping it opens the full map sheet.
 */
export function InlineMapPreview({ pins, label, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const valid = pins.filter((p) => Number.isFinite(p.coordinates?.lat) && Number.isFinite(p.coordinates?.lng) && (p.coordinates.lat !== 0 || p.coordinates.lng !== 0))
  const key = valid.map((p) => `${p.coordinates.lat.toFixed(5)},${p.coordinates.lng.toFixed(5)}`).join('|')

  useEffect(() => {
    if (!ref.current || !valid.length) return
    let cancelled = false
    let map: import('leaflet').Map | null = null
    ensureLeafletCss()
    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !ref.current) return
      map = L.map(ref.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      })
      L.tileLayer(TILES, { maxZoom: 19 }).addTo(map)
      const latlngs: [number, number][] = valid.map((p) => [p.coordinates.lat, p.coordinates.lng])
      valid.slice(0, 20).forEach((p, i) => {
        const icon = L.divIcon({
          className: 'ios-map-pin',
          html: `<span>${i + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        })
        L.marker([p.coordinates.lat, p.coordinates.lng], { icon, interactive: false }).addTo(map!)
      })
      if (latlngs.length === 1) map.setView(latlngs[0], 15)
      else map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 16 })
    })()
    return () => {
      cancelled = true
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!valid.length) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="ios-card group relative mt-3 block h-[176px] w-full text-left sm:h-[200px]"
      aria-label={label}
    >
      <div ref={ref} className="ios-minimap absolute inset-0 z-0 [&_.leaflet-container]:bg-transparent" />
      <span className="pointer-events-none absolute right-2.5 top-2 z-[500] rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] text-black/60 dark:bg-black/50 dark:text-white/60">
        © OpenStreetMap
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex items-center justify-between gap-2 p-2.5">
        <span className="ios-glass-strong inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-[var(--ios-label)]">
          <MapPin className="h-3.5 w-3.5 text-[var(--ios-tint)]" strokeWidth={2.4} />
          {label}
        </span>
        <span className="ios-glass-strong inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ios-label)] transition-transform group-hover:scale-105">
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
      </div>
    </button>
  )
}
