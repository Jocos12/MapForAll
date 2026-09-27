'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Store } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'

export interface WorkspaceLink {
  href: string
  /** Short name shown in the tooltip and read by screen readers. */
  label: string
  /** Full call to action used in the account drawer. */
  cta: string
  /** Owner listings; two or more open a picker instead of a direct link. */
  places?: Array<{ place_id: string; name: string; status: string; paused?: boolean }>
}

const iconButton =
  'relative flex h-9 w-9 items-center justify-center rounded-full text-[#6E5B50] transition-colors duration-150 hover:bg-black/[0.04] active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8672A]/60 dark:text-gray-300 dark:hover:bg-white/10'

export function WorkspaceShortcut({ workspace }: { workspace: WorkspaceLink }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [tapTip, setTapTip] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const tipTimer = useRef<number | null>(null)
  const places = workspace.places ?? []
  const picker = places.length > 1

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => { if (tipTimer.current) window.clearTimeout(tipTimer.current) }, [])

  const flashTip = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    setTapTip(true)
    if (tipTimer.current) window.clearTimeout(tipTimer.current)
    tipTimer.current = window.setTimeout(() => setTapTip(false), 1400)
  }

  const face = (
    <>
      <Store className="h-4 w-4" strokeWidth={2} aria-hidden />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#F56A00] ring-2 ring-[#FBF6EE] dark:ring-[#141210]" aria-hidden />
    </>
  )

  return (
    <div ref={rootRef} className="group relative">
      {picker ? (
        <button
          type="button"
          aria-label={workspace.label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={iconButton}
        >
          {face}
        </button>
      ) : (
        <a href={workspace.href} aria-label={workspace.label} onPointerDown={flashTip} className={iconButton}>
          {face}
        </a>
      )}

      {!open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1A1614] px-2 py-1 text-[11px] font-medium text-white shadow-lg transition-opacity duration-150 dark:bg-white dark:text-[#1A1614] ${
            tapTip ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          {workspace.label}
        </span>
      )}

      {open && picker && (
        <div
          role="menu"
          aria-label={t('header.workspace.pick')}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_8px_24px_rgba(26,22,20,0.12)] dark:border-white/10 dark:bg-[#1C1916]"
        >
          <p className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#8A7364] dark:text-gray-400">
            <Store className="h-3.5 w-3.5 text-[#E8672A]" aria-hidden />
            {workspace.label}
          </p>
          {places.map((place) => (
            <a
              key={place.place_id}
              role="menuitem"
              href={`/business/dashboard?place=${encodeURIComponent(place.place_id)}`}
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-[#1A1614] transition-colors hover:bg-[#FBF3E7] dark:text-gray-100 dark:hover:bg-white/5"
            >
              <span className="min-w-0 flex-1 truncate">{place.name}</span>
              {place.status === 'pending' && (
                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  {t('badges.pending')}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8A7364]" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
