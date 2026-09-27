'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, ExternalLink, HeartHandshake, MapPin, Share2, Star, Tag, Users } from 'lucide-react'
import { AccessConfirm } from '@/components/AccessConfirm'
import { PlaceBadges } from '@/components/PlaceBadges'
import { StillThere } from '@/components/StillThere'
import { PlaceReviews } from '@/components/PlaceReviews'
import { useI18n } from '@/components/I18nProvider'
import type { Place } from '@/lib/types'
import { WEEK_DAYS, type WeekHours } from '@/lib/hours'

const PLACES_NEW_ENABLED = process.env.NEXT_PUBLIC_PLACES_API_NEW === '1'

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
  /** Owner preview from the dashboard: no view is counted. */
  preview?: boolean
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

function summaryText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'text' in value) {
    const t = (value as { text?: string }).text
    return typeof t === 'string' ? t : undefined
  }
  return undefined
}

function isCommunityPlaceId(placeId: string): boolean {
  return placeId.startsWith('user_') || placeId.startsWith('pin:') || placeId.startsWith('__')
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

async function fetchPlaceDetailsApi(placeId: string): Promise<Partial<PlaceData> | null> {
  try {
    const res = await fetch(`/api/place-photos?placeId=${encodeURIComponent(placeId)}`)
    if (!res.ok) return null
    const data = await res.json()
    const hours = data.opening_hours?.weekday_text as string[] | undefined
    const todayIdx = (new Date().getDay() + 6) % 7
    return {
      name: data.name,
      rating: data.rating,
      ratingCount: typeof data.ratingCount === 'number' ? data.ratingCount : undefined,
      priceSymbol: priceLabel(data.priceLevel ?? data.price_level),
      photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
      address: data.address ?? data.formatted_address,
      todayHours: hours?.[todayIdx],
      mapsUri: data.maps_url,
      website: typeof data.website === 'string' ? data.website : undefined,
      isOpen: data.isOpen ?? data.opening_hours?.open_now ?? null,
    }
  } catch {
    return null
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
  preview = false,
}: Props) {
  const { t, lang } = useI18n()
  const [lbOpen, setLbOpen] = useState(false)
  const [lbIndex, setLbIndex] = useState(0)
  const [recommended, setRecommended] = useState<Recommended[]>([])
  const [recommendedBy, setRecommendedBy] = useState(0)
  const [listing, setListing] = useState<Place | null>(null)

  useEffect(() => {
    setListing(null)
    if (!placeId.startsWith('user_')) return
    let cancelled = false
    if (!preview) {
      void fetch('/api/places/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, source: 'app' }),
      }).catch(() => {})
    }
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

  const initial = useMemo(
    () => (place ? buildFromFallback(place, fallbackMapsUrl) : null),
    [place, fallbackMapsUrl],
  )
  const [data, setData] = useState<PlaceData | null>(initial)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>(initial ? 'ok' : 'loading')

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
        else onClose()
        return
      }
      if (!lbOpen) return
      if (e.key === 'ArrowLeft') lbPrev()
      else if (e.key === 'ArrowRight') lbNext()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lbOpen, closeLightbox, lbPrev, lbNext, onClose])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      const base: PlaceData = place
        ? buildFromFallback(place, fallbackMapsUrl)
        : { name: fallbackName, photoUrls: [], mapsUri: fallbackMapsUrl }
      if (!place) setStatus('loading')

      const community = isCommunityPlaceId(placeId) || place?.source === 'community'
      const api = community ? null : await fetchPlaceDetailsApi(placeId)
      if (cancelled) return

      const merged: PlaceData = {
        name: filled(api?.name) ?? base.name ?? fallbackName,
        rating: api?.rating ?? base.rating,
        ratingCount: api?.ratingCount ?? base.ratingCount,
        priceSymbol: api?.priceSymbol ?? base.priceSymbol,
        photoUrls: api?.photoUrls?.length ? api.photoUrls : base.photoUrls,
        address: filled(api?.address) ?? base.address,
        todayHours: filled(api?.todayHours) ?? base.todayHours,
        summary: filled(base.summary) ?? filled(api?.summary),
        website: filled(api?.website) ?? base.website,
        phone: base.phone,
        mapsUri: filled(api?.mapsUri) ?? base.mapsUri ?? fallbackMapsUrl,
        isOpen: api?.isOpen ?? base.isOpen ?? null,
      }

      if (!community && PLACES_NEW_ENABLED && typeof google !== 'undefined' && google.maps?.importLibrary) {
        try {
          await google.maps.importLibrary('places')
          const place = new google.maps.places.Place({ id: placeId })
          await place.fetchFields({
            fields: [
              'displayName', 'rating', 'userRatingCount', 'priceLevel', 'photos',
              'formattedAddress', 'regularOpeningHours', 'websiteURI',
              'googleMapsURI', 'nationalPhoneNumber', 'editorialSummary',
            ],
          })
          if (!cancelled) {
            const hours = place.regularOpeningHours
            const todayIdx = (new Date().getDay() + 6) % 7
            merged.name = place.displayName ?? merged.name
            merged.rating = place.rating ?? merged.rating
            merged.ratingCount = place.userRatingCount ?? undefined
            merged.priceSymbol = place.priceLevel ? priceLabel(place.priceLevel) : merged.priceSymbol
            if (merged.photoUrls.length === 0 && place.photos?.length) {
              merged.photoUrls = place.photos
                .map((p) => {
                  try {
                    const uri = p.getURI({ maxWidth: 720, maxHeight: 420 })
                    return `/api/place-photo?url=${encodeURIComponent(uri)}`
                  } catch {
                    return null
                  }
                })
                .filter((u): u is string => !!u)
            }
            merged.address = place.formattedAddress ?? merged.address
            merged.todayHours = hours?.weekdayDescriptions?.[todayIdx] ?? merged.todayHours
            merged.summary = summaryText(place.editorialSummary) ?? merged.summary
            merged.website = place.websiteURI ?? merged.website
            merged.phone = place.nationalPhoneNumber ?? merged.phone
            merged.mapsUri = place.googleMapsURI ?? merged.mapsUri
          }
        } catch {
          /* keep merged API + fallback data */
        }
      }

      if (!community && merged.photoUrls.length === 0 && fallbackName.trim()) {
        try {
          const res = await fetch(`/api/place-photos?q=${encodeURIComponent(fallbackName)}`)
          if (res.ok) {
            const named = await res.json() as { photoUrls?: string[]; rating?: number; address?: string }
            if (Array.isArray(named.photoUrls) && named.photoUrls.length) merged.photoUrls = named.photoUrls
            if (merged.rating == null && typeof named.rating === 'number') merged.rating = named.rating
            if (!filled(merged.address) && typeof named.address === 'string') merged.address = named.address
          }
        } catch {
          /* keep the fields already on the place */
        }
      }

      if (!cancelled) {
        setData(merged)
        setStatus('ok')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [placeId, fallbackName, fallbackMapsUrl, place])

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
  const mapsLink =
    data?.mapsUri ??
    fallbackMapsUrl ??
    (placeId && !placeId.startsWith('__')
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackName)}&query_place_id=${encodeURIComponent(placeId)}`
      : null)

  return (
    <div className="fixed inset-0 z-[250] flex items-end justify-center animate-fade-up p-0 md:items-center md:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Phone: full-width bottom sheet; md+: centered modal card. */}
      <div className="relative flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--bg-header)] shadow-2xl md:rounded-2xl">
        <div className="relative h-44 shrink-0 overflow-hidden bg-gradient-to-br from-amber-50 to-[#ffffff] dark:from-amber-950/40 dark:to-slate-900">
          {data?.photoUrls?.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.photoUrls[0]}
              alt={displayName}
              className="h-full w-full cursor-zoom-in object-cover"
              loading="lazy"
              onClick={() => openLightbox(0)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-4xl font-semibold text-amber-600/60">
                {displayName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close"
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

        <div className="scrollbar-hide overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
          <h2 className="font-display text-xl font-semibold leading-tight text-[var(--text-primary)]">
            {displayName}
          </h2>

          {status === 'loading' && (
            <div className="mt-4 flex items-center gap-2.5">
              <div className="thinking-ring" />
              <span className="text-[11px] tracking-wide text-[var(--text-secondary)]">Loading details…</span>
            </div>
          )}

          {data && (status === 'ok' || place) && (
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
                  <span className="text-[13px] font-medium text-green-600">{data.priceSymbol}</span>
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
              ) : data.todayHours && (
                <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {data.todayHours}
                </p>
              )}

              {data.address && (
                <div className="mt-3 flex items-start gap-2 text-[var(--text-secondary)]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="text-[13px] leading-relaxed">{data.address}</span>
                </div>
              )}

              {walking && (
                <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">
                  {walking} {t('placeCard.walk')}
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
                {mapsLink && (
                  <a
                    href={mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F56A00] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#e05a1a]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('placeCard.openMaps')}
                  </a>
                )}
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
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    Website
                  </a>
                )}
                {data.phone && (
                  <a
                    href={`tel:${data.phone}`}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    {data.phone}
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
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90"
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
