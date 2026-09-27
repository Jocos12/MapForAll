'use client'

import { useEffect, useRef, useState } from 'react'
import { Crosshair, Loader2 } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { loadLeaflet, OSM_TILES, type LeafletMap, type LeafletMarker } from '@/lib/leaflet'

const KIGALI: [number, number] = [-1.9536, 30.0606]

const PIN_HTML =
  '<span style="display:block;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#E8672A;border:3px solid #fff;box-shadow:0 4px 10px rgba(0,0,0,.35)"></span>'

interface Props {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function LocationPicker({ latitude, longitude, onChange }: Props) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const placeRef = useRef<(lat: number, lng: number) => void>(() => {})
  const changeRef = useRef(onChange)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  changeRef.current = onChange

  useEffect(() => {
    let dead = false
    loadLeaflet().then((L) => {
      if (dead || !box.current) return
      const start: [number, number] = latitude != null && longitude != null ? [latitude, longitude] : KIGALI
      const map = L.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true })
      L.tileLayer(OSM_TILES, { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map)
      map.setView(start, latitude != null ? 17 : 13)
      const icon = L.divIcon({ className: '', html: PIN_HTML, iconSize: [26, 26], iconAnchor: [13, 26] })
      placeRef.current = (lat, lng) => {
        if (markerRef.current) markerRef.current.setLatLng([lat, lng])
        else {
          markerRef.current = L.marker([lat, lng], { icon, draggable: true, keyboard: false }).addTo(map)
          markerRef.current.on('dragend', () => {
            const at = markerRef.current?.getLatLng()
            if (at) changeRef.current(round(at.lat), round(at.lng))
          })
        }
      }
      if (latitude != null && longitude != null) placeRef.current(latitude, longitude)
      map.on('click', (e) => {
        placeRef.current(e.latlng.lat, e.latlng.lng)
        changeRef.current(round(e.latlng.lat), round(e.latlng.lng))
      })
      mapRef.current = map
      setReady(true)
    }).catch(() => setFailed(true))
    return () => {
      dead = true
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // The map is created once; later position changes are pushed through placeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || latitude == null || longitude == null) return
    placeRef.current(latitude, longitude)
  }, [ready, latitude, longitude])

  function locate() {
    const apply = (lat: number, lng: number) => {
      setLocating(false)
      onChange(round(lat), round(lng))
      mapRef.current?.setView([lat, lng], 17)
    }
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => apply(pos.coords.latitude, pos.coords.longitude),
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-[#E4E4E7]">
        <div ref={box} className="relative z-0 h-56 w-full bg-[#EEF0F2] isolate" aria-label={t('biz.form.mapHint')} />
        {failed && (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12.5px] text-[#52525B]">{t('biz.form.mapFailed')}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[#52525B]">
          {latitude != null && longitude != null
            ? `${t('biz.form.pinAt')} ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
            : t('biz.form.mapHint')}
        </p>
        <button
          type="button"
          onClick={locate}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D4D4D8] bg-white px-3 text-[12.5px] font-medium text-[#1A1614] transition-colors hover:border-[#E8672A] hover:text-[#C2410C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8672A]"
        >
          {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
          {locating ? t('business.locating') : t('biz.form.useLocation')}
        </button>
      </div>
    </div>
  )
}
