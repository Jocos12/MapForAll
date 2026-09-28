'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { BarChart3, Download, ExternalLink, Globe2, MapPinned } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useI18n } from '@/components/I18nProvider'
import { ChartCard } from '@/components/admin/ChartCard'
import { StatCard } from '@/components/admin/StatCard'
import { Skeleton } from '@/components/ui/Skeleton'

const SectorMap = dynamic(
  () => import('@/components/admin/SectorMap').then((m) => m.SectorMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] rounded-xl" /> },
)

const BRAND = '#E8672A'

type ImpactPayload = {
  inclusionScore: number
  breakdown: { localVisiblePct: number; accessiblePct: number; sectorCoveragePct: number }
  sdg: { id: number; title: string; link: string; relevance: string }[]
  timeSeries: { date: string; inclusionScore: number; localPct: number; accessiblePct: number }[]
  undercovered: { sector: string; count: number; suggestion: string | null }[]
  topBoosted: { place_id: string; name: string; lat: number; lng: number; local: boolean }[]
}

export default function AdminImpactPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<'7' | '30' | '90'>('30')
  const [data, setData] = useState<ImpactPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/impact?range=${range}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json)
    } catch {
      setError(t('admin.shell.loadError'))
    } finally {
      setLoading(false)
    }
  }, [range, t])

  useEffect(() => { void load() }, [load])

  const mapPoints = (data?.undercovered ?? []).map((s) => ({
    sector: s.sector,
    count: s.count,
    lat: -1.95 + (s.sector.length % 5) * 0.01,
    lng: 30.06 + (s.sector.length % 7) * 0.008,
  }))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t('admin.nav.impact')}</h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.impact.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['7', '30', '90'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1.5 text-[12px] ${range === r ? 'bg-[#E8672A] text-white' : 'border border-black/10 dark:border-white/10'}`}
            >
              {t(`admin.dashboard.range.${r}`)}
            </button>
          ))}
          <a
            href="/api/admin/impact/pdf"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E8672A]/40 px-3 py-1.5 text-[12px] font-medium text-[#E8672A]"
          >
            <Download size={14} /> {t('admin.impact.exportPdf')}
          </a>
        </div>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard index={0} label={t('admin.impact.score')} value={loading ? 0 : data?.inclusionScore ?? 0} icon={BarChart3} />
        <StatCard index={1} label={t('admin.impact.localVisible')} value={loading ? 0 : data?.breakdown.localVisiblePct ?? 0} icon={MapPinned} />
        <StatCard index={2} label={t('admin.impact.accessible')} value={loading ? 0 : data?.breakdown.accessiblePct ?? 0} icon={Globe2} />
        <StatCard index={3} label={t('admin.impact.sectors')} value={loading ? 0 : data?.breakdown.sectorCoveragePct ?? 0} icon={BarChart3} />
      </div>

      <ChartCard title={t('admin.impact.seriesTitle')} subtitle={t('admin.impact.seriesHint')}>
        {loading || !data ? (
          <Skeleton className="h-[220px]" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.timeSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00000010" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="inclusionScore" stroke={BRAND} fill={BRAND} fillOpacity={0.2} name={t('admin.impact.score')} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <h2 className="text-[15px] font-semibold">{t('admin.impact.sdgTitle')}</h2>
        <ul className="mt-3 space-y-2">
          {(data?.sdg ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="rounded-full bg-[#E8672A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#E8672A]">SDG {s.id}</span>
              <span>{s.relevance}</span>
              <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#E8672A] hover:underline">
                {s.title} <ExternalLink size={12} />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <ChartCard title={t('admin.impact.undercoveredTitle')} subtitle={t('admin.impact.undercoveredHint')}>
        <SectorMap points={mapPoints.length ? mapPoints : [{ sector: 'Kigali', count: 1, lat: -1.953, lng: 30.09 }]} />
        <ul className="mt-3 space-y-1 text-[13px]">
          {(data?.undercovered ?? []).slice(0, 8).map((s) => (
            <li key={s.sector}>
              <strong>{s.sector}</strong> — {s.count} {t('admin.impact.places')}
              {s.suggestion && <span className="text-[#6E5B50] dark:text-white/50"> · {s.suggestion}</span>}
            </li>
          ))}
        </ul>
      </ChartCard>
    </div>
  )
}
