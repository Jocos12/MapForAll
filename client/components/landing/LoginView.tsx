'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, Compass, Eye, EyeOff, Loader2, Store } from 'lucide-react'
import TrailMap from '@/components/landing/TrailMap'
import { useI18n } from '@/components/I18nProvider'

const ERROR_CODES: Record<string, string> = {
  oauth_unconfigured: 'auth.errors.generic',
  oauth_state: 'auth.errors.generic',
  oauth_denied: 'auth.errors.generic',
  oauth_email: 'auth.errors.generic',
  oauth_token: 'auth.errors.generic',
  oauth_failed: 'auth.errors.generic',
  rate: 'auth.errors.rate',
}

type Mode = 'login' | 'signup'
type FieldErrors = { name?: string; email?: string; password?: string; role?: string; form?: string }
type PublicRole = 'client' | 'business_owner'

const MODES: Mode[] = ['login', 'signup']
/** y of each branch end in the fork drawing; matches the centre of each tab row. */
const FORK_ENDS = [14, 62]

function BrandMark() {
  return (
    <svg width="30" height="36" viewBox="0 0 30 36" aria-hidden className="shrink-0">
      <path d="M15 35 C11 27 2 22 2 13.5 A13 13 0 1 1 28 13.5 C28 22 19 27 15 35 Z" fill="var(--ink)" />
      <circle cx="15" cy="13.5" r="5" fill="var(--clay)" />
    </svg>
  )
}

/**
 * Sign in / Create account drawn as a fork in a trail: one stem, two branches,
 * the chosen branch inked in clay. Behaves as a vertical tablist.
 */
function TrailFork({ mode, onChange, label, tabs }: { mode: Mode; onChange: (m: Mode) => void; label: string; tabs: Record<Mode, string> }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const active = MODES.indexOf(mode)

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, number> = { ArrowUp: 1 - active, ArrowDown: 1 - active, ArrowLeft: 1 - active, ArrowRight: 1 - active, Home: 0, End: 1 }
    if (!(e.key in moves)) return
    e.preventDefault()
    const next = moves[e.key]
    onChange(MODES[next])
    refs.current[next]?.focus()
  }

  return (
    <div className="flex h-[76px] items-stretch">
      <svg width="88" height="76" viewBox="0 0 88 76" aria-hidden className="shrink-0">
        <path d="M8 38 H30" stroke="var(--ink)" strokeWidth="2.5" strokeDasharray="0.1 6" strokeLinecap="round" />
        {FORK_ENDS.map((y, i) => {
          const on = i === active
          return (
            <g key={y}>
              <path
                d={`M30 38 C48 38 50 ${y} 76 ${y}`}
                fill="none"
                stroke={on ? 'var(--clay)' : 'var(--line)'}
                strokeWidth={on ? 3 : 2.5}
                strokeDasharray="0.1 6"
                strokeLinecap="round"
                className="transition-[stroke] duration-200 motion-reduce:transition-none"
              />
              <circle
                cx="80"
                cy={y}
                r={on ? 5 : 3.5}
                fill={on ? 'var(--clay)' : 'var(--paper)'}
                stroke={on ? 'var(--clay)' : 'var(--ink-soft)'}
                strokeWidth="1.5"
              />
            </g>
          )
        })}
        <circle cx="8" cy="38" r="4.5" fill="var(--ink)" />
      </svg>
      <div role="tablist" aria-label={label} aria-orientation="vertical" className="flex flex-col justify-between">
        {MODES.map((id, i) => {
          const on = i === active
          return (
            <button
              key={id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={`pp-tab-${id}`}
              aria-selected={on}
              aria-controls="pp-auth-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={onKey}
              className={`pp-focus h-7 rounded-md px-1.5 text-left text-[15px] leading-7 transition-colors duration-150 ${on ? 'font-semibold text-pp-ink' : 'font-medium text-pp-ink-soft hover:text-pp-ink'}`}
            >
              {tabs[id]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-pp-error">
      <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
      {children}
    </p>
  )
}

export default function LoginView({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const router = useRouter()
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [role, setRole] = useState<PublicRole>('client')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [fields, setFields] = useState<FieldErrors>({})

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('error')
    if (!code) return
    if (!googleEnabled && code.startsWith('oauth_')) {
      router.replace('/login')
      return
    }
    const key = ERROR_CODES[code] ?? 'auth.errors.generic'
    setFields({ form: t(key) })
  }, [googleEnabled, router, t])

  const signup = mode === 'signup'
  const longEnough = password.length >= 8

  function switchMode(next: Mode) {
    setMode(next)
    setFields({})
    setForgot(false)
  }

  function messageFor(data: { code?: string; error?: string }) {
    if (data.code && data.code !== 'invalid') return t(`auth.errors.${data.code}`)
    return data.error || t('auth.errors.generic')
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault()
    const next: FieldErrors = {}
    if (signup && !name.trim()) next.name = t('auth.errors.name_required')
    if (!email.includes('@')) next.email = t('auth.errors.invalid_email')
    if (signup && !longEnough) next.password = t('auth.errors.weak_password')
    if (!signup && !password) next.password = t('auth.errors.bad_credentials')
    if (Object.keys(next).length > 0) {
      setFields(next)
      return
    }
    setFields({})
    setFormBusy(true)
    try {
      const endpoint = signup ? '/api/auth/signup' : '/api/auth/login'
      const payload = signup ? { name, email, password, role } : { email, password }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = messageFor(data)
        const code = data.code as string | undefined
        if (code === 'bad_credentials' || code === 'weak_password') setFields({ password: msg })
        else if (code === 'invalid_email' || code === 'email_taken') setFields({ email: msg })
        else if (code === 'name_required') setFields({ name: msg })
        else if (code === 'role_required') setFields({ role: msg })
        else setFields({ form: msg })
        setFormBusy(false)
        return
      }
      window.location.href = typeof data.redirect === 'string' ? data.redirect : '/chat'
    } catch {
      setFields({ form: t('auth.errors.network') })
      setFormBusy(false)
    }
  }

  const roles = [
    { id: 'client' as const, title: t('auth.clientTitle'), body: t('auth.clientBody'), Icon: Compass },
    { id: 'business_owner' as const, title: t('auth.ownerTitle'), body: t('auth.ownerBody'), Icon: Store },
  ]

  return (
    <div className="pp-root h-dvh overflow-y-auto">
      <div className="grid min-h-full lg:grid-cols-[minmax(460px,540px)_1fr]">
        <div className="pp-sheet-wrap relative z-10 lg:-mr-4">
          <div className="pp-sheet pp-paper flex min-h-dvh flex-col px-6 pb-10 pt-6 sm:px-10 lg:pr-16">
            <header className="flex items-center justify-between gap-4">
              <Link href="/" className="pp-focus flex items-center gap-2.5 rounded-md">
                <BrandMark />
                <span className="leading-tight">
                  <span className="pp-serif block text-[20px] font-semibold">MapForAll</span>
                  <span className="block text-[12.5px] text-pp-ink-soft">Ikarita ya Bose</span>
                </span>
              </Link>
              <Link
                href="/"
                className="pp-focus rounded-md text-[14px] font-medium text-pp-ink-soft underline decoration-pp-line decoration-1 underline-offset-4 transition-colors duration-150 hover:text-pp-ink hover:decoration-pp-clay"
              >
                {t('auth.back')}
              </Link>
            </header>

            <main className="mt-auto w-full max-w-[400px] pt-14">
              <TrailFork
                mode={mode}
                onChange={switchMode}
                label={t('auth.forkLabel')}
                tabs={{ login: t('auth.signIn'), signup: t('auth.signUp') }}
              />

              <div id="pp-auth-panel" role="tabpanel" aria-labelledby={`pp-tab-${mode}`}>
                <h1 className="pp-serif mt-7 text-[34px] font-semibold leading-[1.08] tracking-[-0.01em] sm:text-[38px]">
                  {signup ? t('auth.joinTitle') : t('auth.welcome')}
                </h1>
                <p className="mt-2.5 text-[15px] leading-relaxed text-pp-ink-soft">
                  {signup ? t('auth.createBody') : t('auth.welcomeBody')}
                </p>

                <form onSubmit={submitEmail} className="mt-7 space-y-5" noValidate>
                  {signup && (
                    <fieldset>
                      <legend className="mb-2 text-[13px] font-medium">{t('auth.roleLegend')}</legend>
                      <div className="grid grid-cols-2 gap-3">
                        {roles.map(({ id, title, body, Icon }) => {
                          const on = role === id
                          return (
                            <label
                              key={id}
                              className={`relative flex cursor-pointer flex-col rounded-xl border p-3.5 transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pp-clay ${on ? 'border-pp-clay bg-pp-paper-dark' : 'border-pp-line hover:border-[#B3A487] hover:bg-pp-field'}`}
                            >
                              <input type="radio" name="role" value={id} checked={on} onChange={() => setRole(id)} className="sr-only" />
                              <span className="flex items-center justify-between">
                                <Icon size={20} strokeWidth={1.75} className={on ? 'text-pp-clay' : 'text-pp-ink-soft'} aria-hidden />
                                <span
                                  aria-hidden
                                  className={`h-4 w-4 rounded-full border transition-colors duration-150 ${on ? 'border-pp-clay bg-pp-clay shadow-[inset_0_0_0_3px_var(--paper-dark)]' : 'border-pp-line bg-pp-field'}`}
                                />
                              </span>
                              <span className="mt-3 text-[14px] font-semibold leading-snug">{title}</span>
                              <span className="mt-1 text-[13px] leading-snug text-pp-ink-soft">{body}</span>
                            </label>
                          )
                        })}
                      </div>
                      <FieldError id="pp-role-error">{fields.role}</FieldError>
                    </fieldset>
                  )}

                  {signup && (
                    <div>
                      <label htmlFor="pp-name" className="mb-1.5 block text-[13px] font-medium">{t('auth.name')}</label>
                      <input
                        id="pp-name"
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-invalid={Boolean(fields.name)}
                        aria-describedby={fields.name ? 'pp-name-error' : undefined}
                        className="pp-field"
                      />
                      <FieldError id="pp-name-error">{fields.name}</FieldError>
                    </div>
                  )}

                  <div>
                    <label htmlFor="pp-email" className="mb-1.5 block text-[13px] font-medium">{t('auth.email')}</label>
                    <input
                      id="pp-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={Boolean(fields.email)}
                      aria-describedby={fields.email ? 'pp-email-error' : undefined}
                      className="pp-field"
                    />
                    <FieldError id="pp-email-error">{fields.email}</FieldError>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <label htmlFor="pp-password" className="text-[13px] font-medium">{t('auth.password')}</label>
                      {!signup && (
                        <button
                          type="button"
                          onClick={() => setForgot((v) => !v)}
                          aria-expanded={forgot}
                          aria-controls="pp-forgot"
                          className="pp-focus rounded text-[13px] font-medium text-pp-clay underline-offset-4 hover:underline"
                        >
                          {t('auth.forgot')}
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="pp-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={signup ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-invalid={Boolean(fields.password)}
                        aria-describedby={[signup ? 'pp-password-rules' : '', fields.password ? 'pp-password-error' : ''].filter(Boolean).join(' ') || undefined}
                        className="pp-field pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                        aria-pressed={showPassword}
                        className="pp-focus absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-pp-ink-soft transition-colors duration-150 hover:text-pp-ink"
                      >
                        {showPassword ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                      </button>
                    </div>
                    {signup && (
                      <ul id="pp-password-rules" className="mt-2">
                        <li className={`flex items-center gap-2 text-[13px] transition-colors duration-150 ${longEnough ? 'text-pp-ink' : 'text-pp-ink-soft'}`}>
                          <span
                            aria-hidden
                            className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors duration-150 ${longEnough ? 'border-pp-ink bg-pp-ink text-pp-paper' : 'border-pp-line bg-pp-field'}`}
                          >
                            {longEnough && <Check size={11} strokeWidth={3} />}
                          </span>
                          {t('auth.passwordHint')}
                          <span className="sr-only">{longEnough ? t('auth.ruleMet') : t('auth.ruleUnmet')}</span>
                        </li>
                      </ul>
                    )}
                    <FieldError id="pp-password-error">{fields.password}</FieldError>
                    {forgot && !signup && (
                      <p id="pp-forgot" className="mt-2 rounded-lg bg-pp-paper-dark px-3 py-2 text-[13px] leading-relaxed text-pp-ink-soft">
                        {t('auth.forgotHint')}
                      </p>
                    )}
                  </div>

                  <FieldError id="pp-form-error">{fields.form}</FieldError>

                  <button
                    type="submit"
                    disabled={formBusy}
                    className="pp-primary pp-focus flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold disabled:opacity-70"
                  >
                    {formBusy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                    {formBusy ? (signup ? t('auth.busyUp') : t('auth.busyIn')) : (signup ? t('auth.submitUp') : t('auth.submitIn'))}
                  </button>
                </form>

                {googleEnabled && (
                  <>
                    <div className="my-5 flex items-center gap-3 text-[13px] text-pp-ink-soft">
                      <span className="h-px flex-1 bg-pp-line" />
                      {t('auth.or')}
                      <span className="h-px flex-1 bg-pp-line" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setBusy(true); window.location.href = '/api/auth/google' }}
                      disabled={busy}
                      className="pp-focus flex w-full items-center justify-center gap-2 rounded-[10px] border border-pp-line bg-pp-field py-3 text-[15px] font-medium transition-colors duration-150 hover:border-pp-ink disabled:opacity-70"
                    >
                      {busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
                      {busy ? t('auth.googleBusy') : t('auth.google')}
                    </button>
                  </>
                )}
              </div>
            </main>
          </div>
        </div>

        <div className="relative hidden overflow-hidden bg-pp-paper-dark lg:sticky lg:top-0 lg:block lg:h-dvh" aria-hidden>
          <TrailMap
            labels={{
              start: t('auth.map.start'),
              market: t('auth.map.market'),
              pharmacy: t('auth.map.pharmacy'),
              shop: 'Duka rya Jean',
              confirmed: t('auth.map.confirmed'),
            }}
          />
          <div className="absolute bottom-8 left-12 rounded-md border border-pp-line bg-pp-paper px-4 py-3 text-[12.5px] text-pp-ink">
            <p className="pp-serif text-[17px] italic">Kigali</p>
            <ul className="mt-2 space-y-1.5">
              <li className="flex items-center gap-2.5">
                <svg width="28" height="6" viewBox="0 0 28 6">
                  <line x1="2" y1="3" x2="26" y2="3" stroke="var(--clay)" strokeWidth="3" strokeDasharray="0.1 6" strokeLinecap="round" />
                </svg>
                {t('auth.map.legendTrail')}
              </li>
              <li className="flex items-center gap-2.5">
                <span className="flex w-7 justify-center">
                  <span className="h-2.5 w-2.5 rounded-full border border-pp-ink bg-pp-gold" />
                </span>
                {t('auth.map.legendConfirmed')}
              </li>
            </ul>
          </div>
          <div className="absolute bottom-8 right-8 flex items-end gap-5 text-[12px] text-pp-ink-soft">
            <div>
              <div className="flex h-2 w-24 border border-pp-ink">
                <span className="w-1/2 bg-pp-ink" />
              </div>
              <div className="mt-1 flex justify-between">
                <span>0</span>
                <span>200 m</span>
              </div>
            </div>
            <svg width="22" height="36" viewBox="0 0 22 36">
              <path d="M11 12 L17 32 L11 27 L5 32 Z" fill="var(--ink)" />
              <text x="11" y="9" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">N</text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
