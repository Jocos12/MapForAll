'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import { LineChart, Star, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { GREEN, ORANGE } from '@/components/business/ui'

/** 1★ → 5★: light red, orange, green. Each bar clears 3:1 against white. */
const STAR_COLORS = ['#D9443C', '#E06A50', '#D97706', '#3F9A68', GREEN]

const W = 600
const H = 180

function niceMax(value: number): number {
  if (value <= 4) return 4
  const step = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / step) * step
}

/** Empty-state copy for the views and ratings charts; it differs once the listing is live. */
export function useChartEmpty(published: boolean) {
  const { t } = useI18n()
  return {
    views: { title: t('biz.charts.emptyViews.title'), body: t(`biz.charts.emptyViews.${published ? 'live' : 'draft'}`) },
    ratings: { title: t('biz.charts.emptyRatings.title'), body: t('biz.charts.emptyRatings.body') },
  }
}

/** Stand-in for a chart with no data yet, so a new listing reads as "not started" rather than broken. */
export function ChartEmpty({ icon: Icon, title, body, height = 208 }: { icon: LucideIcon; title: string; body: string; height?: number }) {
  return (
    <div
      className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#D4D4D8] bg-[#FAFAFA] px-6 text-center"
      style={{ height }}
    >
      <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full" aria-hidden>
        <path d="M0,50 C40,46 60,30 100,34 S160,52 200,28 S260,18 300,22" fill="none" style={{ stroke: 'var(--biz-grid)' }} strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#FDE8DC] text-[#C2410C]" aria-hidden>
        <Icon size={20} />
      </span>
      <p className="relative mt-3 text-[13.5px] font-semibold text-[#18181B]">{title}</p>
      <p className="relative mt-1 max-w-sm text-[12.5px] leading-relaxed text-[#52525B]">{body}</p>
    </div>
  )
}

/** Views per day as a line + area, with a hover/keyboard cursor and a hidden data table for screen readers. */
export function ViewsLineChart({
  daily,
  title,
  empty,
}: {
  daily: Array<{ day: string; count: number }>
  title: string
  empty?: { title: string; body: string }
}) {
  const { t, lang } = useI18n()
  const gradient = useId()
  const [active, setActive] = useState<number | null>(null)
  const locale = lang === 'rw' ? 'en' : lang
  const hasData = daily.some((row) => row.count > 0)
  const max = niceMax(Math.max(0, ...daily.map((row) => row.count)))
  const n = Math.max(1, daily.length - 1)
  const x = (i: number) => (i / n) * W
  const y = (count: number) => H - (count / max) * (H - 12) - 2
  const line = daily.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(row.count).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const fmt = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const point = active != null ? daily[active] : null

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!daily.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      setActive((prev) => Math.min(daily.length - 1, Math.max(0, (prev ?? daily.length - 1) + (prev == null ? 0 : delta))))
    } else if (e.key === 'Escape') setActive(null)
  }

  if (!hasData && empty) return <ChartEmpty icon={LineChart} title={empty.title} body={empty.body} />

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex h-[180px] w-7 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-[#52525B]" aria-hidden>
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div
          className="relative h-[180px] flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#E8672A]"
          tabIndex={0}
          role="img"
          aria-label={`${title}. ${t('biz.charts.keyboardHint')}`}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={ORANGE} stopOpacity="0.22" />
                <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} style={{ stroke: 'var(--biz-grid)' }} strokeDasharray={f ? '4 4' : undefined} vectorEffect="non-scaling-stroke" />
            ))}
            <g className="biz-reveal">
              <path d={area} fill={`url(#${gradient})`} />
              <path d={line} fill="none" stroke={ORANGE} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
            {active != null && (
              <line x1={x(active)} x2={x(active)} y1="0" y2={H} style={{ stroke: 'var(--biz-ink)' }} strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />
            )}
            {daily.map((row, i) => (
              <rect
                key={row.day}
                x={x(i) - W / n / 2}
                y="0"
                width={W / n}
                height={H}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
            ))}
          </svg>
          {point && active != null && (
            <>
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#E8672A] shadow"
                style={{ left: `${(active / n) * 100}%`, top: `${(y(point.count) / H) * 100}%` }}
              />
              <span
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[#18181B] px-2 py-1 text-[11.5px] font-medium text-white shadow-lg"
                style={{ left: `${Math.min(92, Math.max(8, (active / n) * 100))}%` }}
                role="status"
              >
                {fmt(point.day)}{lang === 'fr' ? ' : ' : ': '}{t('biz.charts.viewsCount').replace('{n}', String(point.count))}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="ml-9 mt-1.5 flex justify-between text-[11px] text-[#52525B]" aria-hidden>
        {daily.length > 0 && (
          <>
            <span>{fmt(daily[0].day)}</span>
            <span>{fmt(daily[Math.floor(daily.length / 2)].day)}</span>
            <span>{fmt(daily[daily.length - 1].day)}</span>
          </>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {daily.map((row) => (
            <tr key={row.day}><th scope="row">{fmt(row.day)}</th><td>{row.count}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Review count per star rating, 1 to 5, as vertical bars. */
export function RatingBarChart({
  histogram,
  title,
  empty,
}: {
  histogram: number[]
  title: string
  empty?: { title: string; body: string }
}) {
  const { t } = useI18n()
  const max = Math.max(1, ...histogram)
  const total = histogram.reduce((sum, value) => sum + value, 0)
  if (!total && empty) return <ChartEmpty icon={Star} title={empty.title} body={empty.body} />
  return (
    <div>
      <div className="flex h-[180px] items-end gap-3 border-b border-[#E4E4E7] px-1" role="img" aria-label={title}>
        {[1, 2, 3, 4, 5].map((stars) => {
          const count = histogram[stars - 1] ?? 0
          return (
            <div key={stars} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[12px] font-semibold tabular-nums text-[#18181B]">{count}</span>
              <div
                className="biz-bar w-full max-w-[56px] rounded-t-md"
                style={{
                  height: `${count ? Math.max(6, (count / max) * 82) : 2}%`,
                  background: count ? STAR_COLORS[stars - 1] : 'var(--biz-empty-bar)',
                  animationDelay: `${(stars - 1) * 60}ms`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-3 px-1">
        {[1, 2, 3, 4, 5].map((stars) => (
          <span key={stars} className="inline-flex flex-1 items-center justify-center gap-0.5 text-[12px] font-medium text-[#3F3F46]">
            {stars}
            <Star size={11} className="fill-amber-500 text-amber-500" aria-hidden />
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {[5, 4, 3, 2, 1].map((stars) => (
            <tr key={stars}><th scope="row">{stars} {t('biz.charts.stars')}</th><td>{histogram[stars - 1] ?? 0}</td></tr>
          ))}
        </tbody>
      </table>
      {total === 0 && <p className="mt-3 text-[12.5px] text-[#52525B]">{t('biz.reviews.empty')}</p>}
    </div>
  )
}

/** Week-over-week change: green when up, red when down. */
export function TrendChip({ current, previous, label }: { current: number; previous: number; label?: string }) {
  const { t } = useI18n()
  const caption = label ?? t('biz.charts.vsLastWeek')
  if (!previous && !current) return null
  const pct = previous ? Math.round(((current - previous) / previous) * 100) : 100
  const up = current >= previous
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
        up ? 'bg-[#2E8B57]/10 text-[#1F6B43]' : 'bg-red-50 text-[#B91C1C]'
      }`}
      title={caption}
    >
      {up ? '▲' : '▼'} {Math.abs(pct)}%
      <span className="sr-only font-normal sm:not-sr-only">{caption}</span>
    </span>
  )
}
