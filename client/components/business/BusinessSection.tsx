'use client'

import { Check, Plus } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { CategoryIcon } from '@/components/CategoryIcon'
import { BusinessForm, type BusinessFormValues } from '@/components/business/BusinessForm'
import { DangerZone } from '@/components/business/DangerZone'
import { ListingPreview } from '@/components/business/ListingPreview'
import type { OwnedSummary, OwnerDashboard } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

const MAX_OWNED = 5

export function statusKey(row: Pick<OwnedSummary, 'status' | 'paused'>): 'paused' | 'validated' | 'rejected' | 'pending' {
  if (row.paused) return 'paused'
  return row.status === 'validated' || row.status === 'rejected' ? row.status : 'pending'
}

export const STATUS_DOT: Record<ReturnType<typeof statusKey>, string> = {
  validated: 'bg-[#2E8B57]',
  pending: 'bg-[#E0A800]',
  rejected: 'bg-[#DC2626]',
  paused: 'bg-[#71717A]',
}

interface Props {
  data: OwnerDashboard
  formKey: number
  saving: boolean
  saveError: string
  saveOk: string
  onSave: (values: BusinessFormValues) => void
  onSwitch: (placeId: string) => void
  onPauseChanged: () => void
  onClosed: (remaining: number) => void
}

export function BusinessSection({ data, formKey, saving, saveError, saveOk, onSave, onSwitch, onPauseChanged, onClosed }: Props) {
  const { t } = useI18n()
  const place = data.place
  if (!place) return null
  const canAdd = data.places.length < MAX_OWNED

  return (
    <div className="flex flex-col gap-5">
      <section className={`${BIZ.card} p-5`} aria-labelledby="my-places">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="my-places" className={BIZ.cardTitle}>{t('biz.places.title')}</h2>
            <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.places.subtitle').replace('{n}', String(MAX_OWNED))}</p>
          </div>
          {canAdd && (
            <a href="/business/onboarding?new=1" className={`${BIZ.secondary} h-10`}>
              <Plus size={15} aria-hidden />
              {t('biz.places.add')}
            </a>
          )}
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.places.map((row) => {
            const active = row.place_id === place.place_id
            const key = statusKey(row)
            return (
              <li key={row.place_id}>
                <button
                  type="button"
                  onClick={() => !active && onSwitch(row.place_id)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${BIZ.focus} ${
                    active ? 'border-[#E8672A] bg-[#FFF7F2] ring-1 ring-[#E8672A]' : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F4F4F5] text-[#3F3F46]">
                    <CategoryIcon categories={row.categories} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#18181B]">{row.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#3F3F46]">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[key]}`} aria-hidden />
                      {t(`biz.status.${key}`)}
                    </span>
                  </span>
                  {active && <Check size={16} className="shrink-0 text-[#C2410C]" aria-label={t('biz.places.active')} />}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <ListingPreview data={data} />

      <div>
        <h2 className="mb-3 text-[16px] font-semibold text-[#18181B]">{t('biz.nav.edit')}</h2>
        <BusinessForm
          key={`${place.place_id}-${formKey}`}
          mode="edit"
          initial={data.form}
          busy={saving}
          error={saveError}
          success={saveOk}
          onSubmit={onSave}
        />
      </div>

      <DangerZone
        placeId={place.place_id}
        name={place.name}
        paused={place.paused === true}
        onChanged={onPauseChanged}
        onClosed={onClosed}
      />
    </div>
  )
}
