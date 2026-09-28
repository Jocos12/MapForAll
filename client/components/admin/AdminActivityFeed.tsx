'use client'

import Link from 'next/link'
import {
  Ban,
  Building2,
  CheckCircle2,
  FileWarning,
  FlaskConical,
  MapPin,
  Settings2,
  Shield,
  Sparkles,
  Star,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'

export type ActivityItem = {
  id: string
  action: string
  at: string
  actor: string
  target: string
  targetType?: string
}

type ActionMeta = {
  icon: LucideIcon
  tone: string
  href?: (item: ActivityItem) => string | undefined
}

const ACTION_META: Record<string, ActionMeta> = {
  'place.validate': {
    icon: CheckCircle2,
    tone: 'bg-[#1F8A5B]/12 text-[#1F8A5B]',
    href: () => '/admin/places',
  },
  'place.reject': {
    icon: Ban,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/moderation',
  },
  'place.update': {
    icon: MapPin,
    tone: 'bg-[#E8672A]/12 text-[#E8672A]',
    href: (i) => (i.target ? `/admin/places` : '/admin/places'),
  },
  'place.pause': {
    icon: MapPin,
    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    href: () => '/admin/places',
  },
  'place.delete': {
    icon: Ban,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/places',
  },
  'user.create': {
    icon: UserCog,
    tone: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
    href: () => '/admin/users',
  },
  'user.update': {
    icon: UserCog,
    tone: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
    href: () => '/admin/users',
  },
  'user.suspend': {
    icon: Ban,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/users',
  },
  'user.force_logout': {
    icon: Shield,
    tone: 'bg-violet-500/12 text-violet-700 dark:text-violet-400',
    href: () => '/admin/users',
  },
  'user.role_change': {
    icon: UserCog,
    tone: 'bg-violet-500/12 text-violet-700 dark:text-violet-400',
    href: () => '/admin/users',
  },
  'business.approve': {
    icon: Building2,
    tone: 'bg-[#1F8A5B]/12 text-[#1F8A5B]',
    href: () => '/admin/businesses',
  },
  'business.reject': {
    icon: Building2,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/businesses',
  },
  'business.suspend': {
    icon: Building2,
    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    href: () => '/admin/businesses',
  },
  'report.resolve': {
    icon: FileWarning,
    tone: 'bg-[#1F8A5B]/12 text-[#1F8A5B]',
    href: () => '/admin/reports',
  },
  'report.ignore': {
    icon: FileWarning,
    tone: 'bg-[#6E5B50]/12 text-[#6E5B50] dark:text-white/60',
    href: () => '/admin/reports',
  },
  'report.disable_place': {
    icon: FileWarning,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/reports',
  },
  'review.hide': {
    icon: Star,
    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    href: () => '/admin/reviews',
  },
  'review.delete': {
    icon: Star,
    tone: 'bg-red-500/10 text-red-600 dark:text-red-400',
    href: () => '/admin/reviews',
  },
  'scoring.update': {
    icon: FlaskConical,
    tone: 'bg-[#E8672A]/12 text-[#E8672A]',
    href: () => '/admin/scoring',
  },
  'settings.update': {
    icon: Settings2,
    tone: 'bg-[#6E5B50]/12 text-[#6E5B50] dark:text-white/60',
    href: () => '/admin/settings',
  },
  'demo.start': {
    icon: Sparkles,
    tone: 'bg-[#E8672A]/12 text-[#E8672A]',
    href: () => '/admin/dashboard',
  },
}

const FALLBACK: ActionMeta = {
  icon: Sparkles,
  tone: 'bg-[#E8672A]/12 text-[#E8672A]',
}

function relativeTime(iso: string, lang: string): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return iso
  const diffSec = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(lang || 'fr', { numeric: 'auto' })
  if (abs < 60) return rtf.format(diffSec, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day')
  return new Date(then).toLocaleString(lang || undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function actorInitial(actor: string): string {
  const part = actor.split('@')[0] || actor
  return (part[0] || '?').toUpperCase()
}

function shortActor(actor: string): string {
  if (!actor) return '—'
  if (actor.includes('@') && actor.length > 28) {
    const [local, domain] = actor.split('@')
    const shown = local.length <= 4 ? local : `${local.slice(0, 3)}…`
    return `${shown}@${domain}`
  }
  return actor
}

function shortTarget(target: string): string {
  if (!target) return ''
  if (target.length > 28) return `${target.slice(0, 14)}…${target.slice(-8)}`
  return target
}

export function AdminActivityFeed({ items }: { items: ActivityItem[] }) {
  const { t, lang } = useI18n()
  const list = items.slice(0, 12)

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] px-5 py-4 dark:border-white/10">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{t('admin.dashboard.activityTitle')}</h2>
          <p className="mt-0.5 text-[12px] text-[#6E5B50] dark:text-white/45">{t('admin.dashboard.activityPoll')}</p>
        </div>
        <Link
          href="/admin/audit"
          className="rounded-full border border-black/10 px-3 py-1.5 text-[12px] font-medium text-[#6E5B50] transition hover:border-[#E8672A]/40 hover:text-[#E8672A] dark:border-white/15 dark:text-white/55"
        >
          {t('admin.dashboard.activityViewAll')}
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState className="border-0 py-10" title={t('admin.dashboard.activityEmpty')} />
      ) : (
        <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
          {list.map((a, i) => {
            const meta = ACTION_META[a.action] ?? FALLBACK
            const Icon = meta.icon
            const href = meta.href?.(a)
            const labelKey = `admin.dashboard.actions.${a.action}` as const
            const label = t(labelKey)
            const resolvedLabel = label === labelKey ? a.action : label
            const key = a.id || `${a.at}-${a.action}-${i}`

            const row = (
              <div className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#E8672A]/[0.04] dark:hover:bg-white/[0.03] sm:px-5">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}
                  aria-hidden
                >
                  <Icon size={16} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-[#1A1614] dark:text-[#FBF3E7]">
                      {resolvedLabel}
                    </span>
                    {a.target ? (
                      <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-[#6E5B50] dark:bg-white/10 dark:text-white/55">
                        {shortTarget(a.target)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[#6E5B50] dark:text-white/45">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E8672A]/15 text-[10px] font-semibold text-[#E8672A]">
                        {actorInitial(a.actor)}
                      </span>
                      <span className="truncate">{shortActor(a.actor)}</span>
                    </span>
                    <span aria-hidden className="text-black/20 dark:text-white/20">·</span>
                    <time dateTime={a.at} title={a.at ? new Date(a.at).toLocaleString() : undefined}>
                      {relativeTime(a.at, lang)}
                    </time>
                  </div>
                </div>
              </div>
            )

            return (
              <li key={key}>
                {href ? (
                  <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#E8672A]/50">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Normalize activity payloads from /api/admin/stats or /api/admin/activity. */
export function normalizeActivityItems(raw: unknown): ActivityItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ActivityItem[] = []
  raw.forEach((row, i) => {
    if (!row || typeof row !== 'object') return
    const r = row as Record<string, unknown>
    const id = String(r.id ?? `act-${i}`)
    const key = id || `${r.at}-${r.action}-${i}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: key,
      action: String(r.action ?? ''),
      at: typeof r.at === 'string' ? r.at : '',
      actor: String(r.actor ?? ''),
      target: String(r.target ?? r.targetId ?? ''),
      targetType: typeof r.targetType === 'string' ? r.targetType : undefined,
    })
  })
  return out
}
