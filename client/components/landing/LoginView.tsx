'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { AlertCircle, ArrowRight, CheckCircle2, Check, ChevronLeft, Clock, Compass, Eye, EyeOff, Loader2, MapPin, Store } from 'lucide-react'
import { LiveClock, ThemeToggle, useLandingTheme } from '@/components/landing/bits'
import { LangMenu } from '@/components/landing/MapForAllLanding'
import { LiveProvider, NotificationBanner, PauseToggle, TalkingDevice, useLive } from '@/components/landing/live'
import { useTransitionLinks } from '@/components/landing/pageTransition'
import { APPLE_EASE, BlurInWords, IntroIn } from '@/components/landing/scrollFx'
import { useI18n } from '@/components/I18nProvider'
import { OtpStep, type OtpChallenge } from '@/components/landing/OtpStep'

/**
 * Sign in / create account, in the landing page's iOS style.
 *
 * - Fits one screen: the header is fixed at the top of the form column and
 *   the form is compact enough that no scrolling is needed on a laptop.
 * - Large screens get a live panel: a slideshow of Kigali places with
 *   story-style progress bars, the talking phone and notifications, and a
 *   pause control that always sits on the photo.
 *
 * Sign-up creates the account without signing in and shows a success card.
 * Sign-in is two steps: password, then the 6-digit code sent by email
 * (OtpStep). The session cookie is only set once the code is accepted.
 */

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
type Step = 'form' | 'signedUp' | 'otp'
type FieldErrors = { name?: string; email?: string; password?: string; confirm?: string; role?: string; form?: string }
type PublicRole = 'client' | 'business_owner'

const MODES: Mode[] = ['login', 'signup']
const EASE_CSS = 'ease-[cubic-bezier(0.28,0.11,0.32,1)]'
const HEADER_GHOST =
  'flex h-9 w-9 items-center justify-center rounded-full text-[#1A1614] transition-colors duration-200 hover:bg-black/[0.05] active:opacity-70 dark:text-gray-100 dark:hover:bg-white/10'

/** Kigali places for the panel slideshow (all real photos in /public/landing). */
const SLIDES = [
  { src: '/landing/kigali-convention-center.jpg', key: 'convention', pos: 'center 45%' },
  { src: '/landing/kigali-city-real.jpg', key: 'city', pos: 'center 45%' },
  { src: '/landing/kigali-stall-real.jpg', key: 'stall', pos: 'center 40%' },
  { src: '/landing/kigali-market-real.jpg', key: 'market', pos: 'center 50%' },
  { src: '/landing/kigali-view-real.jpg', key: 'hills', pos: 'center 50%' },
] as const
const SLIDE_MS = 6500

function Mark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8672A] text-[11px] font-bold tracking-tight text-white">
      MF
    </span>
  )
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** iOS segmented control; the white pill slides to the chosen side. */
function Segmented({ mode, onChange, label, tabs }: { mode: Mode; onChange: (m: Mode) => void; label: string; tabs: Record<Mode, string> }) {
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
    <div role="tablist" aria-label={label} className="grid grid-cols-2 rounded-full bg-black/[0.05] p-1 dark:bg-white/[0.07]">
      {MODES.map((id, i) => {
        const on = i === active
        return (
          <button
            key={id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`auth-tab-${id}`}
            aria-selected={on}
            aria-controls="auth-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={onKey}
            className={`relative h-9 rounded-full text-[13.5px] font-medium transition-colors duration-200 ${on ? 'text-[#1A1614] dark:text-gray-50' : 'text-[#6E5B50] hover:text-[#1A1614] dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {on && (
              <motion.span
                layoutId="auth-segment"
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(26,22,20,0.08),0_4px_14px_-4px_rgba(26,22,20,0.18)] dark:bg-[#2C2621]"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              />
            )}
            <span className="relative">{tabs[id]}</span>
          </button>
        )
      })}
    </div>
  )
}

function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.p
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.25, ease: APPLE_EASE }}
          className="flex items-start gap-1.5 overflow-hidden pt-1 text-[12.5px] leading-snug text-[#B42318] dark:text-[#FF8A7A]"
        >
          <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

/**
 * Floating-label field: the label sits inside the box and glides up when the
 * field is focused or filled. `ariaLabel` is only for fields whose visible
 * label is shortened (it always contains the visible text).
 */
function Field({
  id,
  label,
  ariaLabel,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  describedBy,
  trailing,
}: {
  id: string
  label: string
  ariaLabel?: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  error?: string
  describedBy?: string
  trailing?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div
        className={`relative rounded-[14px] border bg-white transition-[border-color,box-shadow] duration-200 dark:bg-white/[0.04] ${error
          ? 'border-[#B42318] shadow-[0_0_0_4px_rgba(180,35,24,0.10)] dark:border-[#FF8A7A]'
          : 'border-black/[0.09] hover:border-black/20 focus-within:!border-[#E8672A] focus-within:shadow-[0_0_0_4px_rgba(232,103,42,0.16)] dark:border-white/10 dark:hover:border-white/20'}`}
      >
        <input
          id={id}
          type={type}
          value={value}
          placeholder=" "
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`peer h-[50px] w-full rounded-[14px] bg-transparent px-3.5 pb-1.5 pt-5 text-[16px] text-[#1A1614] outline-none autofill:shadow-[inset_0_0_0_60px_#fff] dark:text-gray-50 dark:autofill:shadow-[inset_0_0_0_60px_#1f1b18] ${trailing ? 'pr-11' : ''}`}
        />
        <label
          htmlFor={id}
          className={`pointer-events-none absolute left-3.5 top-[14px] max-w-[calc(100%-1.75rem)] truncate text-[15px] text-[#6E5B50] transition-all duration-200 ${EASE_CSS} peer-focus:top-[7px] peer-focus:text-[11px] peer-focus:font-medium peer-[:not(:placeholder-shown)]:top-[7px] peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-medium dark:text-gray-400`}
        >
          {label}
        </label>
        {trailing}
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  )
}

function Rule({ met, children, srMet, srUnmet }: { met: boolean; children: ReactNode; srMet: string; srUnmet: string }) {
  return (
    <li className={`flex items-center gap-1.5 text-[12.5px] transition-colors duration-200 ${met ? 'text-[#1A1614] dark:text-gray-100' : 'text-[#6E5B50] dark:text-gray-400'}`}>
      <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${met ? 'border-[#1F8A5B] bg-[#1F8A5B] text-white' : 'border-black/20 dark:border-white/25'}`}>
        <AnimatePresence>
          {met && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
              <Check size={10} strokeWidth={3.25} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {children}
      <span className="sr-only">{met ? srMet : srUnmet}</span>
    </li>
  )
}

/**
 * "How will you use MapForAll?" choice. The orange highlight is one shared
 * element that glides between the two cards (like the segmented control),
 * and a check badge pops onto the chosen card's icon. Visible text is short;
 * screen readers get the full title and description.
 */
function RoleCard({
  id,
  on,
  title,
  hint,
  full,
  Icon,
  onSelect,
}: {
  id: PublicRole
  on: boolean
  title: string
  hint: string
  full: string
  Icon: typeof Compass
  onSelect: () => void
}) {
  return (
    <label
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-2xl p-2.5 transition-transform duration-200 active:scale-[0.98] has-[:focus-visible]:outline has-[:focus-visible]:outline-[2.5px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#E8672A]`}
    >
      <input type="radio" name="role" value={id} checked={on} onChange={onSelect} className="sr-only" aria-label={full} />
      {/* Resting surface */}
      <span aria-hidden className="absolute inset-0 rounded-2xl border border-black/[0.08] bg-white/70 transition-colors duration-200 group-hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:group-hover:bg-white/[0.06]" />
      {/* Shared selection highlight */}
      {on && (
        <motion.span
          aria-hidden
          layoutId="auth-role-highlight"
          className="absolute inset-0 rounded-2xl border-[1.5px] border-[#E8672A] bg-gradient-to-br from-[#FFF1E6] via-white to-white shadow-[0_0_0_4px_rgba(232,103,42,0.12),0_10px_24px_-12px_rgba(232,103,42,0.55)] dark:from-[#E8672A]/20 dark:via-white/[0.05] dark:to-white/[0.03]"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span
        aria-hidden
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-[background-color,color,transform] duration-300 ${EASE_CSS} group-hover:scale-105 ${on
          ? 'bg-[#E8672A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_14px_-6px_rgba(232,103,42,0.8)]'
          : 'bg-[#F3E6D4] text-[#6E5B50] dark:bg-white/10 dark:text-gray-300'}`}
      >
        <Icon size={19} strokeWidth={2} />
        <AnimatePresence>
          {on && (
            <motion.span
              key="badge"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}
              className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#1A1614] text-white dark:border-[#1C1916] dark:bg-white dark:text-[#1A1614]"
            >
              <Check size={10} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span aria-hidden className="relative min-w-0">
        <span className={`block text-[13px] font-semibold leading-[1.2] transition-colors duration-200 ${on ? 'text-[#1A1614] dark:text-gray-50' : 'text-[#3A2E28] dark:text-gray-200'}`}>{title}</span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-tight text-[#6E5B50] dark:text-gray-400">{hint}</span>
      </span>
    </label>
  )
}

/**
 * Right-hand panel (large screens). Kigali places cross-fade with a slow
 * zoom; story bars show how long each stays. A bar's CSS animation drives the
 * slideshow, so the page's pause control freezes bar and photo together.
 */
function LivePanel() {
  const { t } = useI18n()
  const [slide, setSlide] = useState(0)
  const current = SLIDES[slide]

  return (
    <div className="relative m-3 h-[calc(100dvh-24px)] overflow-hidden rounded-[32px] bg-[#0E0C0A]">
      <div aria-hidden className="absolute inset-0">
        {SLIDES.map((s, i) => {
          // Keep only the previous (for the cross-fade), current and next
          // photos in the page, so all five are never downloaded at once.
          const n = SLIDES.length
          if (i !== slide && i !== (slide + 1) % n && i !== (slide - 1 + n) % n) return null
          return (
          <img
            key={s.src}
            src={s.src}
            alt=""
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ${EASE_CSS} ${i === slide ? 'mf-kenburns opacity-100' : 'opacity-0'}`}
            style={{ objectPosition: s.pos }}
          />
          )
        })}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0E0C0A]/80 via-[#0E0C0A]/40 to-[#0E0C0A]/25" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0E0C0A]/85 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0E0C0A]/60 to-transparent" />
      </div>

      <div className="relative grid h-full grid-cols-[minmax(0,1fr)_auto] gap-6 p-7 xl:gap-10 xl:p-9">
        <div className="flex min-w-0 flex-col">
          {/* Story bars — the active one's animation end advances the slide. */}
          <div aria-hidden className="flex gap-1.5">
            {SLIDES.map((s, i) => (
              <span key={s.src} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
                {i < slide && <span className="block h-full w-full bg-white" />}
                {i === slide && (
                  <span
                    key={`bar-${slide}`}
                    className="mf-story-bar block h-full bg-white"
                    style={{ animationDuration: `${SLIDE_MS}ms` }}
                    onAnimationEnd={() => setSlide((v) => (v + 1) % SLIDES.length)}
                  />
                )}
              </span>
            ))}
          </div>

          <IntroIn delay={0.3} className="mt-4">
            <span aria-hidden className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-medium text-white backdrop-blur-xl">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8672A] opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E8672A]" />
              </span>
              {t('landing.nav.live')} · <LiveClock timeZone="Africa/Kigali" bare />
            </span>
          </IntroIn>

          <div aria-hidden className="flex flex-1 flex-col justify-center gap-5 py-6">
            <IntroIn delay={1.1} className="w-[min(290px,100%)]">
              <NotificationBanner offset={0} compact />
            </IntroIn>
            <IntroIn delay={1.3} className="ml-[12%] w-[min(290px,88%)]">
              <NotificationBanner offset={1} compact />
            </IntroIn>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div aria-hidden className="min-w-0">
              <div className="relative mb-4 h-8">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={current.key}
                    initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                    transition={{ duration: 0.6, ease: APPLE_EASE }}
                    className="absolute left-0 top-0 inline-flex max-w-full items-center gap-2 whitespace-nowrap rounded-full bg-white/15 py-1.5 pl-2 pr-3.5 text-[13px] font-medium text-white backdrop-blur-xl"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E8672A]"><MapPin size={11} strokeWidth={2.5} /></span>
                    {t(`auth.places.${current.key}`)}
                  </motion.span>
                </AnimatePresence>
              </div>
              <IntroIn delay={0.6}>
                <p className="text-[clamp(1.8rem,2.6vw,2.6rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-white">
                  {t('landing.hero2.titleA')}
                  <span className="mf-gradient-on-dark block pb-[0.06em]">{t('landing.hero2.titleB')}</span>
                </p>
              </IntroIn>
            </div>
            {/* Always on the photo, whatever the slide. */}
            <PauseToggle tone="dark" className="mb-1" />
          </div>
        </div>

        {/* Phone: as tall as the panel allows, capped for large screens. */}
        <div aria-hidden className="flex items-center">
          <IntroIn delay={0.45} from="zoom" className="w-[min(340px,calc((100dvh-24px-64px)*0.486))]">
            <TalkingDevice />
          </IntroIn>
        </div>
      </div>
    </div>
  )
}

/** Shown after sign-up instead of signing in: the account exists, sign in next. */
function SignedUpCard({ email, welcomeSent, onContinue }: { email: string; welcomeSent: boolean; onContinue: () => void }) {
  const { t } = useI18n()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: APPLE_EASE }}
      className="text-center"
    >
      <motion.span
        aria-hidden
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 20, delay: 0.1 }}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#1F8A5B]/12 text-[#1F8A5B] dark:bg-[#1F8A5B]/25 dark:text-[#5BD49A]"
      >
        <CheckCircle2 size={36} strokeWidth={2} />
      </motion.span>
      <h1 className="mt-5 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#1A1614] dark:text-gray-50">
        {t('auth.signedUp.title')}
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-[#6E5B50] dark:text-gray-400">
        {welcomeSent ? t('auth.signedUp.bodySent') : t('auth.signedUp.bodyNotSent')}
      </p>
      <p className="mt-1 truncate text-[13.5px] font-medium text-[#1A1614] dark:text-gray-200">{email}</p>
      {!welcomeSent && (
        <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-[#FFF7DB] px-3.5 py-2.5 text-left text-[12.5px] leading-snug text-[#6B4E00] dark:bg-[#F2C94C]/10 dark:text-[#F5D77A]">
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
          {t('auth.signedUp.mailFailed')}
        </p>
      )}
      <button
        ref={button}
        type="button"
        onClick={onContinue}
        className={`group mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[#1A1614] text-[15px] font-medium text-white transition-[transform,background-color] duration-300 ${EASE_CSS} hover:-translate-y-px hover:bg-black dark:bg-white dark:text-[#1A1614] dark:hover:bg-gray-100`}
      >
        {t('auth.signedUp.cta')}
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8672A] text-white">
          <ArrowRight size={14} strokeWidth={2.25} />
        </span>
      </button>
    </motion.div>
  )
}

export default function LoginView({ googleEnabled = false }: { googleEnabled?: boolean }) {
  return (
    <LiveProvider>
      <LoginScreen googleEnabled={googleEnabled} />
    </LiveProvider>
  )
}

function LoginScreen({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const { t, lang } = useI18n()
  const { dark, toggle } = useLandingTheme()
  const { paused } = useLive()
  const reduced = useReducedMotion()
  const shake = useAnimationControls()
  const rootRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [role, setRole] = useState<PublicRole>('client')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [welcomeSent, setWelcomeSent] = useState(false)
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [notice, setNotice] = useState('')
  const [forgot, setForgot] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [fields, setFields] = useState<FieldErrors>({})

  // Back to the landing page through the same curtain.
  useTransitionLinks(rootRef, ['/'])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const prefill = params.get('email')
    if (prefill) setEmail(prefill)
    if (params.get('expired')) setNotice(t('auth.expired'))
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
  const matches = confirm.length > 0 && confirm === password

  function switchMode(next: Mode) {
    setMode(next)
    setFields({})
    setForgot(false)
    setNotice('')
  }

  /** From the sign-up success card, or back from the code step: the sign-in form, email kept. */
  function toSignIn(message = '') {
    setStep('form')
    setMode('login')
    setChallenge(null)
    setPassword('')
    setConfirm('')
    setFields(message ? { form: message } : {})
    setForgot(false)
    setNotice('')
  }

  function messageFor(data: { code?: string; error?: string }, status: number) {
    if (data.code && data.code !== 'invalid') return t(`auth.errors.${data.code}`)
    // These responses carry an English `error` and no code; use our own
    // translated copy so the visitor reads it in their language.
    if (status === 503) return t('auth.errors.unavailable')
    if (status === 429) return t('auth.errors.rate')
    return data.error || t('auth.errors.generic')
  }

  /** A short head-shake on the form, like iOS on a wrong passcode. */
  function refuse(next: FieldErrors) {
    setFields(next)
    if (!reduced) shake.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.42, ease: 'easeInOut' } })
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault()
    const next: FieldErrors = {}
    if (signup && !name.trim()) next.name = t('auth.errors.name_required')
    if (!email.includes('@')) next.email = t('auth.errors.invalid_email')
    if (signup && !longEnough) next.password = t('auth.errors.weak_password')
    if (signup && longEnough && confirm !== password) next.confirm = t('auth.errors.password_mismatch')
    if (!signup && !password) next.password = t('auth.errors.bad_credentials')
    if (Object.keys(next).length > 0) {
      refuse(next)
      return
    }
    setFields({})
    setNotice('')
    setFormBusy(true)
    // The password check is quick; after that the wait is the email going out.
    const sendingTimer = signup ? 0 : window.setTimeout(() => setSendingCode(true), 700)
    try {
      const endpoint = signup ? '/api/auth/signup' : '/api/auth/login'
      const payload = signup ? { name, email, password, role, lang } : { email, password, lang }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data.code as string | undefined
        if (code === 'otp_locked') {
          refuse({ form: t('auth.otp.errors.otp_locked').replace('{m}', String(Math.max(1, Math.ceil((Number(data.retry_after) || 600) / 60)))) })
        } else if (code === 'email_failed') {
          refuse({ form: t('auth.otp.errors.email_failed') })
        } else {
          const msg = messageFor(data, res.status)
          if (code === 'bad_credentials' || code === 'weak_password') refuse({ password: msg })
          else if (code === 'invalid_email' || code === 'email_taken') refuse({ email: msg })
          else if (code === 'name_required') refuse({ name: msg })
          else if (code === 'role_required') refuse({ role: msg })
          else refuse({ form: msg })
        }
        return
      }
      if (signup) {
        setWelcomeSent(Boolean(data.welcome_sent))
        setPassword('')
        setConfirm('')
        setStep('signedUp')
        return
      }
      setChallenge({
        email: typeof data.email === 'string' ? data.email : email,
        expiresIn: Number(data.expires_in) || 600,
        resendIn: Number(data.resend_in) || 45,
        demoCode: typeof data.demo_code === 'string' ? data.demo_code : undefined,
      })
      setStep('otp')
    } catch {
      refuse({ form: t('auth.errors.network') })
    } finally {
      window.clearTimeout(sendingTimer)
      setSendingCode(false)
      setFormBusy(false)
    }
  }

  function onVerified(target: string) {
    // Let the check mark land before leaving the page.
    window.setTimeout(() => { window.location.href = target }, reduced ? 0 : 450)
  }

  const roles = [
    { id: 'client' as const, title: t('auth.roleShort.client'), hint: t('auth.roleShort.clientHint'), full: `${t('auth.clientTitle')}. ${t('auth.clientBody')}`, Icon: Compass },
    { id: 'business_owner' as const, title: t('auth.roleShort.owner'), hint: t('auth.roleShort.ownerHint'), full: `${t('auth.ownerTitle')}. ${t('auth.ownerBody')}`, Icon: Store },
  ]
  const reveal = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.45, ease: APPLE_EASE } }

  /** Show/hide toggle; each password field gets its own. */
  const eyeButton = (shown: boolean, toggleShown: () => void, controls: string) => (
    <button
      type="button"
      onClick={toggleShown}
      aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
      aria-pressed={shown}
      aria-controls={controls}
      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-[#6E5B50] transition-colors duration-150 hover:bg-black/[0.04] hover:text-[#1A1614] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={shown ? 'hide' : 'show'}
          initial={{ opacity: 0, scale: 0.7, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.7, rotate: 20 }}
          transition={{ duration: 0.18 }}
        >
          {shown ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  )

  return (
    <div
      ref={rootRef}
      className={`mf-landing h-dvh overflow-hidden bg-[#FBF3E7] font-[family-name:var(--font-inter)] antialiased dark:bg-[#12100E] ${paused ? 'mf-paused' : ''}`}
    >
      <div className="grid h-full lg:grid-cols-[minmax(400px,470px)_1fr]">
        <div className="relative flex h-dvh min-w-0 flex-col">
          <div aria-hidden className="pointer-events-none absolute -left-40 -top-48 h-[520px] w-[520px]">
            <div className="mf-glow-drift h-full w-full rounded-full bg-[radial-gradient(closest-side,rgba(232,103,42,0.16),transparent)] blur-2xl" />
          </div>

          {/* Fixed header: it never scrolls with the form. The way back
              sits right under the logo, so the right side only holds the
              language and theme controls. */}
          <header className="relative z-10 flex shrink-0 items-start justify-between gap-3 px-6 pt-4 sm:px-9">
            <div className="flex min-w-0 flex-col items-start">
              <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full">
                <Mark />
                <span className="whitespace-nowrap leading-tight">
                  <span className="block text-[15px] font-semibold tracking-[-0.015em] text-[#1A1614] dark:text-gray-100">MapForAll</span>
                  <span className="block text-[11px] text-[#6E5B50] dark:text-gray-400">Ikarita ya Bose</span>
                </span>
              </Link>
              <Link
                href="/"
                className="group -ml-1.5 mt-1.5 flex h-8 items-center gap-0.5 whitespace-nowrap rounded-full pl-1 pr-2.5 text-[13px] font-medium text-[#6E5B50] transition-colors duration-200 hover:bg-black/[0.05] hover:text-[#1A1614] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
              >
                <ChevronLeft size={16} className={`transition-transform duration-300 ${EASE_CSS} group-hover:-translate-x-0.5`} />
                {t('auth.back')}
              </Link>
            </div>
            <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
              <LangMenu />
              <ThemeToggle dark={dark} onToggle={toggle} className={HEADER_GHOST} />
            </span>
          </header>

          {/* Only scrolls on very short screens; the header stays put. */}
          <main className="relative min-h-0 flex-1 overflow-y-auto px-6 sm:px-9">
            <div className="mx-auto flex min-h-full w-full max-w-[380px] flex-col justify-center py-3">
              {step === 'otp' && challenge ? (
                <OtpStep challenge={challenge} onVerified={onVerified} onRestart={toSignIn} />
              ) : step === 'signedUp' ? (
                <SignedUpCard email={email} welcomeSent={welcomeSent} onContinue={() => toSignIn()} />
              ) : (
              <>
              <IntroIn delay={0.05}>
                <Segmented
                  mode={mode}
                  onChange={switchMode}
                  label={t('auth.forkLabel')}
                  tabs={{ login: t('auth.signIn'), signup: t('auth.signUp') }}
                />
              </IntroIn>

              <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
                <BlurInWords
                  key={mode}
                  text={signup ? t('auth.joinTitle') : t('auth.welcome')}
                  delay={0.05}
                  className="mt-4 text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] text-[#1A1614] dark:text-gray-50"
                />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={mode}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: APPLE_EASE }}
                    // On short screens the sign-up intro repeats the role
                    // question below it, so it is kept for screen readers only.
                    className={`mt-1.5 text-[14px] leading-snug text-[#6E5B50] dark:text-gray-400 ${signup ? '[@media(max-height:760px)]:sr-only' : ''}`}
                  >
                    {signup ? t('auth.createBody') : t('auth.welcomeBody')}
                  </motion.p>
                </AnimatePresence>

                {notice && (
                  <p role="status" className="mt-3 flex items-start gap-2 rounded-[14px] bg-[#FDE8DC] px-3.5 py-2.5 text-[13px] leading-snug text-[#8A3412] dark:bg-[#E8672A]/15 dark:text-[#FFB38A]">
                    <Clock size={15} className="mt-px shrink-0" aria-hidden />
                    {notice}
                  </p>
                )}
                <motion.form animate={shake} onSubmit={submitEmail} className="mt-4" noValidate>
                  <AnimatePresence initial={false}>
                    {signup && (
                      <motion.fieldset key="role" {...reveal} className="overflow-hidden">
                        <legend className="mb-2 text-[12.5px] font-medium text-[#1A1614] dark:text-gray-200">{t('auth.roleLegend')}</legend>
                        <div className="grid grid-cols-2 gap-2.5 pb-2.5">
                          {roles.map((r) => (
                            <RoleCard key={r.id} {...r} on={role === r.id} onSelect={() => setRole(r.id)} />
                          ))}
                        </div>
                        <FieldError id="auth-role-error">{fields.role}</FieldError>
                      </motion.fieldset>
                    )}
                    {signup && (
                      <motion.div key="name" {...reveal} className="overflow-hidden">
                        <div className="pb-2.5">
                          <Field
                            id="auth-name"
                            label={t('auth.name')}
                            value={name}
                            onChange={setName}
                            autoComplete="name"
                            error={fields.name}
                            describedBy={fields.name ? 'auth-name-error' : undefined}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2.5">
                    <Field
                      id="auth-email"
                      label={t('auth.email')}
                      type="email"
                      value={email}
                      onChange={setEmail}
                      autoComplete="email"
                      error={fields.email}
                      describedBy={fields.email ? 'auth-email-error' : undefined}
                    />

                    <div className={`grid gap-2.5 ${signup ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      <Field
                        id="auth-password"
                        label={t('auth.password')}
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={setPassword}
                        autoComplete={signup ? 'new-password' : 'current-password'}
                        error={fields.password}
                        describedBy={[signup ? 'auth-password-rules' : '', fields.password ? 'auth-password-error' : ''].filter(Boolean).join(' ') || undefined}
                        trailing={eyeButton(showPassword, () => setShowPassword((v) => !v), 'auth-password')}
                      />
                      <AnimatePresence initial={false}>
                        {signup && (
                          <motion.div
                            key="confirm"
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 16 }}
                            transition={{ duration: 0.35, ease: APPLE_EASE }}
                            className="min-w-0"
                          >
                            <Field
                              id="auth-confirm"
                              label={t('auth.confirmShort')}
                              ariaLabel={t('auth.confirmPassword')}
                              type={showConfirm ? 'text' : 'password'}
                              value={confirm}
                              onChange={setConfirm}
                              autoComplete="new-password"
                              error={fields.confirm}
                              describedBy={['auth-password-rules', fields.confirm ? 'auth-confirm-error' : ''].filter(Boolean).join(' ')}
                              trailing={eyeButton(showConfirm, () => setShowConfirm((v) => !v), 'auth-confirm')}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <AnimatePresence initial={false} mode="popLayout">
                      {signup ? (
                        <motion.ul key="rules" id="auth-password-rules" {...reveal} className="flex flex-wrap gap-x-4 gap-y-1 overflow-hidden pt-0.5">
                          <Rule met={longEnough} srMet={t('auth.ruleMet')} srUnmet={t('auth.ruleUnmet')}>{t('auth.passwordHint')}</Rule>
                          <Rule met={longEnough && matches} srMet={t('auth.ruleMet')} srUnmet={t('auth.ruleUnmet')}>{t('auth.passwordMatch')}</Rule>
                        </motion.ul>
                      ) : (
                        <motion.div key="forgot-row" {...reveal} className="overflow-hidden">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setForgot((v) => !v)}
                              aria-expanded={forgot}
                              aria-controls="auth-forgot"
                              className="min-h-[32px] rounded-full px-1 text-[13px] font-medium text-[#B8441A] underline-offset-4 hover:underline dark:text-[#FF9A63]"
                            >
                              {t('auth.forgot')}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence initial={false}>
                      {forgot && !signup && (
                        <motion.p key="forgot" id="auth-forgot" {...reveal} className="overflow-hidden">
                          <span className="block rounded-[14px] bg-white/70 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#6E5B50] dark:bg-white/[0.05] dark:text-gray-400">
                            {t('auth.forgotHint')}
                          </span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <FieldError id="auth-form-error">{fields.form}</FieldError>

                  <button
                    type="submit"
                    disabled={formBusy}
                    className={`group relative mt-4 flex h-12 w-full items-center justify-center overflow-hidden rounded-full bg-[#1A1614] text-[15px] font-medium tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(26,22,20,0.22),0_12px_28px_-12px_rgba(26,22,20,0.6)] transition-[transform,background-color] duration-300 ${EASE_CSS} enabled:hover:-translate-y-px enabled:hover:bg-black enabled:active:translate-y-0 enabled:active:scale-[0.99] disabled:cursor-default dark:bg-white dark:text-[#1A1614] dark:enabled:hover:bg-gray-100`}
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-[150%] skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 ease-out group-enabled:group-hover:translate-x-[400%] dark:via-black/10" />
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={sendingCode ? 'sending' : formBusy ? 'busy' : mode}
                        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                        transition={{ duration: 0.25, ease: APPLE_EASE }}
                        className="relative flex items-center gap-2.5"
                        aria-live="polite"
                      >
                        {formBusy ? (
                          <>
                            <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
                            {signup ? t('auth.busyUp') : sendingCode ? t('auth.otp.sending') : t('auth.checking')}
                          </>
                        ) : (
                          <>
                            {signup ? t('auth.submitUp') : t('auth.submitIn')}
                            <span aria-hidden className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[#E8672A] text-white">
                              <ArrowRight size={14} strokeWidth={2.25} className={`absolute transition-transform duration-300 ${EASE_CSS} group-enabled:group-hover:translate-x-[220%]`} />
                              <ArrowRight size={14} strokeWidth={2.25} className={`absolute -translate-x-[220%] transition-transform duration-300 ${EASE_CSS} group-enabled:group-hover:translate-x-0`} />
                            </span>
                          </>
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </motion.form>

                {googleEnabled && (
                  <>
                    <div className="my-3 flex items-center gap-3 text-[12.5px] text-[#6E5B50] dark:text-gray-400">
                      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                      {t('auth.or')}
                      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setBusy(true); window.location.href = '/api/auth/google' }}
                      disabled={busy}
                      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-black/[0.09] bg-white text-[15px] font-medium text-[#1A1614] shadow-[0_1px_2px_rgba(26,22,20,0.05)] transition-[border-color,transform] duration-200 enabled:hover:-translate-y-px enabled:hover:border-black/25 disabled:opacity-70 dark:border-white/10 dark:bg-white/[0.05] dark:text-gray-50"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <GoogleG />}
                      {busy ? t('auth.googleBusy') : t('auth.google')}
                    </button>
                  </>
                )}
              </div>
              </>
              )}
            </div>
          </main>
        </div>

        <div className="relative hidden min-w-0 lg:block">
          <LivePanel />
        </div>
      </div>
    </div>
  )
}
