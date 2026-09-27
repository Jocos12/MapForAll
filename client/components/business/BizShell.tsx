'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Star,
  Store,
  Sun,
  UserRound,
  XCircle,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { STATUS_DOT, statusKey } from '@/components/business/BusinessSection'
import { AccountAvatar } from '@/components/business/ProfileSection'
import { useBizTheme } from '@/components/business/theme'
import type { ListingTimeline, OwnedSummary, OwnerAccount, OwnerReview } from '@/components/business/types'
import { BIZ, BIZ_SCROLL, BIZ_SCROLL_ID } from '@/components/business/ui'

export const SECTIONS = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'business', icon: Store },
  { id: 'stats', icon: BarChart3 },
  { id: 'reviews', icon: MessageSquare },
  { id: 'promotion', icon: Megaphone },
  { id: 'settings', icon: Settings },
  { id: 'profile', icon: UserRound },
] as const

/** The phone tab bar keeps six slots; the profile is reached from the avatar menu there. */
const MOBILE_SECTIONS = SECTIONS.filter((row) => row.id !== 'profile')

export type SectionId = (typeof SECTIONS)[number]['id']

export function isSection(value: string): value is SectionId {
  return SECTIONS.some((row) => row.id === value)
}

function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

const SEEN_KEY = 'hodari_biz_seen'

type Seen = Record<string, { at: string; status: string }>

function readSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw as Seen : {}
  } catch {
    return {}
  }
}

interface Notice {
  id: string
  kind: 'review' | 'validated' | 'edited' | 'rejected' | 'pending'
  text: string
  at: string
  unread: boolean
}

const NOTICE_STYLE: Record<Notice['kind'], { icon: typeof Star; tone: string }> = {
  review: { icon: Star, tone: 'bg-amber-50 text-amber-700' },
  validated: { icon: CheckCircle2, tone: 'bg-[#2E8B57]/10 text-[#1F6B43]' },
  edited: { icon: CheckCircle2, tone: 'bg-[#2E8B57]/10 text-[#1F6B43]' },
  rejected: { icon: XCircle, tone: 'bg-red-50 text-[#B91C1C]' },
  pending: { icon: Clock, tone: 'bg-[#FFF8E1] text-[#854D0E]' },
}

/** The latest moderation event, dated from the listing's own timestamps. */
function statusNotice(status: string, reason: string | undefined, timeline: ListingTimeline, t: (key: string) => string): Omit<Notice, 'unread'> | null {
  const { createdAt, moderatedAt, resubmittedAt } = timeline
  if (status === 'validated') {
    const edited = !!resubmittedAt && !!moderatedAt && resubmittedAt < moderatedAt
    return {
      id: `status-validated-${moderatedAt ?? ''}`,
      kind: edited ? 'edited' : 'validated',
      text: t(edited ? 'biz.notifications.editValidated' : 'biz.notifications.validated'),
      at: moderatedAt ?? '',
    }
  }
  if (status === 'rejected') {
    return {
      id: `status-rejected-${moderatedAt ?? ''}`,
      kind: 'rejected',
      text: `${t('biz.notifications.rejected')} ${reason?.trim() || ''}`.trim(),
      at: moderatedAt ?? '',
    }
  }
  const at = resubmittedAt ?? createdAt
  return at
    ? { id: `status-pending-${at}`, kind: 'pending', text: t(resubmittedAt ? 'biz.notifications.editPending' : 'biz.notifications.submitted'), at }
    : null
}

function NotificationsBell({
  placeId,
  status,
  reason,
  timeline,
  reviews,
  onOpenReviews,
  onOpenOverview,
}: {
  placeId: string
  status: string
  reason?: string
  timeline: ListingTimeline
  reviews: OwnerReview[]
  onOpenReviews: () => void
  onOpenOverview: () => void
}) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<Seen>({})
  const box = useRef<HTMLDivElement>(null)
  useDismiss(box, open, () => setOpen(false))
  useEffect(() => setSeen(readSeen()), [])

  const mark = seen[placeId]
  const since = Date.now() - 30 * 86_400_000
  const isNew = (at: string) => !!at && (!mark || at > mark.at)
  const notices: Notice[] = []
  const moderation = statusNotice(status, reason, timeline, t)
  if (moderation) {
    notices.push({ ...moderation, unread: moderation.at ? isNew(moderation.at) : !!mark && mark.status !== status })
  }
  for (const review of reviews) {
    if (!review.createdAt || Date.parse(review.createdAt) < since) continue
    notices.push({
      id: review.key,
      kind: 'review',
      text: t('biz.notifications.review').replace('{name}', review.firstName).replace('{n}', String(review.rating)),
      at: review.createdAt,
      unread: isNew(review.createdAt),
    })
  }
  notices.sort((a, b) => b.at.localeCompare(a.at))
  notices.splice(8)
  const unread = notices.filter((row) => row.unread).length
  const locale = lang === 'rw' ? 'en' : lang

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      const updated = { ...readSeen(), [placeId]: { at: new Date().toISOString(), status } }
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
      window.setTimeout(() => setSeen(updated), 1500)
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? t('biz.notifications.unread').replace('{n}', String(unread)) : t('biz.notifications.title')}
        className={`relative flex h-10 w-10 items-center justify-center rounded-lg text-[#3F3F46] transition-colors hover:bg-[#F4F4F5] ${BIZ.focus}`}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E8672A] px-1 text-[10.5px] font-bold text-[#1A1614] ring-2 ring-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[#E4E4E7] bg-white shadow-xl">
          <p className="border-b border-[#F4F4F5] px-4 py-3 text-[13.5px] font-semibold text-[#18181B]">{t('biz.notifications.title')}</p>
          {notices.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[#52525B]">{t('biz.notifications.empty')}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notices.map((row) => {
                const { icon: Icon, tone } = NOTICE_STYLE[row.kind]
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); if (row.kind === 'review') onOpenReviews(); else onOpenOverview() }}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F7F7F8] ${row.unread ? 'bg-[#FFF7F2]' : ''} ${BIZ.focus}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] ${row.unread ? 'font-semibold text-[#18181B]' : 'text-[#27272A]'}`}>{row.text}</span>
                        {row.at && (
                          <span className="block text-[11.5px] text-[#52525B]">
                            {new Date(row.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </span>
                      {row.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#E8672A]" aria-label={t('biz.notifications.new')} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function PlaceSwitcher({
  places,
  activeId,
  onSwitch,
}: {
  places: OwnedSummary[]
  activeId: string
  onSwitch: (id: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(box, open, () => setOpen(false))
  const active = places.find((row) => row.place_id === activeId)

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-[#E4E4E7] bg-white px-3 py-2 text-left transition-colors hover:border-[#A1A1AA] ${BIZ.focus}`}
      >
        <span className="hidden shrink-0 text-[12.5px] text-[#52525B] sm:inline">{t('biz.header.managing')}</span>
        <span className="truncate text-[13.5px] font-semibold text-[#18181B]">{active?.name ?? '—'}</span>
        <ChevronDown size={15} className={`shrink-0 text-[#52525B] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 w-72 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white shadow-xl">
          <ul role="listbox" aria-label={t('biz.places.title')} className="max-h-72 overflow-y-auto py-1">
            {places.map((row) => {
              const key = statusKey(row)
              const selected = row.place_id === activeId
              return (
                <li key={row.place_id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); if (!selected) onSwitch(row.place_id) }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] hover:bg-[#F7F7F8] ${selected ? 'font-semibold text-[#18181B]' : 'text-[#27272A]'} ${BIZ.focus}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[key]}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 text-[11.5px] font-normal text-[#52525B]">{t(`biz.status.${key}`)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {places.length < 5 && (
            <a href="/business/onboarding?new=1" className={`flex items-center gap-2 border-t border-[#F4F4F5] px-4 py-3 text-[13px] font-semibold text-[#C2410C] hover:bg-[#FFF7F2] ${BIZ.focus}`}>
              <Plus size={15} aria-hidden />
              {t('biz.places.add')}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const { t } = useI18n()
  const { dark, toggle } = useBizTheme()
  const label = t(dark ? 'biz.header.lightMode' : 'biz.header.darkMode')
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-[#3F3F46] transition-colors hover:bg-[#F4F4F5] ${BIZ.focus}`}
    >
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  )
}

function ProfileMenu({ account, onProfile, onSettings, onLogout }: { account: OwnerAccount | null; onProfile: () => void; onSettings: () => void; onLogout: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(box, open, () => setOpen(false))
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('biz.header.profile')}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-[14px] ${BIZ.focus}`}
      >
        <AccountAvatar account={account} size={40} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-[#E4E4E7] bg-white shadow-xl">
          <div className="border-b border-[#F4F4F5] px-4 py-3">
            <p className="truncate text-[13.5px] font-semibold text-[#18181B]">{account?.name || '—'}</p>
            <p className="truncate text-[12px] text-[#52525B]">{account?.email}</p>
          </div>
          <button type="button" onClick={() => { setOpen(false); onProfile() }} className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-[#27272A] hover:bg-[#F7F7F8] ${BIZ.focus}`}>
            <UserRound size={15} aria-hidden />{t('biz.nav.profile')}
          </button>
          <button type="button" onClick={() => { setOpen(false); onSettings() }} className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-[#27272A] hover:bg-[#F7F7F8] ${BIZ.focus}`}>
            <Settings size={15} aria-hidden />{t('biz.nav.settings')}
          </button>
          <button type="button" onClick={onLogout} className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-[#27272A] hover:bg-[#F7F7F8] ${BIZ.focus}`}>
            <LogOut size={15} aria-hidden />{t('biz.nav.logout')}
          </button>
        </div>
      )}
    </div>
  )
}

interface ShellProps {
  section: SectionId
  onSection: (id: SectionId) => void
  places: OwnedSummary[]
  activeId: string | null
  onSwitch: (id: string) => void
  status: string
  reason?: string
  timeline: ListingTimeline
  reviews: OwnerReview[]
  account: OwnerAccount | null
  onLogout: () => void
  children: ReactNode
}

export function BizShell({ section, onSection, places, activeId, onSwitch, status, reason, timeline, reviews, account, onLogout, children }: ShellProps) {
  const { t } = useI18n()
  const unanswered = reviews.filter((row) => !row.reply).length

  return (
    <div id={BIZ_SCROLL_ID} className={`${BIZ_SCROLL} ${BIZ.bg} text-[#18181B]`}>
      <a href="#biz-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[400] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-[13px] focus:shadow">
        {t('biz.header.skip')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-[#1A1614] text-[#E7E5E4] md:flex" aria-label={t('biz.nav.kicker')}>
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <MapPin size={17} className="text-[#E8672A]" aria-hidden />
          <span className="text-[15px] font-semibold tracking-tight text-white">MapForAll</span>
          <span className="rounded-md bg-[#E8672A] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1A1614]">Business</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#A8A29E]">{t('biz.nav.kicker')}</p>
          {SECTIONS.map(({ id, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSection(id)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8672A] ${
                  active ? 'bg-[#E8672A]/15 font-semibold text-[#FFB38A]' : 'text-[#D6D3D1] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[#E8672A]" aria-hidden />}
                <Icon size={17} aria-hidden className={active ? 'text-[#E8672A]' : ''} />
                <span className="flex-1">{t(`biz.nav.${id}`)}</span>
                {id === 'reviews' && unanswered > 0 && (
                  <span className="rounded-full bg-[#E8672A] px-1.5 text-[10.5px] font-bold text-[#1A1614]" aria-label={t('biz.overview.unanswered').replace('{n}', String(unanswered))}>
                    {unanswered}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <a href="/chat" className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-[#D6D3D1] hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8672A]">
            <MapPin size={16} aria-hidden />{t('biz.nav.map')}
          </a>
        </div>
      </aside>

      <header className="biz-surface sticky top-0 z-30 border-b border-[#E4E4E7] bg-white/95 backdrop-blur md:ml-60">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-6">
          <span className="flex shrink-0 items-center gap-1.5 md:hidden">
            <MapPin size={16} className="text-[#E8672A]" aria-hidden />
            <span className="rounded-md bg-[#1A1614] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Pro</span>
          </span>
          <div className="min-w-0 flex-1">
            {activeId && <PlaceSwitcher places={places} activeId={activeId} onSwitch={onSwitch} />}
          </div>
          <ThemeToggle />
          {activeId && (
            <NotificationsBell
              placeId={activeId}
              status={status}
              reason={reason}
              timeline={timeline}
              reviews={reviews}
              onOpenReviews={() => onSection('reviews')}
              onOpenOverview={() => onSection('overview')}
            />
          )}
          <ProfileMenu account={account} onProfile={() => onSection('profile')} onSettings={() => onSection('settings')} onLogout={onLogout} />
          <button
            type="button"
            onClick={onLogout}
            aria-label={t('biz.nav.logout')}
            title={t('biz.nav.logout')}
            className={`hidden h-10 w-10 items-center justify-center rounded-lg text-[#3F3F46] transition-colors hover:bg-[#F4F4F5] sm:flex ${BIZ.focus}`}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main id="biz-main" className="biz-surface px-3 pb-28 pt-5 sm:px-6 md:ml-60 md:pb-10 md:pt-7">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-white/10 bg-[#1A1614] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t('biz.nav.kicker')}
      >
        {MOBILE_SECTIONS.map(({ id, icon: Icon }) => {
          const active = section === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSection(id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#E8672A] ${
                active ? 'text-[#FFB38A]' : 'text-[#D6D3D1]'
              }`}
            >
              {active && <span className="absolute inset-x-3 top-0 h-[3px] rounded-b bg-[#E8672A]" aria-hidden />}
              <Icon size={19} aria-hidden className={active ? 'text-[#E8672A]' : ''} />
              <span className="max-w-full truncate px-0.5">{t(`biz.nav.short.${id}`)}</span>
              {id === 'reviews' && unanswered > 0 && (
                <span className="absolute right-[18%] top-1 h-2 w-2 rounded-full bg-[#E8672A]" aria-hidden />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
