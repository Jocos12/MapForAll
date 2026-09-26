'use client'

import { Accessibility, Store } from 'lucide-react'
import type { Place } from '@/lib/types'
import { useI18n } from '@/components/I18nProvider'

export function PlaceBadges({ place, className = '' }: { place: Pick<Place, 'local_business' | 'accessible'>; className?: string }) {
  const { t } = useI18n()
  if (!place.local_business && !place.accessible) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {place.local_business && (
        <span className="inline-flex items-center gap-1 rounded-full bg-terracotta/15 px-1.5 py-0.5 text-[10px] font-medium text-terracotta dark:text-[#FF8C2F]">
          <Store className="h-3 w-3" aria-hidden />
          {t('badges.local')}
        </span>
      )}
      {place.accessible && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#0F6E56]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0F6E56] dark:text-[#3DDC97]">
          <Accessibility className="h-3 w-3" aria-hidden />
          {t('badges.accessible')}
        </span>
      )}
    </span>
  )
}
