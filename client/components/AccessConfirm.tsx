'use client'

import { useEffect, useState } from 'react'
import type { Place } from '@/lib/types'
import { useI18n } from '@/components/I18nProvider'

export function AccessConfirm({ place }: { place: Place }) {
  const { t } = useI18n()
  const [confirmations, setConfirmations] = useState(place.access_confirmations ?? 0)
  const [disputes, setDisputes] = useState(place.access_disputes ?? 0)
  const [mine, setMine] = useState<'yes' | 'no' | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/places/access?placeId=${encodeURIComponent(place.place_id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { confirmations?: number; disputes?: number; mine?: 'yes' | 'no' | null } | null) => {
        if (cancelled || !data) return
        if (typeof data.confirmations === 'number') setConfirmations(data.confirmations)
        if (typeof data.disputes === 'number') setDisputes(data.disputes)
        setMine(data.mine === 'yes' || data.mine === 'no' ? data.mine : null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [place.place_id])

  async function vote(next: 'yes' | 'no') {
    setNote('')
    const res = await fetch('/api/places/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: place.place_id, vote: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      setNote(t('access.signIn'))
      return
    }
    if (!res.ok) {
      setNote(t('access.error'))
      return
    }
    setConfirmations(typeof data.confirmations === 'number' ? data.confirmations : confirmations)
    setDisputes(typeof data.disputes === 'number' ? data.disputes : disputes)
    setMine(next)
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] px-3 py-2.5">
      <p className="text-[12px] font-medium text-[var(--text-primary)]">{t('access.ask')}</p>
      <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
        {t('access.confirmed').replace('{n}', String(confirmations))}
        {disputes > 0 ? ` · ${t('access.disputed').replace('{n}', String(disputes))}` : ''}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          aria-pressed={mine === 'yes'}
          onClick={() => void vote('yes')}
          className={`rounded-full px-3 py-1 text-[12px] font-medium ${mine === 'yes' ? 'bg-[#0F6E56] text-white' : 'border border-[var(--border)] text-[var(--text-primary)]'}`}
        >
          {t('access.yes')}
        </button>
        <button
          type="button"
          aria-pressed={mine === 'no'}
          onClick={() => void vote('no')}
          className={`rounded-full px-3 py-1 text-[12px] font-medium ${mine === 'no' ? 'bg-[#9a3412] text-white' : 'border border-[var(--border)] text-[var(--text-primary)]'}`}
        >
          {t('access.no')}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{note}</p>}
    </div>
  )
}
