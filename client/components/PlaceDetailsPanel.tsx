'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, Car, ChevronLeft, ChevronRight, Clock, Copy, Footprints, HeartHandshake, MapPin, Share2, Star, Tag, Users } from 'lucide-react'
import { MapsChooser } from '@/components/MapsChooser'
import { AccessConfirm } from '@/components/AccessConfirm'
import { PlaceBadges } from '@/components/PlaceBadges'
import { StillThere } from '@/components/StillThere'
import { PlaceRatePopover, PlaceReviews } from '@/components/PlaceReviews'
import { useI18n } from '@/components/I18nProvider'
import type { Place } from '@/lib/types'
import { WEEK_DAYS, type WeekHours } from '@/lib/hours'
import { trackPlace } from '@/lib/trackPlace'

const DETAILS_PREF = 'hodari_details_expanded'

export function detailsExpandedPref(): boolean {
  try { return sessionStorage.getItem(DETAILS_PREF) === '1' } catch { return false }
}

export function setDetailsExpandedPref(open: boolean) {
  try { sessionStorage.setItem(DETAILS_PREF, open ? '1' : '0') } catch { /* private mode */ }
}

function notifyMapChrome() {
  window.dispatchEvent(new Event('hodari:chrome'))
}

interface AccessFlags {
  entrance: boolean | null
  toilet: boolean | null
  parking: boolean | null
  seating: boolean | null
}

interface HourLine { label: string; hours: string; today: boolean }

interface DetailsApi {
  name?: string
  address?: string
  rating?: number | null
  ratingCount?: number | null
  photos?: string[]
  openNow?: boolean | null
  weekdayText?: string[]
  todayIndex?: number
  phone?: string
  website?: string
  price?: string | null
  summary?: string
  accessibility?: AccessFlags
  error?: string
}

interface PlaceData {
  name: string
  rating?: number
  ratingCount?: number
  priceSymbol?: string
  photoUrls: string[]
  address?: string
  todayHours?: string
  summary?: string
  website?: string
  phone?: string
  mapsUri?: string
  isOpen?: boolean | null
  weekday?: HourLine[]
  access?: AccessFlags | null
}

interface Props {
  placeId: string
  fallbackName: string
  fallbackMapsUrl: string
  fallbackPlace?: Place | null
  /** Current position, used for the walking distance already shown on the map. */
  userLocation?: { lat: number; lng: number } | null
  onClose: () => void
  /** Community share action — opens the host's share-a-pin picker. */
  onShare?: () => void
  /** Center and open this place on the in-app map. */
  onViewInApp?: (place: Place) => void
  /** Owner preview from the dashboard: no view is counted. */
  preview?: boolean
  onWalk?: () => void
  onDrive?: () => void
  onSave?: () => void
  onRate?: () => void
  saved?: boolean
  distance?: string
  duration?: string
}

interface Recommended {
  place_id: string
  name: string
  categories: string[]
}

const PRICE_SYMBOL: Record<string, string> = {
  FREE: 'Free',
  INEXPENSIVE: '$',
  MODERATE: '$$',
  EXPENSIVE: '$$$',
  VERY_EXPENSIVE: '$$$$',
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  '0': 'Free',
  '1': '$',
  '2': '$$',
  '3': '$$$',
  '4': '$$$$',
}

function priceLabel(level?: string | number): string | undefined {
  if (level == null) return undefined
  return PRICE_SYMBOL[String(level)] ?? undefined
}

function isCommunityPlaceId(placeId: string): boolean {
  return (
    placeId.startsWith('user_') ||
    placeId.startsWith('pin:') ||
    placeId.startsWith('__') ||
    placeId.startsWith('kgl_') ||
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(placeId)
  )
}

function photoList(place: Place): string[] {
  const urls: string[] = []
  const push = (value?: string) => {
    if (!value) return
    if (value.startsWith('data:image/') || value.startsWith('/api/') || value.startsWith('http')) urls.push(value)
  }
  push(place.photo_url)
  for (const photo of place.photos ?? []) push(photo)
  return [...new Set(urls)]
}

function filled(value?: string | null): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function walkLine(from: { lat: number; lng: number }, to: { lat: number; lng: number }, lang: string): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2
  const meters = 2 * 6371000 * Math.asin(Math.sqrt(a))
  const mins = Math.max(1, Math.round(meters / 83.333))
  const dist = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
  const pretty = lang === 'fr' ? dist.replace('.', ',') : dist
  return `${pretty} · ${mins} min`
}

function todayIndex(): number {
  return (new Date().getDay() + 6) % 7
}

function openFromWeek(week: WeekHours): boolean {
  const today = week[WEEK_DAYS[todayIndex()]]
  if (today.closed) return false
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return today.close > today.open
    ? hhmm >= today.open && hhmm < today.close
    : hhmm >= today.open || hhmm < today.close
}

function hourLines(text: string[] | undefined, todayIndex: number): HourLine[] {
  if (!text?.length) return []
  return text.map((line, index) => {
    const split = line.indexOf(':')
    if (split < 0) return { label: line.trim(), hours: '', today: index === todayIndex }
    return {
      label: line.slice(0, split).trim(),
      hours: line.slice(split + 1).trim(),
      today: index === todayIndex,
    }
  }).filter((row) => row.label || row.hours)
}

function buildFromFallback(place: Place, mapsUrl: string): PlaceData {
  return {
    name: place.name,
    rating: place.rating,
    priceSymbol: priceLabel(place.price_level),
    photoUrls: photoList(place),
    address: place.address || undefined,
    todayHours: place.hours || undefined,
    summary: place.summary || undefined,
    website: place.website || undefined,
    phone: place.phone || undefined,
    mapsUri: place.maps_url || mapsUrl,
    isOpen: place.open_now ?? (place.hours_week ? openFromWeek(place.hours_week) : null),
  }
}

function WeekSchedule({ week }: { week: WeekHours }) {
  const { t } = useI18n()
  const today = todayIndex()
  return (
    <div className="mt-3 flex items-start gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
      <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {WEEK_DAYS.map((day, i) => {
          const slot = week[day]
          const current = i === today
          return (
            <div key={day} className={`contents ${current ? 'font-semibold text-[var(--text-primary)]' : ''}`}>
              <dt>{t(`biz.days.${day}`)}</dt>
              <dd className="tabular-nums">{slot.closed ? t('biz.hours.closed') : `${slot.open} – ${slot.close}`}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

export function PlaceDetailsPanel({
  placeId,
  fallbackName,
  fallbackMapsUrl,
  fallbackPlace,
  userLocation,
  onClose,
  onShare,
  onViewInApp,
  preview = false,
  onWalk,
  onDrive,
  onSave,
  onRate,
  saved = false,
  distance,
  duration,
}: Props) {
  const { t, lang } = useI18n()
  const [lbOpen, setLbOpen] = useState(false)
  const [lbIndex, setLbIndex] = useState(0)
  const [recommended, setRecommended] = useState<Recommended[]>([])
  const [recommendedBy, setRecommendedBy] = useState(0)
  const [listing, setListing] = useState<Place | null>(null)

  useEffect(() => {
    if (preview || !/^[A-Za-z0-9][A-Za-z0-9_:-]{1,120}$/.test(placeId)) return
    trackPlace(placeId, 'view', 'map')
  }, [placeId, preview])

  useEffect(() => {
    setListing(null)
    if (!placeId.startsWith('user_')) return
    let cancelled = false
    void fetch(`/api/places/public?placeId=${encodeURIComponent(placeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { place?: Place | null; recommends?: Recommended[]; recommendedBy?: number } | null) => {
        if (cancelled) return
        if (data?.place) setListing(data.place)
        if (!preview && Array.isArray(data?.recommends)) setRecommended(data.recommends)
        if (typeof data?.recommendedBy === 'number') setRecommendedBy(data.recommendedBy)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [placeId, preview])

  useEffect(() => {
    if (!preview || !fallbackPlace?.recommends?.length) return
    const ids = fallbackPlace.recommends
    void fetch('/api/places', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { places?: Recommended[] } | null) => {
        const rows = (data?.places ?? []).filter((row) => ids.includes(row.place_id))
        setRecommended(ids.map((id) => rows.find((row) => row.place_id === id)).filter((row): row is Recommended => !!row))
      })
      .catch(() => {})
  }, [preview, fallbackPlace?.recommends])

  const openLightbox = useCallback((index: number) => {
    setLbIndex(index)
    setLbOpen(true)
  }, [])

  const closeLightbox = useCallback(() => setLbOpen(false), [])

  const place = useMemo<Place | null>(
    () => (listing ? ({ ...fallbackPlace, ...listing } as Place) : fallbackPlace ?? null),
    [listing, fallbackPlace],
  )

  const [data, setData] = useState<PlaceData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [gallery, setGallery] = useState(0)
  const [rateOpen, setRateOpen] = useState(false)

  const lbPrev = useCallback(() => {
    setLbIndex((i) => (i === 0 ? (data?.photoUrls.length ?? 1) - 1 : i - 1))
  }, [data?.photoUrls.length])

  const lbNext = useCallback(() => {
    setLbIndex((i) => ((i + 1) % (data?.photoUrls.length ?? 1)))
  }, [data?.photoUrls.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (lbOpen) closeLightbox()
        else { setDetailsExpandedPref(false); onClose() }
        return
      }
      if (!lbOpen) return
      if (e.key === 'ArrowLeft') lbPrev()
      else if (e.key === 'ArrowRight') lbNext()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lbOpen, closeLightbox, lbPrev, lbNext, onClose])

  const hide = useCallback(() => {
    setDetailsExpandedPref(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    setDetailsExpandedPref(true)
    const timer = window.setTimeout(() => notifyMapChrome(), 80)
    return () => {
      window.clearTimeout(timer)
      notifyMapChrome()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const community = isCommunityPlaceId(placeId) || place?.source === 'community'

    async function load() {
      setStatus('loading')
      setLoadError(null)
      setGallery(0)
      const base: PlaceData = place
        ? buildFromFallback(place, fallbackMapsUrl)
        : { name: fallbackName, photoUrls: [], mapsUri: fallbackMapsUrl }
      if (community) {
        if (!cancelled) {
          setData(base)
          setStatus('ok')
        }
        return
      }
      try {
        const res = await fetch(`/api/places/details?placeId=${encodeURIComponent(placeId)}`)
        const json = await res.json().catch(() => null) as DetailsApi | null
        if (cancelled) return
        if (!res.ok || !json) {
          setLoadError(json?.error || t('placeCard.detailsError'))
          setData(base)
          setStatus('error')
          return
        }
        const lines = hourLines(json.weekdayText, json.todayIndex ?? new Date().getDay())
        const photos = (json.photos ?? []).slice(0, 5)
        setData({
          name: filled(json.name) ?? base.name,
          rating: json.rating ?? base.rating ?? undefined,
          ratingCount: json.ratingCount ?? base.ratingCount ?? undefined,
          priceSymbol: json.price ?? base.priceSymbol ?? undefined,
          photoUrls: photos.length ? photos : base.photoUrls.slice(0, 5),
          address: filled(json.address) ?? base.address,
          todayHours: lines.find((line) => line.today)?.hours || base.todayHours,
          weekday: lines,
          summary: filled(json.summary) ?? base.summary,
          website: filled(json.website) ?? base.website,
          phone: filled(json.phone) ?? base.phone,
          mapsUri: base.mapsUri ?? fallbackMapsUrl,
          isOpen: json.openNow ?? base.isOpen ?? null,
          access: json.accessibility ?? null,
        })
        setStatus('ok')
      } catch {
        if (!cancelled) {
          setLoadError(t('placeCard.detailsError'))
          setData(base)
          setStatus('error')
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [placeId, fallbackName, fallbackMapsUrl, place, attempt, t])

  const displayName = data?.name ?? fallbackName
  const categoryRaw = place?.categories?.[0]
  const categoryText = categoryRaw
    ? (() => {
        const key = categoryRaw.toLowerCase().replace(/\s+/g, '_')
        const translated = t(`categories.${key}`)
        return translated !== `categories.${key}` ? translated : categoryRaw.replace(/_/g, ' ')
      })()
    : null
  const walking =
    userLocation && place?.coordinates
      ? walkLine(userLocation, place.coordinates, lang)
      : null
  const mapsLink = !isCommunityPlaceId(placeId)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayName || fallbackName)}&query_place_id=${encodeURIComponent(placeId)}`
    : (data?.mapsUri || fallbackMapsUrl || null)

  return (
    <div className="pointer-events-none fixed inset-0 z-[250]" role="dialog" aria-modal="false" aria-label={displayName}>
      <div
        data-map-pad="details"
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[min(78dvh,720px)] w-full animate-fade-up flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--bg-header)] shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:h-full md:max-h-none md:w-[min(400px,92vw)] md:animate-slide-right md:rounded-none md:rounded-l-2xl"
      >
        <div className="relative h-44 shrink-0 overflow-hidden bg-gray-100 dark:bg-white/5" style={{ aspectRatio: '16 / 9', maxHeight: 176 }}>
          <div className="absolute inset-0 bg-gray-200 dark:bg-white/10" aria-hidden />
          {data?.photoUrls?.length ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.photoUrls[Math.min(gallery, data.photoUrls.length - 1)]}
                alt={displayName}
                className="absolute inset-0 h-full w-full cursor-zoom-in object-cover"
                loading="lazy"
                onClick={() => openLightbox(Math.min(gallery, data.photoUrls.length - 1))}
                onError={(event) => { event.currentTarget.style.display = 'none' }}
                onTouchStart={(event) => { (event.currentTarget as HTMLImageElement).dataset.x = String(event.changedTouches[0]?.clientX ?? 0) }}
                onTouchEnd={(event) => {
                  const start = Number((event.currentTarget as HTMLImageElement).dataset.x || 0)
                  const delta = (event.changedTouches[0]?.clientX ?? 0) - start
                  if (Math.abs(delta) < 40 || data.photoUrls.length < 2) return
                  setGallery((index) => (delta < 0 ? (index + 1) % data.photoUrls.length : (index + data.photoUrls.length - 1) % data.photoUrls.length))
                }}
              />
              {data.photoUrls.length > 1 && (
                <>
                  <button type="button" aria-label={t('placeCard.photo')} onClick={() => setGallery((index) => (index + data.photoUrls.length - 1) % data.photoUrls.length)} className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={t('placeCard.photo')} onClick={() => setGallery((index) => (index + 1) % data.photoUrls.length)} className="absolute right-12 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-4xl font-semibold text-amber-600/60">
                {displayName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={hide}
            title={t('placeCard.hideDetails')}
            aria-label={t('placeCard.close')}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        {data && data.photoUrls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-3 py-2 scrollbar-hide">
            {data.photoUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${url}-${i}`}
                src={url}
                alt={`${displayName} photo ${i + 1}`}
                className="h-14 w-20 shrink-0 cursor-zoom-in rounded-lg object-cover transition-opacity hover:opacity-80"
                loading="lazy"
                onClick={() => openLightbox(i)}
              />
            ))}
          </div>
        )}

        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          <h2 className="font-display text-xl font-semibold leading-tight text-[var(--text-primary)]">
            {displayName}
          </h2>

          <button type="button" onClick={hide} className="mt-2 text-[12px] font-medium text-[#E8672A]">
            {t('placeCard.hideDetails')}
          </button>
          {status === 'loading' && (
            <div className="mt-4 space-y-2" aria-busy="true">
              <p className="text-[12px] text-[var(--text-secondary)]">{t('placeCard.loading')}</p>
              <div className="h-3 w-2/3 animate-pulse rounded bg-black/10 motion-reduce:animate-none dark:bg-white/10" />
              <div className="h-3 w-full animate-pulse rounded bg-black/10 motion-reduce:animate-none dark:bg-white/10" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-black/10 motion-reduce:animate-none dark:bg-white/10" />
            </div>
          )}
          {status === 'error' && (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-[13px] text-[var(--text-primary)]">{loadError || t('placeCard.detailsError')}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-2 rounded-full bg-[#F56A00] px-3 py-1 text-[12px] font-medium text-white">
                {t('placeCard.retry')}
              </button>
            </div>
          )}

          {data && status !== 'loading' && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {categoryText && (
                  <span className="text-[12px] text-[var(--text-secondary)]">{categoryText}</span>
                )}
                {place && <PlaceBadges place={place} />}
                {place && <AccessConfirm place={place} />}
                <StillThere placeId={placeId} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {data.rating != null && (
                  <span className="inline-flex items-center gap-1 text-[13px] text-[var(--text-primary)]">
                    <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                    {data.rating.toFixed(1)}
                    {data.ratingCount != null && (
                      <span className="text-[var(--text-secondary)]">({data.ratingCount.toLocaleString()})</span>
                    )}
                  </span>
                )}
                {data.priceSymbol && (
                  <span className="text-[13px] font-medium text-green-600">{t('placeCard.price')} {data.priceSymbol}</span>
                )}
                {data.isOpen != null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      data.isOpen
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}
                  >
                    {data.isOpen ? t('placeCard.open') : t('placeCard.closed')}
                  </span>
                )}
              </div>

              {data.summary && (
                <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{data.summary}</p>
              )}

              {place?.hours_week ? (
                <WeekSchedule week={place.hours_week} />
              ) : data.weekday && data.weekday.length > 0 ? (
                <div className="mt-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
                    <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    {t('placeCard.hours')}
                  </p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--text-secondary)]">
                    {data.weekday.map((row) => (
                      <div key={row.label} className={`contents ${row.today ? 'font-semibold text-[var(--text-primary)]' : ''}`}>
                        <dt>{row.label}</dt>
                        <dd>{row.hours}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : data.todayHours ? (
                <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {data.todayHours}
                </p>
              ) : null}

              {data.access && (
                <ul className="mt-3 space-y-1 text-[12.5px] text-[var(--text-secondary)]">
                  {([
                    ['entrance', t('placeCard.stepFree')],
                    ['toilet', t('placeCard.accessibleToilet')],
                    ['parking', t('placeCard.accessibleParking')],
                    ['seating', t('placeCard.accessibleSeating')],
                  ] as const).map(([key, label]) => {
                    const value = data.access?.[key]
                    const state = value === true ? t('placeCard.yes') : value === false ? t('placeCard.no') : t('placeCard.notConfirmed')
                    return <li key={key}>{label}: {state}</li>
                  })}
                </ul>
              )}

              {data.address && (
                <div className="mt-3 flex items-start gap-2 text-[var(--text-secondary)]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="flex-1 text-[13px] leading-relaxed">{data.address}</span>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#E8672A]"
                    onClick={() => {
                      void navigator.clipboard?.writeText(data.address || '').then(() => {
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1600)
                      })
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {copied ? t('placeCard.copied') : t('placeCard.copyAddress')}
                  </button>
                </div>
              )}

              {(distance || duration || walking) && (
                <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">
                  {t('placeCard.fromYou')}
                  {distance || duration ? ` · ${[distance, duration].filter(Boolean).join(' · ')}` : walking ? ` · ${walking}` : ''}
                </p>
              )}

              {!!place?.tags?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {place.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {recommendedBy >= 2 && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#2E8B57]/10 px-2.5 py-1 text-[12px] font-medium text-[#1F6B43] dark:text-[#3DDC97]">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {t('placeCard.recommendedBy').replace('{n}', String(recommendedBy))}
                </p>
              )}
              {recommended.length > 0 && (
                <div className="mt-3 rounded-xl bg-[#FDE8DC]/60 px-3 py-2.5 dark:bg-[#E8672A]/10">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#E8672A]">
                    <HeartHandshake className="h-3.5 w-3.5" />
                    {t('placeCard.recommends')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recommended.map((row) =>
                      row.place_id.startsWith('user_') ? (
                        <a
                          key={row.place_id}
                          href={`/p/${encodeURIComponent(row.place_id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-white px-2.5 py-1 text-[12px] text-[var(--text-primary)] transition-colors hover:text-[#E8672A] dark:bg-white/10"
                        >
                          {row.name}
                        </a>
                      ) : (
                        <span key={row.place_id} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-[var(--text-primary)] dark:bg-white/10">
                          {row.name}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              )}

              {!data.summary && !data.address && data.rating == null && !data.todayHours && !place?.hours_week && !categoryText && !place?.local_business && !place?.accessible && !walking && (
                <p className="mt-3 text-[13px] text-[var(--text-secondary)]">
                  {t('placeCard.noDetails')}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                {onWalk && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'route', 'map'); onWalk?.() }} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F56A00] px-3 text-[12px] font-medium text-white">
                    <Footprints className="h-3.5 w-3.5" aria-hidden />
                    {t('placeCard.walkRoute')}
                  </button>
                )}
                {onDrive && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'route', 'map'); onDrive?.() }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-primary)]">
                    <Car className="h-3.5 w-3.5" aria-hidden />
                    {t('placeCard.driveRoute')}
                  </button>
                )}
                {mapsLink && (
                  <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-3 text-[12px] text-[var(--text-secondary)]">
                    {t('placeCard.openMaps')}
                  </a>
                )}
                {onSave && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'save', 'map'); onSave?.() }} className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-[12px] ${saved ? 'text-[#F56A00]' : 'text-[var(--text-secondary)]'}`}>
                    <Bookmark className={`h-3.5 w-3.5 ${saved ? 'fill-[#F56A00]' : ''}`} aria-hidden />
                    {saved ? t('placeCard.saved') : t('placeCard.save')}
                  </button>
                )}
                <button type="button" onClick={() => { onRate?.(); setRateOpen(true) }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-[12px] text-amber-700">
                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden />
                  {t('placeCard.rate')}
                </button>
                {rateOpen && (
                  <PlaceRatePopover
                    placeId={placeId}
                    onSaved={() => setRateOpen(false)}
                    onClose={() => setRateOpen(false)}
                  />
                )}
                <MapsChooser
                  place={{
                    ...(place ?? fallbackPlace ?? {
                      place_id: placeId,
                      name: data?.name || fallbackName,
                      address: '',
                      coordinates: { lat: 0, lng: 0 },
                      categories: [],
                    }),
                    maps_url: place?.maps_url || fallbackPlace?.maps_url || fallbackMapsUrl || mapsLink || undefined,
                  }}
                  onViewInApp={onViewInApp}
                  buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F56A00] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#e05a1a]"
                />
                {onShare && (
                  <button
                    type="button"
                    onClick={onShare}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-4 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {t('placeCard.share')}
                  </button>
                )}
                {data.website && (
                  <a
                    href={data.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackPlace(placeId, 'website', 'map')}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    {t('placeCard.website')}
                  </a>
                )}
                {data.phone && (
                  <a
                    href={`tel:${data.phone}`}
                    onClick={() => trackPlace(placeId, 'call', 'map')}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    {t('placeCard.phone')} {data.phone}
                  </a>
                )}
              </div>
              <PlaceReviews placeId={placeId} />
            </>
          )}
        </div>
      </div>
      {lbOpen && data?.photoUrls?.length ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
          className="fixed inset-0 z-[280] flex flex-col items-center justify-center bg-black/90"
          onClick={closeLightbox}
        >
          {/* Main image — stop propagation so clicking image doesn't close */}
          <div
            className="relative flex w-full flex-1 items-center justify-center overflow-hidden px-14"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.photoUrls[lbIndex]}
              alt={`${displayName} photo ${lbIndex + 1} of ${data.photoUrls.length}`}
              className="max-h-[70dvh] max-w-full object-contain motion-reduce:transition-none"
              draggable={false}
            />
          </div>

          {/* Counter */}
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[13px] font-medium text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {lbIndex + 1} / {data.photoUrls.length}
          </div>

          <button
            type="button"
            aria-label={t('placeCard.back')}
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute left-4 top-4 z-10 inline-flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3 text-[13px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
            {t('placeCard.back')}
          </button>

          {/* Close button */}
          <button
            type="button"
            aria-label={t('placeCard.close')}
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>

          {/* Prev arrow */}
          {data.photoUrls.length > 1 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); lbPrev() }}
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-[#F56A00] disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            </button>
          )}

          {/* Next arrow */}
          {data.photoUrls.length > 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); lbNext() }}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-[#F56A00] disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          )}

          {/* Thumbnail strip */}
          {data.photoUrls.length > 1 && (
            <div
              className="flex w-full gap-2 overflow-x-auto px-4 pb-4 pt-3 scrollbar-hide"
              onClick={(e) => e.stopPropagation()}
            >
              {data.photoUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`lb-thumb-${i}`}
                  src={url}
                  alt={`${displayName} photo ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); setLbIndex(i) }}
                  className={`h-14 w-20 shrink-0 cursor-pointer rounded-lg object-cover transition-opacity motion-reduce:transition-none ${
                    i === lbIndex
                      ? 'ring-2 ring-[#F56A00] opacity-100'
                      : 'opacity-50 hover:opacity-80'
                  }`}
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
