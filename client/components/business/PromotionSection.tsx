'use client'

import { useState } from 'react'
import { Accessibility, ArrowRight, CheckCircle2, ListChecks, Loader2, Sparkles, Store, XCircle } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { accessDetail } from '@/lib/access'
import { checklistFor, MIN_PHOTOS, type ChecklistItem } from '@/components/business/checklist'
import { RecommendCard, ShareCard } from '@/components/business/RecommendSection'
import { withPlace, type OwnerDashboard, type PlaceLite } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

interface Props {
  data: OwnerDashboard
  onJump: (anchor: string) => void
  onRefresh: () => Promise<void>
  onRecommendsSaved: (list: PlaceLite[]) => void
}

function Checklist({ data, onJump, onRefresh }: Pick<Props, 'data' | 'onJump' | 'onRefresh'>) {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const items = checklistFor(data)
  const done = items.filter((item) => item.done).length
  const pct = Math.round((done / items.length) * 100)
  const placeId = data.place?.place_id

  async function confirmHours() {
    setConfirming(true)
    try {
      await fetch(withPlace('/api/business', placeId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmHours: true }),
      })
      await onRefresh()
    } finally {
      setConfirming(false)
    }
  }

  function action(item: ChecklistItem) {
    if (item.id === 'hours' && data.form.hoursWeek) {
      return (
        <button type="button" disabled={confirming} onClick={() => void confirmHours()} className={`${BIZ.secondary} h-8 px-3 text-[12px]`}>
          {confirming && <Loader2 size={13} className="animate-spin" />}
          {t('biz.checklist.confirmHours')}
        </button>
      )
    }
    return (
      <button type="button" onClick={() => onJump(item.target)} className={`${BIZ.secondary} h-8 px-3 text-[12px]`}>
        {t('biz.checklist.fix')}
        <ArrowRight size={13} aria-hidden />
      </button>
    )
  }

  return (
    <section className={`${BIZ.card} p-5`} aria-labelledby="checklist-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="checklist-title" className={BIZ.cardTitle}>
            <ListChecks size={16} className="text-[#2E8B57]" aria-hidden />
            {t('biz.checklist.title')}
          </h2>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-[#52525B]">{t('biz.checklist.subtitle')}</p>
        </div>
        <div className="text-right">
          <p className="text-[26px] font-semibold leading-none tabular-nums text-[#18181B]">{pct}%</p>
          <p className="text-[11.5px] text-[#52525B]">{t('biz.checklist.progress').replace('{done}', String(done)).replace('{total}', String(items.length))}</p>
        </div>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-[#E4E4E7]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('biz.checklist.title')}
      >
        <div className="h-full rounded-full bg-[#2E8B57] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 divide-y divide-[#F4F4F5]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2.5">
            {item.done ? (
              <CheckCircle2 size={20} className="shrink-0 text-[#2E8B57]" aria-label={t('biz.checklist.done')} />
            ) : (
              <XCircle size={20} className="shrink-0 text-[#DC2626]" aria-label={t('biz.checklist.todo')} />
            )}
            <span className="min-w-0 flex-1">
              <span className={`block text-[13.5px] ${item.done ? 'text-[#52525B] line-through decoration-[#A1A1AA]' : 'font-medium text-[#18181B]'}`}>
                {t(`biz.checklist.items.${item.label}`).replace('{n}', String(MIN_PHOTOS))}
              </span>
              {!item.done && (
                <span className="block text-[12px] text-[#52525B]">{t(`biz.checklist.why.${item.id}`)}</span>
              )}
            </span>
            {!item.done && action(item)}
          </li>
        ))}
      </ul>
    </section>
  )
}

function InclusionCard({ data }: { data: OwnerDashboard }) {
  const { t } = useI18n()
  const place = data.place
  if (!place) return null
  const detail = accessDetail(place)
  const local = place.local_business === true
  const accessible = detail.entrance
  const published = place.status === 'validated' && !place.paused
  const headline = local && accessible
    ? t('biz.inclusion.both')
    : local
      ? t('biz.inclusion.localOnly')
      : accessible
        ? t('biz.inclusion.accessOnly')
        : t('biz.inclusion.none')

  return (
    <section className="rounded-2xl border border-[#2E8B57]/30 bg-gradient-to-br from-[#2E8B57]/[0.07] to-white p-5" aria-labelledby="inclusion-title">
      <h2 id="inclusion-title" className={BIZ.cardTitle}>
        <Sparkles size={16} className="text-[#2E8B57]" aria-hidden />
        {t('biz.inclusion.title')}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${local ? 'bg-[#E8672A] text-[#1A1614]' : 'bg-[#F4F4F5] text-[#52525B]'}`}>
          <Store size={14} aria-hidden />
          {t('badges.local')}
        </span>
        <span aria-hidden className="text-[#71717A]">+</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${accessible ? 'bg-[#2E8B57] text-white' : 'bg-[#F4F4F5] text-[#52525B]'}`}>
          <Accessibility size={14} aria-hidden />
          {t('badges.accessible')}
        </span>
        <ArrowRight size={16} className="text-[#71717A]" aria-hidden />
        <span className="text-[13.5px] font-semibold text-[#18181B]">{headline}</span>
      </div>
      <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-[#27272A]">
        <li className="flex gap-2"><Store size={15} className="mt-0.5 shrink-0 text-[#C2410C]" aria-hidden />{t('biz.inclusion.whyLocal')}</li>
        <li className="flex gap-2"><Accessibility size={15} className="mt-0.5 shrink-0 text-[#1F6B43]" aria-hidden />{t('biz.inclusion.whyAccess')}</li>
        {accessible && (!detail.toilet || !detail.parking) && (
          <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#1F6B43]" aria-hidden />{t('biz.inclusion.moreAccess')}</li>
        )}
      </ul>
      <p className="mt-4 rounded-lg bg-white/80 px-3 py-2 text-[12.5px] text-[#3F3F46]">
        {published ? t('biz.inclusion.tellClients') : t('biz.inclusion.afterPublish')}
      </p>
    </section>
  )
}

export function PromotionSection({ data, onJump, onRefresh, onRecommendsSaved }: Props) {
  const place = data.place
  if (!place) return null
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <InclusionCard data={data} />
        <Checklist data={data} onJump={onJump} onRefresh={onRefresh} />
      </div>
      <ShareCard placeId={place.place_id} placeName={place.name} published={place.status === 'validated' && !place.paused} />
      <RecommendCard
        key={place.place_id}
        placeId={place.place_id}
        initial={data.recommends}
        recommendedBy={data.recommendedBy}
        onSaved={onRecommendsSaved}
      />
    </div>
  )
}
