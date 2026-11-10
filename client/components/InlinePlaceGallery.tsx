'use client'

import { useState } from 'react'
import { Globe, Star, X } from 'lucide-react'
import type { Place } from '@/lib/types'
import { dedupePlaces, placeKey } from '@/lib/placeDedupe'
import { MapsChooser } from './MapsChooser'
import { PlaceBadges } from './PlaceBadges'
import { PlaceImage } from './PlaceImage'
import { placePhotoList } from '@/lib/placePhoto'

interface Props {
  places: Place[]
  /** Opens the in-app details panel (photos lightbox, hours, website, phone). */
  onDetails?: (place: Place) => void
  /** Center the in-app map on this place. */
  onFocusPlace?: (place: Place) => void
  activePlaceId?: string | null
}

/**
 * Place results inside the chat, under the AI reply: an iOS-style horizontal
 * card carousel (swipe on phones, scroll on desktop). Cards stay attached to
 * the message so photos are still there on scroll-back.
 */
export function InlinePlaceGallery({ places, onDetails, onFocusPlace, activePlaceId }: Props) {
  const unique = dedupePlaces(places)
  if (!unique.length) return null

  return (
    <div className="ios-carousel mt-3" role="list">
      {unique.map((place, index) => {
        const active = !!activePlaceId && place.place_id === activePlaceId
        const meta = [place.categories?.[0]?.replace(/_/g, ' '), place.distance].filter(Boolean).join(' · ')
        return (
          <article
            key={placeKey(place)}
            role="listitem"
            data-active={active}
            className="ios-card flex w-[248px] flex-col sm:w-[264px]"
          >
            <GalleryPhoto place={place} index={index} />
            <button
              type="button"
              onClick={() => onDetails?.(place)}
              className="flex flex-1 flex-col px-3.5 pb-2 pt-3 text-left"
              title={place.name}
            >
              <p className="line-clamp-1 text-[16px] font-semibold leading-[21px] tracking-[-0.02em] text-[var(--ios-label)]">
                {place.name}
              </p>
              {meta && (
                <p className="mt-0.5 line-clamp-1 text-[13px] capitalize text-[var(--ios-label-2)]">{meta}</p>
              )}
              {(place.description || place.summary || place.why) && (
                <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-[var(--ios-label-2)]">
                  {(place.description || place.summary || place.why || '').slice(0, 140)}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {place.rating != null && (
                  <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--ios-label)]">
                    <Star className="h-3 w-3 fill-[#FF9F0A] text-[#FF9F0A]" />
                    {place.rating.toFixed(1)}
                  </span>
                )}
                {place.open_now != null && (
                  <span className={`text-[12px] font-semibold ${place.open_now ? 'text-[var(--ios-green)]' : 'text-[var(--ios-red)]'}`}>
                    {place.open_now ? 'Ouvert' : 'Fermé'}
                  </span>
                )}
                <PlaceBadges place={place} />
              </div>
            </button>
            <div className="mt-auto flex items-center gap-2 px-3 pb-3 pt-1">
              <button
                type="button"
                onClick={() => onDetails?.(place)}
                className="ios-btn-tint h-8 flex-1 px-3 text-[13px]"
              >
                Détails
              </button>
              {place.website && (
                <a
                  href={place.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Site web"
                  className="ios-icon-btn h-8 w-8 bg-[var(--ios-fill)]"
                >
                  <Globe className="h-4 w-4" />
                </a>
              )}
              <MapsChooser
                place={place}
                onViewInApp={onFocusPlace}
                buttonClassName="ios-pill h-8 px-3 text-[13px]"
              />
            </div>
          </article>
        )
      })}
    </div>
  )
}

function GalleryPhoto({ place, index }: { place: Place; index: number }) {
  const urls = placePhotoList(place, 600).slice(0, 4)
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (urls.length) setOpen(0)
        }}
        className="relative block h-[148px] w-full overflow-hidden bg-[var(--ios-fill)]"
        aria-label={`${place.name} photos`}
      >
        {urls.length ? (
          <PlaceImage place={place} src={urls[0]} width={600} height={340} className="h-full w-full object-cover" />
        ) : (
          <PlaceImage place={place} width={600} height={340} className="h-full w-full object-cover" />
        )}
        <span className="ios-glass-strong absolute left-2.5 top-2.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] font-bold text-[var(--ios-label)]">
          {index + 1}
        </span>
        {urls.length > 1 && (
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md">
            1/{urls.length}
          </span>
        )}
      </button>
      {open != null && (
        <div
          className="ios-fade-in fixed inset-0 z-[400] flex items-center justify-center bg-black/85 p-6 backdrop-blur-xl"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label={place.name}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Fermer"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex max-h-[80vh] max-w-full flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
            <PlaceImage place={place} src={urls[open]} width={1200} height={800} className="max-h-[70vh] w-full rounded-2xl" />
            {urls.length > 1 && (
              <div className="flex gap-2">
                {urls.map((url, i) => (
                  <button
                    key={`${url}-${i}`}
                    type="button"
                    onClick={() => setOpen(i)}
                    className={`h-14 w-14 overflow-hidden rounded-xl ring-2 ${i === open ? 'ring-white' : 'ring-transparent opacity-60'}`}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <PlaceImage place={place} src={url} width={160} height={160} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Square-ish photo grid for a chat reply that actually has image URLs. */
export function PhotoGallery({
  placeName,
  photos,
  attribution,
}: {
  placeName: string
  photos: string[]
  attribution?: string
}) {
  const urls = photos.slice(0, 4)
  const [open, setOpen] = useState<number | null>(null)
  if (!urls.length) return null

  return (
    <div className="mt-3">
      <div className={`grid gap-2 ${urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setOpen(i)}
            className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black/5 dark:bg-white/5"
            aria-label={`${placeName} photo ${i + 1}`}
          >
            <PlaceImage place={{ name: placeName, photo_url: url }} src={url} width={640} height={480} className="h-full w-full" />
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-[#8A7364] dark:text-gray-500">
        {attribution ? `Photo : ${attribution}` : 'Photos : Google'}
      </p>
      {open != null && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label={placeName}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="max-h-[80vh] max-w-full" onClick={(event) => event.stopPropagation()}>
            <PlaceImage place={{ name: placeName, photo_url: urls[open] }} src={urls[open]} width={1200} height={800} className="max-h-[80vh] w-full" />
          </div>
        </div>
      )}
    </div>
  )
}
