'use client'

import { useCallback, useMemo, useState } from 'react'
import { Download, Flag, KeyRound, LogOut, MapPin, Pencil, Plus, Shield, Trash2, UserPlus, UserRound } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { EmptyState } from '@/components/admin/EmptyState'
import { ImageUploader, type ImageUploadValue } from '@/components/admin/ImageUploader'
import { RoleBadge, UserStatusBadge } from '@/components/admin/AdminBadges'
import { useAdminUsersList } from '@/components/admin/useAdminUsersList'
import type { AdminUserListItem, AdminUserDetail } from '@/components/admin/adminUserTypes'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'

type CreateForm = {
  name: string
  email: string
  password: string
  role: string
}

const emptyCreate = (): CreateForm => ({
  name: '',
  email: '',
  password: '',
  role: 'client',
})

function fmtDate(iso: string | null | undefined, locale: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function AdminUsersPage() {
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const { query, setQuery, data, loading, error, reload } = useAdminUsersList({
    status: 'active',
    sort: 'created_desc',
    page: 1,
    limit: 50,
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate())
  const [createAvatar, setCreateAvatar] = useState<ImageUploadValue | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('client')
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active')
  const [editAvatar, setEditAvatar] = useState<ImageUploadValue | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const page = data?.page ?? 1
  const limit = query.limit ?? 50
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const stats = useMemo(() => ({
    total,
    active: items.filter((u) => u.status === 'active').length,
    suspended: items.filter((u) => u.status === 'suspended').length,
  }), [total, items])

  const exportCsv = useCallback(() => {
    const sp = new URLSearchParams()
    if (query.q) sp.set('q', query.q)
    if (query.role) sp.set('role', query.role)
    if (query.status) sp.set('status', query.status)
    window.open(`/api/admin/users/export?${sp.toString()}`, '_blank', 'noopener,noreferrer')
  }, [query])

  const openCreate = () => {
    setCreateForm(emptyCreate())
    setCreateAvatar(null)
    setCreateOpen(true)
  }

  const loadDetail = async (userId: string) => {
    setSelectedId(userId)
    setDetail(null)
    setEditAvatar(null)
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include', cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
      return
    }
    const u = json.user as AdminUserDetail
    setDetail(u)
    setEditName(u.name ?? '')
    setEditRole(u.role)
    setEditStatus(u.status === 'suspended' ? 'suspended' : 'active')
  }

  const submitCreate = async () => {
    setBusy(true)
    try {
      if (!createForm.name.trim() || !createForm.email.trim() || createForm.password.length < 8) {
        toast({ title: t('admin.users.formInvalid'), tone: 'danger' })
        return
      }
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
          avatar_base64: createAvatar?.dataUrl,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t('admin.users.created'), tone: 'success' })
      setCreateOpen(false)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          role: editRole,
          status: editStatus,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      if (editAvatar?.file) {
        const fd = new FormData()
        fd.set('file', editAvatar.file)
        const av = await fetch(`/api/admin/users/${encodeURIComponent(selectedId)}/avatar`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!av.ok) {
          const avJson = await av.json().catch(() => ({}))
          toast({ title: t('admin.users.avatarFailed'), description: avJson.error, tone: 'danger' })
        }
      }
      toast({ title: t('admin.users.saved'), tone: 'success' })
      await reload()
      await loadDetail(selectedId)
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: 'force_logout' | 'reset_password' | 'resend_welcome') => {
    if (!selectedId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedId)}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.shell.loadError'), description: json.error, tone: 'danger' })
        return
      }
      if (action === 'force_logout') toast({ title: t('admin.users.forceLogoutDone'), tone: 'success' })
      if (action === 'resend_welcome') {
        toast({
          title: json.sent ? t('admin.users.welcomeSent') : t('admin.users.welcomeNotSent'),
          tone: json.sent ? 'success' : 'info',
        })
      }
      if (action === 'reset_password') {
        toast({
          title: json.emailed ? t('admin.users.passwordEmailed') : t('admin.users.passwordTemp'),
          description: json.temporary_password ? String(json.temporary_password) : undefined,
          tone: json.emailed ? 'success' : 'info',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const deleteUser = async (userId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: t('admin.users.deleteFailed'), description: json.error, tone: 'danger' })
        return
      }
      toast({ title: t('admin.users.deleted'), tone: 'info' })
      setConfirmDelete(null)
      if (selectedId === userId) {
        setSelectedId(null)
        setDetail(null)
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const removeAvatar = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedId)}/avatar`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        toast({ title: t('admin.users.avatarFailed'), tone: 'danger' })
        return
      }
      setEditAvatar(null)
      await loadDetail(selectedId)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight">{t('admin.nav.users')}</h1>
          <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.users.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-[13px] dark:border-white/15">
            <Download size={16} /> {t('admin.users.export')}
          </button>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white">
            <Plus size={16} /> {t('admin.users.create')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-white/5">
        <input
          value={query.q ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value, page: 1 }))}
          placeholder={t('admin.users.search')}
          className="min-w-[140px] flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-2 text-[13px] dark:border-white/15"
        />
        <select
          value={query.role ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, role: e.target.value || undefined, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="">{t('admin.users.allRoles')}</option>
          <option value="client">{t('admin.users.roleClient')}</option>
          <option value="business_owner">{t('admin.users.roleOwner')}</option>
          <option value="moderator">{t('admin.users.roleModerator')}</option>
          <option value="admin">{t('admin.users.roleAdmin')}</option>
        </select>
        <select
          value={query.status ?? 'active'}
          onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="active">{t('admin.users.statusActive')}</option>
          <option value="suspended">{t('admin.users.statusSuspended')}</option>
          <option value="deleted">{t('admin.users.statusDeleted')}</option>
          <option value="all">{t('admin.users.statusAll')}</option>
        </select>
        <select
          value={query.sort ?? 'created_desc'}
          onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value, page: 1 }))}
          className="rounded-xl border border-black/10 bg-transparent px-2 py-2 text-[13px] dark:border-white/15"
        >
          <option value="created_desc">{t('admin.users.sortNewest')}</option>
          <option value="created_asc">{t('admin.users.sortOldest')}</option>
          <option value="name">{t('admin.users.sortName')}</option>
          <option value="email">{t('admin.users.sortEmail')}</option>
          <option value="last_active">{t('admin.users.sortActive')}</option>
        </select>
      </div>

      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">{t('admin.shell.loadError')}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <EmptyState
              title={t('admin.users.empty')}
              action={
                <button type="button" onClick={openCreate} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] text-white">
                  {t('admin.users.create')}
                </button>
              }
            />
          )}
          {!loading && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13px]">
                <thead className="border-b border-black/5 bg-black/[0.02] text-[11px] uppercase tracking-wide text-[#6E5B50] dark:border-white/10">
                  <tr>
                    <th className="px-3 py-2">{t('admin.users.colUser')}</th>
                    <th className="px-3 py-2">{t('admin.users.colRole')}</th>
                    <th className="px-3 py-2">{t('admin.users.colStatus')}</th>
                    <th className="px-3 py-2">{t('admin.users.colCreated')}</th>
                    <th className="px-3 py-2">{t('admin.users.colLastActive')}</th>
                    <th className="px-3 py-2">{t('admin.users.colContributions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row: AdminUserListItem) => (
                    <tr
                      key={`${row.user_id}::${row.email}`}
                      onClick={() => void loadDetail(row.user_id)}
                      className={cnRow(selectedId === row.user_id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar src={row.avatar_url} name={row.name ?? row.email} size="sm" />
                          <div>
                            <div className="font-medium">{row.name ?? '—'}</div>
                            <div className="text-[12px] text-[#6E5B50] dark:text-white/50">{row.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <RoleBadge role={row.role} label={t(`admin.users.role_${row.role}` as 'admin.users.role_client')} />
                      </td>
                      <td className="px-3 py-2">
                        <UserStatusBadge
                          status={row.status}
                          label={t(`admin.users.status_${row.status}` as 'admin.users.status_active')}
                        />
                      </td>
                      <td className="px-3 py-2">{fmtDate(row.created_at, lang)}</td>
                      <td className="px-3 py-2">{fmtDate(row.last_active_at, lang)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3 text-[12px] text-[#6E5B50] dark:text-white/55">
                          <span className="inline-flex items-center gap-1" title={t('admin.users.contribPlaces')}>
                            <MapPin size={13} className="text-[#E8672A]" /> {row.places_added}
                          </span>
                          <span className="inline-flex items-center gap-1" title={t('admin.users.contribReports')}>
                            <Flag size={13} className="text-amber-600" /> {row.reports_count}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-black/5 px-3 py-2 text-[12px] dark:border-white/10">
              <span>{t('admin.users.pageOf').replace('{page}', String(page)).replace('{total}', String(totalPages))}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setQuery((q) => ({ ...q, page: Math.max(1, (q.page ?? 1) - 1) }))}
                  className="rounded-full border border-black/10 px-3 py-1 disabled:opacity-40 dark:border-white/15"
                >
                  {t('admin.users.prev')}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))}
                  className="rounded-full border border-black/10 px-3 py-1 disabled:opacity-40 dark:border-white/15"
                >
                  {t('admin.users.next')}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          {!selectedId && (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8672A]/12 text-[#E8672A]">
                <UserRound size={28} strokeWidth={1.75} />
              </span>
              <p className="text-[14px] font-medium">{t('admin.users.selectTitle')}</p>
              <p className="mt-1 max-w-[220px] text-[12px] text-[#6E5B50] dark:text-white/50">{t('admin.users.selectRow')}</p>
            </div>
          )}
          {selectedId && !detail && <Skeleton className="h-40 w-full rounded-xl" />}
          {detail && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Avatar src={detail.avatar_url} name={detail.name ?? detail.email} size="lg" />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold leading-tight">{detail.name ?? detail.email}</h2>
                  <p className="truncate text-[12px] text-[#6E5B50] dark:text-white/50">{detail.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <RoleBadge role={detail.role} label={t(`admin.users.role_${detail.role}` as 'admin.users.role_client')} />
                    <UserStatusBadge
                      status={detail.status}
                      label={t(`admin.users.status_${detail.status}` as 'admin.users.status_active')}
                    />
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.02] p-3 text-[12px] dark:bg-white/[0.03]">
                <div>
                  <dt className="text-[#6E5B50] dark:text-white/45">{t('admin.users.colCreated')}</dt>
                  <dd className="mt-0.5 font-medium">{fmtDate(detail.created_at, lang)}</dd>
                </div>
                <div>
                  <dt className="text-[#6E5B50] dark:text-white/45">{t('admin.users.lastLogin')}</dt>
                  <dd className="mt-0.5 font-medium">{fmtDate(detail.last_login_at, lang)}</dd>
                </div>
                <div className="col-span-2 flex items-center gap-3 pt-1">
                  <span className="inline-flex items-center gap-1"><MapPin size={13} className="text-[#E8672A]" /> {detail.places_added} {t('admin.users.contribPlaces')}</span>
                  <span className="inline-flex items-center gap-1"><Flag size={13} className="text-amber-600" /> {detail.reports_count} {t('admin.users.contribReports')}</span>
                </div>
              </dl>

              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6E5B50] dark:text-white/45">{t('admin.users.sectionProfile')}</p>
                <label className="block text-[12px]">
                  {t('admin.users.fieldName')}
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15"
                  />
                </label>
                <label className="block text-[12px]">
                  {t('admin.users.fieldRole')}
                  <Select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="mt-1 text-[13px]">
                    <option value="client">{t('admin.users.roleClient')}</option>
                    <option value="business_owner">{t('admin.users.roleOwner')}</option>
                    <option value="moderator">{t('admin.users.roleModerator')}</option>
                    <option value="admin">{t('admin.users.roleAdmin')}</option>
                  </Select>
                </label>
                <label className="block text-[12px]">
                  {t('admin.users.fieldStatus')}
                  <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'suspended')} className="mt-1 text-[13px]">
                    <option value="active">{t('admin.users.statusActive')}</option>
                    <option value="suspended">{t('admin.users.statusSuspended')}</option>
                  </Select>
                </label>
                <div>
                  <p className="mb-2 text-[12px]">{t('admin.users.fieldAvatar')}</p>
                  <ImageUploader value={editAvatar} onChange={setEditAvatar} disabled={busy} />
                  {detail.avatar_url && !editAvatar && (
                    <button type="button" onClick={() => void removeAvatar()} className="mt-2 text-[12px] text-red-600">
                      {t('admin.users.avatarRemove')}
                    </button>
                  )}
                </div>
                <button type="button" disabled={busy} onClick={() => void saveEdit()} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
                  <Pencil size={14} /> {busy ? '…' : t('admin.users.save')}
                </button>
              </div>

              <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6E5B50] dark:text-white/45">{t('admin.users.sectionSecurity')}</p>
                <button type="button" disabled={busy} onClick={() => void runAction('force_logout')} className="inline-flex w-full items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-[12px] dark:border-white/15 disabled:opacity-60">
                  <LogOut size={14} /> {t('admin.users.forceLogout')}
                </button>
                <button type="button" disabled={busy} onClick={() => void runAction('reset_password')} className="inline-flex w-full items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-[12px] dark:border-white/15 disabled:opacity-60">
                  <KeyRound size={14} /> {t('admin.users.resetPassword')}
                </button>
                <button type="button" disabled={busy} onClick={() => void runAction('resend_welcome')} className="inline-flex w-full items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-[12px] dark:border-white/15 disabled:opacity-60">
                  <UserPlus size={14} /> {t('admin.users.resendWelcome')}
                </button>
                <p className="pt-1 text-[11px] text-[#6E5B50] dark:text-white/45">
                  <Shield size={12} className="mr-1 inline" />
                  {detail.has_password ? t('admin.users.hasPassword') : t('admin.users.noPassword')}
                </p>
              </div>

              <div className="space-y-2 border-t border-red-500/20 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">{t('admin.users.sectionDanger')}</p>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(detail.user_id)} className="inline-flex w-full items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-600 disabled:opacity-60">
                  <Trash2 size={14} /> {t('admin.users.delete')}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <p className="text-[12px] text-[#6E5B50] dark:text-white/45">
        {t('admin.users.statsLine')
          .replace('{total}', String(stats.total))
          .replace('{active}', String(stats.active))
          .replace('{suspended}', String(stats.suspended))}
      </p>

      {createOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#1A1614]">
            <h2 className="font-display text-xl font-semibold">{t('admin.users.createTitle')}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-[12px]">
                {t('admin.users.fieldName')}
                <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
              </label>
              <label className="block text-[12px]">
                {t('admin.users.fieldEmail')}
                <input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
              </label>
              <label className="block text-[12px]">
                {t('admin.users.fieldPassword')}
                <input type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15" />
              </label>
              <label className="block text-[12px]">
                {t('admin.users.fieldRole')}
                <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-[13px] dark:border-white/15">
                  <option value="client">{t('admin.users.roleClient')}</option>
                  <option value="business_owner">{t('admin.users.roleOwner')}</option>
                  <option value="moderator">{t('admin.users.roleModerator')}</option>
                  <option value="admin">{t('admin.users.roleAdmin')}</option>
                </select>
              </label>
              <ImageUploader value={createAvatar} onChange={setCreateAvatar} disabled={busy} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-full px-4 py-2 text-[13px]">{t('admin.users.cancel')}</button>
              <button type="button" disabled={busy} onClick={() => void submitCreate()} className="rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">{t('admin.users.save')}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-[#1A1614]">
            <p className="text-[14px]">{t('admin.users.deleteConfirm')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-full px-4 py-2 text-[13px]">{t('admin.users.cancel')}</button>
              <button type="button" disabled={busy} onClick={() => void deleteUser(confirmDelete)} className="rounded-full bg-red-600 px-4 py-2 text-[13px] text-white">{t('admin.users.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function cnRow(selected: boolean) {
  return [
    'cursor-pointer border-b border-black/5 transition-colors dark:border-white/5',
    selected ? 'bg-[#E8672A]/10' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]',
  ].join(' ')
}
