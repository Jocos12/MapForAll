'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { Place } from '@/lib/types'
import {
  clampPhotoWidth,
  placePhotoList,
} from '@/lib/placePhoto'

interface Props {
  place: Pick<Place, 'name' | 'photos' | 'photo_url' | 'photo_reference'> & Partial<Pick<Place, 'place_id' | 'google_place_id' | 'maps_place_id'>>
  /** A specific photo URL (gallery cell). Stale Google CDN links are refreshed via the place id. */
  src?: string
  className?: string
  width?: number
  height?: number
  loading?: 'eager' | 'lazy'
  onLoad?: () => void
  /** Owner and admin previews only. Visitors do not see this link. */
  allowAddPhotos?: boolean
  addPhotosHref?: string
}

const inflight = new Map<string, Promise<string>>()
const memory = new Map<string, string>()
const memoryOrder: string[] = []

/** One network request per URL, even when several cards share the same ref. */
function loadPlacePhoto(src: string): Promise<string> {
  const cached = memory.get(src)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(src)
  if (pending) return pending
  const job = fetch(src)
    .then(async (res) => {
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.startsWith('image/') || res.headers.get('x-place-photo-reason')) {
        throw new Error('photo unavailable')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      memory.set(src, url)
      memoryOrder.push(src)
      while (memoryOrder.length > 300) {
        const old = memoryOrder.shift()
        const prev = old ? memory.get(old) : undefined
        if (old) memory.delete(old)
        if (prev) URL.revokeObjectURL(prev)
      }
      return url
    })
    .finally(() => {
      inflight.delete(src)
    })
  inflight.set(src, job)
  return job
}

export function placePhotoError(event: SyntheticEvent<HTMLImageElement>) {
  const el = event.currentTarget
  if (el.dataset.fallback === '1') return
  el.dataset.fallback = '1'
  el.style.visibility = 'hidden'
}

function categoryTone(name: string, categories?: string[]): { bg: string; fg: string; label: string } {
  const text = `${name} ${categories?.join(' ') ?? ''}`.toLowerCase()
  if (/market|shop|tomato|vegetable|grocery|duka/.test(text)) return { bg: '#E7F2E4', fg: '#2F6B3A', label: 'Market' }
  if (/caf|coffee/.test(text)) return { bg: '#F6E7D8', fg: '#8A4B2F', label: 'Cafe' }
  if (/hotel|lodg|auberge/.test(text)) return { bg: '#E4EEF8', fg: '#2C4C7C', label: 'Hotel' }
  if (/phone|electronic/.test(text)) return { bg: '#EEEAF8', fg: '#4C3D78', label: 'Shop' }
  return { bg: '#F3EDE6', fg: '#6B5344', label: 'Place' }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
  return letters || '?'
}

function photoSource(
  place: Props['place'],
  src: string | undefined,
  width: number,
): string | null {
  if (!src) return placePhotoList(place, width)[0] ?? null
  const converted = placePhotoList(
    { ...place, photo_url: src, photos: [], photo_reference: null },
    width,
  )
  return converted[0] ?? null
}

export function PlaceImage({ place, src, className, width, height, loading = 'lazy', onLoad, allowAddPhotos = false, addPhotosHref = '/business/dashboard' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad
  const [visible, setVisible] = useState(false)
  const [display, setDisplay] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const boxW = width && width > 0 ? width : 16
  const boxH = height && height > 0 ? height : 9
  const requestWidth = clampPhotoWidth(width)
  const photoKey = [
    place.place_id,
    place.google_place_id,
    place.maps_place_id,
    place.photo_url,
    place.photo_reference,
    ...(place.photos ?? []),
    src,
    requestWidth,
  ].join('|')
  const list = useMemo(() => {
    const all = placePhotoList(place, requestWidth)
    const first = photoSource(place, src, requestWidth)
    if (!first) return all
    return [first, ...all.filter((item) => item !== first)]
  }, [place, src, requestWidth])
  const resolved = list[index] ?? null
  const categories = 'categories' in place ? (place as { categories?: string[] }).categories : undefined
  const tone = categoryTone(place.name, categories)
  const notifiedRef = useRef(false)

  useEffect(() => {
    notifiedRef.current = false
    setIndex(0)
    setDisplay(null)
  }, [photoKey])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '240px', threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    if (!resolved) {
      if (!notifiedRef.current) {
        notifiedRef.current = true
        onLoadRef.current?.()
      }
      return
    }
    let cancelled = false
    loadPlacePhoto(resolved).then(
      (url) => {
        if (cancelled) return
        setDisplay(url)
        onLoadRef.current?.()
      },
      () => {
        if (cancelled) return
        setDisplay(null)
        setIndex((current) => current + 1)
      },
    )
    return () => {
      cancelled = true
    }
  }, [visible, resolved])

  return (
    <div
      ref={hostRef}
      className={`relative overflow-hidden bg-neutral-100 dark:bg-neutral-800 ${className ?? ''}`}
      style={{ aspectRatio: `${boxW} / ${boxH}` }}
      aria-label={place.name}
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1"
        style={{ background: tone.bg, color: tone.fg }}
      >
        <span className="text-[22px] font-semibold leading-none">{initials(place.name)}</span>
        <span className="text-[11px] font-medium tracking-wide">{tone.label}</span>
        {allowAddPhotos && !display && (
          <a href={addPhotosHref} className="mt-1 text-[11px] underline">
            Add photos
          </a>
        )}
      </div>
      {display && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={display}
          alt={place.name}
          width={boxW}
          height={boxH}
          loading={loading}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            placePhotoError(event)
            setDisplay(null)
            setIndex((current) => current + 1)
          }}
        />
      )}
      {display?.includes('/api/place-photo') && (
        <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">Photo: Google</span>
      )}
    </div>
  )
}
