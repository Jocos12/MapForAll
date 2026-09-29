'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { Skeleton } from '@/components/ui/Skeleton'

type AuditRow = {
  id: string
  at: string
  action: string
  actor_email: string
  actor_role: string
  target_type: string
  target_id: string
}

export default function AdminAuditPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<AuditRow[]>([])
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '80' })
      if (action.trim()) qs.set('action', action.trim())
      if (actor.trim()) qs.set('actor', actor.trim())
      const res = await fetch(`/api/admin/audit?${qs}`, { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      if (res.ok) setItems(json.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [action, actor])

  useEffect(() => { void load() }, [load])

  const exportHref = `/api/admin/audit/export?${new URLSearchParams({
    ...(action.trim() ? { action: action.trim() } : {}),
    ...(actor.trim() ? { actor: actor.trim() } : {}),
  }).toString()}`

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t('admin.nav.audit')}</h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.audit.subtitle')}</p>
        </div>
        <a href={exportHref} className="inline-flex items-center gap-1.5 rounded-full border border-[#E8672A]/40 px-3 py-1.5 text-[12px] font-medium text-[#E8672A]">
          <Download size={14} /> {t('admin.audit.export')}
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder={t('admin.audit.filterAction')}
          className="rounded-full border border-black/10 px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        />
        <input
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder={t('admin.audit.filterActor')}
          className="rounded-full border border-black/10 px-3 py-2 text-[13px] dark:border-white/10 dark:bg-white/5"
        />
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] text-white">
          {t('admin.audit.apply')}
        </button>
      </div>

      {loading ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white dark:border-white/10 dark:bg-white/[0.04]">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-black/5 text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10">
              <tr>
                <th className="px-3 py-2">{t('admin.audit.when')}</th>
                <th className="px-3 py-2">{t('admin.audit.action')}</th>
                <th className="px-3 py-2">{t('admin.audit.actor')}</th>
                <th className="px-3 py-2">{t('admin.audit.target')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="px-3 py-2 whitespace-nowrap text-[12px]">{row.at ? new Date(row.at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{row.action}</td>
                  <td className="px-3 py-2">{row.actor_email || '—'} <span className="text-[11px] text-[#6E5B50]">({row.actor_role})</span></td>
                  <td className="px-3 py-2">{row.target_type} · <span className="font-mono text-[11px]">{row.target_id}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <p className="px-4 py-8 text-center text-[#6E5B50]">{t('admin.audit.empty')}</p>}
        </div>
      )}
    </div>
  )
}
