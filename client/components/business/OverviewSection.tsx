'use client'

import { useState, type CSSProperties } from 'react'
import {
  Accessibility,
  ArrowRight,
  BarChart3,
  Camera,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  HeartHandshake,
  Link2,
  ListChecks,
  MessageSquare,
  Phone,
  Sparkles,
  Star,
  Store,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { accessDetail } from '@/lib/access'
import { RatingBarChart, ViewsLineChart, useChartEmpty } from '@/components/business/charts'
import { ClientPreview } from '@/components/business/ListingPreview'
import { StatCards, type StatTarget } from '@/components/business/StatCards'
import { StatusCard } from '@/components/business/StatusCard'
import { checklistFor, MIN_PHOTOS, type ChecklistItem } from '@/components/business/checklist'
import type { OwnerDashboard } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

type Go = (section: StatTarget) => void

/** Entrance cascade step; the whole overview settles in well under a second. */
const STAGGER = 50

const ITEM_ICONS: Record<ChecklistItem['id'], LucideIcon> = {
  photos: Camera,
  description: FileText,
  hours: Clock,
  access: Accessibility,
  phone: Phone,
  tags: Tags,
  recommend: HeartHandshake,
}

interface Task {
  id: string
  icon: LucideIcon
  label: string
  hint: string
  urgent?: boolean
  run: () => void
}

/** The most urgent fixes first: photos, description, then a bad review left unanswered, then the rest. */
function useTasks(data: OwnerDashboard, go: Go, jump: (anchor: string) => void): Task[] {
  const { t } = useI18n()
  const items = checklistFor(data).filter((item) => !item.done)
  const unanswered = data.reviews.filter((row) => !row.reply)
  const low = unanswered.filter((row) => row.rating <= 2).sort((a, b) => a.rating - b.rating)[0]
  const fromItem = (item: ChecklistItem): Task => ({
    id: item.id,
    icon: ITEM_ICONS[item.id],
    label: item.id === 'photos' && data.form.photos.length === 0
      ? t('biz.todo.firstPhoto')
      : t(`biz.checklist.items.${item.label}`).replace('{n}', String(MIN_PHOTOS)),
    hint: t(`biz.checklist.why.${item.id}`),
    run: () => jump(item.target),
  })
  const tasks: Task[] = []
  for (const item of items.filter((row) => row.id === 'photos' || row.id === 'description')) tasks.push(fromItem(item))
  if (low) {
    tasks.push({
      id: 'low-review',
      icon: MessageSquare,
      label: t('biz.todo.lowReview').replace('{n}', String(low.rating)).replace('{name}', low.firstName),
      hint: t('biz.todo.lowReviewHint'),
      urgent: true,
      run: () => go('reviews'),
    })
  }
  for (const item of items.filter((row) => row.id !== 'photos' && row.id !== 'description')) tasks.push(fromItem(item))
  const others = unanswered.filter((row) => row !== low).length
  if (others) {
    tasks.push({
      id: 'reply',
      icon: MessageSquare,
      label: t('biz.overview.unanswered').replace('{n}', String(others)),
      hint: t('biz.overview.unansweredHint'),
      run: () => go('reviews'),
    })
  }
  return tasks
}

/** Listing completeness on the home screen: one segment per checklist item, same items as Promotion. */
function CompletionCard({ data, jump, style }: { data: OwnerDashboard; jump: (anchor: string) => void; style?: CSSProperties }) {
  const { t } = useI18n()
  const checklist = checklistFor(data)
  const done = checklist.filter((item) => item.done).length
  const pct = Math.round((done / checklist.length) * 100)
  const next = checklist.find((item) => !item.done)
  const complete = !next
  const label = (item: ChecklistItem) => t(`biz.checklist.items.${item.label}`).replace('{n}', String(MIN_PHOTOS))

  return (
    <section className={`${BIZ.card} animate-fade-up p-4 sm:p-5`} style={style} aria-labelledby="completion-title">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 id="completion-title" className={BIZ.cardTitle}>
            {complete ? <CheckCircle2 size={16} className="text-[#2E8B57]" aria-hidden /> : <Gauge size={16} className="text-[#E8672A]" aria-hidden />}
            {t('biz.completion.title')}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#52525B]">
            {complete ? t('biz.completion.done') : t('biz.completion.progress').replace('{done}', String(done)).replace('{total}', String(checklist.length))}
          </p>
        </div>
        <p className={`font-display text-[28px] font-semibold leading-none tabular-nums ${complete ? 'text-[#1F6B43]' : 'text-[#18181B]'}`}>{pct}%</p>
        {next && (
          <button type="button" onClick={() => jump(next.target)} className={`${BIZ.primary} h-9 w-full sm:w-auto`}>
            {t('biz.completion.cta')}<ArrowRight size={14} aria-hidden />
          </button>
        )}
      </div>
      <div
        className="mt-3.5 flex gap-1"
        role="progressbar"
        aria-labelledby="completion-title"
        aria-valuemin={0}
        aria-valuemax={checklist.length}
        aria-valuenow={done}
        aria-valuetext={`${done}/${checklist.length}`}
      >
        {checklist.map((item, i) => (
          <span
            key={item.id}
            title={`${label(item)} — ${t(item.done ? 'biz.completion.itemDone' : 'biz.completion.itemTodo')}`}
            className={`biz-bar-x h-2 flex-1 rounded-full ${item.done ? 'bg-[#2E8B57]' : 'bg-[var(--biz-empty-bar)]'}`}
            style={{ animationDelay: `${120 + i * 40}ms` }}
          />
        ))}
      </div>
      {next && (
        <p className="mt-2 text-[12px] text-[#52525B]">
          {t('biz.completion.next')} <button type="button" onClick={() => jump(next.target)} className={`font-semibold text-[#C2410C] underline-offset-2 hover:underline ${BIZ.focus}`}>{label(next)}</button>
        </p>
      )}
    </section>
  )
}

function TodoCard({ data, go, jump, style }: { data: OwnerDashboard; go: Go; jump: (anchor: string) => void; style?: CSSProperties }) {
  const { t } = useI18n()
  const tasks = useTasks(data, go, jump)
  const shown = tasks.slice(0, 3)
  const more = tasks.length - shown.length

  return (
    <section className={`${BIZ.card} flex animate-fade-up flex-col gap-3 p-5`} style={style} aria-labelledby="todo-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="todo-title" className={BIZ.cardTitle}>
          <ListChecks size={16} className="text-[#E8672A]" aria-hidden />
          {t('biz.overview.todo')}
        </h2>
        {tasks.length > 0 && (
          <span className="rounded-full bg-[#FDE8DC] px-2 py-0.5 text-[11.5px] font-semibold text-[#9A3412]">
            {t('biz.todo.count').replace('{n}', String(tasks.length))}
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl bg-[#2E8B57]/[0.07] p-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#1F6B43]" aria-hidden />
          <p className="text-[13px] text-[#1F6B43]">
            <span className="block font-semibold">{t('biz.todo.allDone')}</span>
            {t('biz.todo.allDoneHint')}
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {shown.map((task, i) => {
            const Icon = task.icon
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={task.run}
                  className={`group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    task.urgent ? 'border-red-200 bg-red-50/60 hover:border-red-300' : 'border-[#E4E4E7] hover:border-[#E8672A]'
                  } ${BIZ.focus}`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      task.urgent ? 'bg-red-100 text-[#B91C1C]' : 'bg-[#FDE8DC] text-[#C2410C]'
                    }`}
                    aria-hidden
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[#18181B]">
                      <span className="sr-only">{i + 1}. </span>{task.label}
                    </span>
                    <span className="block text-[12px] leading-snug text-[#52525B]">{task.hint}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-[#71717A] transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={() => go('promotion')}
        className={`mt-auto flex items-center justify-between gap-2 rounded-xl bg-[#F7F7F8] px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-[#F1F1F3] ${BIZ.focus}`}
      >
        <span className="font-medium text-[#18181B]">{t('biz.todo.fullList')}</span>
        <span className="flex items-center gap-1 font-semibold text-[#C2410C]">
          {more > 0 && t('biz.todo.more').replace('{n}', String(more))}
          <ArrowRight size={13} aria-hidden />
        </span>
      </button>
    </section>
  )
}

/**
 * Ties the owner's numbers to the mission: views MapForAll itself brought in, where the
 * ranking lifts Local and Accessible businesses, next to the reach of their own link.
 */
function ImpactCard({ data, go, jump, style }: { data: OwnerDashboard; go: Go; jump: (anchor: string) => void; style?: CSSProperties }) {
  const { t } = useI18n()
  const place = data.place
  if (!place) return null
  const local = place.local_business === true
  const accessible = accessDetail(place).entrance
  const label = [local && t('badges.local'), accessible && t('badges.accessible')].filter(Boolean).join(' + ')
  const { app, link } = data.stats.reach
  const started = app + link > 0

  return (
    <section
      className="relative animate-fade-up overflow-hidden rounded-2xl bg-[#1A1614] p-6 text-white sm:p-7"
      style={style}
      aria-labelledby="impact-title"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#E8672A]/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-[#2E8B57]/25 blur-3xl" aria-hidden />
      <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p id="impact-title" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[#FFB38A]">
            <Sparkles size={14} aria-hidden />
            {t('biz.impact.kicker')}
          </p>
          <h2 className="mt-2 font-display text-[22px] font-semibold leading-snug sm:text-[26px]">{t('biz.impact.headline')}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${local ? 'bg-[#E8672A] text-[#1A1614]' : 'bg-white/10 text-[#D6D3D1]'}`}>
              <Store size={14} aria-hidden />{t('badges.local')}
            </span>
            <span aria-hidden className="text-[#A8A29E]">+</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${accessible ? 'bg-[#2E8B57] text-white' : 'bg-white/10 text-[#D6D3D1]'}`}>
              <Accessibility size={14} aria-hidden />{t('badges.accessible')}
            </span>
          </div>
          <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-[#D6D3D1]">{t('biz.impact.how')}</p>
          {!accessible && (
            <button type="button" onClick={() => jump('biz-access')} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#FFB38A] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8672A]">
              {t('biz.impact.addAccess')}<ArrowRight size={14} aria-hidden />
            </button>
          )}
        </div>

        <div className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10">
          {started ? (
            <>
              <p className="text-[44px] font-semibold leading-none tracking-tight tabular-nums text-white">{app}</p>
              <p className="mt-2 text-[13.5px] leading-snug text-[#E7E5E4]">
                {label ? t('biz.impact.appViews').replace('{status}', label) : t('biz.impact.appViewsPlain')}
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-white">{t('biz.impact.emptyTitle')}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#D6D3D1]">{t('biz.impact.emptyBody')}</p>
            </>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
            {[
              { icon: Link2, value: link, label: t('biz.impact.linkViews'), to: 'promotion' as const },
              { icon: Users, value: data.recommendedBy, label: t('biz.impact.backers'), to: 'promotion' as const },
              { icon: Star, value: data.stats.reviewCount, label: t('biz.impact.reviews'), to: 'reviews' as const },
            ].map(({ icon: Icon, value, label: text, to }) => (
              <div key={text}>
                <dt className="sr-only">{text}</dt>
                <dd>
                  <button type="button" onClick={() => go(to)} className="w-full rounded-lg px-1 py-1 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8672A]">
                    <Icon size={14} className="mx-auto text-[#FFB38A]" aria-hidden />
                    <span className="mt-1 block text-[18px] font-semibold tabular-nums text-white">{value}</span>
                    <span className="block text-[11px] leading-tight text-[#D6D3D1]" aria-hidden>{text}</span>
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}

export function OverviewSection({ data, go, jump }: { data: OwnerDashboard; go: Go; jump: (anchor: string) => void }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState(false)
  const place = data.place
  const published = place?.status === 'validated' && !place?.paused
  const empty = useChartEmpty(published)
  if (!place) return null
  const at = (step: number): CSSProperties => ({ animationDelay: `${step * STAGGER}ms` })

  return (
    <div className="flex flex-col gap-5">
      <CompletionCard data={data} jump={jump} style={at(0)} />
      <StatCards stats={data.stats} published={published} onOpen={go} delay={STAGGER} />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${BIZ.card} animate-fade-up p-5 lg:col-span-2`} style={at(5)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={BIZ.cardTitle}>
              <BarChart3 size={16} className="text-[#E8672A]" aria-hidden />
              {t('biz.charts.views30')}
            </h2>
            {data.stats.views30 > 0 && (
              <span className="text-[12.5px] text-[#52525B]">{t('biz.stats.chartTotal').replace('{n}', String(data.stats.views30)).replace('{d}', '30')}</span>
            )}
          </div>
          <div className="mt-4">
            <ViewsLineChart daily={data.stats.daily} title={t('biz.charts.views30')} empty={empty.views} />
          </div>
        </section>
        <StatusCard
          status={place.status ?? 'pending'}
          reason={place.rejection_reason}
          paused={place.paused}
          placeId={place.place_id}
          checks={data.checks}
          onFix={() => go('business')}
          onPreview={() => setPreview(true)}
          className="animate-fade-up"
          style={at(6)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${BIZ.card} animate-fade-up p-5 lg:col-span-2`} style={at(7)}>
          <h2 className={BIZ.cardTitle}>
            <Star size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.stats.starsTitle')}
          </h2>
          <div className="mt-4">
            <RatingBarChart histogram={data.stats.histogram} title={t('biz.stats.starsTitle')} empty={empty.ratings} />
          </div>
        </section>
        <TodoCard data={data} go={go} jump={jump} style={at(8)} />
      </div>

      <ImpactCard data={data} go={go} jump={jump} style={at(9)} />

      {preview && <ClientPreview data={data} onClose={() => setPreview(false)} />}
    </div>
  )
}
