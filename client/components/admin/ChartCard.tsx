'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/design/cn'

export function ChartCard({
  title,
  subtitle,
  children,
  className,
  delay = 0,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduced = useReducedMotion()
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduced ? 0 : delay, duration: reduced ? 0 : 0.4 }}
      className={cn(
        'rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]',
        className,
      )}
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[12px] text-[#6E5B50] dark:text-white/50">{subtitle}</p>
        )}
      </div>
      <div className="min-h-[220px]">{children}</div>
    </motion.section>
  )
}
