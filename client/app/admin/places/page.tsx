'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Download,
  MapPinned,
  PauseCircle,
  Pencil,
  Plus,
  Upload,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { StatCard } from '@/components/admin/StatCard'
import { CategoryBadge, PillFlag, StatusBadge } from '@/components/admin/AdminBadges'
import { AdminTablePagination, AdminTableShell, IconAction } from '@/components/admin/AdminDataTable'
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
  const { query, setQuery, data, loading, error, reload } = useAdminPlacesList({
    sort: 'created_desc',
    page: 1,
    limit: 25,
  })
  const [panelOpen, setPanelOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [importTab, setImportTab] = useState<'json' | 'csv'>('json')
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState<ImportRowPreview[]>([])
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const page = data?.page ?? 1
  const limit = query.limit ?? 25
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const stats = useMemo(() => ({
    total,
    validated: items.filter((p) => p.status === 'validated' || !p.status).length,
    paused: items.filter((p) => p.paused).length,
  }), [total, items])

  const statusLabels = useMemo(() => ({
    pending: t('admin.places.statusPending'),
    validated: t('admin.places.statusValidated'),
    rejected: t('admin.places.statusRejected'),
    archived: t('admin.places.statusArchived'),
  }), [t])

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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('admin.total')} value={stats.total} icon={MapPinned} index={0} />
        <StatCard label={t('admin.places.validatedOnPage')} value={stats.validated} icon={CheckCircle2} index={1} />
        <StatCard label={t('admin.places.pausedOnPage')} value={stats.paused} icon={PauseCircle} index={2} />
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-white/5">
        <input
          value={query.q ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value, page: 1 }))}
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

      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">{t('admin.shell.loadError')}</p>}

      <AdminTableShell>
        {loading && <p className="p-4 text-[13px] text-[#6E5B50]">{t('admin.moderation.loading')}</p>}
        {!loading && items.length === 0 && (
          <EmptyState title={t('admin.places.empty')} action={<button type="button" onClick={openCreate} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] text-white">{t('admin.places.create')}</button>} />
        )}
        {!loading && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-black/5 bg-black/[0.02] text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10">
                <tr>
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
                      <div className="flex justify-end gap-1 opacity-70 transition group-hover:opacity-100">
                        <IconAction label={t('admin.places.edit')} onClick={() => openEdit(row)} disabled={busy}>
                          <Pencil size={14} />
                        </IconAction>
                        <IconAction
                          label={t('admin.places.archive')}
                          tone="danger"
                          disabled={busy || rowBusy === row.place_id}
                          onClick={() => setConfirmArchive(row.place_id)}
                        >
                          <Archive size={14} />
                        </IconAction>
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

      <section className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
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
                onClick={() => { setImportTab(tab); setImportRows([]); setImportText('') }}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] font-medium',
                  importTab === tab ? 'bg-[#E8672A] text-white' : 'text-[#6E5B50] dark:text-white/55',
                )}
              >
                {tab === 'json' ? t('admin.places.importTabJson') : t('admin.places.importTabCsv')}
              </button>
            ))}
          </div>
        </div>
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
      </section>

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
