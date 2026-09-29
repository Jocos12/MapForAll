'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, MapPinned, Shield, Users, X } from 'lucide-react'
import { PlaceBadges } from '@/components/PlaceBadges'
import type { AdminPlaceItem, DuplicateHint } from '@/components/admin/adminPlaceTypes'
import { EmptyState } from '@/components/admin/EmptyState'
import { StatCard } from '@/components/admin/StatCard'
import { useAdminPlacesList } from '@/components/admin/useAdminPlacesList'
import { PLACE_CATEGORIES } from '@/lib/places'
import { SECTOR_NAMES } from '@/lib/adminPlaces'
import { useI18n } from '@/components/I18nProvider'
import { useToast } from '@/components/ui/Toast'

const AdminPlaceMiniMap = dynamic(
  () => import('@/components/admin/AdminPlaceMiniMap').then((m) => m.AdminPlaceMiniMap),
  { ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded-xl bg-black/5 dark:bg-white/5" /> },
)

const REJECT_PRESETS = ['duplicate', 'incomplete', 'location', 'quality', 'spam'] as const

export default function AdminModerationPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const { query, setQuery, data, loading, error, reload } = useAdminPlacesList({
    status: 'pending',
    sort: 'created_desc',
    page: 1,
    limit: 50,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [rejectPreset, setRejectPreset] = useState<(typeof REJECT_PRESETS)[number] | ''>('')
  const [busy, setBusy] = useState(false)

  const items = data?.items ?? []
  const dupMap = useMemo(() => {
    const m = new Map<string, DuplicateHint>()
    for (const h of data?.duplicatesHints ?? []) m.set(h.place_id, h)
    return m
  }, [data?.duplicatesHints])

  const focused = useMemo(() => {
    const id = focusId ?? items[0]?.place_id ?? null
    return items.find((p) => p.place_id === id) ?? null
  }, [focusId, items])

  useEffect(() => {
    if (items.length && !focusId) setFocusId(items[0].place_id)
  }, [items, focusId])

  useEffect(() => {
    if (rejectPreset) setReason(t(`admin.moderation.presets.${rejectPreset}`))
  }, [rejectPreset, t])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const moderate = useCallback(
    async (ids: string[], status: 'validated' | 'rejected', action?: 'request_changes' | 'merge') => {
      if (!ids.length) return
      setBusy(true)
      try {
        const body =
          ids.length === 1
            ? { place_id: ids[0], status, reason, action }
            : { place_ids: ids, status, reason, action }
        const res = await fetch('/api/admin/places', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
          return
        }
        toast({
          title: status === 'validated' ? t('admin.validate') : t('admin.reject'),
          tone: status === 'validated' ? 'success' : 'info',
        })
        setSelected(new Set())
        setReason('')
        setRejectPreset('')
        await reload()
      } finally {
        setBusy(false)
      }
    },
    [reason, reload, t, toast],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!focused || busy) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        void moderate([focused.place_id], 'validated')
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        void moderate([focused.place_id], 'rejected', rejectPreset === 'incomplete' ? 'request_changes' : undefined)
      }
      const idx = items.findIndex((p) => p.place_id === focused.place_id)
      if (e.key === 'ArrowDown' && idx >= 0 && idx < items.length - 1) {
        e.preventDefault()
        setFocusId(items[idx + 1].place_id)
      }
      if (e.key === 'ArrowUp' && idx > 0) {
        e.preventDefault()
        setFocusId(items[idx - 1].place_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, focused, items, moderate, rejectPreset])

  const pendingCount = data?.total ?? 0

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight">{t('admin.nav.moderation')}</h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.moderation.subtitle')}</p>
        </div>
        <p className="text-[12px] text-[#6E5B50] dark:text-white/45">{t('admin.moderation.shortcuts')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.pending')} value={pendingCount} icon={Shield} index={0} />
        <StatCard label={t('admin.moderation.duplicates')} value={data?.duplicatesHints?.length ?? 0} icon={AlertTriangle} index={1} />
        <StatCard label={t('admin.local')} value={items.filter((p) => p.local_business).length} icon={MapPinned} index={2} />
        <StatCard label={t('admin.accessible')} value={items.filter((p) => p.accessible).length} icon={Users} index={3} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-white/5">
        <input
          value={query.q ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value, page: 1 }))}
          placeholder={t('admin.moderation.search')}
          className="min-w-[160px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px] dark:border-white/15"
        />
        <select
          value={query.category ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, category: e.target.value || undefined, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="">{t('admin.moderation.allCategories')}</option>
          {PLACE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={query.source ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, source: e.target.value || undefined, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="">{t('admin.moderation.allSources')}</option>
          <option value="user_submitted">user_submitted</option>
          <option value="owner_claimed">owner_claimed</option>
          <option value="official">official</option>
          <option value="admin">admin</option>
          <option value="import">import</option>
        </select>
        <select
          value={query.sector ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, sector: e.target.value || undefined, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="">{t('admin.moderation.allSectors')}</option>
          {SECTOR_NAMES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={!!query.local}
            onChange={(e) => setQuery((q) => ({ ...q, local: e.target.checked || undefined, page: 1 }))}
          />
          {t('admin.local')}
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={!!query.accessible}
            onChange={(e) => setQuery((q) => ({ ...q, accessible: e.target.checked || undefined, page: 1 }))}
          />
          {t('admin.accessible')}
        </label>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">
          {error === 'load_failed' ? t('admin.shell.loadError') : error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
          {loading && <p className="p-4 text-[13px] text-[#6E5B50]">{t('admin.moderation.loading')}</p>}
          {!loading && items.length === 0 && (
            <EmptyState title={t('admin.empty')} body={t('admin.moderation.emptyHint')} className="border-0" />
          )}
          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-black/5 bg-black/[0.02] text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10 dark:bg-white/[0.03]">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">{t('admin.places.colName')}</th>
                    <th className="px-3 py-2">{t('admin.places.colCategory')}</th>
                    <th className="px-3 py-2">{t('admin.places.colSector')}</th>
                    <th className="px-3 py-2">{t('admin.places.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <ModerationRow
                      key={row.place_id}
                      row={row}
                      active={focused?.place_id === row.place_id}
                      selected={selected.has(row.place_id)}
                      duplicate={dupMap.get(row.place_id)}
                      onSelect={() => toggleSelect(row.place_id)}
                      onFocus={() => setFocusId(row.place_id)}
                      t={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > (query.limit ?? 50) && (
            <div className="flex items-center justify-between border-t border-black/5 px-3 py-2 dark:border-white/10">
              <button
                type="button"
                disabled={(query.page ?? 1) <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: Math.max(1, (q.page ?? 1) - 1) }))}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] disabled:opacity-40"
              >
                <ChevronLeft size={14} /> {t('admin.places.prev')}
              </button>
              <span className="text-[12px] text-[#6E5B50]">
                {`${t('admin.places.page')} ${query.page ?? 1} / ${Math.max(1, Math.ceil(data.total / (query.limit ?? 50)))}`}
              </span>
              <button
                type="button"
                disabled={(query.page ?? 1) * (query.limit ?? 50) >= data.total}
                onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] disabled:opacity-40"
              >
                {t('admin.places.next')} <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          {!focused ? (
            <p className="text-[13px] text-[#6E5B50]">{t('admin.moderation.selectRow')}</p>
          ) : (
            <>
              <DetailPanel place={focused} duplicate={dupMap.get(focused.place_id)} t={t} />
              <select
                value={rejectPreset}
                onChange={(e) => setRejectPreset(e.target.value as (typeof REJECT_PRESETS)[number] | '')}
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px] dark:border-white/15"
              >
                <option value="">{t('admin.moderation.presetReason')}</option>
                {REJECT_PRESETS.map((k) => (
                  <option key={k} value={k}>{t(`admin.moderation.presets.${k}`)}</option>
                ))}
              </select>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('admin.reason')}
                rows={3}
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px] dark:border-white/15"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void moderate([focused.place_id], 'validated')}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-[#0F6E56] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60"
                >
                  <Check size={14} /> {t('admin.validate')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void moderate([focused.place_id], 'rejected', rejectPreset === 'incomplete' ? 'request_changes' : undefined)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-[#E8672A] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60"
                >
                  <X size={14} /> {t('admin.reject')}
                </button>
              </div>
              {selected.size > 0 && (
                <div className="border-t border-black/5 pt-3 dark:border-white/10">
                  <p className="mb-2 text-[12px] text-[#6E5B50]">{t('admin.moderation.bulkSelected').replace('{n}', String(selected.size))}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void moderate([...selected], 'validated')}
                      className="flex-1 rounded-full bg-[#0F6E56] px-2 py-1.5 text-[11px] text-white disabled:opacity-60"
                    >
                      {t('admin.moderation.bulkApprove')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void moderate([...selected], 'rejected')}
                      className="flex-1 rounded-full bg-[#E8672A] px-2 py-1.5 text-[11px] text-white disabled:opacity-60"
                    >
                      {t('admin.moderation.bulkReject')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function ModerationRow({
  row,
  active,
  selected,
  duplicate,
  onSelect,
  onFocus,
  t,
}: {
  row: AdminPlaceItem
  active: boolean
  selected: boolean
  duplicate?: DuplicateHint
  onSelect: () => void
  onFocus: () => void
  t: (k: string) => string
}) {
  return (
    <tr
      className={`cursor-pointer border-b border-black/5 transition dark:border-white/5 ${active ? 'bg-[#E8672A]/8' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}
      onClick={onFocus}
    >
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={t('admin.moderation.selectPlace')} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-start gap-2">
          <div>
            <p className="font-medium">{row.name}</p>
            {row.claimed_by_owner && <p className="text-[11px] text-[#E8672A]">{t('admin.claimed')}</p>}
            {duplicate && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle size={12} /> {t('admin.moderation.duplicateWarning')}
              </p>
            )}
            <PlaceBadges place={row} className="mt-1" />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-[#6E5B50] dark:text-white/55">{row.categories.join(', ')}</td>
      <td className="px-3 py-2 text-[#6E5B50] dark:text-white/55">{row.sector ?? '—'}</td>
      <td className="px-3 py-2 text-[#6E5B50] dark:text-white/55">{row.created_at?.slice(0, 10) ?? '—'}</td>
    </tr>
  )
}

function DetailPanel({
  place,
  duplicate,
  t,
}: {
  place: AdminPlaceItem
  duplicate?: DuplicateHint
  t: (k: string) => string
}) {
  return (
    <>
      <div>
        <h2 className="font-display text-lg font-semibold">{place.name}</h2>
        <p className="mt-1 text-[12px] text-[#6E5B50] dark:text-white/55">{place.address}</p>
        <PlaceBadges place={place} className="mt-2" />
      </div>
      {duplicate && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px]">
          <p className="font-medium">{t('admin.moderation.duplicateTitle')}</p>
          <ul className="mt-1 list-inside list-disc">
            {duplicate.matches.slice(0, 3).map((m) => (
              <li key={m.place_id}>{m.name} ({m.distance_m} m)</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        <div><dt className="text-[#6E5B50]">{t('admin.places.colStatus')}</dt><dd>{place.status}</dd></div>
        <div><dt className="text-[#6E5B50]">{t('admin.places.colSource')}</dt><dd>{place.source ?? '—'}</dd></div>
        <div><dt className="text-[#6E5B50]">{t('admin.places.colSector')}</dt><dd>{place.sector ?? '—'}</dd></div>
        <div><dt className="text-[#6E5B50]">Lat/Lng</dt><dd>{place.coordinates.lat.toFixed(5)}, {place.coordinates.lng.toFixed(5)}</dd></div>
      </dl>
      <AdminPlaceMiniMap lat={place.coordinates.lat} lng={place.coordinates.lng} label={place.name} />
    </>
  )
}
