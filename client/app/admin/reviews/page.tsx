'use client'

import { useCallback, useEffect, useState } from 'react'
import { EyeOff, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { useToast } from '@/components/ui/Toast'

type ReviewItem = {
  key: string
  placeId: string
  rating: number
  comment: string
  firstName: string
  hidden: boolean
  flag: string
  createdAt: string
}

type ExistsRow = {
  place_id: string
  place_name: string
  confirmations: number
  meets_threshold: boolean
}

export default function AdminReviewsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [tab, setTab] = useState<'reviews' | 'exists'>('reviews')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [exists, setExists] = useState<ExistsRow[]>([])
  const [threshold, setThreshold] = useState(3)
  const [flagFilter, setFlagFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const loadReviews = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ flag: flagFilter, limit: '80' })
      const res = await fetch(`/api/admin/reviews?${sp}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setItems(Array.isArray(json.items) ? json.items : [])
    } finally {
      setLoading(false)
    }
  }, [flagFilter])

  const loadExists = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/reviews/exists', { credentials: 'include', cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setExists(Array.isArray(json.items) ? json.items : [])
        if (typeof json.threshold === 'number') setThreshold(json.threshold)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'reviews') void loadReviews()
    else void loadExists()
  }, [tab, loadReviews, loadExists])

  const reviewAction = async (key: string, action: 'hide' | 'unhide' | 'delete') => {
    setBusy(key)
    try {
      const res = await fetch(`/api/admin/reviews/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t(`admin.reviews.action_${action}`), tone: 'success' })
      await loadReviews()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.reviews')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.reviews.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('reviews')}
          className={`rounded-full px-4 py-1.5 text-[13px] ${tab === 'reviews' ? 'bg-[#E8672A] text-white' : 'border border-black/10'}`}
        >
          {t('admin.reviews.tabReviews')}
        </button>
        <button
          type="button"
          onClick={() => setTab('exists')}
          className={`rounded-full px-4 py-1.5 text-[13px] ${tab === 'exists' ? 'bg-[#E8672A] text-white' : 'border border-black/10'}`}
        >
          {t('admin.reviews.tabExists')}
        </button>
        {tab === 'reviews' && (
          <select
            value={flagFilter}
            onChange={(e) => setFlagFilter(e.target.value)}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
          >
            <option value="all">{t('admin.reviews.allFlags')}</option>
            <option value="url_spam">{t('admin.reviews.flagUrl')}</option>
            <option value="banned_word">{t('admin.reviews.flagBanned')}</option>
            <option value="none">{t('admin.reviews.flagClean')}</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => void (tab === 'reviews' ? loadReviews() : loadExists())}
          className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px]"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {tab === 'exists' && (
        <p className="text-[13px] text-[#6E5B50]">
          {t('admin.reviews.thresholdHint').replace('{n}', String(threshold))}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        {loading ? (
          <p className="p-6 text-[13px]">{t('admin.moderation.loading')}</p>
        ) : tab === 'reviews' ? (
          items.length === 0 ? (
            <EmptyState title={t('admin.reviews.empty')} />
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {items.map((r) => (
                <li key={r.key} className="px-4 py-3 md:flex md:items-start md:justify-between md:gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {r.firstName} · {'★'.repeat(r.rating)}
                      {r.hidden && (
                        <span className="ml-2 rounded bg-black/10 px-1.5 text-[10px] uppercase">{t('admin.reviews.hidden')}</span>
                      )}
                      {r.flag !== 'none' && (
                        <span className="ml-2 rounded bg-[#E8672A]/15 px-1.5 text-[10px] text-[#E8672A]">{r.flag}</span>
                      )}
                    </p>
                    <p className="mt-1 text-[12px] text-[#6E5B50]">{r.placeId}</p>
                    <p className="mt-2 text-[13px]">{r.comment || '—'}</p>
                  </div>
                  <div className="mt-2 flex gap-2 md:mt-0">
                    <button
                      type="button"
                      disabled={busy === r.key}
                      onClick={() => void reviewAction(r.key, r.hidden ? 'unhide' : 'hide')}
                      className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-2 py-1 text-[12px]"
                    >
                      <EyeOff size={12} /> {r.hidden ? t('admin.reviews.unhide') : t('admin.reviews.hide')}
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.key}
                      onClick={() => void reviewAction(r.key, 'delete')}
                      className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-2 py-1 text-[12px] text-red-700"
                    >
                      <Trash2 size={12} /> {t('admin.reviews.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : exists.length === 0 ? (
          <EmptyState title={t('admin.reviews.existsEmpty')} />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="bg-[#F7F1E8]/80 text-[12px] uppercase tracking-wide dark:bg-white/5">
              <tr>
                <th className="px-4 py-2">{t('admin.places.colName')}</th>
                <th className="px-4 py-2">{t('admin.reviews.confirmations')}</th>
                <th className="px-4 py-2">{t('admin.reviews.meetsThreshold')}</th>
              </tr>
            </thead>
            <tbody>
              {exists.map((row) => (
                <tr key={row.place_id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-2">{row.place_name}</td>
                  <td className="px-4 py-2">{row.confirmations}</td>
                  <td className="px-4 py-2">{row.meets_threshold ? t('admin.reviews.yes') : t('admin.reviews.no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
