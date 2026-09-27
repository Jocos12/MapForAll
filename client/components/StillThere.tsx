'use client'

import { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'

/** Independent freshness vote. Not part of the community module. */
export function StillThere({ placeId }: { placeId: string }) {
  const { t, lang } = useI18n()
  const [count, setCount] = useState(0)
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancel = false
    fetch(`/api/places/exists?placeId=${encodeURIComponent(placeId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancel || !data) return
        setCount(typeof data.count === 'number' ? data.count : 0)
        setLastAt(typeof data.lastAt === 'string' ? data.lastAt : null)
        setMine(data.mine === true)
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [placeId])

  async function confirm() {
    if (busy || mine) return
    setBusy(true)
    try {
      const res = await fetch('/api/places/exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCount(typeof data.count === 'number' ? data.count : count + 1)
        setLastAt(typeof data.lastAt === 'string' ? data.lastAt : new Date().toISOString())
        setMine(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const when = lastAt
    ? new Date(lastAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'rw' ? 'rw-RW' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={confirm}
        disabled={busy || mine}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition-colors hover:border-[#E8672A] hover:text-[#E8672A] disabled:opacity-70 dark:border-white/10 dark:text-neutral-300"
      >
        <CheckCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('placeCard.stillThere')}
      </button>
      {count > 0 && (
        <span className="text-[12px] text-neutral-500">
          {t('placeCard.confirmedBy')} {count} {count === 1 ? t('placeCard.person') : t('placeCard.people')}
          {when ? ` · ${t('placeCard.lastConfirmed')} ${when}` : ''}
        </span>
      )}
    </div>
  )
}
