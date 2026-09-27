'use client'

import { useState } from 'react'
import { ExternalLink, Globe, Star, X } from 'lucide-react'
import type { Place } from '@/lib/types'
import { PlaceBadges } from './PlaceBadges'
import { PlaceImage } from './PlaceImage'

interface Props {
  places: Place[]
  /** Opens the in-app details panel (photos lightbox, hours, website, phone). */
  onDetails?: (place: Place) => void
}

function mapsLink(place: Place): string | null {
  if (place.maps_url) return place.maps_url
  if (place.place_id && !place.place_id.startsWith('__')) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.place_id)}`
  }
  if (place.coordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lng}`
  }
  return null
}

/**
 * Persistent place cards rendered INSIDE the chat, directly under the AI reply.
 * Unlike the map's bottom strip these don't slide in or live on the right — they
 * stay attached to the message so the images are always there on scroll-back.
 */
export function InlinePlaceGallery({ places, onDetails }: Props) {
  if (!places?.length) return null

  // Past ~4 cards (2 rows on desktop) cap the height and let it scroll
  // vertically (up/down) so the gallery doesn't push the chat down endlessly.
  const scrolls = places.length > 4

  return (
    <div
      className={`mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${
        scrolls ? 'chat-scroll max-h-[58vh] overflow-y-auto pr-1' : ''
      }`}
    >
      {places.map((place, i) => {
        const href = mapsLink(place)
        return (
          <div
            key={`${place.place_id || place.name}-${i}`}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-header)] shadow-[0_1px_8px_rgba(0,0,0,0.05)] transition-colors hover:border-[#F56A00]/40 dark:shadow-[0_1px_8px_rgba(0,0,0,0.4)]"
          >
            <div className="block w-full text-left">
              <GalleryPhoto place={place} />
              <button
                type="button"
                onClick={() => onDetails?.(place)}
                className="block w-full px-3 pb-1.5 pt-2 text-left"
                title="See photos & details"
              >
                <p className="line-clamp-1 text-[13px] font-medium leading-snug text-[var(--text-primary)]">
                  {place.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {place.rating != null && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      {place.rating.toFixed(1)}
                    </span>
                  )}
                  <PlaceBadges place={place} />
                  {place.open_now != null && (
                    <span className={`text-[10px] font-semibold ${place.open_now ? 'text-[#1FA463]' : 'text-[#E5484D]'}`}>
                      {place.open_now ? 'Open now' : 'Closed'}
                    </span>
                  )}
                </div>
              </button>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-0.5">
              <button
                type="button"
                onClick={() => onDetails?.(place)}
                className="rounded-full bg-[#F56A00]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#F56A00] transition-colors hover:bg-[#F56A00]/20 dark:bg-[#F56A00]/15 dark:text-[#FF8C2F]"
              >
                Details
              </button>
              {place.website && (
                <a
                  href={place.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                >
                  <Globe className="h-3 w-3" />
                  Site
                </a>
              )}
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                >
                  <ExternalLink className="h-3 w-3" />
                  Maps
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GalleryPhoto({ place }: { place: Place }) {
  const urls = (place.photos?.length ? place.photos : place.photo_url ? [place.photo_url] : []).slice(0, 4)
  const [open, setOpen] = useState<number | null>(null)

  if (urls.length === 0) {
    return (
      <div className="relative h-28 w-full overflow-hidden bg-black/5 dark:bg-white/5">
        <PlaceImage place={place} width={440} height={240} className="h-full w-full object-cover" />
      </div>
    )
  }

  return (
    <>
      <div className={`grid gap-0.5 ${urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(i)
            }}
            className="relative h-24 overflow-hidden bg-black/5 dark:bg-white/5"
            aria-label={`${place.name} photo ${i + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open != null && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label={place.name}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[open]}
            alt={place.name}
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[open]}
            alt={placeName}
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
