'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, MapPinned } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Place } from '@/lib/types'

export function googleMapsHref(place: { name: string; place_id?: string; maps_url?: string; coordinates?: { lat: number; lng: number } }): string {
  const name = encodeURIComponent(place.name || 'place')
  if (place.place_id && !place.place_id.startsWith('__')) {
    return `https://www.google.com/maps/search/?api=1&query=${name}&query_place_id=${encodeURIComponent(place.place_id)}`
  }
  const lat = place.coordinates?.lat
  const lng = place.coordinates?.lng
  if (typeof lat === 'number' && typeof lng === 'number' && !(lat === 0 && lng === 0)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  }
  if (place.maps_url) return place.maps_url
  return `https://www.google.com/maps/search/?api=1&query=${name}`
}

interface Props {
  place: Place
  onViewInApp?: (place: Place) => void
  buttonClassName: string
}

export function MapsChooser({ place, onViewInApp, buttonClassName }: Props) {
  const { t } = useI18n()
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setBox({ top: rect.bottom + 6, left: Math.max(8, rect.right - 240) })
    setOpen((value) => !value)
  }

  const options = (
    <div className="flex flex-col gap-1">
      <p id={titleId} className="px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
        {t('mapsChooser.title')}
      </p>
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(false)
          onViewInApp?.(place)
        }}
      >
        <MapPinned className="h-4 w-4 text-[#F56A00]" />
        {t('mapsChooser.inApp')}
      </button>
      <a
        href={googleMapsHref(place)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(false)
        }}
      >
        <ExternalLink className="h-4 w-4 text-[#F56A00]" />
        {t('mapsChooser.google')}
      </a>
    </div>
  )

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.stopPropagation()
          openMenu()
        }}
        className={buttonClassName}
      >
        <ExternalLink className="h-3 w-3" />
        {t('mapsChooser.button')}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        mobile ? (
          <div className="fixed inset-0 z-[80]">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label={t('mapsChooser.close')}
              onClick={() => setOpen(false)}
            />
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-[var(--border)] bg-[var(--bg-header)] p-3 pb-6 shadow-xl"
            >
              {options}
            </div>
          </div>
        ) : (
          <div
            ref={menuRef}
            role="dialog"
            aria-labelledby={titleId}
            style={{ top: box?.top ?? 0, left: box?.left ?? 0 }}
            className="fixed z-[80] w-60 rounded-xl border border-[var(--border)] bg-[var(--bg-header)] p-1.5 shadow-lg"
          >
            {options}
          </div>
        ),
        document.body,
      )}
    </div>
  )
}
