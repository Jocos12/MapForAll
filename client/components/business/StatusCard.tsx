'use client'

import type { CSSProperties } from 'react'
import { Check, CheckCircle2, Clock, ExternalLink, Eye, PauseCircle, ShieldCheck, X, XCircle } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { MODERATION_CHECKS, type ModerationCheck } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

const TONES = {
  validated: { icon: CheckCircle2, badge: 'bg-[#2E8B57] text-white', ring: 'border-[#2E8B57]/35 bg-[#2E8B57]/[0.06]' },
  pending: { icon: Clock, badge: 'bg-[#F5C542] text-[#422006]', ring: 'border-[#E0A800]/45 bg-[#FFF8E1]' },
  rejected: { icon: XCircle, badge: 'bg-[#DC2626] text-white', ring: 'border-[#DC2626]/35 bg-[#FEF2F2]' },
  paused: { icon: PauseCircle, badge: 'bg-[#52525B] text-white', ring: 'border-[#A1A1AA]/60 bg-[#F4F4F5]' },
} as const

/** Thin labelled bar: "3/4 critères validés". */
function CheckBar({ passed, total, label }: { passed: number; total: number; label: string }) {
  const pct = Math.round((passed / total) * 100)
  const done = passed === total
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-medium text-[#3F3F46]">{label}</span>
        <span className={`font-semibold tabular-nums ${done ? 'text-[#1F6B43]' : 'text-[#713F12]'}`}>{passed}/{total}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#E4E4E7]"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passed}
        aria-valuetext={`${passed}/${total}`}
      >
        <div className={`biz-progress h-full rounded-full ${done ? 'bg-[#2E8B57]' : 'bg-[#E0A800]'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function StatusCard({
  status,
  reason,
  paused,
  placeId,
  checks,
  onFix,
  onPreview,
  className = '',
  style,
}: {
  status: string
  reason?: string
  paused?: boolean
  placeId?: string
  checks?: Record<ModerationCheck, boolean>
  onFix?: () => void
  onPreview?: () => void
  className?: string
  style?: CSSProperties
}) {
  const { t } = useI18n()
  const key: keyof typeof TONES = paused ? 'paused' : status === 'validated' || status === 'rejected' ? status : 'pending'
  const tone = TONES[key]
  const Icon = tone.icon
  const passed = checks ? MODERATION_CHECKS.filter((id) => checks[id]).length : MODERATION_CHECKS.length
  const total = MODERATION_CHECKS.length
  const failing = checks ? MODERATION_CHECKS.filter((id) => !checks[id]) : []

  return (
    <section className={`flex flex-col rounded-2xl border p-5 ${tone.ring} ${className}`} style={style} aria-labelledby="listing-status">
      <p id="listing-status" className="text-[12px] font-semibold uppercase tracking-wide text-[#3F3F46]">{t('biz.status.title')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold ${tone.badge}`}>
          <Icon size={15} aria-hidden />
          {t(`biz.status.${key}`)}
        </span>
        {key === 'pending' && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#713F12]">
            <Clock size={13} aria-hidden />
            {t('biz.status.eta')}
          </span>
        )}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-[#27272A]">{t(`biz.status.${key}Hint`)}</p>

      {key === 'pending' && (
        <div className="mt-3 rounded-xl bg-white/80 p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#18181B]">
            <ShieldCheck size={14} className="text-[#1F6B43]" aria-hidden />
            {t('biz.status.checksTitle')}
          </p>
          <div className="mt-2.5">
            <CheckBar passed={passed} total={total} label={t('biz.status.autoChecks')} />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {MODERATION_CHECKS.map((id) => {
              const ok = !checks || checks[id]
              return (
                <li key={id} className="flex items-start gap-2 text-[12.5px] leading-snug text-[#3F3F46]">
                  {ok
                    ? <Check size={13} className="mt-0.5 shrink-0 text-[#1F6B43]" aria-label={t('biz.status.checkOk')} />
                    : <X size={13} className="mt-0.5 shrink-0 text-[#B91C1C]" aria-label={t('biz.status.checkKo')} />}
                  <span>
                    {t(`biz.status.checks.${id}`)}
                    {!ok && <span className="block text-[12px] text-[#B91C1C]">{t(`biz.status.checkFix.${id}`)}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {failing.length > 0 && onFix && (
            <button type="button" onClick={onFix} className={`${BIZ.secondary} mt-3 h-8`}>{t('biz.status.fixChecks')}</button>
          )}
          <p className="mt-2.5 text-[11.5px] leading-snug text-[#52525B]">{t('biz.status.autoChecksNote')}</p>
        </div>
      )}

      {key === 'validated' && (
        <div className="mt-3">
          <CheckBar passed={total} total={total} label={t('biz.status.teamChecked')} />
        </div>
      )}

      {key === 'validated' && (
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          {onPreview && (
            <button type="button" onClick={onPreview} className={`${BIZ.primary} h-9`}>
              <Eye size={14} aria-hidden />
              {t('biz.status.seePublic')}
            </button>
          )}
          {placeId && (
            <a href={`/p/${encodeURIComponent(placeId)}`} target="_blank" rel="noreferrer" className={`${BIZ.secondary} h-9`}>
              <ExternalLink size={14} aria-hidden />
              {t('biz.status.openLink')}
            </a>
          )}
        </div>
      )}

      {key === 'rejected' && (
        <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[13px] text-[#7F1D1D]">
          <strong>{t('biz.status.reason')}</strong> {reason?.trim() || t('biz.status.noReason')}
        </p>
      )}
      {(key === 'rejected' || key === 'paused') && onFix && (
        <button type="button" onClick={onFix} className={`${BIZ.primary} mt-3 h-9 self-start`}>
          {t(key === 'rejected' ? 'biz.status.fix' : 'biz.status.manage')}
        </button>
      )}
    </section>
  )
}
