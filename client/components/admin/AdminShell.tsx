'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ChevronLeft,
  ClipboardList,
  Flag,
  FolderTree,
  Gauge,
  Languages,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  MessageSquareWarning,
  Moon,
  Scale,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { useI18n, type Lang } from '@/components/I18nProvider'
import { logoutAndRedirect } from '@/lib/authClient'
import { ToastProvider } from '@/components/ui/Toast'
import { AdminNavProgress } from '@/components/admin/AdminNavProgress'

export const ADMIN_NAV = [
  { href: '/admin/dashboard', icon: LayoutDashboard, key: 'dashboard' },
  { href: '/admin/moderation', icon: Shield, key: 'moderation' },
  { href: '/admin/places', icon: MapPinned, key: 'places' },
  { href: '/admin/businesses', icon: Building2, key: 'businesses' },
  { href: '/admin/users', icon: Users, key: 'users' },
  { href: '/admin/reports', icon: Flag, key: 'reports' },
  { href: '/admin/reviews', icon: MessageSquareWarning, key: 'reviews' },
  { href: '/admin/categories', icon: FolderTree, key: 'categories' },
  { href: '/admin/translations', icon: Languages, key: 'translations' },
  { href: '/admin/impact', icon: BarChart3, key: 'impact' },
  { href: '/admin/insights', icon: Sparkles, key: 'insights' },
  { href: '/admin/scoring', icon: Gauge, key: 'scoring' },
  { href: '/admin/audit', icon: ClipboardList, key: 'audit' },
  { href: '/admin/settings', icon: Settings, key: 'settings' },
] as const

type Notif = { id: string; title: string; href: string; at: string }

function useTheme() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const stored = localStorage.getItem('hodari_theme') === 'dark'
    setDark(stored)
    document.documentElement.classList.toggle('dark', stored)
  }, [])
  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev
      localStorage.setItem('hodari_theme', next ? 'dark' : 'light')
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])
  return { dark, toggle }
}

export function AdminShell({
  children,
  actor,
}: {
  children: ReactNode
  actor: { name: string | null; email: string; role: string }
}) {
  const { t, lang, setLang } = useI18n()
  const pathname = usePathname()
  const router = useRouter()
  const reduced = useReducedMotion()
  const { dark, toggle } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  const active = useMemo(
    () => ADMIN_NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? ADMIN_NAV[0],
    [pathname],
  )

  useEffect(() => {
    document.documentElement.classList.add('admin-app')
    return () => {
      document.documentElement.classList.remove('admin-app')
      // Never leave body locked if a modal was mid-open during unmount.
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen(true)
      }
      if (e.key === 'Escape') {
        setCmdOpen(false)
        setBellOpen(false)
        setAvatarOpen(false)
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!cmdOpen && !mobileOpen) {
      document.body.style.overflow = ''
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [cmdOpen, mobileOpen])
  useEffect(() => {
    let cancelled = false
    async function loadNotifs() {
      try {
        const res = await fetch('/api/admin/notifications', { cache: 'no-store', credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setNotifs(Array.isArray(data.items) ? data.items : [])
      } catch { /* ignore */ }
    }
    void loadNotifs()
    const id = window.setInterval(loadNotifs, 15_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  const filteredNav = useMemo(() => {
    const q = cmdQuery.trim().toLowerCase()
    if (!q) return ADMIN_NAV
    return ADMIN_NAV.filter((item) => t(`admin.nav.${item.key}`).toLowerCase().includes(q) || item.key.includes(q))
  }, [cmdQuery, t])

  const crumb = t(`admin.nav.${active.key}`)

  const sidebar = (
    <aside
      className={`flex h-full flex-col border-r border-black/[0.06] bg-[#141210] text-[#FBF3E7] transition-[width] duration-300 ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}
    >
      <div className={`flex items-center gap-3 px-4 py-5 ${collapsed ? 'justify-center' : ''}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8672A] text-[11px] font-bold text-white">MF</span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-tight">MapForAll</p>
            <p className="truncate text-[11px] text-white/50">{t('admin.shell.console')}</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label={t('admin.shell.nav')}>
        {ADMIN_NAV.map((item) => {
          const on = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => setMobileOpen(false)}
              title={t(`admin.nav.${item.key}`)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors ${
                on ? 'bg-[#E8672A] text-white' : 'text-white/70 hover:bg-white/8 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon size={18} strokeWidth={on ? 2.25 : 1.75} className="shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{t(`admin.nav.${item.key}`)}</span>}
            </Link>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="m-2 hidden items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-[12px] text-white/60 hover:bg-white/5 md:flex"
        aria-label={collapsed ? t('admin.shell.expand') : t('admin.shell.collapse')}
      >
        <ChevronLeft size={16} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        {!collapsed && t('admin.shell.collapse')}
      </button>
    </aside>
  )

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-[#F7F1E8] text-[#1A1614] dark:bg-[#0F0D0B] dark:text-[#FBF3E7]">
      <AdminNavProgress />
      <div className="hidden h-full shrink-0 md:block">{sidebar}</div>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button type="button" className="absolute inset-0 bg-black/50" aria-label={t('admin.shell.closeMenu')} onClick={() => setMobileOpen(false)} />
            <motion.div
              className="absolute inset-y-0 left-0"
              initial={reduced ? false : { x: -260 }}
              animate={{ x: 0 }}
              exit={reduced ? undefined : { x: -260 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-black/[0.06] bg-[#F7F1E8]/90 px-3 backdrop-blur-md dark:border-white/10 dark:bg-[#0F0D0B]/90 md:px-5">
          <button type="button" className="rounded-lg p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/10" onClick={() => setMobileOpen(true)} aria-label={t('admin.shell.openMenu')}>
            <Menu size={18} />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 truncate text-[13px] text-[#6E5B50] dark:text-white/50">
              <li><Link href="/admin/dashboard" className="hover:text-[#E8672A]">{t('admin.shell.console')}</Link></li>
              <li aria-hidden>/</li>
              <li className="truncate font-medium text-[#1A1614] dark:text-white">{crumb}</li>
            </ol>
          </nav>

          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12.5px] text-[#6E5B50] hover:border-[#E8672A]/40 sm:flex dark:border-white/10 dark:bg-white/5 dark:text-white/60"
          >
            <Search size={14} />
            <span>{t('admin.shell.search')}</span>
            <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] dark:bg-white/10">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-0.5">
            {(['fr', 'en', 'rw'] as Lang[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${lang === code ? 'bg-[#E8672A] text-white' : 'text-[#6E5B50] hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10'}`}
              >
                {code}
              </button>
            ))}
          </div>

          <button type="button" onClick={toggle} className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10" aria-label={t('admin.shell.theme')}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => { setBellOpen((v) => !v); setAvatarOpen(false) }}
              className="relative rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label={t('admin.shell.notifications')}
            >
              <Bell size={17} />
              {notifs.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8672A] px-1 text-[10px] font-semibold text-white">
                  {notifs.length > 9 ? '9+' : notifs.length}
                </span>
              )}
            </button>
            <AnimatePresence>
              {bellOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#1A1614]"
                >
                  <p className="border-b border-black/5 px-3 py-2 text-[12px] font-semibold dark:border-white/10">{t('admin.shell.notifications')}</p>
                  {notifs.length === 0 ? (
                    <p className="px-3 py-6 text-center text-[13px] text-[#6E5B50]">{t('admin.shell.noNotifs')}</p>
                  ) : (
                    <ul className="max-h-72 overflow-y-auto">
                      {notifs.map((n) => (
                        <li key={n.id}>
                          <Link href={n.href} onClick={() => setBellOpen(false)} className="block px-3 py-2.5 text-[13px] hover:bg-[#E8672A]/8">
                            <span className="font-medium">{n.title}</span>
                            <span className="mt-0.5 block text-[11px] text-[#6E5B50]">{n.at}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => { setAvatarOpen((v) => !v); setBellOpen(false) }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8672A]/15 text-[12px] font-semibold text-[#E8672A]"
              aria-label={t('admin.shell.account')}
            >
              {(actor.name || actor.email).slice(0, 1).toUpperCase()}
            </button>
            <AnimatePresence>
              {avatarOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#1A1614]"
                >
                  <div className="border-b border-black/5 px-3 py-2 dark:border-white/10">
                    <p className="truncate text-[13px] font-medium">{actor.name || actor.email}</p>
                    <p className="truncate text-[11px] text-[#6E5B50]">{actor.role}</p>
                  </div>
                  <Link href="/admin/settings" onClick={() => setAvatarOpen(false)} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-black/[0.04] dark:hover:bg-white/5">
                    <Settings size={14} /> {t('admin.nav.settings')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void logoutAndRedirect('/login')}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[#B91C1C] hover:bg-red-50 dark:hover:bg-red-500/10"
                  >
                    <LogOut size={14} /> {t('admin.shell.logout')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className="admin-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
          <ToastProvider>
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </ToastProvider>
        </main>
      </div>

      <AnimatePresence>
        {cmdOpen && (
          <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="absolute inset-0" aria-label={t('admin.shell.closeMenu')} onClick={() => setCmdOpen(false)} />
            <motion.div
              role="dialog"
              aria-label={t('admin.shell.command')}
              initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, y: 8 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1A1614]"
            >
              <div className="flex items-center gap-2 border-b border-black/5 px-3 dark:border-white/10">
                <Search size={16} className="text-[#6E5B50]" />
                <input
                  autoFocus
                  value={cmdQuery}
                  onChange={(e) => setCmdQuery(e.target.value)}
                  placeholder={t('admin.shell.commandHint')}
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none"
                />
                <button type="button" onClick={() => setCmdOpen(false)} className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/10"><X size={16} /></button>
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {filteredNav.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13.5px] hover:bg-[#E8672A]/10"
                        onClick={() => { setCmdOpen(false); setCmdQuery(''); router.push(item.href) }}
                      >
                        <Icon size={16} className="text-[#E8672A]" />
                        {t(`admin.nav.${item.key}`)}
                      </button>
                    </li>
                  )
                })}
                {filteredNav.length === 0 && (
                  <li className="px-3 py-6 text-center text-[13px] text-[#6E5B50]">{t('admin.shell.noResults')}</li>
                )}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AdminComingSoon({ section }: { section: string }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-3xl border border-dashed border-black/10 bg-white/60 px-6 text-center dark:border-white/10 dark:bg-white/5">
      <Activity className="mb-3 text-[#E8672A]" size={28} />
      <h1 className="font-display text-xl font-semibold">{t(`admin.nav.${section}`)}</h1>
      <p className="mt-2 max-w-md text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.shell.comingSoon')}</p>
      <Scale className="mt-6 text-black/10 dark:text-white/10" size={48} />
    </div>
  )
}
