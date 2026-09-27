'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PlaceBadges } from '@/components/PlaceBadges'
import { useI18n, type Lang } from '@/components/I18nProvider'

type Row = {
  place_id: string
  name: string
  categories: string[]
  local_business?: boolean
  accessible?: boolean
  created_at?: string
  added_by?: string
  claimed_by_owner?: boolean
}

type Stats = {
  total: number
  pending: number
  validated: number
  approvalRate: number
  local: number
  accessible: number
}

export default function AdminPage() {
  const { t, lang, setLang } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})

  async function load() {
    const res = await fetch('/api/admin/places')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(res.status === 403 || res.status === 401 ? t('admin.denied') : (data.error ?? t('admin.denied')))
      setRows([])
      return
    }
    setError('')
    setRows(data.pending ?? [])
    setStats(data.stats ?? null)
  }

  useEffect(() => { void load() }, [])

  async function moderate(placeId: string, status: 'validated' | 'rejected') {
    const res = await fetch('/api/admin/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place_id: placeId, status, reason: reasons[placeId] ?? '' }),
    })
    if (res.ok) setRows((prev) => prev.filter((row) => row.place_id !== placeId))
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-8 text-ink dark:bg-ink dark:text-cream">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] uppercase tracking-wider text-terracotta">{t('app.name')}</p>
            <h1 className="font-display text-2xl font-semibold">{t('admin.title')}</h1>
          </div>
          <div className="flex items-center gap-2">
            {(['fr', 'en', 'rw'] as Lang[]).map((code) => (
              <button key={code} type="button" onClick={() => setLang(code)} className={`rounded-full px-2.5 py-1 text-[12px] uppercase ${lang === code ? 'bg-[#F56A00] text-white' : 'border border-black/10 dark:border-white/15'}`}>
                {code}
              </button>
            ))}
            <Link href="/chat" className="text-[13px] text-terracotta underline">{t('app.name')}</Link>
          </div>
        </header>

        {stats && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              [t('admin.total'), stats.total],
              [t('admin.pending'), stats.pending],
              [t('admin.rate'), `${stats.approvalRate}%`],
              [t('admin.local'), stats.local],
              [t('admin.accessible'), stats.accessible],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] uppercase tracking-wider text-ink/60 dark:text-cream/60">{label}</p>
                <p className="font-display text-xl">{value}</p>
              </div>
            ))}
          </section>
        )}

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">{error}</p>}
        {!error && rows.length === 0 && <p className="text-[14px]">{t('admin.empty')}</p>}

        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.place_id} className="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{row.name}</p>
                  {row.claimed_by_owner && (
                    <p className="mt-1 text-[12px] font-medium text-[#E8672A]">{t('admin.claimed')}</p>
                  )}
                  <p className="text-[12px] text-ink/60 dark:text-cream/60">{row.categories.join(', ')} · {row.created_at ?? ''}</p>
                  <PlaceBadges place={row} className="mt-2" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void moderate(row.place_id, 'validated')} className="rounded-full bg-[#0F6E56] px-3 py-1.5 text-[12px] text-white">{t('admin.validate')}</button>
                  <button type="button" onClick={() => void moderate(row.place_id, 'rejected')} className="rounded-full bg-terracotta px-3 py-1.5 text-[12px] text-white">{t('admin.reject')}</button>
                </div>
              </div>
              <input
                value={reasons[row.place_id] ?? ''}
                onChange={(e) => setReasons((prev) => ({ ...prev, [row.place_id]: e.target.value }))}
                placeholder={t('admin.reason')}
                className="mt-3 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px] dark:border-white/15"
              />
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
