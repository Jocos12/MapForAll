'use client'

import { Accessibility, Clock, Store, TrendingUp } from 'lucide-react'
import type { Place } from '@/lib/types'
import { accessDetail, hasStepFreeEntrance } from '@/lib/access'
import { useI18n } from '@/components/I18nProvider'

export function PlaceBadges({
  place,
  className = '',
}: {
  place: Pick<Place, 'local_business' | 'accessible' | 'access' | 'access_confirmations' | 'status' | 'prioritized'>
  className?: string
}) {
  const { t } = useI18n()
  const detail = accessDetail(place)
  const accessible = hasStepFreeEntrance(place)
  const pending = place.status === 'pending'
  if (!place.local_business && !accessible && !place.prioritized && !pending) return null
  const bits = [
    detail.entrance ? t('access.entrance') : '',
    detail.toilet ? t('access.toilet') : '',
    detail.parking ? t('access.parking') : '',
  ].filter(Boolean)
  const confirmed = place.access_confirmations ?? 0
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {place.local_business && (
        <span className="inline-flex items-center gap-1 rounded-full bg-terracotta/15 px-1.5 py-0.5 text-[10px] font-medium text-terracotta dark:text-[#FF8C2F]">
          <Store className="h-3 w-3" aria-hidden />
          {t('badges.local')}
        </span>
      )}
      {accessible && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#0F6E56]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0F6E56] dark:text-[#3DDC97]">
          <Accessibility className="h-3 w-3" aria-hidden />
          {t('badges.accessible')}
          {bits.length > 0 && <span className="font-normal opacity-80">· {bits.join(' · ')}</span>}
          {confirmed > 0 && <span className="font-normal opacity-80">· {confirmed}</span>}
        </span>
      )}
      {place.prioritized && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FDE8DC] px-1.5 py-0.5 text-[10px] font-medium text-[#E8672A]">
          <TrendingUp className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          {t('badges.prioritized')}
        </span>
      )}
      {pending && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F0E6] px-1.5 py-0.5 text-[10px] font-medium text-[#6B5E4E] dark:bg-white/10 dark:text-amber-100">
          <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          {t('badges.pending')}
        </span>
      )}
    </span>
  )
}
