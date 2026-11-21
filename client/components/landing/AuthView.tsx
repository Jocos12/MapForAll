'use client'

/**
 * ConnectRwanda AI: sign in, create account and password reset.
 *
 * Design: Apple ID / iOS "Liquid Glass" inspired. One centred glass card on
 * a still, colourful backdrop with the "thousand hills" contour motif; iOS
 * segmented control, grouped input lists, list-style role picker, system
 * font (SF Pro on Apple devices). No map and no running animation in the
 * background, so the page loads and responds instantly.
 *
 *   login   → password, then the 6-digit code (OtpStep) → session
 *   signup  → account created → success → sign in
 *   forgot  → email → code → new password → done
 *
 * URL: /login?mode=signup | /login?mode=forgot (+ ?email=, ?expired=, ?error=).
 */

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import {
  Accessibility, AlertCircle, Bus, Check, CheckCircle2, ChevronLeft, Clock, Compass, Eye, EyeOff, KeyRound, Loader2, Mic, Navigation, RotateCcw, ShieldCheck, Store,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { clearLocalAuth } from '@/lib/authClient'
import { OtpStep, type OtpChallenge } from '@/components/landing/OtpStep'
import { CRMark, LangSwitch, RwandaFlag, ThemeSwitch, paletteVars, useCrTheme, type Palette } from '@/components/landing/crTheme'

type View = 'login' | 'signup' | 'forgot' | 'reset' | 'resetDone' | 'otp' | 'signedUp'
type PublicRole = 'client' | 'business_owner'
type Errors = { name?: string; email?: string; password?: string; confirm?: string; role?: string; code?: string; form?: string }

const ERROR_CODES: Record<string, string> = {
  oauth_unconfigured: 'auth.errors.generic', oauth_state: 'auth.errors.generic', oauth_denied: 'auth.errors.generic',
  oauth_email: 'auth.errors.generic', oauth_token: 'auth.errors.generic', oauth_failed: 'auth.errors.generic', rate: 'auth.errors.rate',
}
const MIN_PASSWORD = 8
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", var(--font-inter), "Helvetica Neue", system-ui, sans-serif'
const QUICK = { duration: 0.14, ease: [0.25, 0.1, 0.25, 1] as const }

function strength(pw: string) {
  let s = 0
  if (pw.length >= MIN_PASSWORD) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return pw ? Math.max(1, s) : 0
}

const BACKDROP_CSS = `
@keyframes crb-sun { to { transform: rotate(360deg) } }
@keyframes crb-pill { 0% { opacity: 0; transform: translate3d(0, 8px, 0) } 3% { opacity: 1; transform: none } 14% { opacity: 1; transform: none } 17% { opacity: 0; transform: translate3d(0, -6px, 0) } 100% { opacity: 0 } }
.crb-sun { animation: crb-sun 140s linear infinite; will-change: transform; }
.crb-pill { opacity: 0; animation: crb-pill 30s ease-in-out infinite; will-change: opacity, transform; }
@media (prefers-reduced-motion: reduce) { .crb-sun, .crb-pill { animation: none !important; } .crb-pill { opacity: 0; } }
`

/* Bus routes crossing the hills; the moving lights are buses. */
const ROUTES = [
  { id: 'crb-r1', color: '#21B3F2', d: 'M-60 760 C 200 700, 300 560, 470 520 S 760 430, 980 470 S 1300 560, 1500 500', dur: 26, stops: [[470, 520], [980, 470]] },
  { id: 'crb-r2', color: '#FAD201', d: 'M120 -40 C 180 140, 260 260, 380 330 S 560 600, 720 720 S 900 920, 980 960', dur: 22, stops: [[380, 330], [720, 720]] },
  { id: 'crb-r3', color: '#22C47A', d: 'M1500 180 C 1300 240, 1180 300, 1060 380 S 820 560, 640 640 S 280 820, -40 860', dur: 30, stops: [[1060, 380], [640, 640]] },
] as const

/* What the platform says while you sign in: buses, accessibility, local shops, voice. */
const PILLS = [
  { k: 'cr.auth.live1t', s: 'cr.auth.live1s', Icon: Bus, color: '#21B3F2', pos: 'left-[5%] top-[22%]' },
  { k: 'cr.auth.live2t', s: 'cr.auth.live2s', Icon: Accessibility, color: '#22C47A', pos: 'right-[5%] top-[30%]' },
  { k: 'cr.auth.live3t', s: 'cr.auth.live3s', Icon: Store, color: '#FAD201', pos: 'left-[7%] bottom-[24%]' },
  { k: 'cr.auth.live4t', s: 'cr.auth.live4s', Icon: Navigation, color: '#B48CFF', pos: 'right-[6%] bottom-[20%]' },
  { k: 'cr.auth.voiceT', s: 'cr.auth.voiceS', Icon: Mic, color: '#22C47A', pos: 'left-[9%] top-[48%]' },
  { k: 'cr.ticker.m3', s: 'cr.ticker.network', Icon: Bus, color: '#FAD201', pos: 'right-[8%] top-[56%]' },
] as const

/* ── Backdrop: drifting light in the flag colours, the thousand hills,
 *    bus routes with moving lights, the sun of the flag, live events ─────── */
function Backdrop({ P, dark }: { P: Palette; dark: boolean }) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const a = dark ? 0.34 : 0.3
  const ink = dark ? '#FFFFFF' : '#0A1430'
  const sunRays = Array.from({ length: 48 }).map((_, i) => {
    const r = i % 2 === 0 ? 150 : 98
    const ang = (i * Math.PI) / 24 - Math.PI / 2
    return `${r * Math.cos(ang)},${r * Math.sin(ang)}`
  }).join(' ')
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: BACKDROP_CSS }} />
      <div className="absolute inset-0" style={{ background: P.bg }} />
      {/* light in the flag colours: painted once, never animated */}
      <div className="absolute inset-0" style={{
        background: `radial-gradient(50% 45% at 10% 6%, rgba(0,161,222,${a}), transparent 70%),
          radial-gradient(45% 40% at 94% 14%, rgba(140,110,255,${a * 0.75}), transparent 70%),
          radial-gradient(60% 50% at 65% 104%, rgba(32,160,90,${a * 0.9}), transparent 70%),
          radial-gradient(35% 30% at 14% 96%, rgba(250,210,1,${a * 0.4}), transparent 70%)`,
      }} />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
        {/* the thousand hills: two contour layers drifting at different speeds */}
        <g stroke={ink} strokeOpacity={dark ? 0.07 : 0.09} strokeWidth="1">
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={`w${i}`} d={`M-60 ${640 - i * 26} C 180 ${540 - i * 30}, 360 ${720 - i * 22}, 560 ${620 - i * 28} S 900 ${490 - i * 24}, 1100 ${580 - i * 26} S 1380 ${660 - i * 20}, 1520 ${540 - i * 24}`} />
          ))}
        </g>
        <g stroke={ink} strokeOpacity={dark ? 0.08 : 0.1} strokeWidth="1">
          {Array.from({ length: 6 }).map((_, i) => <ellipse key={`h${i}`} cx="1190" cy="250" rx={60 + i * 44} ry={34 + i * 27} transform="rotate(-12 1190 250)" />)}
          {Array.from({ length: 5 }).map((_, i) => <ellipse key={`g${i}`} cx="220" cy="260" rx={50 + i * 40} ry={30 + i * 23} transform="rotate(8 220 260)" />)}
          {Array.from({ length: 4 }).map((_, i) => <ellipse key={`k${i}`} cx="1260" cy="760" rx={50 + i * 36} ry={28 + i * 20} transform="rotate(-6 1260 760)" />)}
        </g>

        {/* bus routes over the hills, buses as moving lights */}
        {ROUTES.map((r) => (
          <g key={r.id}>
            <path id={r.id} d={r.d} stroke={r.color} strokeOpacity={dark ? 0.1 : 0.16} strokeWidth="10" strokeLinecap="round" />
            <path d={r.d} stroke={r.color} strokeOpacity={dark ? 0.4 : 0.75} strokeWidth="1.6" strokeDasharray="2 9" strokeLinecap="round" />
            {r.stops.map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="9" fill="none" stroke={r.color} strokeOpacity="0.35" strokeWidth="1.5" />
                <circle cx={x} cy={y} r="4.5" fill={P.bg} stroke={r.color} strokeWidth="2" />
              </g>
            ))}
            {!reduce && (
              <circle r="4" fill={r.color}>
                <animateMotion dur={`${r.dur}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${r.id}`} /></animateMotion>
              </circle>
            )}
          </g>
        ))}
      </svg>

      {/* the sun of the flag, slowly turning on its own GPU layer */}
      <svg className="crb-sun absolute right-[6%] top-[4%] h-[300px] w-[300px]" viewBox="-160 -160 320 320" style={{ opacity: dark ? 0.1 : 0.2 }}>
        <polygon points={sunRays} fill="none" stroke="#E5BE01" strokeWidth="1.6" />
        <circle r="62" fill="none" stroke="#E5BE01" strokeWidth="1.6" />
      </svg>

      {/* live events, one at a time, around the card (large screens) */}
      <div className="absolute inset-0 hidden xl:block">
        {PILLS.map((p, i) => (
          <div key={p.k} className={`crb-pill absolute ${p.pos} flex max-w-[300px] items-center gap-3 rounded-2xl border px-3.5 py-3`}
            style={{ animationDelay: `${i * 5}s`, background: dark ? 'rgba(14,24,44,0.72)' : 'rgba(255,255,255,0.78)', borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,30,60,0.08)', boxShadow: dark ? '0 20px 50px -24px rgba(0,0,0,0.8)' : '0 20px 50px -24px rgba(15,40,90,0.3)' }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: p.color === '#FAD201' ? '#E0B800' : p.color }}><p.Icon size={17} strokeWidth={2.2} /></span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13.5px] font-semibold text-[var(--text)]">{t(p.k)}</span>
              <span className="mt-0.5 block truncate text-[12px] text-[var(--faint)]">{t(p.s)}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex h-[3px]"><span className="flex-[2] bg-[#00A1DE]" /><span className="flex-1 bg-[#FAD201]" /><span className="flex-1 bg-[#20603D]" /></div>
    </div>
  )
}


/* ── iOS-style building blocks ─────────────────────────────────────────── */
function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 px-1 pt-2 text-[13px] leading-snug text-[var(--red)]">
      <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />{children}
    </p>
  )
}

/** Grouped list of inputs with hairline separators, like Apple ID sign-in. */
function Group({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-[18px] border bg-[var(--field)] shadow-[0_1px_2px_rgba(15,30,60,0.05)] transition-[border-color,box-shadow] duration-150 ${error
      ? 'border-[var(--red)]'
      : 'border-[var(--line)] focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_22%,transparent)]'}`}>
      {children}
    </div>
  )
}

function Row({ id, label, type = 'text', value, onChange, autoComplete, invalid, describedBy, trailing, first, inputMode }: {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string
  invalid?: boolean; describedBy?: string; trailing?: ReactNode; first?: boolean; inputMode?: 'email' | 'text'
}) {
  return (
    <div className={`relative ${first ? '' : 'before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-[var(--line)]'}`}>
      <input id={id} type={type} value={value} placeholder=" " autoComplete={autoComplete} inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className={`peer h-[58px] w-full bg-transparent px-4 pb-2 pt-6 text-[17px] text-[var(--text)] outline-none ${trailing ? 'pr-12' : ''}`} />
      <label htmlFor={id} className="pointer-events-none absolute left-4 top-[18px] text-[17px] text-[var(--faint)] transition-all duration-150 peer-focus:top-[9px] peer-focus:text-[12px] peer-[:not(:placeholder-shown)]:top-[9px] peer-[:not(:placeholder-shown)]:text-[12px]">
        {label}
      </label>
      {trailing}
    </div>
  )
}

function Primary({ busy, children, busyLabel, type = 'submit', onClick }: { busy?: boolean; children: ReactNode; busyLabel?: string; type?: 'submit' | 'button'; onClick?: () => void }) {
  return (
    <button type={type} onClick={onClick} disabled={busy}
      className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent)] text-[17px] font-semibold text-white transition-[filter,transform] duration-150 enabled:hover:brightness-110 enabled:active:scale-[0.985] disabled:opacity-80">
      {busy ? <><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /><span aria-live="polite">{busyLabel}</span></> : children}
    </button>
  )
}

function Segmented({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: { id: string; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="relative grid rounded-[11px] bg-[var(--seg)] p-[2px]" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it) => {
        const on = it.id === value
        return (
          <button key={it.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.id)}
            className={`relative h-[32px] rounded-[9px] text-[13.5px] font-semibold transition-colors duration-150 ${on ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
            {on && <motion.span layoutId="seg-thumb" className="absolute inset-0 rounded-[9px] bg-[var(--segThumb)] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            <span className="relative">{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function StrengthMeter({ value }: { value: number }) {
  const { t } = useI18n()
  const colors = ['var(--red)', '#FF9F0A', 'var(--accent)', 'var(--green)']
  const labels = ['weak', 'fair', 'good', 'strong']
  return (
    <div className="flex items-center gap-3 px-1 pt-2.5" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-full transition-colors duration-200" style={{ background: value > i ? colors[Math.max(0, value - 1)] : 'var(--line)' }} />
        ))}
      </div>
      <span className="w-16 text-right text-[12px] font-medium" style={{ color: value ? colors[value - 1] : 'var(--faint)' }}>{value ? t(`cr.auth.strength.${labels[value - 1]}`) : ''}</span>
    </div>
  )
}

function CodeBoxes({ value, onChange, error, disabled }: { value: string[]; onChange: (v: string[]) => void; error?: boolean; disabled?: boolean }) {
  const { t } = useI18n()
  const refs = useRef<Array<HTMLInputElement | null>>([])
  useEffect(() => { refs.current[0]?.focus() }, [])
  const fill = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '')
    if (!clean) return
    const start = clean.length >= 6 ? 0 : index
    const next = [...value]
    for (let k = 0; k < clean.length && start + k < 6; k++) next[start + k] = clean[k]
    onChange(next)
    refs.current[Math.min(start + clean.length, 5)]?.focus()
  }
  return (
    <div role="group" aria-label={t('auth.otp.label')} className="grid grid-cols-6 gap-2">
      {value.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el }} value={d} disabled={disabled} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6}
          aria-label={`${t('auth.otp.label')} ${i + 1}`}
          onChange={(e) => {
            const clean = e.target.value.replace(/\D/g, '')
            if (clean.length > 1) return fill(i, clean)
            const next = [...value]; next[i] = clean; onChange(next)
            if (clean && i < 5) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) { e.preventDefault(); const next = [...value]; next[i - 1] = ''; onChange(next); refs.current[i - 1]?.focus() }
          }}
          onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); fill(i, e.clipboardData.getData('text')) }}
          className={`h-[58px] w-full min-w-0 rounded-[14px] border bg-[var(--field)] text-center text-[24px] font-semibold text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 disabled:opacity-60 ${error ? 'border-[var(--red)]' : 'border-[var(--line)] focus:border-[var(--accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_22%,transparent)]'}`} />
      ))}
    </div>
  )
}

/** Card header: app icon (or a symbol tile), title and one line of text. */
function Header({ icon, title, body }: { icon?: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex justify-center">{icon ?? <span className="rounded-[18px] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.5)]"><CRMark size={64} /></span>}</div>
      <h1 className="mt-5 text-[28px] font-semibold leading-[1.12] tracking-[-0.022em] text-[var(--text)]">{title}</h1>
      <p className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-[1.45] text-[var(--muted)]">{body}</p>
    </div>
  )
}
function SymbolTile({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-[18px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_12px_30px_-12px_rgba(0,0,0,0.5)]"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${color} 85%, #fff), ${color})` }}>{children}</span>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function AuthView({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const router = useRouter()
  const { t, lang } = useI18n()
  const { theme, toggle, P } = useCrTheme()
  const reduced = useReducedMotion()
  const shake = useAnimationControls()

  const [view, setView] = useState<View>('login')
  const [role, setRole] = useState<PublicRole>('client')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [notice, setNotice] = useState('')
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [welcomeSent, setWelcomeSent] = useState(false)
  const [code, setCode] = useState<string[]>(Array(6).fill(''))
  const [maskedEmail, setMaskedEmail] = useState('')
  const [demoCode, setDemoCode] = useState<string | undefined>()
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const prefill = params.get('email')
    if (prefill) setEmail(prefill)
    const mode = params.get('mode')
    if (mode === 'signup' || mode === 'forgot') setView(mode)
    if (params.get('expired')) setNotice(t('auth.expired'))
    const c = params.get('error')
    if (!c) return
    if (!googleEnabled && c.startsWith('oauth_')) { router.replace('/login'); return }
    setErrors({ form: t(ERROR_CODES[c] ?? 'auth.errors.generic') })
  }, [googleEnabled, router, t])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  const go = (next: View) => {
    setView(next); setErrors({}); setNotice(''); setShowPw(false)
    window.history.replaceState(null, '', next === 'signup' || next === 'forgot' ? `/login?mode=${next}` : '/login')
  }
  const refuse = useCallback((next: Errors) => {
    setErrors(next)
    if (!reduced) shake.start({ x: [0, -8, 7, -4, 2, 0], transition: { duration: 0.32 } })
  }, [reduced, shake])
  const messageFor = (data: { code?: string }, status: number) => {
    if (data.code && data.code !== 'invalid' && !data.code.startsWith('otp_')) return t(`auth.errors.${data.code}`)
    if (status === 503) return t('auth.errors.unavailable')
    if (status === 429) return t('auth.errors.rate')
    return t('auth.errors.generic')
  }
  const lockMsg = (s: unknown) => t('auth.otp.errors.otp_locked').replace('{m}', String(Math.max(1, Math.ceil((Number(s) || 600) / 60))))

  async function submitAccount(e: FormEvent) {
    e.preventDefault()
    const signup = view === 'signup'
    const next: Errors = {}
    if (signup && !name.trim()) next.name = t('auth.errors.name_required')
    if (!email.includes('@')) next.email = t('auth.errors.invalid_email')
    if (signup && password.length < MIN_PASSWORD) next.password = t('auth.errors.weak_password')
    if (signup && password.length >= MIN_PASSWORD && confirm !== password) next.confirm = t('auth.errors.password_mismatch')
    if (!signup && !password) next.password = t('auth.errors.bad_credentials')
    if (Object.keys(next).length) return refuse(next)
    setErrors({}); setNotice(''); setBusy(true)
    const timer = signup ? 0 : window.setTimeout(() => setSendingCode(true), 700)
    try {
      const res = await fetch(signup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signup ? { name, email, password, role, lang } : { email, password, lang }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const c = data.code as string | undefined
        if (c === 'otp_locked') return refuse({ form: lockMsg(data.retry_after) })
        if (c === 'email_failed') return refuse({ form: t('auth.otp.errors.email_failed') })
        const msg = messageFor(data, res.status)
        if (c === 'bad_credentials' || c === 'weak_password') return refuse({ password: msg })
        if (c === 'invalid_email' || c === 'email_taken') return refuse({ email: msg })
        if (c === 'name_required') return refuse({ name: msg })
        if (c === 'role_required') return refuse({ role: msg })
        return refuse({ form: msg })
      }
      if (signup) { setWelcomeSent(Boolean(data.welcome_sent)); setPassword(''); setConfirm(''); setView('signedUp'); return }
      setChallenge({ email: typeof data.email === 'string' ? data.email : email, expiresIn: Number(data.expires_in) || 600, resendIn: Number(data.resend_in) || 45, demoCode: typeof data.demo_code === 'string' ? data.demo_code : undefined })
      setView('otp')
    } catch { refuse({ form: t('auth.errors.network') }) } finally { window.clearTimeout(timer); setSendingCode(false); setBusy(false) }
  }

  async function requestReset(e?: FormEvent) {
    e?.preventDefault()
    if (!email.includes('@')) return refuse({ email: t('auth.errors.invalid_email') })
    setErrors({}); setBusy(true)
    try {
      const res = await fetch('/api/auth/reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, lang }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'otp_locked') return refuse({ form: lockMsg(data.retry_after) })
        if (data.code === 'email_failed') return refuse({ form: t('auth.otp.errors.email_failed') })
        return refuse({ form: messageFor(data, res.status) })
      }
      setMaskedEmail(typeof data.email === 'string' ? data.email : email)
      setDemoCode(typeof data.demo_code === 'string' ? data.demo_code : undefined)
      setCooldown(Number(data.resend_in) || 60)
      setCode(Array(6).fill('')); setPassword(''); setConfirm('')
      setView('reset')
    } catch { refuse({ form: t('auth.errors.network') }) } finally { setBusy(false) }
  }

  async function resendReset() {
    if (cooldown > 0 || busy) return
    setErrors({}); setNotice('')
    try {
      const res = await fetch('/api/auth/reset/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setCooldown(Number(data.resend_in) || 60); setDemoCode(typeof data.demo_code === 'string' ? data.demo_code : undefined); setCode(Array(6).fill('')); setNotice(t('auth.otp.resent')); return }
      if (data.code === 'otp_wait') setCooldown(Number(data.retry_after) || 30)
      else refuse({ form: data.code === 'email_failed' ? t('auth.otp.errors.email_failed') : t('cr.auth.reset.expired') })
    } catch { refuse({ form: t('auth.errors.network') }) }
  }

  async function confirmReset(e: FormEvent) {
    e.preventDefault()
    const joined = code.join('')
    const next: Errors = {}
    if (!/^\d{6}$/.test(joined)) next.code = t('auth.otp.errors.incomplete')
    if (password.length < MIN_PASSWORD) next.password = t('auth.errors.weak_password')
    else if (confirm !== password) next.confirm = t('auth.errors.password_mismatch')
    if (Object.keys(next).length) return refuse(next)
    setErrors({}); setBusy(true)
    try {
      const res = await fetch('/api/auth/reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: joined, password }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setPassword(''); setConfirm(''); setView('resetDone'); return }
      switch (data.code) {
        case 'otp_wrong': setCode(Array(6).fill('')); return refuse({ code: t('auth.otp.errors.otp_wrong').replace('{n}', String(data.remaining ?? 0)) })
        case 'otp_locked': return refuse({ code: lockMsg(data.retry_after) })
        case 'otp_expired': return refuse({ code: t('auth.otp.errors.otp_expired') })
        case 'weak_password': return refuse({ password: t('auth.errors.weak_password') })
        case 'otp_invalid': return refuse({ form: t('cr.auth.reset.expired') })
        default: return refuse({ form: messageFor(data, res.status) })
      }
    } catch { refuse({ form: t('auth.errors.network') }) } finally { setBusy(false) }
  }

  const toSignIn = (message = '') => { setChallenge(null); setPassword(''); setConfirm(''); go('login'); if (message) setErrors({ form: message }) }
  const eye = (controls: string) => (
    <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')} aria-pressed={showPw} aria-controls={controls}
      className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[var(--faint)] transition-colors hover:text-[var(--text)]">
      {showPw ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
    </button>
  )
  const roles = [
    { id: 'client' as const, Icon: Compass, color: '#0A84FF', title: t('auth.roleShort.client'), hint: t('auth.roleShort.clientHint'), full: `${t('auth.clientTitle')}. ${t('auth.clientBody')}` },
    { id: 'business_owner' as const, Icon: Store, color: '#FF9F0A', title: t('auth.roleShort.owner'), hint: t('auth.roleShort.ownerHint'), full: `${t('auth.ownerTitle')}. ${t('auth.ownerBody')}` },
  ]
  const isAccount = view === 'login' || view === 'signup'
  const signup = view === 'signup'
  const dark = theme === 'dark'
  const cardStyle: React.CSSProperties = {
    background: dark ? 'rgba(18,27,46,0.94)' : 'rgba(244,247,251,0.97)',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,30,60,0.10)'}`,
    boxShadow: dark
      ? 'inset 0 1px 0 rgba(255,255,255,0.10), 0 50px 120px -50px rgba(0,0,0,0.85)'
      : 'inset 0 1px 0 rgba(255,255,255,1), 0 2px 6px rgba(15,30,60,0.06), 0 50px 110px -40px rgba(15,40,90,0.45)',
  }

  return (
    <div style={{ ...paletteVars(P), colorScheme: theme, fontFamily: SYSTEM_FONT }} className="fixed inset-0 overflow-y-auto bg-[var(--bg)] text-[var(--text)] antialiased">
      <Backdrop P={P} dark={dark} />

      <div className="relative flex min-h-full flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="group flex items-center gap-1 rounded-full py-1.5 pl-1 pr-3 text-[15px] font-medium text-[var(--accent)]">
            <ChevronLeft size={20} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
            <span className="flex items-center gap-2"><CRMark size={22} /><span className="text-[var(--text)]">ConnectRwanda AI</span></span>
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-[var(--line)] p-1" style={{ background: dark ? 'rgba(22,30,50,0.6)' : 'rgba(255,255,255,0.9)', boxShadow: dark ? 'none' : '0 4px 14px -6px rgba(15,40,90,0.2)' }}>
            <LangSwitch id="auth" /><ThemeSwitch theme={theme} onToggle={toggle} />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-6 sm:py-10">
            <motion.section animate={shake}
              className="w-full max-w-[440px] rounded-[32px] px-6 py-8 sm:px-9 sm:py-10" style={cardStyle}>
              <AnimatePresence initial={false}>
                <motion.div key={view} initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={QUICK}>

                  {isAccount && (
                    <>
                      <Header title={signup ? t('auth.joinTitle') : t('auth.welcome')} body={signup ? t('auth.createBody') : t('auth.welcomeBody')} />
                      <div className="mt-7">
                        <Segmented value={view} onChange={(v) => go(v as View)} label={t('auth.forkLabel')} items={[{ id: 'login', label: t('auth.signIn') }, { id: 'signup', label: t('auth.signUp') }]} />
                      </div>

                      {notice && (
                        <p role="status" className="mt-4 flex items-start gap-2 rounded-[14px] bg-[var(--seg)] px-3.5 py-2.5 text-[13px] leading-snug text-[var(--muted)]">
                          <Clock size={15} className="mt-px shrink-0 text-[var(--accent)]" aria-hidden />{notice}
                        </p>
                      )}

                      <form onSubmit={submitAccount} noValidate className="mt-5">
                        {signup && (
                          <fieldset className="mb-4">
                            <legend className="mb-2 px-1 text-[13px] font-medium uppercase tracking-[0.02em] text-[var(--faint)]">{t('auth.roleLegend')}</legend>
                            <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--field)] shadow-[0_1px_2px_rgba(15,30,60,0.05)]">
                              {roles.map((r, i) => {
                                const on = role === r.id
                                return (
                                  <label key={r.id} className={`relative flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--seg)] has-[:focus-visible]:bg-[var(--seg)] ${i ? 'before:absolute before:left-[60px] before:right-0 before:top-0 before:h-px before:bg-[var(--line)]' : ''}`}>
                                    <input type="radio" name="role" value={r.id} checked={on} onChange={() => setRole(r.id)} className="sr-only" aria-label={r.full} />
                                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: r.color }}><r.Icon size={17} strokeWidth={2.2} /></span>
                                    <span aria-hidden className="min-w-0 flex-1 leading-tight">
                                      <span className="block text-[16px] text-[var(--text)]">{r.title}</span>
                                      <span className="mt-0.5 block text-[13px] text-[var(--faint)]">{r.hint}</span>
                                    </span>
                                    <Check size={20} strokeWidth={2.6} aria-hidden className="shrink-0 text-[var(--accent)] transition-opacity duration-150" style={{ opacity: on ? 1 : 0 }} />
                                  </label>
                                )
                              })}
                            </div>
                            <FieldError id="auth-role-error">{errors.role}</FieldError>
                          </fieldset>
                        )}

                        <Group error={Boolean(errors.name || errors.email || errors.password || errors.confirm)}>
                          {signup && <Row first id="auth-name" label={t('auth.name')} value={name} onChange={setName} autoComplete="name" invalid={!!errors.name} describedBy="auth-errors" />}
                          <Row first={!signup} id="auth-email" label={t('auth.email')} type="email" inputMode="email" value={email} onChange={setEmail} autoComplete="email" invalid={!!errors.email} describedBy="auth-errors" />
                          <Row id="auth-password" label={t('auth.password')} type={showPw ? 'text' : 'password'} value={password} onChange={setPassword}
                            autoComplete={signup ? 'new-password' : 'current-password'} invalid={!!errors.password} describedBy="auth-errors" trailing={eye('auth-password')} />
                          {signup && <Row id="auth-confirm" label={t('auth.confirmPassword')} type={showPw ? 'text' : 'password'} value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!errors.confirm} describedBy="auth-errors" />}
                        </Group>
                        {signup && <StrengthMeter value={strength(password)} />}
                        <div id="auth-errors">
                          <FieldError id="e-name">{errors.name}</FieldError>
                          <FieldError id="e-email">{errors.email}</FieldError>
                          <FieldError id="e-password">{errors.password}</FieldError>
                          <FieldError id="e-confirm">{errors.confirm}</FieldError>
                          <FieldError id="e-form">{errors.form}</FieldError>
                        </div>

                        <div className="mt-6">
                          <Primary busy={busy} busyLabel={signup ? t('auth.busyUp') : sendingCode ? t('auth.otp.sending') : t('auth.checking')}>
                            {signup ? t('auth.submitUp') : t('auth.submitIn')}
                          </Primary>
                        </div>
                      </form>

                      {!signup && (
                        <button type="button" onClick={() => go('forgot')} className="mx-auto mt-4 block rounded-lg px-2 py-1 text-[15px] text-[var(--accent)] hover:underline">{t('auth.forgot')}</button>
                      )}

                      {googleEnabled && (
                        <>
                          <div className="my-5 flex items-center gap-3 text-[13px] text-[var(--faint)]"><span className="h-px flex-1 bg-[var(--line)]" />{t('auth.or')}<span className="h-px flex-1 bg-[var(--line)]" /></div>
                          <button type="button" disabled={googleBusy} onClick={() => { setGoogleBusy(true); window.location.href = '/api/auth/google' }}
                            className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--field)] text-[16px] font-semibold text-[var(--text)] transition-colors hover:bg-[var(--seg)] disabled:opacity-70">
                            {googleBusy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <span aria-hidden className="text-[18px] font-bold text-[#4285F4]">G</span>}
                            {googleBusy ? t('auth.googleBusy') : t('auth.google')}
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {view === 'otp' && challenge && (
                    <OtpStep challenge={challenge} onVerified={(target) => { clearLocalAuth(); window.location.replace(target) }} onRestart={toSignIn} />
                  )}

                  {view === 'signedUp' && (
                    <div role="status">
                      <Header icon={<SymbolTile color="#30D158"><CheckCircle2 size={32} /></SymbolTile>} title={t('auth.signedUp.title')}
                        body={welcomeSent ? t('auth.signedUp.bodySent') : t('auth.signedUp.bodyNotSent')} />
                      <p className="mt-3 text-center text-[15px] font-medium text-[var(--text)]">{email}</p>
                      {!welcomeSent && <p className="mt-4 rounded-[14px] bg-[var(--seg)] px-3.5 py-2.5 text-[13px] text-[var(--muted)]">{t('auth.signedUp.mailFailed')}</p>}
                      <div className="mt-7"><Primary type="button" onClick={() => toSignIn()}>{t('auth.signedUp.cta')}</Primary></div>
                    </div>
                  )}

                  {view === 'forgot' && (
                    <form onSubmit={requestReset} noValidate>
                      <Header icon={<SymbolTile color="#5E5CE6"><KeyRound size={30} /></SymbolTile>} title={t('cr.auth.forgot.title')} body={t('cr.auth.forgot.body')} />
                      <div className="mt-7">
                        <Group error={Boolean(errors.email)}>
                          <Row first id="reset-email" label={t('auth.email')} type="email" inputMode="email" value={email} onChange={setEmail} autoComplete="email" invalid={!!errors.email} describedBy="reset-errors" />
                        </Group>
                        <div id="reset-errors"><FieldError id="r-email">{errors.email}</FieldError><FieldError id="r-form">{errors.form}</FieldError></div>
                        <div className="mt-6"><Primary busy={busy} busyLabel={t('cr.auth.forgot.sending')}>{t('cr.auth.forgot.send')}</Primary></div>
                      </div>
                      <button type="button" onClick={() => go('login')} className="mx-auto mt-4 block rounded-lg px-2 py-1 text-[15px] text-[var(--accent)] hover:underline">{t('cr.auth.forgot.back')}</button>
                    </form>
                  )}

                  {view === 'reset' && (
                    <form onSubmit={confirmReset} noValidate>
                      <Header icon={<SymbolTile color="#0A84FF"><ShieldCheck size={30} /></SymbolTile>} title={t('cr.auth.reset.title')}
                        body={<>{t('cr.auth.reset.body')} <span className="font-medium text-[var(--text)]">{maskedEmail}</span></>} />
                      {demoCode && (
                        <p role="status" className="mt-5 rounded-[14px] bg-[var(--seg)] px-3.5 py-2.5 text-center text-[13px] text-[var(--muted)]">
                          {t('auth.otp.demoTitle')}: <span className="font-mono text-[15px] font-bold tracking-[0.14em] text-[var(--text)]">{demoCode}</span>
                        </p>
                      )}
                      <div className="mt-6">
                        <CodeBoxes value={code} onChange={(v) => { setCode(v); setErrors((er) => ({ ...er, code: undefined })) }} error={Boolean(errors.code)} disabled={busy} />
                        <FieldError id="r-code">{errors.code}</FieldError>
                        <div className="mt-2 flex items-center justify-between px-1 text-[13px]">
                          <span className="text-[var(--faint)]">{notice}</span>
                          <button type="button" onClick={resendReset} disabled={cooldown > 0} className="flex items-center gap-1.5 rounded-lg py-1 text-[var(--accent)] disabled:text-[var(--faint)]">
                            <RotateCcw size={13} />{cooldown > 0 ? t('cr.auth.reset.resendIn').replace('{s}', String(cooldown)) : t('cr.auth.reset.resend')}
                          </button>
                        </div>
                      </div>
                      <div className="mt-4">
                        <Group error={Boolean(errors.password || errors.confirm)}>
                          <Row first id="reset-password" label={t('cr.auth.reset.newPassword')} type={showPw ? 'text' : 'password'} value={password} onChange={setPassword} autoComplete="new-password" invalid={!!errors.password} describedBy="reset-errors2" trailing={eye('reset-password')} />
                          <Row id="reset-confirm" label={t('auth.confirmPassword')} type={showPw ? 'text' : 'password'} value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!errors.confirm} describedBy="reset-errors2" />
                        </Group>
                        <StrengthMeter value={strength(password)} />
                        <div id="reset-errors2"><FieldError id="r-pw">{errors.password}</FieldError><FieldError id="r-cf">{errors.confirm}</FieldError><FieldError id="r-f">{errors.form}</FieldError></div>
                        <div className="mt-6"><Primary busy={busy} busyLabel={t('cr.auth.reset.busy')}>{t('cr.auth.reset.submit')}</Primary></div>
                      </div>
                      <button type="button" onClick={() => go('forgot')} className="mx-auto mt-4 block rounded-lg px-2 py-1 text-[15px] text-[var(--accent)] hover:underline">{t('cr.auth.reset.changeEmail')}</button>
                    </form>
                  )}

                  {view === 'resetDone' && (
                    <div role="status">
                      <Header icon={<SymbolTile color="#30D158"><ShieldCheck size={32} /></SymbolTile>} title={t('cr.auth.done.title')} body={t('cr.auth.done.body')} />
                      <div className="mt-7"><Primary type="button" onClick={() => toSignIn()}>{t('cr.auth.done.cta')}</Primary></div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.section>
        </main>

        <footer className="flex flex-col items-center gap-2 px-5 pb-6 text-center text-[12px] text-[var(--faint)]">
          {isAccount && <p className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-[var(--green)]" />{signup ? t('cr.auth.secureUp') : t('cr.auth.secureIn')}</p>}
          <p className="flex items-center gap-2"><span className="h-[10px] w-[15px] overflow-hidden rounded-[2px]"><RwandaFlag className="h-full w-full" /></span>© {new Date().getFullYear()} ConnectRwanda AI · {t('cr.footer.made')}</p>
        </footer>
      </div>
    </div>
  )
}
