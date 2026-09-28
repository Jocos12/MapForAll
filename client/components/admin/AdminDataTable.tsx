'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/design/cn'

export function AdminTableShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5', className)}>
      {children}
    </div>
  )
}

export function AdminTablePagination({
  page,
  totalPages,
  total,
  pageLabel,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  page: number
  totalPages: number
  total: number
  pageLabel: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
}) {
  if (totalPages <= 1 && total === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 px-3 py-2.5 text-[12px] dark:border-white/10">
      <span className="text-[#6E5B50] dark:text-white/50">
        {pageLabel.replace('{page}', String(page)).replace('{total}', String(totalPages)).replace('{count}', String(total))}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrev}
          className="rounded-full border border-black/10 px-3 py-1 font-medium disabled:opacity-40 dark:border-white/15"
        >
          {prevLabel}
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={onNext}
          className="rounded-full border border-black/10 px-3 py-1 font-medium disabled:opacity-40 dark:border-white/15"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

export function IconAction({
  label,
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-50',
        tone === 'danger'
          ? 'border-red-500/25 text-red-600 hover:bg-red-500/10'
          : 'border-black/10 text-[#6E5B50] hover:border-[#E8672A]/40 hover:text-[#E8672A] dark:border-white/15 dark:text-white/60',
      )}
    >
      {children}
    </button>
  )
}
