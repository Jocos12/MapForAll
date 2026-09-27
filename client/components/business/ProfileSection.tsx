'use client'

import { useRef, useState, type FormEvent } from 'react'
import { Camera, CheckCircle2, ChevronRight, KeyRound, Loader2, Lock, LogOut, Map as MapIcon, Plus, ShieldCheck, Store, Trash2, UserRound } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { STATUS_DOT, statusKey } from '@/components/business/BusinessSection'
import type { OwnedSummary, OwnerAccount } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'
import { compressImage } from '@/lib/imageCompress'

const AVATAR_CHARS = 90_000

function Notice({ ok, text }: { ok: boolean; text: string }) {
  if (!text) return null
  return (
    <p className={`mt-3 flex items-center gap-1.5 text-[13px] ${ok ? 'text-[#1F6B43]' : 'text-[#B91C1C]'}`} role={ok ? 'status' : 'alert'}>
      {ok && <CheckCircle2 size={14} aria-hidden />}
      {text}
    </p>
  )
}

function Avatar({ account, size }: { account: OwnerAccount | null; size: number }) {
  const initial = (account?.name || account?.email || '?').slice(0, 1).toUpperCase()
  return account?.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- data URL avatar
    <img src={account.avatar} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[#1A1614] font-display font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {initial}
    </span>
  )
}

export { Avatar as AccountAvatar }

function IdentityCard({ account, onSaved }: { account: OwnerAccount; onSaved: (next: OwnerAccount) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(account.name)
  const [phone, setPhone] = useState(account.phone)
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = name.trim() !== account.name || phone.trim() !== account.phone

  async function send(body: Record<string, unknown>, kind: 'save' | 'photo') {
    setBusy(kind)
    setMessage({ ok: true, text: '' })
    try {
      const res = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const key = typeof json.code === 'string' ? `biz.profile.errors.${json.code}` : ''
        const text = key ? t(key) : ''
        setMessage({ ok: false, text: text && text !== key ? text : json.error ?? t('auth.errors.generic') })
        return
      }
      onSaved(json.profile as OwnerAccount)
      setName((json.profile as OwnerAccount).name)
      setPhone((json.profile as OwnerAccount).phone)
      setMessage({ ok: true, text: t(kind === 'photo' ? 'biz.profile.photoSaved' : 'biz.profile.saved') })
    } catch {
      setMessage({ ok: false, text: t('auth.errors.network') })
    } finally {
      setBusy(null)
    }
  }

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    const url = await compressImage(file, AVATAR_CHARS)
    if (!url) {
      setMessage({ ok: false, text: t('biz.profile.errors.invalid_avatar') })
      return
    }
    await send({ avatar: url }, 'photo')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setMessage({ ok: false, text: t('biz.profile.errors.name_required') })
      return
    }
    void send({ name, phone }, 'save')
  }

  const roleKey = account.role === 'admin' ? 'admin' : account.role === 'business_owner' ? 'owner' : 'client'

  return (
    <section className={`${BIZ.card} animate-fade-up p-5 lg:col-span-2`} aria-labelledby="profile-identity">
      <h2 id="profile-identity" className={BIZ.cardTitle}>
        <UserRound size={16} className="text-[#E8672A]" aria-hidden />
        {t('biz.profile.identity')}
      </h2>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-center gap-3 sm:w-40">
          <div className="relative">
            <Avatar account={account} size={96} />
            {busy === 'photo' && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white"><Loader2 size={20} className="animate-spin" aria-hidden /></span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" id="profile-photo" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap justify-center gap-1.5">
            <label htmlFor="profile-photo" className={`${BIZ.secondary} h-9 cursor-pointer`}>
              <Camera size={14} aria-hidden />{t(account.avatar ? 'biz.profile.changePhoto' : 'biz.profile.addPhoto')}
            </label>
            {account.avatar && (
              <button type="button" onClick={() => void send({ avatar: null }, 'photo')} disabled={!!busy} className={`${BIZ.secondary} h-9 w-9 px-0`} aria-label={t('biz.profile.removePhoto')} title={t('biz.profile.removePhoto')}>
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#FDE8DC] px-3 py-1.5 text-[12.5px] font-semibold text-[#9A3412]">
              <ShieldCheck size={14} aria-hidden />
              {t('biz.profile.roleLabel')} {t(`biz.profile.roles.${roleKey}`)}
            </span>
            <p className="mt-1.5 text-[12px] text-[#52525B]">{t('biz.profile.roleHint')}</p>
          </div>
          <div>
            <label htmlFor="profile-name" className={BIZ.label}>{t('biz.profile.name')}</label>
            <input id="profile-name" className={BIZ.field} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="profile-phone" className={BIZ.label}>
              {t('biz.profile.phone')} <span className="font-normal text-[#52525B]">({t('biz.profile.optional')})</span>
            </label>
            <input id="profile-phone" className={BIZ.field} value={phone} maxLength={30} inputMode="tel" autoComplete="tel" placeholder="+250 7xx xxx xxx" onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="profile-email" className={BIZ.label}>{t('biz.profile.email')}</label>
            <div className="relative">
              <input id="profile-email" className={`${BIZ.field} cursor-not-allowed bg-[#F7F7F8] pr-10 text-[#52525B]`} value={account.email} readOnly aria-describedby="profile-email-hint" />
              <Lock size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#71717A]" aria-hidden />
            </div>
            <p id="profile-email-hint" className="mt-1 text-[12px] text-[#52525B]">{t('biz.profile.emailHint')}</p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={!dirty || !!busy} className={`${BIZ.primary} h-10`}>
              {busy === 'save' && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {t('biz.profile.save')}
            </button>
          </div>
        </form>
      </div>
      <Notice ok={message.ok} text={message.text} />
    </section>
  )
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next.length < 8) return setMessage({ ok: false, text: t('biz.profile.errors.weak_password') })
    if (next !== confirm) return setMessage({ ok: false, text: t('biz.profile.errors.mismatch') })
    setBusy(true)
    setMessage({ ok: true, text: '' })
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const key = typeof json.code === 'string' ? `biz.profile.errors.${json.code}` : ''
        const text = key ? t(key) : ''
        setMessage({ ok: false, text: text && text !== key ? text : json.error ?? t('auth.errors.generic') })
        return
      }
      setCurrent('')
      setNext('')
      setConfirm('')
      setOpen(false)
      setMessage({ ok: true, text: t('biz.profile.passwordChanged') })
    } catch {
      setMessage({ ok: false, text: t('auth.errors.network') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${BIZ.card} animate-fade-up p-5`} style={{ animationDelay: '60ms' }} aria-labelledby="profile-password">
      <h2 id="profile-password" className={BIZ.cardTitle}>
        <KeyRound size={16} className="text-[#E8672A]" aria-hidden />
        {t('biz.profile.password')}
      </h2>
      {!hasPassword ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[#52525B]">{t('biz.profile.googleOnly')}</p>
      ) : !open ? (
        <>
          <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.profile.passwordHint')}</p>
          <button type="button" onClick={() => { setOpen(true); setMessage({ ok: true, text: '' }) }} className={`${BIZ.secondary} mt-4 h-10`}>
            <KeyRound size={14} aria-hidden />{t('biz.profile.changePassword')}
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor="pw-current" className={BIZ.label}>{t('biz.profile.currentPassword')}</label>
            <input id="pw-current" type="password" className={BIZ.field} value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pw-next" className={BIZ.label}>{t('biz.profile.newPassword')}</label>
            <input id="pw-next" type="password" className={BIZ.field} value={next} minLength={8} autoComplete="new-password" aria-describedby="pw-rule" onChange={(e) => setNext(e.target.value)} />
            <p id="pw-rule" className="mt-1 text-[12px] text-[#52525B]">{t('biz.profile.passwordRule')}</p>
          </div>
          <div>
            <label htmlFor="pw-confirm" className={BIZ.label}>{t('biz.profile.confirmPassword')}</label>
            <input id="pw-confirm" type="password" className={BIZ.field} value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !current || !next || !confirm} className={`${BIZ.primary} h-10`}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {t('biz.profile.updatePassword')}
            </button>
            <button type="button" onClick={() => { setOpen(false); setMessage({ ok: true, text: '' }) }} className={`${BIZ.secondary} h-10`}>
              {t('biz.profile.cancel')}
            </button>
          </div>
        </form>
      )}
      <Notice ok={message.ok} text={message.text} />
    </section>
  )
}

interface Props {
  account: OwnerAccount | null
  places: OwnedSummary[]
  activeId: string | null
  onAccount: (next: OwnerAccount) => void
  onOpenPlace: (id: string) => void
  onLogout: () => void
}

export function ProfileSection({ account, places, activeId, onAccount, onOpenPlace, onLogout }: Props) {
  const { t } = useI18n()
  if (!account) {
    return (
      <div className="grid gap-5 lg:grid-cols-3" aria-hidden>
        <div className={`${BIZ.card} h-[260px] animate-pulse lg:col-span-2`} />
        <div className={`${BIZ.card} h-[260px] animate-pulse`} />
      </div>
    )
  }
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <IdentityCard account={account} onSaved={onAccount} />
      <PasswordCard hasPassword={account.hasPassword} />

      <section className={`${BIZ.card} animate-fade-up p-5 lg:col-span-2`} style={{ animationDelay: '120ms' }} aria-labelledby="profile-places">
        <h2 id="profile-places" className={BIZ.cardTitle}>
          <Store size={16} className="text-[#E8672A]" aria-hidden />
          {t('biz.profile.places')}
          <span className="ml-auto text-[12px] font-normal text-[#52525B]">{places.length}/5</span>
        </h2>
        {places.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#52525B]">{t('biz.profile.noPlaces')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#F4F4F5]">
            {places.map((row) => {
              const key = statusKey(row)
              const active = row.place_id === activeId
              return (
                <li key={row.place_id}>
                  <button
                    type="button"
                    onClick={() => onOpenPlace(row.place_id)}
                    className={`group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[#F7F7F8] ${BIZ.focus}`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[key]}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[#18181B]">{row.name}</span>
                      <span className="block text-[12px] text-[#52525B]">
                        {t(`biz.status.${key}`)}
                        {active && <> · {t('biz.profile.current')}</>}
                      </span>
                    </span>
                    <span className="text-[12.5px] font-semibold text-[#C2410C] opacity-80 group-hover:opacity-100">{t('biz.profile.open')}</span>
                    <ChevronRight size={16} className="text-[#71717A] transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {places.length < 5 && (
          <a href="/business/onboarding?new=1" className={`${BIZ.secondary} mt-3 h-10`}>
            <Plus size={15} aria-hidden />{t('biz.places.add')}
          </a>
        )}
      </section>

      <section className={`${BIZ.card} animate-fade-up p-5`} style={{ animationDelay: '180ms' }} aria-labelledby="profile-session">
        <h2 id="profile-session" className={BIZ.cardTitle}>
          <LogOut size={16} className="text-[#E8672A]" aria-hidden />
          {t('biz.profile.session')}
        </h2>
        <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.profile.sessionHint')}</p>
        <div className="mt-4 flex flex-col gap-2">
          <a href="/chat" className={`${BIZ.secondary} h-10`}>
            <MapIcon size={15} aria-hidden />{t('biz.nav.map')}
          </a>
          <button type="button" onClick={onLogout} className={`${BIZ.primary} h-10`}>
            <LogOut size={15} aria-hidden />{t('biz.nav.logout')}
          </button>
        </div>
      </section>
    </div>
  )
}
