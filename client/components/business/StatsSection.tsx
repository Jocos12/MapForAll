'use client'

import { useState } from 'react'
import { BarChart3, CalendarDays, Download, Eye, Link2, MapPinned, Star, TrendingUp } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { RatingBarChart, TrendChip, ViewsLineChart, useChartEmpty } from '@/components/business/charts'
import type { StatTarget } from '@/components/business/StatCards'
import type { OwnerStats } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'
import { WEEK_DAYS } from '@/lib/hours'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function StatsSection({
  stats,
  published,
  placeName,
  onOpen,
}: {
  stats: OwnerStats
  published: boolean
  placeName: string
  onOpen: (target: StatTarget) => void
}) {
  const { t, lang } = useI18n()
  const empty = useChartEmpty(published)
  const [range, setRange] = useState<Range>(30)
  const series = stats.daily90
  const rows = series.slice(-range)
  const previousRows = range < 90 ? series.slice(-range * 2, -range) : []
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const previous = previousRows.reduce((sum, row) => sum + row.count, 0)
  const app = rows.reduce((sum, row) => sum + row.app, 0)
  const link = rows.reduce((sum, row) => sum + row.link, 0)
  const perDay = Math.round((total / range) * 10) / 10
  const title = t('biz.stats.chartTitle')

  const weekdays = WEEK_DAYS.map(() => 0)
  for (const row of rows) weekdays[(new Date(`${row.day}T12:00:00`).getDay() + 6) % 7] += row.count
  const bestIndex = weekdays.some((n) => n > 0) ? weekdays.indexOf(Math.max(...weekdays)) : -1
  const weekdayMax = Math.max(1, ...weekdays)

  function exportCsv() {
    const lines = [
      [t('biz.stats.csv.date'), t('biz.stats.csv.total'), t('biz.stats.csv.app'), t('biz.stats.csv.link')].map(csvCell).join(','),
      ...rows.map((row) => [row.day, row.count, row.app, row.link].join(',')),
      '',
      [t('biz.stats.csv.stars'), t('biz.stats.csv.count')].map(csvCell).join(','),
      ...stats.histogram.map((n, i) => `${i + 1},${n}`),
    ]
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const slug = placeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fiche'
    const a = document.createElement('a')
    a.href = url
    a.download = `mapforall-${slug}-${range}j-${rows[rows.length - 1]?.day ?? 'stats'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const kpis = [
    { icon: Eye, label: t('biz.stats.kpi.views'), value: String(total), extra: previousRows.length ? <TrendChip current={total} previous={previous} label={t('biz.stats.vsPrevious')} /> : null },
    { icon: TrendingUp, label: t('biz.stats.kpi.perDay'), value: perDay.toLocaleString(), extra: null },
    { icon: MapPinned, label: t('biz.stats.sourceApp'), value: String(app), extra: null },
    { icon: Link2, label: t('biz.stats.sourceLink'), value: String(link), extra: null },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] p-0.5 text-[12.5px]" role="group" aria-label={t('biz.stats.range')}>
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${BIZ.focus} ${
                range === value ? 'bg-white text-[#18181B] shadow-sm' : 'text-[#52525B] hover:text-[#18181B]'
              }`}
            >
              {t('biz.stats.days').replace('{n}', String(value))}
            </button>
          ))}
        </div>
        <button type="button" onClick={exportCsv} className={`${BIZ.secondary} h-9`}>
          <Download size={14} aria-hidden />
          {t('biz.stats.export')}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ icon: Icon, label, value, extra }) => (
          <div key={label} className={`${BIZ.card} p-4`}>
            <dt className="flex items-center gap-1.5 text-[12px] font-medium text-[#52525B]">
              <Icon size={14} className="text-[#E8672A]" aria-hidden />
              {label}
            </dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-display text-[24px] font-semibold leading-none tabular-nums text-[#18181B]">{value}</span>
              {extra}
            </dd>
          </div>
        ))}
      </dl>

      <section className={`${BIZ.card} p-5`}>
        <h2 className={BIZ.cardTitle}>
          <BarChart3 size={16} className="text-[#E8672A]" aria-hidden />
          {title}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-[#52525B]">
          {t('biz.stats.chartTotal').replace('{n}', String(total)).replace('{d}', String(range))}
        </p>
        <div className="mt-5">
          <ViewsLineChart daily={rows} title={title} empty={series.every((row) => row.count === 0) ? empty.views : undefined} />
        </div>
        {total === 0 && series.some((row) => row.count > 0) && <p className="mt-3 text-[12.5px] text-[#52525B]">{t('biz.stats.noViews')}</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${BIZ.card} p-5`}>
          <h2 className={BIZ.cardTitle}>
            <Link2 size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.stats.sourcesTitle')}
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {[
              { label: t('biz.stats.sourceAppLong'), value: app, color: 'bg-[#E8672A]' },
              { label: t('biz.stats.sourceLinkLong'), value: link, color: 'bg-[#2E8B57]' },
            ].map((row) => {
              const pct = total ? Math.round((row.value / total) * 100) : 0
              return (
                <li key={row.label}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-[#18181B]">{row.label}</span>
                    <span className="tabular-nums text-[#52525B]">{row.value} · {pct}%</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-[var(--biz-empty-bar)]">
                    <div className={`h-2 rounded-full ${row.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          {link === 0 && (
            <button type="button" onClick={() => onOpen('promotion')} className={`mt-4 text-[12.5px] font-semibold ${BIZ.accentText} underline-offset-2 hover:underline ${BIZ.focus}`}>
              {t('biz.stats.shareHint')}
            </button>
          )}
        </section>

        <section className={`${BIZ.card} p-5`}>
          <h2 className={BIZ.cardTitle}>
            <CalendarDays size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.stats.weekdayTitle')}
          </h2>
          <div className="mt-4 flex h-[120px] items-end gap-2" role="img" aria-label={t('biz.stats.weekdayTitle')}>
            {WEEK_DAYS.map((day, i) => (
              <div key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[11px] tabular-nums text-[#52525B]">{weekdays[i] || ''}</span>
                <div
                  className={`w-full rounded-t-md ${i === bestIndex ? 'bg-[#E8672A]' : 'bg-[var(--biz-empty-bar)]'}`}
                  style={{ height: `${Math.max(4, (weekdays[i] / weekdayMax) * 80)}px` }}
                />
                <span className={`text-[11px] ${i === bestIndex ? 'font-semibold text-[#18181B]' : 'text-[#52525B]'}`}>{t(`biz.days.short.${day}`)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-[#52525B]">
            {bestIndex >= 0
              ? t('biz.stats.weekdayBest').replace('{day}', lang === 'fr' ? t(`biz.days.${WEEK_DAYS[bestIndex]}`).toLowerCase() : t(`biz.days.${WEEK_DAYS[bestIndex]}`))
              : t('biz.stats.noViews')}
          </p>
        </section>
      </div>

      <section className={`${BIZ.card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={BIZ.cardTitle}>
            <Star size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.stats.starsTitle')}
          </h2>
          {stats.average != null && (
            <span className="text-[12.5px] text-[#52525B]">
              {stats.average.toLocaleString()} / 5 · {t('biz.stats.reviewsCount').replace('{n}', String(stats.reviewCount))}
            </span>
          )}
        </div>
        <div className="mt-4 max-w-xl">
          <RatingBarChart histogram={stats.histogram} title={t('biz.stats.starsTitle')} empty={empty.ratings} />
        </div>
      </section>
    </div>
  )
}
