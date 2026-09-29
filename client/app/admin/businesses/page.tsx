'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Check, Download, FileText, RefreshCw, ShieldOff, X } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { StatCard } from '@/components/admin/StatCard'
import { useAdminBusinessesList } from '@/components/admin/useAdminBusinessesList'
import { useToast } from '@/components/ui/Toast'
import { Skeleton } from '@/components/ui/Skeleton'

type ChecklistKey = 'name' | 'address' | 'category' | 'hours' | 'photos' | 'accessibility' | 'proof'

type Detail = {
  checklist: Record<ChecklistKey, boolean>
  completeness: { done: number; total: number }
  owner: { user_id: string; name: string | null; email: string } | null
  place: { address?: string; summary?: string; phone?: string } | null
  proof_document: string | null
}

export default function AdminBusinessesPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const { query, setQuery, data, loading, reload } = useAdminBusinessesList({
    status: 'pending',
    sort: 'completeness',
    page: 1,
    limit: 50,
  })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const items = data?.items ?? []
  const focused = useMemo(
    () => items.find((b) => b.place_id === (focusId ?? items[0]?.place_id)) ?? null,
    [items, focusId],
  )

  useEffect(() => {
    if (items.length && !focusId) setFocusId(items[0].place_id)
  }, [items, focusId])

  const loadDetail = useCallback(async (placeId: string) => {
    setFocusId(placeId)
    setDetail(null)
    const res = await fetch(`/api/admin/businesses/${encodeURIComponent(placeId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) setDetail(json as Detail)
  }, [])

  useEffect(() => {
    if (focused?.place_id) void loadDetail(focused.place_id)
  }, [focused?.place_id, loadDetail])

  const act = async (action: 'approve' | 'reject' | 'suspend' | 'revoke_local_badge') => {
    if (!focused) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/businesses/${encodeURIComponent(focused.place_id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t(`admin.businesses.action_${action}`), tone: 'success' })
      setReason('')
      await reload()
      await loadDetail(focused.place_id)
    } finally {
      setBusy(false)
    }
  }

  const downloadReport = () => {
    if (!focused) return
    window.open(
      `/api/admin/businesses/${encodeURIComponent(focused.place_id)}/report?format=html`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  const stats = useMemo(
    () => ({
      total: data?.total ?? 0,
      pending: items.filter((b) => b.status === 'pending').length,
      validated: items.filter((b) => b.status === 'validated').length,
    }),
    [data?.total, items],
  )

  const checklistKeys: ChecklistKey[] = ['name', 'address', 'category', 'hours', 'photos', 'accessibility', 'proof']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('admin.nav.businesses')}</h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.businesses.subtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('admin.businesses.statTotal')} value={stats.total} icon={Building2} />
        <StatCard label={t('admin.pending')} value={stats.pending} icon={FileText} />
        <StatCard label={t('admin.businesses.statValidated')} value={stats.validated} icon={Check} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query.q ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value, page: 1 }))}
          placeholder={t('admin.businesses.search')}
          className="min-w-[200px] flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        />
        <select
          value={query.status ?? 'all'}
          onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        >
          <option value="all">{t('admin.businesses.allStatuses')}</option>
          <option value="pending">{t('admin.pending')}</option>
          <option value="validated">{t('admin.businesses.statusValidated')}</option>
          <option value="rejected">{t('admin.reject')}</option>
          <option value="suspended">{t('admin.businesses.statusSuspended')}</option>
        </select>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px] hover:bg-black/[0.03] dark:border-white/10"
        >
          <RefreshCw size={14} /> {t('admin.businesses.refresh')}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState title={t('admin.businesses.empty')} />
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {items.map((b) => {
                const on = focused?.place_id === b.place_id
                return (
                  <li key={b.place_id}>
                    <button
                      type="button"
                      onClick={() => void loadDetail(b.place_id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] ${on ? 'bg-[#E8672A]/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/5'}`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] uppercase dark:bg-white/10">{b.status}</span>
                      <span className="text-[11px] text-[#6E5B50]">
                        {b.completeness.done}/{b.completeness.total}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <aside className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          {!focused ? (
            <p className="text-[13px] text-[#6E5B50]">{t('admin.businesses.select')}</p>
          ) : (
            <>
              <h2 className="font-semibold">{focused.name}</h2>
              <p className="mt-1 text-[12px] text-[#6E5B50]">{focused.place_id}</p>
              {detail?.owner && (
                <p className="mt-2 text-[13px]">
                  {t('admin.businesses.owner')}: {detail.owner.name ?? detail.owner.email}
                </p>
              )}
              <ul className="mt-4 space-y-1.5">
                {checklistKeys.map((key) => {
                  const ok = detail?.checklist?.[key]
                  return (
                    <li key={key} className="flex items-center gap-2 text-[13px]">
                      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-[#E8672A]/60'}`} />
                      {t(`admin.businesses.check_${key}`)}
                    </li>
                  )
                })}
              </ul>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('admin.reason')}
                rows={3}
                className="mt-4 w-full rounded-xl border border-black/10 bg-[#F7F1E8]/50 px-3 py-2 text-[13px] dark:border-white/10 dark:bg-black/20"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('approve')}
                  className="inline-flex items-center gap-1 rounded-xl bg-[#E8672A] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                >
                  <Check size={14} /> {t('admin.validate')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('reject')}
                  className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-[13px] text-red-700"
                >
                  <X size={14} /> {t('admin.reject')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('suspend')}
                  className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px]"
                >
                  <ShieldOff size={14} /> {t('admin.businesses.suspend')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('revoke_local_badge')}
                  className="rounded-xl border border-black/10 px-3 py-2 text-[13px]"
                >
                  {t('admin.businesses.revokeBadge')}
                </button>
                <button
                  type="button"
                  onClick={downloadReport}
                  className="inline-flex items-center gap-1 rounded-xl border border-black/10 px-3 py-2 text-[13px]"
                >
                  <Download size={14} /> {t('admin.businesses.downloadReport')}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
