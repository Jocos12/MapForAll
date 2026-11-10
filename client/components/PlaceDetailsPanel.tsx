'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, Car, Check, ChevronLeft, ChevronRight, Clock, Copy, Footprints, Globe, HeartHandshake, Map as MapIcon, MapPin, Navigation, Phone, Share2, Star, Tag, Users, X } from 'lucide-react'
import { MapsChooser } from '@/components/MapsChooser'
import { AccessConfirm } from '@/components/AccessConfirm'
import { PlaceBadges } from '@/components/PlaceBadges'
import { StillThere } from '@/components/StillThere'
import { PlaceRatePopover, PlaceReviews } from '@/components/PlaceReviews'
import { useI18n } from '@/components/I18nProvider'
import type { Place } from '@/lib/types'
import { placePhotoError } from './PlaceImage'
import { placePhotoList } from '@/lib/placePhoto'
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
  return placePhotoList(place, 800)
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
    <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[14px]">
      {WEEK_DAYS.map((day, i) => {
        const slot = week[day]
        const current = i === today
        return (
          <div key={day} className={`contents ${current ? 'font-semibold text-[var(--ios-label)]' : 'text-[var(--ios-label-2)]'}`}>
            <dt>{t(`biz.days.${day}`)}</dt>
            <dd className={`text-right tabular-nums ${slot.closed ? 'text-[var(--ios-red)]' : ''}`}>{slot.closed ? t('biz.hours.closed') : `${slot.open} – ${slot.close}`}</dd>
          </div>
        )
      })}
    </dl>
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

  const tr = (fr: string, en: string) => (lang === 'en' ? en : fr)
  const photoCount = data?.photoUrls?.length ?? 0
  const photoIndex = Math.min(gallery, Math.max(0, photoCount - 1))
  const statusLine = [
    categoryText,
    data?.rating != null ? `★ ${data.rating.toFixed(1)}${data.ratingCount != null ? ` (${data.ratingCount.toLocaleString()})` : ''}` : null,
    data?.priceSymbol || null,
  ].filter(Boolean) as string[]
  const fromYou = distance || duration ? [distance, duration].filter(Boolean).join(' · ') : walking

  const actionBtn =
    'flex h-[62px] flex-1 flex-col items-center justify-center gap-1 rounded-[16px] bg-[var(--ios-fill)] text-[12px] font-semibold tracking-[-0.01em] text-[var(--ios-tint)] transition-transform active:scale-95'
  const rowLabel = 'text-[13px] font-semibold uppercase tracking-[0.02em] text-[var(--ios-label-2)]'

  return (
    <div className="ios-chat pointer-events-none fixed inset-0 z-[250] ![background:transparent]" role="dialog" aria-modal="false" aria-label={displayName}>
      <div
        data-map-pad="details"
        className="ios-glass-strong ios-sheet-in pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[min(86dvh,760px)] w-full flex-col overflow-hidden rounded-t-[30px] md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[400px] md:rounded-[30px]"
      >
        {/* Grabber (phones) */}
        <div className="flex justify-center pb-1 pt-2 md:hidden" aria-hidden>
          <span className="h-[5px] w-9 rounded-full bg-[var(--ios-label-3)]" />
        </div>

        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          {/* Hero photo */}
          <div className="relative mx-3 mt-1 overflow-hidden rounded-[22px] bg-[var(--ios-fill)] md:mt-3" style={{ height: 210 }}>
            {photoCount ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data!.photoUrls[photoIndex]}
                  alt={displayName}
                  className="absolute inset-0 h-full w-full cursor-zoom-in object-cover"
                  loading="lazy"
                  onClick={() => openLightbox(photoIndex)}
                  onError={placePhotoError}
                  onTouchStart={(event) => { (event.currentTarget as HTMLImageElement).dataset.x = String(event.changedTouches[0]?.clientX ?? 0) }}
                  onTouchEnd={(event) => {
                    const start = Number((event.currentTarget as HTMLImageElement).dataset.x || 0)
                    const delta = (event.changedTouches[0]?.clientX ?? 0) - start
                    if (Math.abs(delta) < 40 || photoCount < 2) return
                    setGallery((index) => (delta < 0 ? (index + 1) % photoCount : (index + photoCount - 1) % photoCount))
                  }}
                />
                {photoCount > 1 && (
                  <>
                    <button type="button" aria-label={t('placeCard.photo')} onClick={() => setGallery((index) => (index + photoCount - 1) % photoCount)} className="absolute left-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={t('placeCard.photo')} onClick={() => setGallery((index) => (index + 1) % photoCount)} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
                      {data!.photoUrls.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          aria-label={`Photo ${i + 1}`}
                          onClick={() => setGallery(i)}
                          className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/60'}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#FFB070] to-[#FF6A00]">
                <span className="text-[44px] font-bold tracking-[-0.03em] text-white/90">
                  {displayName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={hide}
              title={t('placeCard.hideDetails')}
              aria-label={t('placeCard.close')}
              className="ios-glass-strong absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--ios-label)] active:scale-90"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
          </div>

          {photoCount > 1 && (
            <div className="scrollbar-hide mt-2 flex gap-2 overflow-x-auto px-3">
              {data!.photoUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`${displayName} photo ${i + 1}`}
                  className={`h-14 w-14 shrink-0 cursor-pointer rounded-[12px] object-cover transition-opacity ${i === photoIndex ? 'ring-2 ring-[var(--ios-tint)]' : 'opacity-70 hover:opacity-100'}`}
                  loading="lazy"
                  onError={placePhotoError}
                  onClick={() => setGallery(i)}
                  onDoubleClick={() => openLightbox(i)}
                />
              ))}
            </div>
          )}

          <div className="px-5 pt-4">
            {/* Title */}
            <h2 className="text-[26px] font-bold leading-[31px] tracking-[-0.025em] text-[var(--ios-label)]">{displayName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[15px] text-[var(--ios-label-2)]">
              {statusLine.map((part, i) => (
                <span key={part} className="capitalize">{i > 0 && <span className="mr-1.5">·</span>}{part}</span>
              ))}
              {data?.isOpen != null && (
                <span className={`font-semibold ${data.isOpen ? 'text-[var(--ios-green)]' : 'text-[var(--ios-red)]'}`}>
                  {statusLine.length > 0 && <span className="mr-1.5 font-normal text-[var(--ios-label-2)]">·</span>}
                  {data.isOpen ? t('placeCard.open') : t('placeCard.closed')}
                </span>
              )}
            </div>

            {status === 'loading' && (
              <div className="mt-5 space-y-2.5" aria-busy="true">
                <div className="h-[62px] animate-pulse rounded-[16px] bg-[var(--ios-fill)] motion-reduce:animate-none" />
                <div className="h-24 animate-pulse rounded-[18px] bg-[var(--ios-fill)] motion-reduce:animate-none" />
                <p className="text-center text-[13px] text-[var(--ios-label-2)]">{t('placeCard.loading')}</p>
              </div>
            )}
            {status === 'error' && (
              <div className="mt-4 rounded-[18px] bg-[color-mix(in_srgb,var(--ios-red)_12%,transparent)] p-3.5">
                <p className="text-[14px] text-[var(--ios-label)]">{loadError || t('placeCard.detailsError')}</p>
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ios-btn-tint mt-2.5 h-8 px-4 text-[13px]">
                  {t('placeCard.retry')}
                </button>
              </div>
            )}
          </div>

          {data && status !== 'loading' && (
            <div className="px-4">
              {/* Primary actions — iOS Maps style */}
              <div className="mt-4 flex gap-2">
                {onWalk && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'route', 'map'); onWalk?.() }} className={`${actionBtn} !bg-[var(--ios-tint)] !text-white`}>
                    <Footprints className="h-5 w-5" aria-hidden />
                    {tr('À pied', 'Walk')}
                  </button>
                )}
                {onDrive && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'route', 'map'); onDrive?.() }} className={actionBtn}>
                    <Car className="h-5 w-5" aria-hidden />
                    {tr('Voiture', 'Drive')}
                  </button>
                )}
                {onSave && (
                  <button type="button" onClick={() => { trackPlace(placeId, 'save', 'map'); onSave?.() }} className={actionBtn} aria-pressed={saved}>
                    <Bookmark className={`h-5 w-5 ${saved ? 'fill-current' : ''}`} aria-hidden />
                    {saved ? tr('Enregistré', 'Saved') : tr('Enregistrer', 'Save')}
                  </button>
                )}
                {onShare ? (
                  <button type="button" onClick={onShare} className={actionBtn}>
                    <Share2 className="h-5 w-5" aria-hidden />
                    {t('placeCard.share')}
                  </button>
                ) : (
                  <button type="button" onClick={() => { onRate?.(); setRateOpen(true) }} className={actionBtn}>
                    <Star className="h-5 w-5" aria-hidden />
                    {tr('Noter', 'Rate')}
                  </button>
                )}
              </div>
              {rateOpen && (
                <div className="relative">
                  <PlaceRatePopover placeId={placeId} onSaved={() => setRateOpen(false)} onClose={() => setRateOpen(false)} />
                </div>
              )}

              {/* Badges & community checks */}
              {place && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <PlaceBadges place={place} />
                </div>
              )}

              {data.summary && (
                <p className="mt-4 px-1 text-[16px] leading-[23px] tracking-[-0.015em] text-[var(--ios-label)]">{data.summary}</p>
              )}

              {/* Info group */}
              {(place?.hours_week || data.weekday?.length || data.todayHours || data.address || fromYou || data.phone || data.website) && (
                <section className="mt-5">
                  <p className={`mb-1.5 px-1 ${rowLabel}`}>{tr('Informations', 'Details')}</p>
                  <div className="divide-y divide-[var(--ios-separator)] overflow-hidden rounded-[18px] bg-[var(--ios-bg-elevated)]">
                    {(place?.hours_week || data.weekday?.length || data.todayHours) && (
                      <div className="px-4 py-3">
                        <p className="mb-1.5 flex items-center gap-2 text-[15px] font-semibold text-[var(--ios-label)]">
                          <Clock className="h-4 w-4 text-[var(--ios-tint)]" aria-hidden />
                          {t('placeCard.hours')}
                        </p>
                        {place?.hours_week ? (
                          <WeekSchedule week={place.hours_week} />
                        ) : data.weekday?.length ? (
                          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[14px]">
                            {data.weekday.map((row) => (
                              <div key={row.label} className={`contents ${row.today ? 'font-semibold text-[var(--ios-label)]' : 'text-[var(--ios-label-2)]'}`}>
                                <dt className="capitalize">{row.label}</dt>
                                <dd className="text-right tabular-nums">{row.hours}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="text-[14px] text-[var(--ios-label-2)]">{data.todayHours}</p>
                        )}
                      </div>
                    )}
                    {data.address && (
                      <div className="flex items-start gap-3 px-4 py-3">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ios-tint)]" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-[var(--ios-label-2)]">{tr('Adresse', 'Address')}</p>
                          <p className="text-[15px] leading-[20px] text-[var(--ios-label)]">{data.address}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={t('placeCard.copyAddress')}
                          title={copied ? t('placeCard.copied') : t('placeCard.copyAddress')}
                          className="ios-icon-btn h-8 w-8 shrink-0 text-[var(--ios-tint)]"
                          onClick={() => {
                            void navigator.clipboard?.writeText(data.address || '').then(() => {
                              setCopied(true)
                              window.setTimeout(() => setCopied(false), 1600)
                            })
                          }}
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    )}
                    {fromYou && (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <Navigation className="h-4 w-4 shrink-0 text-[var(--ios-blue)]" aria-hidden />
                        <p className="flex-1 text-[15px] text-[var(--ios-label)]">{t('placeCard.fromYou')}</p>
                        <p className="text-[15px] text-[var(--ios-label-2)]">{fromYou}</p>
                      </div>
                    )}
                    {data.phone && (
                      <a href={`tel:${data.phone}`} onClick={() => trackPlace(placeId, 'call', 'map')} className="flex items-center gap-3 px-4 py-3">
                        <Phone className="h-4 w-4 shrink-0 text-[var(--ios-green)]" aria-hidden />
                        <span className="flex-1 text-[15px] text-[var(--ios-label)]">{t('placeCard.phone')}</span>
                        <span className="text-[15px] text-[var(--ios-tint)]">{data.phone}</span>
                      </a>
                    )}
                    {data.website && (
                      <a href={data.website} target="_blank" rel="noopener noreferrer" onClick={() => trackPlace(placeId, 'website', 'map')} className="flex items-center gap-3 px-4 py-3">
                        <Globe className="h-4 w-4 shrink-0 text-[var(--ios-blue)]" aria-hidden />
                        <span className="flex-1 text-[15px] text-[var(--ios-label)]">{t('placeCard.website')}</span>
                        <ChevronRight className="h-4 w-4 text-[var(--ios-label-3)]" />
                      </a>
                    )}
                  </div>
                </section>
              )}

              {/* Accessibility group */}
              {(data.access || place) && (
                <section className="mt-5">
                  <p className={`mb-1.5 px-1 ${rowLabel}`}>{tr('Accessibilité', 'Accessibility')}</p>
                  <div className="overflow-hidden rounded-[18px] bg-[var(--ios-bg-elevated)]">
                    {data.access && (
                      <ul className="divide-y divide-[var(--ios-separator)]">
                        {([
                          ['entrance', t('placeCard.stepFree')],
                          ['toilet', t('placeCard.accessibleToilet')],
                          ['parking', t('placeCard.accessibleParking')],
                          ['seating', t('placeCard.accessibleSeating')],
                        ] as const).map(([key, label]) => {
                          const value = data.access?.[key]
                          return (
                            <li key={key} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                              <span className="flex-1 text-[var(--ios-label)]">{label}</span>
                              <span className={value === true ? 'font-semibold text-[var(--ios-green)]' : value === false ? 'text-[var(--ios-red)]' : 'text-[var(--ios-label-3)]'}>
                                {value === true ? t('placeCard.yes') : value === false ? t('placeCard.no') : t('placeCard.notConfirmed')}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {place && (
                      <div className={`flex flex-wrap items-center gap-2 px-4 py-3 ${data.access ? 'border-t border-[var(--ios-separator)]' : ''}`}>
                        <AccessConfirm place={place} />
                        <StillThere placeId={placeId} />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {!!place?.tags?.length && (
                <div className="mt-4 flex flex-wrap gap-1.5 px-1">
                  {place.tags.map((tag) => (
                    <span key={tag} className="ios-pill h-7 !px-2.5 text-[13px]">
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {recommendedBy >= 2 && (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--ios-green)_14%,transparent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ios-green)]">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {t('placeCard.recommendedBy').replace('{n}', String(recommendedBy))}
                </p>
              )}
              {recommended.length > 0 && (
                <section className="mt-5">
                  <p className={`mb-1.5 flex items-center gap-1.5 px-1 ${rowLabel}`}>
                    <HeartHandshake className="h-3.5 w-3.5" />
                    {t('placeCard.recommends')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recommended.map((row) =>
                      row.place_id.startsWith('user_') ? (
                        <a key={row.place_id} href={`/p/${encodeURIComponent(row.place_id)}`} target="_blank" rel="noopener noreferrer" className="ios-pill h-8 text-[13px]">
                          {row.name}
                        </a>
                      ) : (
                        <span key={row.place_id} className="ios-pill h-8 text-[13px]">{row.name}</span>
                      ),
                    )}
                  </div>
                </section>
              )}

              {!data.summary && !data.address && data.rating == null && !data.todayHours && !place?.hours_week && !categoryText && !place?.local_business && !place?.accessible && !walking && (
                <p className="mt-4 px-1 text-[14px] text-[var(--ios-label-2)]">{t('placeCard.noDetails')}</p>
              )}

              {/* Secondary actions */}
              <div className="mt-5 overflow-hidden rounded-[18px] bg-[var(--ios-bg-elevated)]">
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <MapIcon className="h-4 w-4 shrink-0 text-[var(--ios-tint)]" aria-hidden />
                  <span className="flex-1 text-[15px] text-[var(--ios-label)]">{tr('Ouvrir dans une app de cartes', 'Open in a maps app')}</span>
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
                    buttonClassName="ios-pill h-8 !px-3 text-[13px]"
                  />
                </div>
                {onShare && (
                  <button type="button" onClick={() => { onRate?.(); setRateOpen(true) }} className="flex w-full items-center gap-3 border-t border-[var(--ios-separator)] px-4 py-3 text-left">
                    <Star className="h-4 w-4 shrink-0 fill-[#FF9F0A] text-[#FF9F0A]" aria-hidden />
                    <span className="flex-1 text-[15px] text-[var(--ios-label)]">{t('placeCard.rate')}</span>
                    <ChevronRight className="h-4 w-4 text-[var(--ios-label-3)]" />
                  </button>
                )}
              </div>

              <div className="mt-5 px-1">
                <PlaceReviews placeId={placeId} />
              </div>
            </div>
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
              onError={placePhotoError}
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
                  onError={placePhotoError}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
