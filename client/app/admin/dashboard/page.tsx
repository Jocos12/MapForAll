'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { StatCard } from '@/components/admin/StatCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { DemoModeBanner, storeDemoSession } from '@/components/admin/DemoModeBanner'
import { AdminActivityFeed, normalizeActivityItems } from '@/components/admin/AdminActivityFeed'
import type { DashboardChartsData } from '@/components/admin/DashboardCharts'

const DashboardCharts = dynamic(
  () => import('@/components/admin/DashboardCharts').then((m) => m.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <section className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </section>
    ),
  },
)

type Trend = { value: number; prev: number; deltaPct: number }

type DashboardPayload = {
  range: string
  from: string
  to: string
  stats: {
    validated: number
    pending: number
    local: number
    accessible: number
    activeUsers: number
    openReports: number
    approvalRate: number
    trends: {
      validated: Trend
      pending: Trend
      local: Trend
      accessible: Trend
      users: Trend
      reports: Trend
    }
  }
  charts: DashboardChartsData
  queue: {
    pendingPlaces: { id: string; name: string; created_at: string; local: boolean }[]
    urgentReports: { id: string; place_name: string; type: string; created_at: string }[]
    businessesToVerify: { id: string; name: string }[]
  }
  activity: { id: string; action: string; at: string; actor: string; target: string; targetType?: string }[]
  health: { db: string; smtp: string; lastBackup: string | null }
}

type RangeKey = '7' | '30' | '90' | 'custom'

export default function AdminDashboardPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<RangeKey>('30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<DashboardPayload['activity']>([])
  const [demoBusy, setDemoBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ range })
      if (range === 'custom' && customFrom && customTo) {
        qs.set('from', new Date(customFrom).toISOString())
        qs.set('to', new Date(customTo).toISOString())
      }
      const [statsRes, activityRes] = await Promise.all([
        fetch(`/api/admin/stats?${qs}`, { credentials: 'include' }),
        fetch('/api/admin/activity', { credentials: 'include', cache: 'no-store' }),
      ])
      const json = await statsRes.json().catch(() => ({}))
      if (!statsRes.ok) {
        setError(statsRes.status === 403 ? t('admin.denied') : (json.error || t('admin.shell.loadError')))
        setData(null)
        return
      }
      setData(json as DashboardPayload)
      setActivity(normalizeActivityItems(json.activity))
      if (activityRes.ok) {
        const act = await activityRes.json().catch(() => ({}))
        if (Array.isArray(act.items)) setActivity(normalizeActivityItems(act.items))
      }
    } catch {
      setError(t('admin.shell.loadError'))
    } finally {
      setLoading(false)
    }
  }, [range, customFrom, customTo, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/admin/activity', { credentials: 'include', cache: 'no-store' })
        if (!res.ok || cancelled) return
        const json = await res.json()
        if (!cancelled && Array.isArray(json.items)) setActivity(normalizeActivityItems(json.items))
      } catch { /* ignore */ }
    }
    const id = setInterval(tick, 15_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const stats = data?.stats
  const charts = data?.charts

  async function startDemo() {
    setDemoBusy(true)
    try {
      const res = await fetch('/api/admin/demo/start', { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (res.ok) storeDemoSession({ steps: json.steps, place_id: json.place_id })
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <DemoModeBanner />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#E8672A]">
            {t('admin.shell.console')}
          </p>
          <h1 className="mt-1 font-display text-[28px] font-semibold tracking-tight">
            {t('admin.nav.dashboard')}
          </h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.dashboard.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['7', '30', '90', 'custom'] as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={
                range === key
                  ? 'rounded-full bg-[#E8672A] px-3 py-1.5 text-[12px] font-medium text-white'
                  : 'rounded-full border border-black/10 px-3 py-1.5 text-[12px] font-medium dark:border-white/15'
              }
            >
              {t(`admin.dashboard.range.${key}`)}
            </button>
          ))}
          <button
            type="button"
            disabled={demoBusy}
            onClick={() => void startDemo()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E8672A]/45 px-3 py-1.5 text-[12px] font-medium text-[#E8672A] disabled:opacity-60"
          >
            <Sparkles size={14} /> {demoBusy ? t('admin.demo.starting') : t('admin.demo.start')}
          </button>
        </div>
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap gap-3">
          <label className="text-[12px]">
            {t('admin.dashboard.range.from')}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="ml-2 rounded-lg border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
            />
          </label>
          <label className="text-[12px]">
            {t('admin.dashboard.range.to')}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="ml-2 rounded-lg border border-black/10 bg-transparent px-2 py-1 dark:border-white/15"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full bg-[#E8672A] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            {t('admin.dashboard.range.apply')}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px]">{error}</p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {!loading && stats && (
          <>
            <StatCard index={0} label={t('admin.dashboard.kpi.validated')} value={stats.validated} icon={CheckCircle2} href="/admin/places" trendPct={stats.trends.validated.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
            <StatCard index={1} label={t('admin.dashboard.kpi.pending')} value={stats.pending} icon={Clock} href="/admin/moderation" trendPct={stats.trends.pending.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
            <StatCard index={2} label={t('admin.dashboard.kpi.local')} value={stats.local} icon={Building2} href="/admin/businesses" trendPct={stats.trends.local.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
            <StatCard index={3} label={t('admin.dashboard.kpi.accessible')} value={stats.accessible} icon={ShieldCheck} href="/admin/places" trendPct={stats.trends.accessible.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
            <StatCard index={4} label={t('admin.dashboard.kpi.users')} value={stats.activeUsers} icon={Users} href="/admin/users" trendPct={stats.trends.users.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
            <StatCard index={5} label={t('admin.dashboard.kpi.reports')} value={stats.openReports} icon={AlertTriangle} href="/admin/reports" trendPct={stats.trends.reports.deltaPct} trendLabel={t('admin.dashboard.vsPrev')} />
          </>
        )}
      </section>

      {!loading && charts && <DashboardCharts charts={charts} />}

      {!loading && data && (
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04] lg:col-span-2">
            <h2 className="text-[15px] font-semibold">{t('admin.dashboard.queueTitle')}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <QueueCol title={t('admin.dashboard.queue.moderation')} empty={t('admin.dashboard.queue.empty')} items={data.queue.pendingPlaces.map((p) => ({ id: p.id, label: p.name, href: '/admin/moderation' }))} />
              <QueueCol title={t('admin.dashboard.queue.reports')} empty={t('admin.dashboard.queue.empty')} items={data.queue.urgentReports.map((r) => ({ id: r.id, label: r.place_name, href: '/admin/reports' }))} />
              <QueueCol title={t('admin.dashboard.queue.businesses')} empty={t('admin.dashboard.queue.empty')} items={data.queue.businessesToVerify.map((b) => ({ id: b.id, label: b.name, href: '/admin/businesses' }))} />
            </div>
          </div>

          <div className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
            <h2 className="text-[15px] font-semibold">{t('admin.dashboard.healthTitle')}</h2>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li className="flex justify-between"><span>{t('admin.dashboard.healthDb')}</span><span className="font-medium text-[#1F8A5B]">{t('admin.dashboard.healthOk')}</span></li>
              <li className="flex justify-between"><span>{t('admin.dashboard.healthSmtp')}</span><span className={data.health.smtp === 'ok' ? 'font-medium text-[#1F8A5B]' : 'font-medium text-[#854D0E]'}>{data.health.smtp === 'ok' ? t('admin.dashboard.healthOk') : t('admin.dashboard.healthCheck')}</span></li>
              <li className="flex justify-between"><span>{t('admin.dashboard.healthBackup')}</span><span className="font-medium text-[#6E5B50] dark:text-white/50">{data.health.lastBackup ?? t('admin.dashboard.healthNone')}</span></li>
              <li className="flex justify-between"><span>{t('admin.dashboard.approvalRate')}</span><span className="font-medium">{stats?.approvalRate ?? 0}%</span></li>
            </ul>
          </div>
        </section>
      )}

      {!loading && <AdminActivityFeed items={activity} />}
    </div>
  )
}

function QueueCol({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: { id: string; label: string; href: string }[]
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6E5B50] dark:text-white/50">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-[#6E5B50] dark:text-white/45">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="text-[13px] font-medium text-[#E8672A] hover:underline">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
