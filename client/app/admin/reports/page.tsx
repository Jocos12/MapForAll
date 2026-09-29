'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { useAdminReportsList } from '@/components/admin/useAdminReportsList'
import { useToast } from '@/components/ui/Toast'

const REPORT_TYPES = ['closed', 'outdated', 'incorrect', 'inappropriate'] as const

export default function AdminReportsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const { query, setQuery, data, loading, reload } = useAdminReportsList({
    status: 'open',
    priority: 'all',
    type: 'all',
    page: 1,
    limit: 50,
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const items = data?.items ?? []

  const act = async (reportId: string, action: 'resolve' | 'ignore' | 'disable_place') => {
    setBusy(reportId)
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t(`admin.reports.action_${action}`), tone: 'success' })
      setNote('')
      await reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.reports')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.reports.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={query.status ?? 'open'}
          onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        >
          <option value="open">{t('admin.reports.statusOpen')}</option>
          <option value="resolved">{t('admin.reports.statusResolved')}</option>
          <option value="ignored">{t('admin.reports.statusIgnored')}</option>
          <option value="all">{t('admin.reports.statusAll')}</option>
        </select>
        <select
          value={query.priority ?? 'all'}
          onChange={(e) => setQuery((q) => ({ ...q, priority: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        >
          <option value="all">{t('admin.reports.allPriorities')}</option>
          <option value="urgent">{t('admin.reports.priorityUrgent')}</option>
          <option value="normal">{t('admin.reports.priorityNormal')}</option>
          <option value="low">{t('admin.reports.priorityLow')}</option>
        </select>
        <select
          value={query.type ?? 'all'}
          onChange={(e) => setQuery((q) => ({ ...q, type: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        >
          <option value="all">{t('admin.reports.allTypes')}</option>
          {REPORT_TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`admin.reports.type_${tp}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px]"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('admin.reports.note')}
        rows={2}
        className="w-full max-w-xl rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
      />

      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        {loading ? (
          <p className="p-6 text-[13px] text-[#6E5B50]">{t('admin.moderation.loading')}</p>
        ) : items.length === 0 ? (
          <EmptyState title={t('admin.reports.empty')} />
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {items.map((r) => (
              <li key={r.report_id} className="gap-4 px-4 py-4 md:flex md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.place_name}</p>
                  <p className="mt-1 text-[12px] text-[#6E5B50]">
                    {r.type} · {r.priority} · {r.status}
                  </p>
                  <p className="mt-2 text-[13px]">{r.comment}</p>
                  {r.reporter_email && (
                    <p className="mt-1 text-[11px] text-[#6E5B50]">{r.reporter_email}</p>
                  )}
                </div>
                {r.status === 'open' && (
                  <div className="mt-3 flex shrink-0 flex-wrap gap-2 md:mt-0">
                    <button
                      type="button"
                      disabled={busy === r.report_id}
                      onClick={() => void act(r.report_id, 'resolve')}
                      className="rounded-xl bg-[#E8672A] px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
                    >
                      {t('admin.reports.resolve')}
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.report_id}
                      onClick={() => void act(r.report_id, 'ignore')}
                      className="rounded-xl border border-black/10 px-3 py-1.5 text-[12px]"
                    >
                      {t('admin.reports.ignore')}
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.report_id}
                      onClick={() => void act(r.report_id, 'disable_place')}
                      className="rounded-xl border border-red-200 px-3 py-1.5 text-[12px] text-red-700"
                    >
                      {t('admin.reports.disablePlace')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
