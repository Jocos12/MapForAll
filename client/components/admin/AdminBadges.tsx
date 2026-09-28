'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Accessibility,
  Archive,
  Building2,
  CheckCircle2,
  Clock,
  Coffee,
  Hotel,
  MapPin,
  Pill,
  ShoppingBag,
  Store,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/design/cn'

export function StatusBadge({
  status,
  labels,
}: {
  status: string
  labels: Record<string, string>
}) {
  const key = status || 'validated'
  const cfg: Record<string, { icon: LucideIcon; className: string }> = {
    pending: { icon: Clock, className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
    validated: { icon: CheckCircle2, className: 'bg-[#1F8A5B]/12 text-[#1F8A5B]' },
    rejected: { icon: XCircle, className: 'bg-red-500/12 text-red-700 dark:text-red-400' },
    archived: { icon: Archive, className: 'bg-black/8 text-[#6E5B50] dark:bg-white/10 dark:text-white/55' },
  }
  const { icon: Icon, className } = cfg[key] ?? cfg.validated
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {labels[key] ?? key}
    </span>
  )
}

const CATEGORY_CFG: Record<string, { icon: LucideIcon; className: string }> = {
  shop: { icon: ShoppingBag, className: 'bg-[#E8672A]/12 text-[#C2410C]' },
  cafe: { icon: Coffee, className: 'bg-amber-600/12 text-amber-800 dark:text-amber-300' },
  market: { icon: Store, className: 'bg-emerald-600/12 text-emerald-800 dark:text-emerald-300' },
  restaurant: { icon: UtensilsCrossed, className: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
  pharmacy: { icon: Pill, className: 'bg-sky-500/12 text-sky-800 dark:text-sky-300' },
  hotel: { icon: Hotel, className: 'bg-indigo-500/12 text-indigo-800 dark:text-indigo-300' },
  clinic: { icon: Building2, className: 'bg-teal-500/12 text-teal-800 dark:text-teal-300' },
  attraction: { icon: MapPin, className: 'bg-violet-500/12 text-violet-800 dark:text-violet-300' },
  other: { icon: MapPin, className: 'bg-black/6 text-[#6E5B50] dark:bg-white/10 dark:text-white/55' },
}

export function CategoryBadge({ category }: { category: string }) {
  const key = category.toLowerCase()
  const { icon: Icon, className } = CATEGORY_CFG[key] ?? CATEGORY_CFG.other
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', className)}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {category}
    </span>
  )
}

export function PillFlag({
  kind,
  label,
}: {
  kind: 'local' | 'accessible'
  label: string
}) {
  const Icon = kind === 'local' ? Store : Accessibility
  const className =
    kind === 'local'
      ? 'bg-[#E8672A]/10 text-[#C2410C]'
      : 'bg-sky-500/12 text-sky-800 dark:text-sky-300'
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', className)}>
      <Icon size={11} aria-hidden />
      {label}
    </span>
  )
}

export function RoleBadge({
  role,
  label,
}: {
  role: string
  label: string
}) {
  const className =
    role === 'admin'
      ? 'bg-[#E8672A] text-white'
      : role === 'moderator'
        ? 'bg-[#E8672A]/15 text-[#C2410C]'
        : role === 'business_owner'
          ? 'bg-sky-500/15 text-sky-800 dark:text-sky-300'
          : 'bg-black/8 text-[#6E5B50] dark:bg-white/10 dark:text-white/60'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>
      {label}
    </span>
  )
}

export function UserStatusBadge({
  status,
  label,
}: {
  status: string
  label: string
}) {
  const active = status === 'active'
  const Icon = active ? CheckCircle2 : XCircle
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        active ? 'bg-[#1F8A5B]/12 text-[#1F8A5B]' : 'bg-red-500/12 text-red-700 dark:text-red-400',
      )}
    >
      <Icon size={12} aria-hidden />
      {label}
    </span>
  )
}
