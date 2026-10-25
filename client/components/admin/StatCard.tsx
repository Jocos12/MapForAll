'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { memo, useEffect, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { cn } from '@/lib/design/cn'
import type { Trend } from '@/lib/trend'
import type { LucideIcon } from 'lucide-react'

function AnimatedNumber({ value }: { value: number }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      setN(value)
      return
    }
    const start = performance.now()
    const from = n
    const dur = 600
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const eased = 1 - (1 - p) ** 3
      setN(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from last displayed value
  }, [value, reduced])
  return <span>{n.toLocaleString()}</span>
}

export const StatCard = memo(function StatCard({
  label,
  value,
  href,
  icon: Icon,
  trend,
  trendPct,
  trendLabel,
  hint,
  index = 0,
}: {
  label: string
  value: number
  href?: string
  icon: LucideIcon
  trend?: Trend | null
  /** Legacy numeric percent. Ignored when it would read as −100% beside a positive value. */
  trendPct?: number | null
  trendLabel?: string
  hint?: string
  index?: number
}) {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const body = (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : index * 0.06, duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      title={hint}
      className={cn(
        'rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(26,22,20,0.04)]',
        'dark:border-white/10 dark:bg-white/[0.04]',
        href && 'transition duration-200 hover:-translate-y-0.5 hover:border-[#E8672A]/35',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[#6E5B50] dark:text-white/50">
          {label}
        </p>
        <span className="rounded-xl bg-[#E8672A]/12 p-2 text-[#E8672A]">
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-3 font-display text-[32px] font-semibold leading-none tracking-tight">
        <AnimatedNumber value={value} />
      </p>
      {(trend || typeof trendPct === 'number') && (
        <TrendLine trend={trend} trendPct={trendPct} value={value} label={trendLabel} newLabel={t('greet.trendNew')} />
      )}
    </motion.div>
  )
  return href ? <Link href={href}>{body}</Link> : body
})

function TrendLine({
  trend,
  trendPct,
  value,
  label,
  newLabel,
}: {
  trend?: Trend | null
  trendPct?: number | null
  value: number
  label?: string
  newLabel: string
}) {
  const resolved: Trend | null = trend
    ?? (typeof trendPct === 'number'
      ? (value > 0 && trendPct <= -100 ? { kind: 'none' } : { kind: 'pct', pct: trendPct })
      : null)
  if (!resolved || resolved.kind === 'none') {
    return <p className="mt-2 text-[12px] font-medium text-[#6E5B50] dark:text-white/50">—{label ? ` ${label}` : ''}</p>
  }
  if (resolved.kind === 'new') {
    return <p className="mt-2 text-[12px] font-medium text-[#1F8A5B]">{newLabel}{label ? ` ${label}` : ''}</p>
  }
  const pct = resolved.pct
  return (
    <p
      className={cn(
        'mt-2 text-[12px] font-medium',
        pct > 0 && 'text-[#1F8A5B]',
        pct < 0 && 'text-red-600',
        pct === 0 && 'text-[#6E5B50] dark:text-white/50',
      )}
    >
      {pct > 0 ? '+' : ''}
      {pct}%{label ? ` ${label}` : ''}
    </p>
  )
}
