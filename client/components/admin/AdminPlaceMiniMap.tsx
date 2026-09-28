'use client'

import { useEffect, useRef } from 'react'

export function AdminPlaceMiniMap({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    let cancelled = false
    let map: import('leaflet').Map | null = null

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !ref.current) return
      map = L.map(ref.current, { zoomControl: false, attributionControl: false }).setView([lat, lng], 15)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
      L.marker([lat, lng]).addTo(map).bindPopup(label ?? '')
    })()

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [lat, lng, label])

  return <div ref={ref} className="h-[180px] w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10" />
}
