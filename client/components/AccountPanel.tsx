'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Shield,
  Store,
  UserRound,
  XCircle,
} from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Skeleton } from '@/components/ui/Skeleton'
import { useI18n, type Lang } from '@/components/I18nProvider'
import { focusRing } from '@/lib/design/tokens'
import { logoutAndRedirect } from '@/lib/authClient'

export type MeUser = {
  id: string
  user_id: string
  email: string | null
  name: string | null
  role: string
  roles: string[]
  language: Lang
  createdAt: string | null
  lastActiveAt: string | null
  lastLoginAt: string | null
  emailVerified: boolean | null
  hasPassword: boolean
  avatarUrl: string | null
  owned_place_id: string | null
  admin: boolean
}

type View = 'details' | 'edit' | 'password' | 'logoutConfirm'

function formatDate(iso: string | null, lang: Lang, fallback: string): string {
  if (!iso) return fallback
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return fallback
  try {
    return new Date(d).toLocaleString(lang === 'rw' ? 'rw-RW' : lang === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return new Date(d).toLocaleString()
  }
}

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'bg-[#E8672A]/15 text-[#E8672A]'
  if (role === 'moderator') return 'bg-[#854D0E]/15 text-[#854D0E]'
  if (role === 'business_owner') return 'bg-[#1F8A5B]/15 text-[#1F8A5B]'
  return 'bg-black/5 text-[#6E5B50] dark:bg-white/10 dark:text-white/70'
}

export function AccountPanel({
  open,
  onClose,
  onNameChange,
}: {
  open: boolean
  onClose: () => void
  onNameChange?: (name: string) => void
}) {
  const { t, lang, setLang } = useI18n()
  const panelTrapRef = useRef<HTMLDivElement>(null)
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('details')
  const [editName, setEditName] = useState('')
  const [editLang, setEditLang] = useState<Lang>('fr')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.user) {
        setError(res.status === 401 ? t('accountPanel.errors.unauthorized') : t('accountPanel.errors.load'))
        setUser(null)
        return
      }
      const u = data.user as MeUser
      if (!Array.isArray(u.roles) || !u.roles.length) {
        u.roles = u.role ? [u.role] : ['client']
      }
      setUser(u)
      setEditName(u.name ?? '')
      setEditLang(u.language || lang)
    } catch {
      setError(t('accountPanel.errors.load'))
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [t, lang])

  useEffect(() => {
    if (!open) {
      setView('details')
      setFlash('')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      return
    }
    void load()
  }, [open, load])

  // Basic focus trap while open
  useEffect(() => {
    if (!open) return
    const root = panelTrapRef.current
    if (!root) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, view, loading])

  const saveProfile = async () => {
    setBusy(true)
    setFlash('')
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), lang: editLang }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFlash(data.error || t('accountPanel.errors.save'))
        return
      }
      setLang(editLang)
      onNameChange?.(editName.trim())
      try {
        localStorage.setItem('hodari_name', editName.trim())
      } catch { /* ignore */ }
      setView('details')
      await load()
      setFlash(t('accountPanel.saved'))
    } catch {
      setFlash(t('accountPanel.errors.save'))
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      setFlash(t('accountPanel.errors.mismatch'))
      return
    }
    setBusy(true)
    setFlash('')
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_password',
          currentPassword,
          newPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFlash(data.error || t('accountPanel.errors.password'))
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setView('details')
      setFlash(t('accountPanel.passwordChanged'))
    } catch {
      setFlash(t('accountPanel.errors.password'))
    } finally {
      setBusy(false)
    }
  }

  const revokeOthers = async () => {
    setBusy(true)
    setFlash('')
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke_other_sessions' }),
      })
      if (!res.ok) {
        setFlash(t('accountPanel.errors.revoke'))
        return
      }
      setFlash(t('accountPanel.revokeDone'))
    } catch {
      setFlash(t('accountPanel.errors.revoke'))
    } finally {
      setBusy(false)
    }
  }

  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : []

  return (
    <Sheet open={open} onClose={onClose} side="left" title={t('accountPanel.title')}>
      <div ref={panelTrapRef} className="space-y-5">
        {loading && (
          <div className="space-y-3" aria-busy="true">
            <div className="flex items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px]">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className={`mt-3 rounded-full bg-[#E8672A] px-3 py-1.5 text-[12px] font-medium text-white ${focusRing}`}
            >
              {t('accountPanel.retry')}
            </button>
          </div>
        )}

        {!loading && !error && user && view === 'details' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-white dark:ring-[#3A322C]" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#FF8C2F] to-[#E8672A] text-[18px] font-semibold text-white">
                  {(user.name?.trim()?.[0] ?? user.email?.[0] ?? 'U').toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold text-[var(--text-primary)]">
                  {user.name || t('header.signedIn')}
                </p>
                <p className="truncate text-[13px] text-[var(--text-secondary)]">{user.email}</p>
              </div>
            </div>

            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                {t('accountPanel.roles')}
              </p>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <span
                    key={role}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${roleBadgeClass(role)}`}
                  >
                    <Shield className="h-3 w-3" aria-hidden />
                    {t(`accountPanel.role.${role}`)}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-header)] p-3.5 text-[13px]">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                {t('accountPanel.info')}
              </p>
              <dl className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-[var(--text-secondary)]">{t('accountPanel.email')}</dt>
                  <dd className="flex max-w-[60%] flex-col items-end gap-0.5 text-right font-medium">
                    <span className="break-all">{user.email ?? t('accountPanel.unknown')}</span>
                    {user.emailVerified === true && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#1F8A5B]">
                        <CheckCircle2 className="h-3 w-3" /> {t('accountPanel.verified')}
                      </span>
                    )}
                    {user.emailVerified === false && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#854D0E]">
                        <XCircle className="h-3 w-3" /> {t('accountPanel.unverified')}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-secondary)]">{t('accountPanel.language')}</dt>
                  <dd className="font-medium uppercase">{user.language}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-secondary)]">{t('accountPanel.created')}</dt>
                  <dd className="text-right font-medium">{formatDate(user.createdAt, lang, t('accountPanel.unknown'))}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-secondary)]">{t('accountPanel.lastLogin')}</dt>
                  <dd className="text-right font-medium">{formatDate(user.lastLoginAt || user.lastActiveAt, lang, t('accountPanel.unknown'))}</dd>
                </div>
              </dl>
            </section>

            {(roles.includes('business_owner') || roles.includes('admin') || roles.includes('moderator') || user.admin) && (
              <section className="space-y-2">
                {roles.includes('business_owner') && (
                  <Link
                    href="/business/dashboard"
                    className={`flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[13px] font-medium hover:border-[#E8672A]/40 hover:bg-[#E8672A]/5 ${focusRing}`}
                  >
                    <Store className="h-4 w-4 text-[#E8672A]" />
                    {t('accountPanel.linkBusiness')}
                  </Link>
                )}
                {(roles.includes('admin') || roles.includes('moderator') || user.admin) && (
                  <Link
                    href="/admin/dashboard"
                    className={`flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[13px] font-medium hover:border-[#E8672A]/40 hover:bg-[#E8672A]/5 ${focusRing}`}
                  >
                    <LayoutDashboard className="h-4 w-4 text-[#E8672A]" />
                    {t('accountPanel.linkAdmin')}
                  </Link>
                )}
              </section>
            )}

            {flash && <p className="text-[12px] text-[#1F8A5B]">{flash}</p>}

            <section className="space-y-2">
              <button
                type="button"
                onClick={() => { setFlash(''); setView('edit') }}
                className={`flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/[0.03] dark:hover:bg-white/5 ${focusRing}`}
              >
                <UserRound className="h-4 w-4 text-[#E8672A]" />
                {t('accountPanel.editProfile')}
              </button>
              {user.hasPassword && (
                <button
                  type="button"
                  onClick={() => { setFlash(''); setView('password') }}
                  className={`flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/[0.03] dark:hover:bg-white/5 ${focusRing}`}
                >
                  <KeyRound className="h-4 w-4 text-[#E8672A]" />
                  {t('accountPanel.changePassword')}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void revokeOthers()}
                className={`flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/[0.03] disabled:opacity-60 dark:hover:bg-white/5 ${focusRing}`}
              >
                <Shield className="h-4 w-4 text-[#E8672A]" />
                {t('accountPanel.revokeOthers')}
              </button>
              <button
                type="button"
                onClick={() => setView('logoutConfirm')}
                className={`flex w-full items-center gap-2 rounded-xl border border-red-500/25 px-3 py-2.5 text-left text-[13px] font-medium text-red-600 hover:bg-red-500/10 ${focusRing}`}
              >
                <LogOut className="h-4 w-4" />
                {t('header.logout')}
              </button>
            </section>
          </div>
        )}

        {!loading && !error && user && view === 'edit' && (
          <div className="space-y-4">
            <label className="block text-[13px]">
              <span className="mb-1 block text-[var(--text-secondary)]">{t('accountPanel.fields.name')}</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none focus:border-[#E8672A]"
              />
            </label>
            <label className="block text-[13px]">
              <span className="mb-1 block text-[var(--text-secondary)]">{t('accountPanel.fields.language')}</span>
              <select
                value={editLang}
                onChange={(e) => setEditLang(e.target.value as Lang)}
                className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none focus:border-[#E8672A]"
              >
                <option value="fr">FR</option>
                <option value="en">EN</option>
                <option value="rw">RW</option>
              </select>
            </label>
            {flash && <p className="text-[12px] text-red-600">{flash}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setView('details')} className={`rounded-full border border-[var(--border)] px-4 py-2 text-[13px] ${focusRing}`}>
                {t('accountPanel.cancel')}
              </button>
              <button type="button" disabled={busy} onClick={() => void saveProfile()} className={`rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 ${focusRing}`}>
                {t('accountPanel.save')}
              </button>
            </div>
          </div>
        )}

        {!loading && !error && user && view === 'password' && (
          <div className="space-y-3">
            <label className="block text-[13px]">
              <span className="mb-1 block text-[var(--text-secondary)]">{t('accountPanel.fields.currentPassword')}</span>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none focus:border-[#E8672A]" />
            </label>
            <label className="block text-[13px]">
              <span className="mb-1 block text-[var(--text-secondary)]">{t('accountPanel.fields.newPassword')}</span>
              <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none focus:border-[#E8672A]" />
            </label>
            <label className="block text-[13px]">
              <span className="mb-1 block text-[var(--text-secondary)]">{t('accountPanel.fields.confirmPassword')}</span>
              <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none focus:border-[#E8672A]" />
            </label>
            {flash && <p className="text-[12px] text-red-600">{flash}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setView('details')} className={`rounded-full border border-[var(--border)] px-4 py-2 text-[13px] ${focusRing}`}>
                {t('accountPanel.cancel')}
              </button>
              <button type="button" disabled={busy} onClick={() => void savePassword()} className={`rounded-full bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60 ${focusRing}`}>
                {t('accountPanel.save')}
              </button>
            </div>
          </div>
        )}

        {!loading && !error && view === 'logoutConfirm' && (
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--text-primary)]">{t('accountPanel.logoutConfirm')}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setView('details')} className={`rounded-full border border-[var(--border)] px-4 py-2 text-[13px] ${focusRing}`}>
                {t('accountPanel.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void logoutAndRedirect('/login')}
                className={`rounded-full bg-red-600 px-4 py-2 text-[13px] font-medium text-white ${focusRing}`}
              >
                {t('header.logout')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
