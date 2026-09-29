'use client'

import dynamic from 'next/dynamic'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCard } from '@/components/admin/ChartCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { useI18n } from '@/components/I18nProvider'

const SectorMap = dynamic(
  () => import('@/components/admin/SectorMap').then((m) => m.SectorMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] rounded-xl" /> },
)

const BRAND = '#E8672A'
const COLORS = [BRAND, '#1F8A5B', '#3B82F6', '#854D0E', '#7C3AED', '#0D9488', '#DC2626', '#64748B']

export type DashboardChartsData = {
  placesOverTime: { date: string; count: number }[]
  approvalGauge: number
  byCategory: { name: string; value: number }[]
  localFormalAccessible: { name: string; local: number; formal: number; accessible: number }[]
  usersGrowth: { date: string; count: number }[]
  topViewed: { name: string; views: number }[]
  bySector: { sector: string; count: number; lat: number; lng: number }[]
}

export function DashboardCharts({ charts }: { charts: DashboardChartsData }) {
  const { t } = useI18n()

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={t('admin.dashboard.charts.placesOverTime')} delay={0.05}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={charts.placesOverTime}>
              <defs>
                <linearGradient id="fillPlaces" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke={BRAND} fill="url(#fillPlaces)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.dashboard.charts.approval')} delay={0.08}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[
                  { name: 'ok', value: charts.approvalGauge },
                  { name: 'rest', value: Math.max(0, 100 - charts.approvalGauge) },
                ]}
                dataKey="value"
                innerRadius={70}
                outerRadius={95}
                startAngle={90}
                endAngle={-270}
              >
                <Cell fill={BRAND} />
                <Cell fill="rgba(0,0,0,0.08)" />
              </Pie>
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-current text-3xl font-semibold"
              >
                {charts.approvalGauge}%
              </text>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.dashboard.charts.byCategory')} delay={0.1}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={charts.byCategory} dataKey="value" nameKey="name" outerRadius={85} label>
                {charts.byCategory.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.dashboard.charts.stacked')} delay={0.12}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.localFormalAccessible}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="local" stackId="a" fill={BRAND} name={t('admin.dashboard.charts.local')} />
              <Bar dataKey="formal" stackId="a" fill="#64748B" name={t('admin.dashboard.charts.formal')} />
              <Bar dataKey="accessible" fill="#1F8A5B" name={t('admin.dashboard.charts.accessible')} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.dashboard.charts.usersGrowth')} delay={0.14}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={charts.usersGrowth}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t('admin.dashboard.charts.topViewed')} delay={0.16}>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.topViewed} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="views" fill={BRAND} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard
        title={t('admin.dashboard.charts.sectors')}
        subtitle={t('admin.dashboard.charts.sectorsHint')}
        className="lg:col-span-2"
        delay={0.18}
      >
        <SectorMap points={charts.bySector} />
      </ChartCard>
    </section>
  )
}
