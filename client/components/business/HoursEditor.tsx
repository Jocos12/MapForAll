'use client'

import { CalendarClock, Copy } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { WEEK_DAYS, defaultWeek, type WeekDay, type WeekHours } from '@/lib/hours'
import { BIZ } from '@/components/business/ui'

interface Props {
  value: WeekHours | null
  legacy: string
  onChange: (week: WeekHours | null) => void
}

export function HoursEditor({ value, legacy, onChange }: Props) {
  const { t } = useI18n()

  if (!value) {
    return (
      <div className="rounded-xl border border-dashed border-[#D4D4D8] bg-[#FAFAFA] p-4">
        <p className="text-[13px] text-[#3F3F46]">{t('biz.hours.notSet')}</p>
        {legacy && <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.hours.current')} {legacy}</p>}
        <button type="button" onClick={() => onChange(defaultWeek())} className={`${BIZ.secondary} mt-3 h-9`}>
          <CalendarClock size={15} />
          {t('biz.hours.define')}
        </button>
      </div>
    )
  }

  const week = value
  function patchDay(day: WeekDay, next: Partial<WeekHours[WeekDay]>) {
    onChange({ ...week, [day]: { ...week[day], ...next } })
  }

  function copyMonday() {
    const monday = week.mon
    const next = { ...week }
    for (const day of WEEK_DAYS) {
      if (day !== 'mon' && !week[day].closed) next[day] = { ...monday }
    }
    onChange(next)
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-[#E4E4E7]">
        {WEEK_DAYS.map((day) => {
          const row = week[day]
          const id = `hours-${day}`
          return (
            <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#F0F0F2] px-3 py-2.5 last:border-b-0">
              <span className="w-24 text-[13px] font-medium text-[#18181B]">{t(`biz.days.${day}`)}</span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-[#3F3F46]">
                <input
                  type="checkbox"
                  checked={!row.closed}
                  onChange={(e) => patchDay(day, { closed: !e.target.checked })}
                  className="h-4 w-4 accent-[#E8672A]"
                />
                {row.closed ? t('biz.hours.closed') : t('biz.hours.open')}
              </label>
              {!row.closed && (
                <span className="ml-auto flex items-center gap-1.5">
                  <label htmlFor={`${id}-open`} className="sr-only">{t('biz.hours.from')} {t(`biz.days.${day}`)}</label>
                  <input
                    id={`${id}-open`}
                    type="time"
                    value={row.open}
                    onChange={(e) => patchDay(day, { open: e.target.value })}
                    className="h-9 rounded-lg border border-[#D4D4D8] bg-white px-2 text-[13px] tabular-nums outline-none focus:border-[#E8672A] focus:ring-2 focus:ring-[#E8672A]/20"
                  />
                  <span aria-hidden className="text-[#71717A]">–</span>
                  <label htmlFor={`${id}-close`} className="sr-only">{t('biz.hours.to')} {t(`biz.days.${day}`)}</label>
                  <input
                    id={`${id}-close`}
                    type="time"
                    value={row.close}
                    onChange={(e) => patchDay(day, { close: e.target.value })}
                    className="h-9 rounded-lg border border-[#D4D4D8] bg-white px-2 text-[13px] tabular-nums outline-none focus:border-[#E8672A] focus:ring-2 focus:ring-[#E8672A]/20"
                  />
                </span>
              )}
            </div>
          )
        })}
      </div>
      <button type="button" onClick={copyMonday} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#C2410C] hover:underline">
        <Copy size={13} />
        {t('biz.hours.copyMonday')}
      </button>
    </div>
  )
}
