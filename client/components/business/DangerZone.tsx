'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, PauseCircle, PlayCircle, Trash2, X } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { withPlace } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

interface Props {
  placeId: string
  name: string
  paused: boolean
  onChanged: (paused: boolean) => void
  onClosed: (remaining: number) => void
}

export function DangerZone({ placeId, name, paused, onChanged, onClosed }: Props) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<'pause' | 'close' | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!step) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy !== 'close') setStep(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, busy])

  async function send(mode: 'pause' | 'resume' | 'close') {
    setError('')
    setBusy(mode === 'close' ? 'close' : 'pause')
    try {
      const res = await fetch(withPlace('/api/business', placeId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'close' ? { mode, confirmName: typed } : { mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? t('auth.errors.generic'))
        return
      }
      if (mode === 'close') onClosed(typeof data.remaining === 'number' ? data.remaining : 0)
      else onChanged(mode === 'pause')
    } catch {
      setError(t('auth.errors.network'))
    } finally {
      setBusy(null)
    }
  }

  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()

  return (
    <section className="rounded-2xl border border-[#FECACA] bg-white p-5" aria-labelledby="danger-title">
      <h2 id="danger-title" className="flex items-center gap-2 text-[14.5px] font-semibold text-[#991B1B]">
        <AlertTriangle size={16} aria-hidden />
        {t('biz.danger.title')}
      </h2>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14px] font-medium text-[#18181B]">{paused ? t('biz.danger.resumeTitle') : t('biz.danger.pauseTitle')}</p>
          <p className="text-[12.5px] text-[#52525B]">{paused ? t('biz.danger.resumeBody') : t('biz.danger.pauseBody')}</p>
        </div>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void send(paused ? 'resume' : 'pause')}
          className={`${BIZ.secondary} h-10 shrink-0`}
        >
          {busy === 'pause' ? <Loader2 size={15} className="animate-spin" /> : paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
          {paused ? t('biz.danger.resume') : t('biz.danger.pause')}
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-4 border-t border-[#F4F4F5] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14px] font-medium text-[#18181B]">{t('biz.danger.closeTitle')}</p>
          <p className="text-[12.5px] text-[#52525B]">{t('biz.danger.closeBody')}</p>
        </div>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => { setTyped(''); setError(''); setStep(1) }}
          className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#FCA5A5] bg-white px-4 text-[13px] font-medium text-[#991B1B] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50 ${BIZ.focus}`}
        >
          <Trash2 size={15} />
          {t('biz.danger.close')}
        </button>
      </div>
      {error && !step && <p className="mt-3 text-[13px] text-[#B91C1C]" role="alert">{error}</p>}

      {step > 0 && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="close-title">
          <div className="absolute inset-0 bg-black/50" onClick={() => busy !== 'close' && setStep(0)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-[#18181B] shadow-2xl">
            <button
              type="button"
              onClick={() => setStep(0)}
              disabled={busy === 'close'}
              aria-label={t('biz.danger.cancel')}
              className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[#52525B] hover:bg-[#F4F4F5] ${BIZ.focus}`}
            >
              <X size={16} />
            </button>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[#991B1B]">{t('biz.danger.step').replace('{n}', String(step))}</p>
            <h3 id="close-title" className="mt-1 text-[18px] font-semibold">{t('biz.danger.confirmTitle')}</h3>
            {step === 1 ? (
              <>
                <p className="mt-3 text-[14px] leading-relaxed text-[#3F3F46]">{t('biz.danger.confirmBody1')}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-[#3F3F46]">
                  <li>{t('biz.danger.lose1')}</li>
                  <li>{t('biz.danger.lose2')}</li>
                  <li>{t('biz.danger.lose3')}</li>
                </ul>
                <p className="mt-3 text-[13px] text-[#3F3F46]">{t('biz.danger.suggestPause')}</p>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" autoFocus onClick={() => setStep(0)} className={`${BIZ.secondary} h-10`}>
                    {t('biz.danger.cancel')}
                  </button>
                  <button type="button" onClick={() => setStep(2)} className={`h-10 rounded-lg bg-[#B91C1C] px-4 text-[13px] font-semibold text-white hover:bg-[#991B1B] ${BIZ.focus}`}>
                    {t('biz.danger.continue')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label htmlFor="confirm-name" className="mt-3 block text-[14px] leading-relaxed text-[#3F3F46]">
                  {t('biz.danger.typeName')} <strong className="text-[#18181B]">{name}</strong>
                </label>
                <input
                  id="confirm-name"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className={`${BIZ.field} mt-3`}
                />
                {error && <p className="mt-2 text-[13px] text-[#B91C1C]" role="alert">{error}</p>}
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setStep(1)} disabled={busy === 'close'} className={`${BIZ.secondary} h-10`}>
                    {t('biz.danger.back')}
                  </button>
                  <button
                    type="button"
                    disabled={!matches || busy === 'close'}
                    onClick={() => void send('close')}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#B91C1C] px-4 text-[13px] font-semibold text-white hover:bg-[#991B1B] disabled:opacity-40 ${BIZ.focus}`}
                  >
                    {busy === 'close' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    {t('biz.danger.closeForever')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
