'use client'

import { useEffect, useRef } from 'react'
import { loadLeaflet, OSM_TILES as TILES, type LeafletMap } from '@/lib/leaflet'

/** Real streets around Kimisagara Market, KN 112 St, Nyarugenge. */
const PINS: { lat: number; lng: number; ring?: boolean }[] = [
  { lat: -1.95952, lng: 30.05424 },
  { lat: -1.96035, lng: 30.05555, ring: true },
  { lat: -1.95855, lng: 30.05335 },
]

export function KigaliLiveMap({
  zoom = 16,
  className = '',
}: {
  zoom?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let map: LeafletMap | null = null
    let dead = false
    let started = false

    const start = () => {
      if (started || dead) return
      started = true
      loadLeaflet().then((L) => {
        if (dead || !ref.current) return
        const created = L.map(ref.current, {
          zoomControl: false,
          scrollWheelZoom: false,
          attributionControl: true,
        })
        map = created
        L.tileLayer(TILES, {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(created)
        created.setView([-1.9596, 30.0545], zoom)
        PINS.forEach((pin, index) => {
          const icon = L.divIcon({
            className: 'mf-pin-wrap',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
            html: `<span class="mf-pin" style="animation-delay:${index * 90}ms"><span class="mf-pin-dot${pin.ring ? ' is-ring' : ''}"></span></span>`,
          })
          L.marker([pin.lat, pin.lng], { icon, keyboard: false }).addTo(created)
        })
      }).catch(() => {})
    }

    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      start()
      io.disconnect()
    }, { rootMargin: '240px' })
    io.observe(el)

    return () => {
      dead = true
      io.disconnect()
      map?.remove()
    }
  }, [zoom])

  return <div ref={ref} className={`relative z-0 h-full w-full isolate ${className}`} />
}
