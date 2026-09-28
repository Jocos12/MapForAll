'use client'

import { useEffect, useRef, useState } from 'react'
import { Crosshair, Loader2 } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { loadLeaflet, OSM_TILES, type LeafletMap, type LeafletMarker } from '@/lib/leaflet'
import { reverseGeocode } from '@/lib/reverseGeocode'

const KIGALI: [number, number] = [-1.9536, 30.0606]

const PIN_HTML =
  '<span style="display:block;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#E8672A;border:3px solid #fff;box-shadow:0 6px 14px rgba(232,103,42,.45),0 2px 4px rgba(0,0,0,.25)"></span>'

export interface AddressResolveState {
  loading: boolean
  address: string | null
  failed: boolean
}

interface Props {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
  /** Fired when reverse-geocode starts/finishes after a pin place (click, drag, locate). */
  onAddressResolve?: (state: AddressResolveState) => void
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function LocationPicker({ latitude, longitude, onChange, onAddressResolve }: Props) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const placeRef = useRef<(lat: number, lng: number) => void>(() => {})
  const changeRef = useRef(onChange)
  const resolveRef = useRef(onAddressResolve)
  const abortRef = useRef<AbortController | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [geoLoading, setGeoLoading] = useState(false)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null)
  const [geoFailed, setGeoFailed] = useState(false)
  changeRef.current = onChange
  resolveRef.current = onAddressResolve

  function emitResolve(state: AddressResolveState) {
    setGeoLoading(state.loading)
    if (!state.loading) {
      setResolvedAddress(state.address)
      setGeoFailed(state.failed)
    }
    resolveRef.current?.(state)
  }

  function lookupAddress(lat: number, lng: number) {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    emitResolve({ loading: true, address: null, failed: false })
    void reverseGeocode(lat, lng, ac.signal).then((result) => {
      if (ac.signal.aborted) return
      emitResolve({
        loading: false,
        address: result.address,
        failed: result.failed,
      })
    })
  }

  useEffect(() => {
    let dead = false
    loadLeaflet().then((L) => {
      if (dead || !box.current) return
      const start: [number, number] = latitude != null && longitude != null ? [latitude, longitude] : KIGALI
      const map = L.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true })
      L.tileLayer(OSM_TILES, { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map)
      map.setView(start, latitude != null ? 17 : 13)
      const icon = L.divIcon({ className: '', html: PIN_HTML, iconSize: [32, 32], iconAnchor: [16, 32] })
      placeRef.current = (lat, lng) => {
        if (markerRef.current) markerRef.current.setLatLng([lat, lng])
        else {
          markerRef.current = L.marker([lat, lng], { icon, draggable: true, keyboard: false }).addTo(map)
          markerRef.current.on('dragend', () => {
            const at = markerRef.current?.getLatLng()
            if (!at) return
            const latR = round(at.lat)
            const lngR = round(at.lng)
            changeRef.current(latR, lngR)
            lookupAddress(latR, lngR)
          })
        }
      }
      if (latitude != null && longitude != null) placeRef.current(latitude, longitude)
      map.on('click', (e) => {
        const latR = round(e.latlng.lat)
        const lngR = round(e.latlng.lng)
        placeRef.current(latR, lngR)
        changeRef.current(latR, lngR)
        lookupAddress(latR, lngR)
      })
      mapRef.current = map
      setReady(true)
    }).catch(() => setFailed(true))
    return () => {
      dead = true
      abortRef.current?.abort()
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
      const latR = round(lat)
      const lngR = round(lng)
      onChange(latR, lngR)
      mapRef.current?.setView([latR, lngR], 17)
      lookupAddress(latR, lngR)
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
      <p className="mb-2 text-[12.5px] font-medium text-[#3F3F46]">{t('biz.form.mapClickHint')}</p>
      <div className="relative overflow-hidden rounded-xl border border-[#E4E4E7] shadow-sm">
        <div ref={box} className="relative z-0 h-64 w-full bg-[#EEF0F2] sm:h-72 isolate" aria-label={t('biz.form.mapHint')} />
        {failed && (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12.5px] text-[#52525B]">{t('biz.form.mapFailed')}</p>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {geoLoading ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#52525B]">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              {t('biz.form.addressLooking')}
            </p>
          ) : resolvedAddress ? (
            <div>
              <p className="text-[13px] font-medium leading-snug text-[#18181B]">{resolvedAddress}</p>
              {latitude != null && longitude != null && (
                <p className="mt-0.5 text-[11px] tabular-nums text-[#A1A1AA]">
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </p>
              )}
            </div>
          ) : geoFailed && latitude != null ? (
            <div>
              <p className="text-[12.5px] text-[#9A3412]">{t('biz.form.addressNotFound')}</p>
              {latitude != null && longitude != null && (
                <p className="mt-0.5 text-[11px] tabular-nums text-[#A1A1AA]">
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#52525B]">
              {latitude != null && longitude != null
                ? `${t('biz.form.pinAt')} ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                : t('biz.form.mapHint')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={locate}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#D4D4D8] bg-white px-3 text-[12.5px] font-medium text-[#1A1614] transition-colors hover:border-[#E8672A] hover:text-[#C2410C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8672A]"
        >
          {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
          {locating ? t('business.locating') : t('biz.form.useLocation')}
        </button>
      </div>
    </div>
  )
}
