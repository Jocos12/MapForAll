'use client'

import { useState } from 'react'
import { Clock, Eye, MapPin, Phone, Star } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { CategoryIcon } from '@/components/CategoryIcon'
import { PlaceBadges } from '@/components/PlaceBadges'
import { PlaceDetailsPanel } from '@/components/PlaceDetailsPanel'
import { formatAverage } from '@/components/business/StatCards'
import { useBizTheme } from '@/components/business/theme'
import type { OwnerDashboard } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

/** The map InfoWindow as a visitor sees it, plus the full client sheet on demand. */
export function ListingPreview({ data }: { data: OwnerDashboard }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const place = data.place
  if (!place) return null
  const previewPlace = { ...place, rating: data.stats.average ?? undefined }
  const category = place.categories?.[0]

  return (
    <section className={`${BIZ.card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={BIZ.cardTitle}>{t('biz.overview.previewTitle')}</h2>
          <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.overview.previewHint')}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={`${BIZ.primary} h-10`}>
          <Eye size={15} aria-hidden />
          {t('biz.overview.seeAsClient')}
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[300px_1fr]">
        <div className="biz-native rounded-xl bg-white p-3 text-gray-900 shadow-[0_10px_28px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
          {place.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={place.photo_url} alt="" className="mb-2 h-32 w-full rounded-lg object-cover" />
          ) : (
            <div className="mb-2 flex h-32 w-full items-center justify-center rounded-lg bg-[#F4F4F5] text-[#71717A]">
              <CategoryIcon categories={place.categories} className="h-8 w-8" />
            </div>
          )}
          <p className="text-[14px] font-semibold leading-snug">{place.name}</p>
          {category && <p className="mt-0.5 text-[12px] text-gray-600">{t(`categories.${category}`)}</p>}
          <PlaceBadges place={previewPlace} className="mt-1" />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-700">
            {data.stats.average != null && (
              <span className="inline-flex items-center gap-0.5 text-amber-800">
                <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" aria-hidden />
                {formatAverage(data.stats.average, lang)}
                <span className="text-gray-600"> ({data.stats.reviewCount})</span>
              </span>
            )}
            {place.hours && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{place.hours}</span>}
          </div>
        </div>

        <div>
          <p className="text-[13.5px] leading-relaxed text-[#27272A]">
            {data.form.description || <span className="text-[#52525B]">{t('biz.overview.noDescription')}</span>}
          </p>
          <dl className="mt-3 grid content-start gap-3 text-[13px] sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 text-[#E8672A]" aria-hidden />
              <div>
                <dt className="text-[11.5px] font-medium text-[#52525B]">{t('biz.form.address')}</dt>
                <dd className="text-[#18181B]">{data.form.address || '—'}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Phone size={15} className="mt-0.5 shrink-0 text-[#E8672A]" aria-hidden />
              <div>
                <dt className="text-[11.5px] font-medium text-[#52525B]">{t('biz.form.phone')}</dt>
                <dd className="text-[#18181B]">{data.form.phone || '—'}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <Clock size={15} className="mt-0.5 shrink-0 text-[#E8672A]" aria-hidden />
              <div>
                <dt className="text-[11.5px] font-medium text-[#52525B]">{t('business.hours')}</dt>
                <dd className="text-[#18181B]">{data.form.hours || '—'}</dd>
              </div>
            </div>
          </dl>
        </div>
      </div>

      {open && <ClientPreview data={data} onClose={() => setOpen(false)} />}
    </section>
  )
}

/** The full client sheet in preview mode: no view counted, no voting. */
export function ClientPreview({ data, onClose }: { data: OwnerDashboard; onClose: () => void }) {
  const { dark } = useBizTheme()
  const place = data.place
  if (!place) return null
  // The client sheet carries its own `dark:` styles; keep the back-office palette off it.
  return (
    <div className={dark ? 'biz-native dark' : 'biz-native'}>
      <PlaceDetailsPanel
        placeId={place.place_id}
        fallbackName={place.name}
        fallbackMapsUrl={`https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lng}`}
        fallbackPlace={{ ...place, rating: data.stats.average ?? undefined }}
        onClose={onClose}
        preview
      />
    </div>
  )
}
