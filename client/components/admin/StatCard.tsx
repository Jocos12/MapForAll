'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { memo, useEffect, useState } from 'react'
import { cn } from '@/lib/design/cn'
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
    const dur = 650
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
  trendPct,
  trendLabel,
  index = 0,
}: {
  label: string
  value: number
  href?: string
  icon: LucideIcon
  trendPct?: number | null
  trendLabel?: string
  index?: number
}) {
  const reduced = useReducedMotion()
  const body = (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: reduced ? 0 : 0.35 }}
      className={cn(
        'rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(26,22,20,0.04)]',
        'dark:border-white/10 dark:bg-white/[0.04]',
        href && 'transition hover:-translate-y-0.5 hover:border-[#E8672A]/35',
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
      {typeof trendPct === 'number' && (
        <p
          className={cn(
            'mt-2 text-[12px] font-medium',
            trendPct > 0 && 'text-[#1F8A5B]',
            trendPct < 0 && 'text-red-600',
            trendPct === 0 && 'text-[#6E5B50] dark:text-white/50',
          )}
        >
          {trendPct > 0 ? '+' : ''}
          {trendPct}%{trendLabel ? ` ${trendLabel}` : ''}
        </p>
      )}
    </motion.div>
  )
  return href ? <Link href={href}>{body}</Link> : body
})
