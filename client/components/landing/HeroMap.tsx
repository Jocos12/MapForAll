'use client'

import { Accessibility, MapPin } from 'lucide-react'
import { KigaliLiveMap } from '@/components/landing/KigaliLiveMap'

/**
 * Product frame: live Carto/OSM tiles of Kimisagara, with two result cards.
 * Cards are plain app UI. Pins appear once, staggered, and then stay still.
 */
export default function HeroMap({
  className = '',
  fill = false,
  marketTitle = 'Kimisagara Market',
  marketMeta = 'Local market · 6 min walk',
  placeTitle = 'Duka rya Jean · Accessible',
  placeMeta = 'Confirmed by 12 people',
}: {
  className?: string
  fill?: boolean
  marketTitle?: string
  marketMeta?: string
  placeTitle?: string
  placeMeta?: string
}) {
  return (
    <div className={fill
      ? `absolute inset-0 h-full w-full overflow-hidden bg-[#E7E2DA] dark:bg-[#1A1816] ${className}`
      : `relative aspect-[4/5] overflow-hidden rounded-2xl border border-black/10 bg-[#E7E2DA] dark:border-white/10 dark:bg-[#1A1816] ${className}`}>
      <KigaliLiveMap />
      <div className="pointer-events-none absolute left-4 top-4 z-[500] flex max-w-[min(230px,calc(100%-2rem))] items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(26,22,20,0.08)] dark:border-white/10 dark:bg-[#1C1916] dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <MapPin size={16} className="shrink-0 text-[#1A1614] dark:text-gray-100" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[#1A1614] dark:text-gray-100">{marketTitle}</span>
          <span className="block truncate text-[12px] text-[#6E5B50] dark:text-gray-400">{marketMeta}</span>
        </span>
      </div>
      <div className="pointer-events-none absolute bottom-12 left-4 z-[500] flex max-w-[min(240px,calc(100%-2rem))] items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(26,22,20,0.08)] dark:border-white/10 dark:bg-[#1C1916] dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <Accessibility size={16} className="shrink-0 text-[#1A1614] dark:text-gray-100" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[#1A1614] dark:text-gray-100">{placeTitle}</span>
          <span className="block truncate text-[12px] text-[#6E5B50] dark:text-gray-400">{placeMeta}</span>
        </span>
      </div>
    </div>
  )
}
