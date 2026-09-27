'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Clock, HeartHandshake, Map as MapIcon, MapPin, Navigation, Phone, Tag, Users } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { CategoryIcon } from '@/components/CategoryIcon'
import { PlaceBadges } from '@/components/PlaceBadges'
import { PlaceReviews } from '@/components/PlaceReviews'
import { StillThere } from '@/components/StillThere'
import type { Place } from '@/lib/types'

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; place: Place; recommends: Place[]; recommendedBy: number }

export default function PublicPlacePage() {
  const { t } = useI18n()
  const params = useParams<{ id: string }>()
  const placeId = decodeURIComponent(params?.id ?? '')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [photo, setPhoto] = useState(0)

  useEffect(() => {
    if (!placeId) return
    let cancelled = false
    void fetch(`/api/places/public?placeId=${encodeURIComponent(placeId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !data.place) setState({ status: 'missing' })
        else setState({ status: 'ok', place: data.place, recommends: data.recommends ?? [], recommendedBy: data.recommendedBy ?? 0 })
      })
      .catch(() => !cancelled && setState({ status: 'missing' }))
    void fetch('/api/places/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId, source: 'link' }),
    }).catch(() => {})
    return () => { cancelled = true }
  }, [placeId])

  const shell = 'h-dvh overflow-y-auto bg-[#FBF3E7] text-[#1A1614] dark:bg-[#141210] dark:text-gray-50'
  const brand = (
    <Link href="/" className="inline-flex items-center gap-1.5 text-[#E8672A]">
      <MapPin size={18} />
      <span className="font-display text-[17px] font-semibold">MapForAll</span>
      <span className="text-[12px] text-[#6E5B50]">· Ikarita ya Bose</span>
    </Link>
  )

  if (state.status !== 'ok') {
    return (
      <main className={`${shell} flex flex-col items-center justify-center gap-4 px-6 text-center`}>
        {brand}
        {state.status === 'loading' ? (
          <div className="thinking-ring" />
        ) : (
          <>
            <p className="font-display text-2xl font-semibold">{t('biz.public.missing')}</p>
            <p className="max-w-sm text-[14px] text-[#6E5B50]">{t('biz.public.missingHint')}</p>
            <a href="/chat" className="rounded-full bg-[#E8672A] px-5 py-2.5 text-[14px] font-medium text-white">{t('biz.public.openMap')}</a>
          </>
        )}
      </main>
    )
  }

  const { place, recommends, recommendedBy } = state
  const photos = [place.photo_url, ...(place.photos ?? [])].filter((url): url is string => !!url)
  const category = place.categories?.[0]
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${place.coordinates.lat},${place.coordinates.lng}`

  return (
    <main className={shell}>
      <div className="mx-auto w-full max-w-xl px-4 pb-12 pt-5">
        <header className="mb-4">{brand}</header>
        <article className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#1C1916]">
          {photos.length ? (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[photo] ?? photos[0]} alt={place.name} className="h-60 w-full object-cover" />
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto px-4 pt-3">
                  {photos.map((url, i) => (
                    <button key={url} type="button" onClick={() => setPhoto(i)} className={`shrink-0 overflow-hidden rounded-lg ring-2 ${i === photo ? 'ring-[#E8672A]' : 'ring-transparent'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-14 w-20 object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center bg-[#F4F0E6] text-[#6B5E4E]">
              <CategoryIcon categories={place.categories} className="h-10 w-10" />
            </div>
          )}
          <div className="p-5">
            <h1 className="font-display text-2xl font-semibold leading-tight">{place.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {category && <span className="text-[13px] text-[#6E5B50]">{t(`categories.${category}`)}</span>}
              <PlaceBadges place={place} />
              <StillThere placeId={place.place_id} />
            </div>
            {place.summary && place.summary !== place.name && (
              <p className="mt-3 text-[14.5px] leading-relaxed text-[#3D342E] dark:text-gray-300">{place.summary}</p>
            )}
            <div className="mt-4 flex flex-col gap-2 text-[13.5px]">
              {place.hours && <p className="flex items-start gap-2"><Clock size={15} className="mt-0.5 shrink-0 text-[#E8672A]" />{place.hours}</p>}
              {place.address && <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-[#E8672A]" />{place.address}</p>}
              {place.phone && (
                <a href={`tel:${place.phone}`} className="flex items-start gap-2 hover:text-[#E8672A]"><Phone size={15} className="mt-0.5 shrink-0 text-[#E8672A]" />{place.phone}</a>
              )}
            </div>
            {!!place.tags?.length && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {place.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-0.5 text-[12px] text-[#6E5B50] dark:border-white/10">
                    <Tag size={11} />{tag}
                  </span>
                ))}
              </div>
            )}
            {recommendedBy >= 2 && (
              <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#2E8B57]/10 px-3 py-1 text-[12.5px] font-medium text-[#1F6B43] dark:text-[#3DDC97]">
                <Users size={14} aria-hidden />
                {t('placeCard.recommendedBy').replace('{n}', String(recommendedBy))}
              </p>
            )}
            {recommends.length > 0 && (
              <div className="mt-5 rounded-xl bg-[#FDE8DC]/60 px-3.5 py-3 dark:bg-[#E8672A]/10">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#E8672A]">
                  <HeartHandshake size={15} />
                  {t('placeCard.recommends')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recommends.map((row) =>
                    row.place_id.startsWith('user_') ? (
                      <a key={row.place_id} href={`/p/${encodeURIComponent(row.place_id)}`} className="rounded-full bg-white px-3 py-1 text-[12.5px] hover:text-[#E8672A] dark:bg-white/10">{row.name}</a>
                    ) : (
                      <span key={row.place_id} className="rounded-full bg-white px-3 py-1 text-[12.5px] dark:bg-white/10">{row.name}</span>
                    ),
                  )}
                </div>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-black/10 pt-4 dark:border-white/10">
              <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#E8672A] px-4 text-[13px] font-medium text-white hover:opacity-90">
                <Navigation size={15} />
                {t('biz.public.directions')}
              </a>
              <a href="/chat" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-black/10 px-4 text-[13px] hover:border-[#E8672A] hover:text-[#E8672A] dark:border-white/10">
                <MapIcon size={15} />
                {t('biz.public.openMap')}
              </a>
            </div>
            <PlaceReviews placeId={place.place_id} />
          </div>
        </article>
      </div>
    </main>
  )
}
