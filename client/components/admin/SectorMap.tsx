'use client'

import { useEffect, useRef } from 'react'

export type SectorPoint = {
  sector: string
  count: number
  lat: number
  lng: number
}

/**
 * Lightweight Leaflet circle-marker map (no react-leaflet peer conflict).
 * Clusters visually by size of radius ~ place count.
 */
export function SectorMap({ points }: { points: SectorPoint[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || points.length === 0) return
    let cancelled = false
    let map: import('leaflet').Map | null = null

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !ref.current) return

      map = L.map(ref.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([-1.953, 30.09], 12)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map)

      const max = Math.max(...points.map((p) => p.count), 1)
      for (const p of points) {
        const r = 8 + (p.count / max) * 28
        L.circleMarker([p.lat, p.lng], {
          radius: r,
          color: '#E8672A',
          fillColor: '#E8672A',
          fillOpacity: 0.35,
          weight: 2,
        })
          .bindPopup(`<strong>${p.sector}</strong><br/>${p.count}`)
          .addTo(map!)
      }
    })()

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [points])

  if (points.length === 0) {
    return <div className="flex h-[260px] items-center justify-center text-[13px] text-[#6E5B50]">—</div>
  }

  return <div ref={ref} className="h-[260px] w-full overflow-hidden rounded-xl" />
}
