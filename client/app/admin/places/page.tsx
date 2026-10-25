'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Check,
  CheckCircle2,
  Clock,
  Download,
  MapPinned,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { StatCard } from '@/components/admin/StatCard'
import { CategoryBadge, PillFlag, StatusBadge } from '@/components/admin/AdminBadges'
import { AdminTablePagination, AdminTableShell } from '@/components/admin/AdminDataTable'
import { useAdminPlacesList } from '@/components/admin/useAdminPlacesList'
import type { AdminPlaceItem } from '@/components/admin/adminPlaceTypes'
import { Select } from '@/components/ui/Select'
import { PLACE_CATEGORIES } from '@/lib/places'
import { SECTOR_NAMES } from '@/lib/adminPlaces'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/design/cn'

type FormState = {
  place_id?: string
  name: string
  category: string
  latitude: string
  longitude: string
  address: string
  local_business: boolean
  accessible: boolean
  paused: boolean
  status: string
}

type ImportRowPreview = {
  index: number
  name: string
  category: string
  ok: boolean
  reason?: string
}

const emptyForm = (): FormState => ({
  name: '',
  category: 'other',
  latitude: '-1.953',
  longitude: '30.094',
  address: '',
  local_business: false,
  accessible: false,
  paused: false,
  status: 'validated',
})

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cols[i] ?? '' })
    return row
  })
}

function previewRowsLocal(rows: unknown[]): ImportRowPreview[] {
  return rows.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      return { index, name: '—', category: '—', ok: false, reason: 'not_object' }
    }
    const r = raw as Record<string, unknown>
    const name = String(r.name ?? '').trim()
    const category = String(r.category ?? (Array.isArray(r.categories) ? r.categories[0] : '') ?? 'other')
    const lat = Number(r.latitude)
    const lng = Number(r.longitude)
    if (name.length < 2) return { index, name: name || '—', category, ok: false, reason: 'name' }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { index, name, category, ok: false, reason: 'coords' }
    return { index, name, category, ok: true }
  })
}

export default function AdminPlacesPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { query, setQuery, data, setData, loading, slow, error, reload } = useAdminPlacesList({
    sort: searchParams.get('sort') || 'created_desc',
    page: Number(searchParams.get('page') || 1) || 1,
    limit: 20,
    q: searchParams.get('q') || undefined,
    status: searchParams.get('status') || undefined,
    category: searchParams.get('category') || undefined,
    sector: searchParams.get('sector') || undefined,
  })
  const [draftQ, setDraftQ] = useState(searchParams.get('q') ?? '')
  const [selected, setSelected] = useState<string[]>([])
  const [rejectFor, setRejectFor] = useState<string[] | null>(null)
  const [rejectText, setRejectText] = useState('')
  const [rejectPreset, setRejectPreset] = useState('duplicate')
  const [deleteFor, setDeleteFor] = useState<AdminPlaceItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteForever, setDeleteForever] = useState(false)
  const [deleteOverride, setDeleteOverride] = useState(false)
  const [undo, setUndo] = useState<{ ids: string[]; previous: Record<string, string> } | null>(null)
  const [bulkDelete, setBulkDelete] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [importTab, setImportTab] = useState<'json' | 'csv'>('json')
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState<ImportRowPreview[]>([])
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0
  const page = data?.page ?? 1
  const limit = query.limit ?? 20
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const stats = useMemo(() => ({
    total: data?.totals?.all ?? total,
    validated: data?.totals?.validated ?? items.filter((p) => p.status === 'validated' || !p.status).length,
    pending: data?.totals?.pending ?? 0,
    paused: data?.totals?.paused ?? items.filter((p) => p.paused).length,
  }), [total, items, data?.totals])

  const statusLabels = useMemo(() => ({
    draft: t('admin.statusLabels.draft'),
    pending: t('admin.statusLabels.pending'),
    submitted: t('admin.statusLabels.submitted'),
    in_review: t('admin.statusLabels.in_review'),
    validated: t('admin.statusLabels.validated'),
    changes_requested: t('admin.statusLabels.changes_requested'),
    rejected: t('admin.statusLabels.rejected'),
    paused: t('admin.statusLabels.paused'),
    archived: t('admin.statusLabels.archived'),
    deleted: t('admin.statusLabels.deleted'),
  }), [t])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery((current) => (current.q ?? '') === draftQ ? current : { ...current, q: draftQ || undefined, page: 1 })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draftQ, setQuery])

  useEffect(() => {
    const sp = new URLSearchParams()
    if (query.q) sp.set('q', query.q)
    if (query.status) sp.set('status', query.status)
    if (query.category) sp.set('category', query.category)
    if (query.sector) sp.set('sector', query.sector)
    if (query.sort && query.sort !== 'created_desc') sp.set('sort', query.sort)
    if ((query.page ?? 1) > 1) sp.set('page', String(query.page))
    const next = sp.toString()
    if (next !== searchParams.toString()) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [query, pathname, router, searchParams])

  const patchStatus = useCallback((ids: string[], status: string) => {
    setData((current) => current && ({
      ...current,
      items: current.items.map((row) => ids.includes(row.place_id) ? { ...row, status } : row),
    }))
  }, [setData])

  async function runModerate(ids: string[], status: 'validated' | 'rejected', reason = '', action?: 'request_changes') {
    const previous = new Map(items.filter((row) => ids.includes(row.place_id)).map((row) => [row.place_id, row.status ?? 'validated']))
    patchStatus(ids, action === 'request_changes' ? 'changes_requested' : status)
    setRowBusy(ids[0] ?? 'bulk')
    try {
      const res = await fetch('/api/admin/places', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids.length === 1
          ? { place_id: ids[0], status, reason, ...(action ? { action } : {}) }
          : { place_ids: ids, status, reason, ...(action ? { action } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'failed')
      setUndo({ ids, previous: Object.fromEntries(previous) })
      toast({ title: t(status === 'validated' ? 'admin.places.approve' : 'admin.places.reject'), tone: 'success', duration: 8000 })
      void reload()
    } catch (err) {
      for (const [id, prev] of previous) patchStatus([id], prev)
      toast({ title: t('admin.shell.loadError'), description: err instanceof Error ? err.message : '', tone: 'danger' })
    } finally {
      setRowBusy(null)
      setSelected([])
    }
  }

  const validImportCount = importRows.filter((r) => r.ok).length

  const openCreate = () => {
    setForm(emptyForm())
    setPanelOpen(true)
  }

  const openEdit = (place: AdminPlaceItem) => {
    setForm({
      place_id: place.place_id,
      name: place.name,
      category: place.categories[0] ?? 'other',
      latitude: String(place.coordinates.lat),
      longitude: String(place.coordinates.lng),
      address: place.address,
      local_business: !!place.local_business,
      accessible: !!place.accessible,
      paused: !!place.paused,
      status: place.status ?? 'validated',
    })
    setPanelOpen(true)
  }

  const saveForm = async () => {
    setBusy(true)
    try {
      const lat = Number(form.latitude)
      const lng = Number(form.longitude)
      if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast({ title: t('admin.places.formInvalid'), tone: 'danger' })
        return
      }
      if (form.place_id) {
        const res = await fetch(`/api/admin/places/${encodeURIComponent(form.place_id)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            categories: [form.category],
            latitude: lat,
            longitude: lng,
            local_business: form.local_business,
            accessible: form.accessible,
            paused: form.paused,
            status: form.status,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
          return
        }
        toast({ title: t('admin.places.saved'), tone: 'success' })
      } else {
        const res = await fetch('/api/admin/places', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create: true,
            name: form.name.trim(),
            category: form.category,
            latitude: lat,
            longitude: lng,
            address: form.address.trim() || undefined,
            local_business: form.local_business,
            accessible: form.accessible,
            status: form.status === 'pending' ? 'pending' : 'validated',
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
          return
        }
        toast({ title: t('admin.places.created'), tone: 'success' })
      }
      setPanelOpen(false)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const archivePlace = async (placeId: string) => {
    setRowBusy(placeId)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/places/${encodeURIComponent(placeId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        toast({ title: t('admin.places.archiveFailed'), tone: 'danger' })
        return
      }
      toast({ title: t('admin.places.archived'), tone: 'info' })
      setConfirmArchive(null)
      await reload()
    } finally {
      setBusy(false)
      setRowBusy(null)
    }
  }

  const exportCsv = useCallback(() => {
    const sp = new URLSearchParams()
    if (query.status) sp.set('status', query.status)
    if (query.category) sp.set('category', query.category)
    if (query.source) sp.set('source', query.source)
    if (query.local) sp.set('local', '1')
    if (query.accessible) sp.set('accessible', '1')
    if (query.sector) sp.set('sector', query.sector)
    if (query.q) sp.set('q', query.q)
    window.open(`/api/admin/places/export?${sp.toString()}`, '_blank', 'noopener,noreferrer')
  }, [query])

  const applyImportText = (text: string, mode: 'json' | 'csv') => {
    setImportText(text)
    try {
      let rows: unknown[]
      if (mode === 'csv') {
        rows = parseCsv(text).map((r) => ({
          name: r.name,
          category: r.category || r.categories || 'other',
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          address: r.address,
          local_business: r.local_business === 'true' || r.local_business === '1',
          accessible: r.accessible === 'true' || r.accessible === '1',
        }))
      } else {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('not_array')
        rows = parsed
      }
      setImportRows(previewRowsLocal(rows))
    } catch {
      setImportRows([])
    }
  }

  const onDropFile = async (file: File) => {
    const text = await file.text()
    const mode = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'
    setImportTab(mode)
    applyImportText(text, mode)
  }

  const commitImport = async () => {
    let rows: unknown[]
    try {
      if (importTab === 'csv') {
        rows = parseCsv(importText).map((r) => ({
          name: r.name,
          category: r.category || 'other',
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          address: r.address,
        }))
      } else {
        rows = JSON.parse(importText)
        if (!Array.isArray(rows)) throw new Error('not_array')
      }
    } catch {
      toast({ title: t('admin.places.importInvalid'), tone: 'danger' })
      return
    }
    const valid = previewRowsLocal(rows).filter((r) => r.ok)
    if (valid.length === 0) return
    setBusy(true)
    try {
      const payload = rows.filter((_, i) => importRows[i]?.ok)
      const res = await fetch('/api/admin/places/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'csv', rows: payload, dryRun: false }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t('admin.places.importDone'), tone: 'success' })
      setImportText('')
      setImportRows([])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight">{t('admin.nav.places')}</h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.places.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-[13px] dark:border-white/15">
            <Download size={16} /> {t('admin.places.export')}
          </button>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white">
            <Plus size={16} /> {t('admin.places.create')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('admin.places.chipAll')} value={data ? stats.total : 0} icon={MapPinned} index={0} hint={t('admin.places.subtitle')} />
        <StatCard label={t('admin.places.statusValidated')} value={data ? stats.validated : 0} icon={CheckCircle2} index={1} />
        <StatCard label={t('admin.places.statusPending')} value={data ? stats.pending : 0} icon={Clock} index={2} />
        <StatCard label={t('admin.places.paused')} value={data ? stats.paused : 0} icon={PauseCircle} index={3} />
      </div>
      {data?.totals && (
        <div className="flex flex-wrap gap-2">
          {([
            ['', t('admin.places.chipAll'), data.totals.all],
            ['validated', t('admin.statusLabels.validated'), data.totals.validated],
            ['pending', t('admin.statusLabels.pending'), data.totals.pending],
            ['in_review', t('admin.statusLabels.in_review'), data.totals.in_review ?? 0],
            ['changes_requested', t('admin.statusLabels.changes_requested'), data.totals.changes_requested ?? 0],
            ['rejected', t('admin.statusLabels.rejected'), data.totals.rejected],
            ['paused', t('admin.statusLabels.paused'), data.totals.paused],
            ['archived', t('admin.statusLabels.archived'), data.totals.archived],
            ['deleted', t('admin.statusLabels.deleted'), data.totals.deleted ?? 0],
          ] as const).map(([value, label, count]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => setQuery((q) => ({ ...q, status: value || undefined, page: 1 }))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px]',
                (query.status ?? '') === value ? 'border-[#E8672A] bg-[#E8672A]/10 text-[#E8672A]' : 'border-black/10 dark:border-white/15',
              )}
            >
              {label} <span className="tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-white/5">
        <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          placeholder={t('admin.moderation.search')}
          className="min-w-[160px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2.5 text-[13px] dark:border-white/15"
        />
        <div className="w-[150px]">
          <Select
            value={query.status ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value || undefined, page: 1 }))}
            className="!py-2 text-[13px]"
          >
            <option value="">{t('admin.places.allStatuses')}</option>
            <option value="validated">{t('admin.places.statusValidated')}</option>
            <option value="pending">{t('admin.places.statusPending')}</option>
            <option value="rejected">{t('admin.places.statusRejected')}</option>
            <option value="archived">{t('admin.places.statusArchived')}</option>
          </Select>
        </div>
        <div className="w-[150px]">
          <Select
            value={query.category ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, category: e.target.value || undefined, page: 1 }))}
            className="!py-2 text-[13px]"
          >
            <option value="">{t('admin.moderation.allCategories')}</option>
            {PLACE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="w-[160px]">
          <Select
            value={query.sector ?? ''}
            onChange={(e) => setQuery((q) => ({ ...q, sector: e.target.value || undefined, page: 1 }))}
            className="!py-2 text-[13px]"
          >
            <option value="">{t('admin.moderation.allSectors')}</option>
            {SECTOR_NAMES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>

      {(error || (slow && !data)) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">
          <span>{t('admin.shell.loadError')}</span>
          <button type="button" onClick={() => void reload()} className="rounded-full bg-[#E8672A] px-3 py-1.5 text-white">{t('accountPanel.retry')}</button>
        </div>
      )}

      <AdminTableShell>
        {!data && (
          <div className="space-y-2 p-3" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/10" />
            ))}
          </div>
        )}
        {data && items.length === 0 && !loading && (
          <EmptyState title={t('admin.places.empty')} action={<button type="button" onClick={openCreate} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] text-white">{t('admin.places.create')}</button>} />
        )}
        {data && items.length > 0 && (
          <div className={cn('overflow-x-auto', loading && 'opacity-70')}>
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-black/5 bg-black/[0.02] text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10">
                <tr>
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={t('admin.places.selected').replace('{n}', String(items.length))}
                      checked={items.length > 0 && items.every((row) => selected.includes(row.place_id))}
                      onChange={(e) => setSelected(e.target.checked ? items.map((row) => row.place_id) : [])}
                    />
                  </th>
                  <th className="px-3 py-2.5">{t('admin.places.colName')}</th>
                  <th className="px-3 py-2.5">{t('admin.places.colStatus')}</th>
                  <th className="px-3 py-2.5">{t('admin.places.colCategory')}</th>
                  <th className="px-3 py-2.5">{t('admin.places.colSector')}</th>
                  <th className="px-3 py-2.5">{t('admin.places.colViews')}</th>
                  <th className="px-3 py-2.5 text-right">{t('admin.places.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.place_id}
                    className="group border-b border-black/5 transition-colors hover:bg-[#E8672A]/[0.04] dark:border-white/5 dark:hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={row.name} checked={selected.includes(row.place_id)} onChange={(e) => setSelected((cur) => e.target.checked ? [...cur, row.place_id] : cur.filter((id) => id !== row.place_id))} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{row.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.local_business && <PillFlag kind="local" label={t('admin.local')} />}
                        {row.accessible && <PillFlag kind="accessible" label={t('admin.accessible')} />}
                        {row.paused && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
                            <PauseCircle size={11} /> {t('admin.places.paused')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={row.status ?? 'validated'} labels={statusLabels} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(row.categories.length ? row.categories : ['other']).slice(0, 2).map((c) => (
                          <CategoryBadge key={c} category={c} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[#6E5B50] dark:text-white/55">{row.sector ?? '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums">{row.views ?? 0}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {['submitted', 'pending', 'in_review', 'changes_requested'].includes(row.status ?? '') && (
                          <button type="button" title={t('admin.places.approve')} aria-label={t('admin.places.approve')} disabled={!!rowBusy} onClick={() => void runModerate([row.place_id], 'validated')} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#0F6E56] disabled:opacity-40">
                            <Check size={16} />
                          </button>
                        )}
                        {row.status !== 'deleted' && row.status !== 'rejected' && (
                          <button type="button" title={t('admin.places.reject')} aria-label={t('admin.places.reject')} disabled={!!rowBusy} onClick={() => { setRejectFor([row.place_id]); setRejectText('') }} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-red-600 disabled:opacity-40">
                            <X size={16} />
                          </button>
                        )}
                        <button type="button" title={t('admin.places.delete')} aria-label={t('admin.places.delete')} disabled={!!rowBusy} onClick={() => { setDeleteFor(row); setDeleteConfirm(''); setDeleteForever(false) }} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#6E5B50] disabled:opacity-40">
                          <Trash2 size={16} />
                        </button>
                        <details className="relative">
                          <summary className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg" aria-label={t('admin.places.more')}><MoreHorizontal size={16} /></summary>
                          <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-black/10 bg-white p-1 text-[13px] shadow-lg dark:border-white/10 dark:bg-[#1A1614]">
                            <button type="button" className="block w-full rounded-lg px-2 py-2 text-left" onClick={() => openEdit(row)}>{t('admin.places.edit')}</button>
                            <button type="button" className="block w-full rounded-lg px-2 py-2 text-left" onClick={() => void fetch('/api/admin/places', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: row.paused ? 'unpause' : 'pause', place_id: row.place_id }) }).then(() => reload())}>{row.paused ? t('admin.places.unpause') : t('admin.places.pause')}</button>
                            <button type="button" className="block w-full rounded-lg px-2 py-2 text-left" onClick={() => setConfirmArchive(row.place_id)}>{t('admin.places.archive')}</button>
                            <a className="block rounded-lg px-2 py-2" href="/admin/audit">{t('admin.nav.audit')}</a>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AdminTablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageLabel={t('admin.places.pageOf')}
          prevLabel={t('admin.places.prev')}
          nextLabel={t('admin.places.next')}
          onPrev={() => setQuery((q) => ({ ...q, page: Math.max(1, (q.page ?? 1) - 1) }))}
          onNext={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))}
        />
      </AdminTableShell>

      <details className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Upload size={16} className="text-[#E8672A]" /> {t('admin.places.importTitle')}
            </h2>
            <p className="mt-0.5 text-[12px] text-[#6E5B50] dark:text-white/50">{t('admin.places.importHint')}</p>
          </div>
          <div className="flex rounded-full border border-black/10 p-0.5 dark:border-white/15">
            {(['json', 'csv'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={(e) => { e.preventDefault(); setImportTab(tab); setImportRows([]); setImportText('') }}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] font-medium',
                  importTab === tab ? 'bg-[#E8672A] text-white' : 'text-[#6E5B50] dark:text-white/55',
                )}
              >
                {tab === 'json' ? t('admin.places.importTabJson') : t('admin.places.importTabCsv')}
              </button>
            ))}
          </div>
        </summary>
        <div className="space-y-3 p-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) void onDropFile(f)
            }}
            className="rounded-xl border border-dashed border-black/15 bg-black/[0.015] px-3 py-4 text-center text-[12px] text-[#6E5B50] dark:border-white/20 dark:bg-white/[0.02] dark:text-white/50"
          >
            {t('admin.places.importDrop')}
            <button type="button" className="ml-1 font-medium text-[#E8672A]" onClick={() => fileRef.current?.click()}>
              {t('admin.places.importBrowse')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={importTab === 'csv' ? '.csv,text/csv' : '.json,application/json'}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onDropFile(f)
              }}
            />
          </div>
          <textarea
            value={importText}
            onChange={(e) => applyImportText(e.target.value, importTab)}
            rows={5}
            placeholder={importTab === 'json'
              ? '[{"name":"Example","category":"shop","latitude":-1.95,"longitude":30.09}]'
              : 'name,category,latitude,longitude,address'}
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 font-mono text-[12px] dark:border-white/15"
          />
          {importRows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-[#6E5B50] dark:bg-white/[0.03]">
                  <tr>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">{t('admin.places.colName')}</th>
                    <th className="px-2 py-1.5">{t('admin.places.colCategory')}</th>
                    <th className="px-2 py-1.5">{t('admin.places.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 40).map((r) => (
                    <tr key={r.index} className={r.ok ? '' : 'bg-red-500/10'}>
                      <td className="px-2 py-1.5 tabular-nums">{r.index + 1}</td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5">{r.category}</td>
                      <td className="px-2 py-1.5">{r.ok ? 'OK' : r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-black/5 px-2 py-1.5 text-[11px] text-[#6E5B50] dark:border-white/10">
                {t('admin.places.importPreview')
                  .replace('{valid}', String(validImportCount))
                  .replace('{invalid}', String(importRows.length - validImportCount))}
              </p>
            </div>
          )}
          <button
            type="button"
            disabled={busy || validImportCount === 0}
            onClick={() => void commitImport()}
            className="rounded-full bg-[#0F6E56] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {t('admin.places.commitImport')}
          </button>
        </div>
      </details>

      {selected.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 shadow-lg dark:border-white/10 dark:bg-[#1A1614]">
          <span className="text-[13px]">{t('admin.places.selected').replace('{n}', String(selected.length))}</span>
          <button type="button" className="rounded-full bg-[#0F6E56] px-3 py-2 text-[13px] text-white" onClick={() => void runModerate(selected, 'validated')}>{t('admin.places.bulkApprove')}</button>
          <button type="button" className="rounded-full border border-red-500/40 px-3 py-2 text-[13px] text-red-700" onClick={() => { setRejectFor(selected); setRejectText('') }}>{t('admin.places.bulkReject')}</button>
          <button type="button" className="rounded-full border border-red-500/40 px-3 py-2 text-[13px]" onClick={() => { setDeleteConfirm(''); setBulkDelete(true) }}>{t('admin.places.bulkDelete')}</button>
          <button type="button" className="rounded-full border border-black/10 px-3 py-2 text-[13px]" onClick={() => setSelected([])}>{t('admin.places.cancel')}</button>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-4 left-4 z-30 flex items-center gap-3 rounded-xl bg-[#1A1614] px-3 py-2 text-[13px] text-white">
          <span>{t('admin.places.undo')}</span>
          <button type="button" className="rounded-full bg-white px-3 py-1 text-[#1A1614]" onClick={() => {
            for (const [id, prev] of Object.entries(undo.previous)) {
              void fetch('/api/admin/places', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'revert', place_id: id, status: prev }) })
              patchStatus([id], prev)
            }
            setUndo(null)
            void reload()
          }}>{t('admin.places.undo')}</button>
        </div>
      )}

      {rejectFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-[#1A1614]">
            <h2 className="text-lg font-semibold">{t('admin.places.reject')}</h2>
            <select value={rejectPreset} onChange={(e) => setRejectPreset(e.target.value)} className="mt-3 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px]">
              <option value="duplicate">{t('admin.places.reasonDuplicate')}</option>
              <option value="incomplete">{t('admin.places.reasonIncomplete')}</option>
              <option value="spam">{t('admin.places.reasonSpam')}</option>
              <option value="other">{t('admin.places.reasonOther')}</option>
            </select>
            <textarea value={rejectText} onChange={(e) => setRejectText(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px]" placeholder={t('admin.places.reasonHint')} />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-full px-3 py-2 text-[13px]" onClick={() => setRejectFor(null)}>{t('admin.places.cancel')}</button>
              <button type="button" disabled={rejectText.trim().length < 10} className="rounded-full border px-3 py-2 text-[13px] disabled:opacity-40" onClick={() => { const ids = rejectFor; setRejectFor(null); void runModerate(ids, 'rejected', rejectText.trim(), 'request_changes') }}>{t('admin.places.requestChanges')}</button>
              <button type="button" disabled={rejectText.trim().length < 10} className="rounded-full bg-red-600 px-3 py-2 text-[13px] text-white disabled:opacity-40" onClick={() => { const ids = rejectFor; setRejectFor(null); void runModerate(ids, 'rejected', rejectText.trim()) }}>{t('admin.places.reject')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-[#1A1614]">
            <h2 className="text-lg font-semibold">{t('admin.places.bulkDelete')}</h2>
            <p className="mt-2 text-[13px]">{t('admin.places.selected').replace('{n}', String(selected.length))}</p>
            <p className="mt-2 text-[13px]">{t('admin.places.deleteBody')}</p>
            <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="mt-3 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px]" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-full px-3 py-2 text-[13px]" onClick={() => setBulkDelete(false)}>{t('admin.places.cancel')}</button>
              <button type="button" disabled={deleteConfirm.trim() !== 'DELETE'} className="rounded-full bg-red-600 px-3 py-2 text-[13px] text-white disabled:opacity-40" onClick={() => {
                const ids = selected
                setBulkDelete(false)
                void Promise.all(ids.map((id) => fetch('/api/admin/places', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'delete', place_id: id, confirm: 'DELETE' }) }))).then(() => { setSelected([]); void reload() })
              }}>{t('admin.places.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {deleteFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-[#1A1614]">
            <h2 className="text-lg font-semibold">{t('admin.places.deleteTitle')}</h2>
            <p className="mt-2 text-[13px] text-[#6E5B50]">{deleteFor.name}</p>
            <p className="mt-2 text-[13px]">{t('admin.places.deleteBody')}</p>
            <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={t('admin.places.deleteConfirm')} className="mt-3 w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px]" />
            <label className="mt-2 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={deleteOverride} onChange={(e) => setDeleteOverride(e.target.checked)} />{t('admin.places.override')}</label>
            <label className="mt-1 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={deleteForever} onChange={(e) => setDeleteForever(e.target.checked)} />{t('admin.places.deleteForever')}</label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-full px-3 py-2 text-[13px]" onClick={() => setDeleteFor(null)}>{t('admin.places.cancel')}</button>
              <button type="button" disabled={deleteConfirm.trim() !== deleteFor.name && deleteConfirm.trim() !== 'DELETE'} className="rounded-full bg-red-600 px-3 py-2 text-[13px] text-white disabled:opacity-40" onClick={() => {
                const row = deleteFor
                setDeleteFor(null)
                void fetch('/api/admin/places', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'delete', place_id: row.place_id, confirm: deleteConfirm.trim(), forever: deleteForever, override: deleteOverride }) }).then(() => reload())
              }}>{t('admin.places.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#1A1614]">
            <h2 className="font-display text-xl font-semibold">{form.place_id ? t('admin.places.editPlace') : t('admin.places.createPlace')}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-[12px]">{t('admin.places.fieldName')}
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
              </label>
              <label className="block text-[12px]">{t('admin.places.fieldCategory')}
                <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 text-[13px]">
                  {PLACE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[12px]">{t('admin.places.fieldLat')}
                  <input value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
                </label>
                <label className="block text-[12px]">{t('admin.places.fieldLng')}
                  <input value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
                </label>
              </div>
              <label className="block text-[12px]">{t('admin.places.fieldAddress')}
                <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
              </label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.local_business} onChange={(e) => setForm((f) => ({ ...f, local_business: e.target.checked }))} />{t('admin.local')}</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.accessible} onChange={(e) => setForm((f) => ({ ...f, accessible: e.target.checked }))} />{t('admin.accessible')}</label>
              {form.place_id && (
                <>
                  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.paused} onChange={(e) => setForm((f) => ({ ...f, paused: e.target.checked }))} />{t('admin.places.fieldPaused')}</label>
                  <label className="block text-[12px]">{t('admin.places.colStatus')}
                    <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="mt-1 text-[13px]">
                      <option value="validated">{t('admin.places.statusValidated')}</option>
                      <option value="pending">{t('admin.places.statusPending')}</option>
                      <option value="rejected">{t('admin.places.statusRejected')}</option>
                    </Select>
                  </label>
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPanelOpen(false)} className="rounded-full px-4 py-2 text-[13px]">{t('admin.places.cancel')}</button>
              <button type="button" disabled={busy} onClick={() => void saveForm()} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">{busy ? '…' : t('admin.places.save')}</button>
            </div>
          </div>
        </div>
      )}

      {confirmArchive && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-[#1A1614]">
            <p className="text-[14px]">{t('admin.places.archiveConfirm')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmArchive(null)} className="rounded-full px-4 py-2 text-[13px]">{t('admin.places.cancel')}</button>
              <button type="button" disabled={busy} onClick={() => void archivePlace(confirmArchive)} className="rounded-full bg-red-600 px-4 py-2 text-[13px] text-white disabled:opacity-60">{t('admin.places.archive')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
