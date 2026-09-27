'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, CheckCircle2, Eye, MessageSquare, Star, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { TrendChip } from '@/components/business/charts'
import type { OwnerStats } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

export type StatTarget = 'business' | 'stats' | 'reviews' | 'promotion'

const COUNT_MS = 500

export function formatAverage(value: number | null, lang: string): string {
  if (value == null) return '—'
  return lang === 'fr' ? value.toFixed(1).replace('.', ',') : value.toFixed(1)
}

/** Counts from 0 to `target` once per value (ease-out); lands immediately under reduced motion. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / COUNT_MS)
      setShown(target * (1 - (1 - p) ** 3))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    setShown(0)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return shown
}

function CountUp({ value, decimals, format }: { value: number | null; decimals: number; format: (n: number | null) => string }) {
  const shown = useCountUp(value ?? 0)
  if (value == null) return <>{format(null)}</>
  const rounded = decimals ? Math.round(shown * 10 ** decimals) / 10 ** decimals : Math.round(shown)
  return (
    <>
      <span aria-hidden>{format(rounded)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}

interface Card {
  id: 'views' | 'average' | 'reviews' | 'confirmations'
  icon: LucideIcon
  label: string
  value: number | null
  decimals?: number
  empty: boolean
  extra?: ReactNode
  hint: string
  target: StatTarget
}

/**
 * The four headline numbers. Each card opens its detail section; a card still at zero
 * says why and links to the one action that will change it.
 */
export function StatCards({ stats, published, onOpen, delay = 0 }: { stats: OwnerStats; published: boolean; onOpen: (target: StatTarget) => void; delay?: number }) {
  const { t, lang } = useI18n()
  const emptyTarget: StatTarget = published ? 'promotion' : 'business'
  const cards: Card[] = [
    {
      id: 'views',
      icon: Eye,
      label: t('biz.stats.views7'),
      value: stats.views7,
      empty: stats.views === 0,
      extra: <TrendChip current={stats.views7} previous={stats.viewsPrev7} />,
      hint: t('biz.stats.viewsTotal').replace('{n}', String(stats.views)),
      target: 'stats',
    },
    { id: 'average', icon: Star, label: t('biz.stats.average'), value: stats.average, decimals: 1, empty: stats.average == null, hint: t('biz.stats.averageHint'), target: 'reviews' },
    { id: 'reviews', icon: MessageSquare, label: t('biz.stats.reviews'), value: stats.reviewCount, empty: stats.reviewCount === 0, hint: t('biz.stats.reviewsHint'), target: 'reviews' },
    { id: 'confirmations', icon: CheckCircle2, label: t('biz.stats.confirmations'), value: stats.confirmations, empty: stats.confirmations === 0, hint: t('biz.stats.confirmationsHint'), target: 'stats' },
  ]

  return (
    <div className="grid auto-rows-fr grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map(({ id, icon: Icon, label, value, decimals = 0, empty, extra, hint, target }, i) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(empty ? emptyTarget : target)}
          className={`${BIZ.card} ${BIZ.focus} group flex h-full animate-fade-up flex-col p-4 text-left transition-[transform,box-shadow,border-color] duration-150 hover:border-[#E8672A]/50 hover:shadow-[0_8px_24px_rgba(26,22,20,0.08)] motion-safe:hover:-translate-y-0.5`}
          style={{ animationDelay: `${delay + i * 50}ms` }}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-[#3F3F46]">{label}</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FDE8DC] text-[#C2410C]" aria-hidden>
              <Icon size={16} />
            </span>
          </span>
          <span className={`mt-2 block text-[32px] font-semibold leading-none tracking-tight tabular-nums ${empty ? 'text-[#A1A1AA]' : 'text-[#18181B]'}`}>
            <CountUp value={value} decimals={decimals} format={(n) => (decimals ? formatAverage(n, lang) : n == null ? '—' : String(n))} />
          </span>
          {empty ? (
            <span className="mt-2 flex flex-1 flex-col justify-between gap-2">
              <span className="text-[11.5px] leading-snug text-[#52525B]">{t(`biz.stats.empty.${published ? 'live' : 'draft'}.${id}`)}</span>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#C2410C]">
                {t(`biz.stats.empty.cta.${published ? 'live' : 'draft'}`)}
                <ArrowRight size={13} className="transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </span>
          ) : (
            <span className="mt-2 flex flex-1 flex-wrap content-start items-center gap-1.5">
              {extra}
              <span className="text-[11.5px] text-[#52525B]">{hint}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
