'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useReducedMotion,
} from 'framer-motion'
import {
  Accessibility,
  ArrowUp,
  Camera,
  Check,
  MapPin,
  Mic,
  Navigation,
  Pause,
  Play,
} from 'lucide-react'
import { KigaliLiveMap } from '@/components/landing/KigaliLiveMap'
import { LiveClock } from '@/components/landing/bits'
import { Flag } from '@/components/landing/flags'
import { APPLE_EASE, useScrollRoot } from '@/components/landing/scrollFx'
import { useI18n, type Lang } from '@/components/I18nProvider'

/**
 * The "living" layer of the landing page: loops that talk, count and move on
 * their own. Every loop here
 *   - runs only while it is on screen (no work behind the fold),
 *   - stops when the visitor presses the page's pause control (WCAG 2.2.2:
 *     anything that moves on its own for more than 5 s must be pausable),
 *   - starts paused for visitors who asked their OS for reduced motion.
 * Decorative loops are aria-hidden; the facts they illustrate are in the
 * surrounding text, so screen-reader users lose nothing.
 */

// ── Pause control ────────────────────────────────────────────────────────────

type LiveState = { paused: boolean; toggle: () => void }
const LiveContext = createContext<LiveState>({ paused: false, toggle: () => {} })

export function LiveProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [choice, setChoice] = useState<boolean | null>(null)
  const paused = choice ?? !!reduced
  return (
    <LiveContext.Provider value={{ paused, toggle: () => setChoice(!paused) }}>
      {children}
    </LiveContext.Provider>
  )
}

export function useLive() {
  return useContext(LiveContext)
}

export function PauseToggle({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { paused, toggle } = useLive()
  const { t } = useI18n()
  const label = paused ? t('landing.a11y.play') : t('landing.a11y.pause')
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={paused}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full backdrop-blur-xl transition-colors duration-200 ${tone === 'dark'
        ? 'bg-white/15 text-white hover:bg-white/25'
        : 'bg-white/85 text-[#1A1614] shadow-[0_1px_2px_rgba(26,22,20,0.08),0_6px_16px_-6px_rgba(26,22,20,0.2)] hover:bg-white dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15'} ${className}`}
    >
      {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
    </button>
  )
}

/** True while the element is on screen and the visitor has not paused motion. */
function useRunning(ref: RefObject<Element | null>, amount = 0.25) {
  const root = useScrollRoot()
  const inView = useInView(ref as RefObject<Element>, { root: root as RefObject<Element> | undefined, amount })
  const { paused } = useLive()
  return inView && !paused
}

/** Index that advances every `ms` while `running`. */
function useStepper(length: number, ms: number, running: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setI((v) => (v + 1) % length), ms)
    return () => clearInterval(id)
  }, [length, ms, running])
  return i
}

// ── Count-up number ──────────────────────────────────────────────────────────

/**
 * Counts from `from` to `to` each time it scrolls into view and resets when
 * it leaves, so it talks again on the way back. Screen readers get the final
 * value only.
 */
export function CountUp({ to, from = 0, suffix = '', className = '' }: { to: number; from?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const root = useScrollRoot()
  const inView = useInView(ref, { root: root as RefObject<Element> | undefined, amount: 0.6 })
  const { paused } = useLive()
  const [value, setValue] = useState(from)

  useEffect(() => {
    if (paused) { setValue(to); return }
    if (!inView) { setValue(from); return }
    const controls = animate(from, to, {
      duration: 1.8,
      ease: APPLE_EASE,
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [inView, paused, from, to])

  return (
    <span ref={ref} className={className}>
      <span aria-hidden className="tabular-nums">{value}{suffix}</span>
      <span className="sr-only">{to}{suffix}</span>
    </span>
  )
}

// ── Device frame ─────────────────────────────────────────────────────────────

/** Phone shell with a dynamic island and a status bar showing Kigali time. */
export function DeviceFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-[54px] bg-[#1A1614] p-[10px] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.12),0_2px_4px_rgba(26,22,20,0.12),0_40px_90px_-24px_rgba(90,40,10,0.45)] dark:shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.14),0_40px_90px_-24px_rgba(0,0,0,0.8)] ${className}`}>
      <div className="relative isolate h-full w-full overflow-hidden rounded-[44px] bg-[#F4EEE6] dark:bg-[#1A1816]">
        {children}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[700] flex h-12 items-center justify-between px-7 text-[13px] font-semibold text-[#1A1614]">
          <LiveClock timeZone="Africa/Kigali" bare />
          <span className="absolute left-1/2 top-2.5 h-[30px] w-[100px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-[2px]">
              {[4, 6, 8, 10].map((h) => <span key={h} className="w-[3px] rounded-[1px] bg-current" style={{ height: h }} />)}
            </span>
            <span className="ml-1 h-[11px] w-[22px] rounded-[3px] border border-current p-[1.5px]"><span className="block h-full w-3/4 rounded-[1px] bg-current" /></span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Live map layer ───────────────────────────────────────────────────────────

// Positions in % of the phone screen. The route stays in the upper half so
// the chat bubbles never cover it.
const ME = { x: 26, y: 40 }
const PLACE = { x: 66, y: 25 }
const ROUTE = `M${ME.x} ${ME.y} C 34 35, 40 41, 48 34 S 60 27, ${PLACE.x} ${PLACE.y}`
// Community reports popping up around the neighbourhood, one after another.
const REPORTS = [
  { x: 78, y: 42, d: '0s' },
  { x: 18, y: 22, d: '1.4s' },
  { x: 52, y: 50, d: '2.8s' },
  { x: 40, y: 17, d: '4.2s' },
]

/**
 * What makes the map feel live: the visitor's blue dot breathing, community
 * reports rippling in, and — once MapForAll answers — a walking route that
 * draws itself to the place, with a light travelling along it.
 */
function MapLiveLayer({ phase }: { phase: number }) {
  const routed = phase >= 2
  return (
    <div className="absolute inset-0 z-[630]">
      {REPORTS.map((r, i) => (
        <span key={i} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
          <span className="mf-report-ping absolute inset-0 rounded-full bg-[#E8672A]" style={{ animationDelay: r.d }} />
          <span className="mf-report-dot absolute inset-[3px] rounded-full border border-white bg-[#E8672A]" style={{ animationDelay: r.d }} />
        </span>
      ))}

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <AnimatePresence>
          {routed && (
            <motion.g key="route" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
              <path d={ROUTE} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity="0.9" />
              <motion.path
                d={ROUTE}
                fill="none"
                stroke="#E8672A"
                strokeWidth="4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.4, ease: APPLE_EASE }}
              />
              <path
                d={ROUTE}
                pathLength={100}
                fill="none"
                stroke="#FFF4EC"
                strokeWidth="6"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="mf-route-comet"
              />
            </motion.g>
          )}
        </AnimatePresence>
      </svg>

      {/* You are here */}
      <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2" style={{ left: `${ME.x}%`, top: `${ME.y}%` }}>
        <span className="mf-me-halo absolute -inset-3 rounded-full bg-[#3B82F6]/25" />
        <span className="absolute inset-0 rounded-full border-[2.5px] border-white bg-[#3B82F6] shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
      </span>

      {/* The answered place */}
      <AnimatePresence>
        {phase === 3 && (
          <motion.span
            key="ring"
            className="absolute h-6 w-6"
            style={{ left: `${PLACE.x}%`, top: `${PLACE.y}%`, x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-[#E8672A]/60" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-white bg-[#E8672A] text-white shadow-md">
              <Accessibility size={12} strokeWidth={2.5} />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Hero: the talking phone ──────────────────────────────────────────────────

// Phase lengths (ms) after typing: sent+thinking, answer, card, hold.
const PHASES = [1700, 2600, 4200]

/**
 * A live map in a phone. The visitor watches a question get typed, sent and
 * answered, then a verified place card slides up — then it starts over.
 */
export function TalkingDevice({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref, 0.2)
  const { paused } = useLive()
  const ask = t('landing.talk.ask')

  // phase 0 = typing, 1 = sent + thinking, 2 = answer, 3 = place card
  const [phase, setPhase] = useState(0)
  const [typed, setTyped] = useState(0)

  // A paused visitor sees the finished conversation, not an empty phone.
  useEffect(() => {
    if (paused) { setPhase(3); setTyped(ask.length) }
  }, [paused, ask.length])

  useEffect(() => {
    if (!running) return
    if (phase === 0) {
      if (typed < ask.length) {
        const id = setTimeout(() => setTyped((n) => n + 1), 38)
        return () => clearTimeout(id)
      }
      const id = setTimeout(() => setPhase(1), 450)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => {
      if (phase === 3) { setTyped(0); setPhase(0) } else setPhase(phase + 1)
    }, PHASES[phase - 1])
    return () => clearTimeout(id)
  }, [running, phase, typed, ask.length])

  const bubble = { initial: { opacity: 0, y: 14, scale: 0.96, filter: 'blur(6px)' }, animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }, exit: { opacity: 0, y: -8, filter: 'blur(6px)' }, transition: { duration: 0.55, ease: APPLE_EASE } }

  return (
    <div ref={ref} className={className}>
      <p className="sr-only">{t('landing.a11y.deviceDesc')}</p>
      <DeviceFrame className="aspect-[9/18.5] w-full">
        {/* The map and its live layer drift together, so overlays stay put
            on the streets while the whole view breathes. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="mf-map-breathe absolute inset-0">
            <div className="absolute inset-0 [&_.leaflet-control-attribution]:hidden">
              <KigaliLiveMap zoom={16} />
            </div>
            <MapLiveLayer phase={phase} />
          </div>
        </div>
        <span aria-hidden className="pointer-events-none absolute right-5 top-12 z-[650] rounded-full bg-white/80 px-2 py-0.5 text-[9px] text-[#6E5B50] backdrop-blur">© OpenStreetMap</span>

        <div aria-hidden className="absolute inset-x-0 bottom-0 z-[660] flex flex-col gap-2 bg-gradient-to-t from-[#F4EEE6] via-[#F4EEE6]/85 to-transparent px-3.5 pb-4 pt-16">
          <AnimatePresence mode="popLayout">
            {phase >= 1 && (
              <motion.div key="q" layout {...bubble} className="ml-auto max-w-[82%] rounded-[20px] rounded-br-md bg-[#1A1614] px-3.5 py-2 text-[13px] leading-snug text-white">
                {ask}
              </motion.div>
            )}
            {phase === 1 && (
              <motion.div key="thinking" layout {...bubble} className="flex w-fit items-center gap-2 rounded-[20px] rounded-bl-md bg-white px-3.5 py-2.5 text-[12px] text-[#6E5B50] shadow-sm">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#E8672A]" style={{ animation: `scan 1s ease-in-out ${i * 0.15}s infinite` }} />
                  ))}
                </span>
                {t('landing.talk.thinking')}
              </motion.div>
            )}
            {phase >= 2 && (
              <motion.div key="a" layout {...bubble} className="max-w-[88%] rounded-[20px] rounded-bl-md bg-white px-3.5 py-2 text-[13px] leading-snug text-[#1A1614] shadow-sm">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#B8441A]">{t('landing.talk.app')}</span>
                {t('landing.talk.answer')}
              </motion.div>
            )}
            {phase === 3 && (
              <motion.div key="card" layout {...bubble} className="flex items-center gap-3 rounded-[22px] bg-white p-2.5 shadow-[0_10px_30px_-10px_rgba(26,22,20,0.35)]">
                <img src="/landing/kigali-ramp.jpg" alt="" className="h-12 w-12 rounded-[14px] object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-tight text-[#1A1614]">{t('landing.hero.card2Title')}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-[#6E5B50]">
                    <Check size={11} strokeWidth={3} className="shrink-0 text-[#1F8A5B]" />
                    {t('landing.hero.card2Meta')}
                  </span>
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A1614] text-white">
                  <Navigation size={14} strokeWidth={2.25} />
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Composer */}
          <div className="mt-1 flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-4 pr-1.5 shadow-[0_4px_16px_-6px_rgba(26,22,20,0.25)]">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${phase === 0 && typed > 0 ? 'text-[#1A1614]' : 'text-[#8A7364]'}`}>
              {phase === 0 && typed > 0 ? ask.slice(0, typed) : t('landing.talk.placeholder')}
              {phase === 0 && typed > 0 && <span className="ml-px inline-block h-3.5 w-[1.5px] translate-y-0.5 bg-[#E8672A]" style={{ animation: 'caret-blink 1s step-end infinite' }} />}
            </span>
            <Mic size={16} className="shrink-0 text-[#6E5B50]" />
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-colors duration-300 ${phase === 0 && typed === ask.length ? 'bg-[#E8672A]' : 'bg-[#1A1614]/25'}`}>
              <ArrowUp size={16} strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </DeviceFrame>
    </div>
  )
}

// ── Hero: iOS-style notifications ────────────────────────────────────────────

/**
 * A notification that swaps every few seconds, stacked like iOS banners.
 * `offset` lets two instances show different items side by side.
 */
export function NotificationBanner({ offset = 0, className = '', compact = false }: { offset?: number; className?: string; compact?: boolean }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref, 0.1)
  const items = [1, 2, 3].map((n) => ({ title: t(`landing.talk.n${n}Title`), meta: t(`landing.talk.n${n}Meta`), n }))
  const i = (useStepper(items.length, 3800, running) + offset) % items.length
  const item = items[i]
  const Icon = item.n === 1 ? Accessibility : item.n === 2 ? MapPin : Check

  return (
    <div ref={ref} aria-hidden className={`relative h-[74px] ${className}`}>
      {/* the stacked card peeking underneath, like an iOS notification group */}
      <span className="absolute inset-x-3 -bottom-1.5 h-full rounded-[22px] bg-white/50 shadow-sm backdrop-blur-xl dark:bg-white/[0.06]" />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={item.n}
          initial={{ opacity: 0, y: -18, scale: 0.94, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 12, scale: 0.96, filter: 'blur(8px)' }}
          transition={{ duration: 0.7, ease: APPLE_EASE }}
          className="absolute inset-0 flex items-center gap-3 rounded-[22px] border border-white/60 bg-white/80 px-3.5 shadow-[0_12px_32px_-12px_rgba(90,40,10,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#231F1B]/85"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#E8672A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
            <Icon size={19} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-[#1A1614] dark:text-gray-50">{item.title}</span>
              {!compact && <span className="shrink-0 text-[11px] text-[#6E5B50] dark:text-gray-400">MapForAll</span>}
            </span>
            <span className="block truncate text-[12px] text-[#6E5B50] dark:text-gray-400">{item.meta}</span>
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── Community ticker ─────────────────────────────────────────────────────────

const TICKER_ICONS = [Accessibility, MapPin, Accessibility, Check, Accessibility, MapPin, Check]

/** Endless belt of the kinds of things the community reports, with a pause button. */
export function CommunityTicker() {
  const { t } = useI18n()
  const { paused } = useLive()
  const items = [1, 2, 3, 4, 5, 6, 7].map((n) => t(`landing.ticker.i${n}`))
  const row = (copy: boolean) => (
    <ul aria-hidden={copy || undefined} className="flex shrink-0 items-center gap-3 pr-3">
      {items.map((label, i) => {
        const Icon = TICKER_ICONS[i]
        return (
          <li key={label} className="flex shrink-0 items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#1A1614] dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100">
            <Icon size={15} strokeWidth={2.25} className="text-[#D4581F]" />
            {label}
          </li>
        )
      })}
    </ul>
  )
  return (
    <section aria-label={t('landing.ticker.label')} className="border-y border-black/[0.05] bg-[#F7EDDF] py-5 dark:border-white/[0.06] dark:bg-[#161310]">
      <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-5 sm:px-8 lg:px-12">
        <span className="hidden shrink-0 items-center gap-2 text-[13px] font-semibold text-[#1A1614] dark:text-gray-100 md:flex">
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full bg-[#E8672A] opacity-60 ${paused ? '' : 'animate-ping'}`} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8672A]" />
          </span>
          {t('landing.ticker.label')}
        </span>
        <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
          <div className="landing-marquee flex w-max" style={{ animationPlayState: paused ? 'paused' : 'running', animationDuration: '40s' }}>
            {row(false)}
            {row(true)}
          </div>
        </div>
        <PauseToggle />
      </div>
    </section>
  )
}

// ── Bento tile animations ────────────────────────────────────────────────────

/** Search results where the local shops climb above the big chain. */
export function RankingDemo() {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref)
  const flip = useStepper(2, 2600, running)
  const chain = { id: 'chain', label: t('landing.bento.rank3'), local: false }
  const corner = { id: 'corner', label: t('landing.bento.rank2'), local: true }
  const jean = { id: 'jean', label: t('landing.bento.rank1'), local: true }
  const order = flip ? [jean, corner, chain] : [chain, corner, jean]

  return (
    <div ref={ref} aria-hidden className="relative">
      <ol className="flex flex-col gap-2">
        {order.map((item, i) => (
          <motion.li
            key={item.id}
            layout
            transition={{ duration: 0.8, ease: APPLE_EASE }}
            className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${item.local ? 'bg-[#FBF3E7] dark:bg-white/[0.06]' : 'bg-black/[0.03] dark:bg-white/[0.03]'}`}
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${i === 0 ? 'bg-[#1A1614] text-white dark:bg-white dark:text-[#1A1614]' : 'bg-black/[0.06] text-[#6E5B50] dark:bg-white/10 dark:text-gray-400'}`}>{i + 1}</span>
            <span className={`flex-1 text-[14px] font-medium ${item.local ? 'text-[#1A1614] dark:text-gray-50' : 'text-[#6E5B50] dark:text-gray-400'}`}>{item.label}</span>
            {item.local && <span className="rounded-full bg-[#E8672A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#B8441A] dark:text-[#FF9A63]">{t('landing.bento.localTag')}</span>}
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

/** Voice waveform + the spoken question. */
export function VoiceDemo() {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref)
  const bars = [0.35, 0.6, 0.9, 0.5, 1, 0.7, 0.4, 0.85, 0.55, 0.95, 0.45, 0.75, 0.3, 0.65, 0.9, 0.5, 0.8, 0.4]
  return (
    <div ref={ref} aria-hidden className="flex flex-col items-center gap-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#1A1614] text-white dark:bg-white dark:text-[#1A1614]">
          {running && <span className="absolute inset-0 animate-ping rounded-full bg-[#E8672A]/30" />}
          <Mic size={22} />
        </span>
        <span className="flex h-12 items-center gap-[3px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-[4px] origin-center rounded-full bg-gradient-to-t from-[#D4581F] to-[#F29A5C]"
              style={{ height: `${h * 44}px`, animation: `waveBar ${0.9 + (i % 4) * 0.12}s ease-in-out ${i * 0.06}s infinite`, animationPlayState: running ? 'running' : 'paused' }}
            />
          ))}
        </span>
      </div>
      <span className="rounded-[18px] rounded-bl-md bg-[#FBF3E7] px-4 py-2.5 text-[15px] font-medium text-[#1A1614] dark:bg-white/[0.06] dark:text-gray-50">
        « {t('landing.bento.voicePrompt')} »
      </span>
    </div>
  )
}

const GREETINGS: { lang: Lang; word: string }[] = [
  { lang: 'rw', word: 'Muraho' },
  { lang: 'fr', word: 'Bonjour' },
  { lang: 'en', word: 'Hello' },
]

/** Muraho → Bonjour → Hello, each with its flag. */
export function GreetingCycler() {
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref)
  const g = GREETINGS[useStepper(GREETINGS.length, 1900, running)]
  return (
    <div ref={ref} aria-hidden className="relative flex h-[76px] items-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={g.word}
          initial={{ opacity: 0, y: 36, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -36, filter: 'blur(10px)' }}
          transition={{ duration: 0.7, ease: APPLE_EASE }}
          className="flex items-center gap-3"
        >
          <Flag lang={g.lang} className="h-[26px] w-[39px] rounded-[5px]" />
          <span className="text-[36px] font-semibold tracking-[-0.03em] text-[#1A1614] dark:text-gray-50">{g.word}</span>
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

/** Pin → photo → live, ticking through. */
export function AddPlaceDemo() {
  const { t } = useI18n()
  const ref = useRef<HTMLOListElement>(null)
  const running = useRunning(ref)
  const step = useStepper(4, 1300, running) // 0..3, 3 = all done
  const steps = [
    { label: t('landing.bento.addStep1'), Icon: MapPin },
    { label: t('landing.bento.addStep2'), Icon: Camera },
    { label: t('landing.bento.addStep3'), Icon: Check },
  ]
  return (
    <ol ref={ref} aria-hidden className="flex flex-col gap-2.5">
      {steps.map(({ label, Icon }, i) => {
        const done = step > i || (!running && true)
        const active = running && step === i
        return (
          <li key={label} className="flex items-center gap-3">
            <span className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-500 ${done ? 'bg-[#1A1614] text-white dark:bg-white dark:text-[#1A1614]' : active ? 'bg-[#E8672A] text-white' : 'bg-black/[0.05] text-[#6E5B50] dark:bg-white/10 dark:text-gray-400'}`}>
              {active && <span className="absolute inset-0 animate-ping rounded-full bg-[#E8672A]/40" />}
              {done ? <Check size={16} strokeWidth={2.75} /> : <Icon size={16} strokeWidth={2.25} />}
            </span>
            <span className={`text-[15px] font-medium transition-colors duration-500 ${done || active ? 'text-[#1A1614] dark:text-gray-50' : 'text-[#6E5B50] dark:text-gray-400'}`}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

const AVATARS = [
  { i: 'A', bg: '#E8672A' },
  { i: 'J', bg: '#1A1614' },
  { i: 'M', bg: '#B8441A' },
  { i: 'E', bg: '#6E5B50' },
  { i: 'K', bg: '#D4581F' },
]

/** Faces stacking up next to a confirmation counter. */
export function ConfirmDemo() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="flex -space-x-2.5">
        {AVATARS.map((a, i) => (
          <motion.span
            key={a.i}
            initial={{ opacity: 0, x: -10, scale: 0.8 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ amount: 0.6 }}
            transition={{ duration: 0.6, delay: i * 0.09, ease: APPLE_EASE }}
            className="flex h-10 w-10 items-center justify-center rounded-full border-[2.5px] border-white text-[14px] font-semibold text-white dark:border-[#1C1916]"
            style={{ backgroundColor: a.bg }}
          >
            {a.i}
          </motion.span>
        ))}
      </span>
      <span className="text-[15px] text-[#6E5B50] dark:text-gray-400">
        <CountUp to={12} className="mr-1 text-[28px] font-semibold tracking-[-0.02em] text-[#1A1614] dark:text-gray-50" />
        {t('landing.bento.trustCount')}
      </span>
    </div>
  )
}

/** Small bar chart that grows each time it is seen (business preview card). */
export function GrowingBars() {
  const heights = [34, 48, 40, 62, 55, 78, 92]
  return (
    <span aria-hidden className="flex h-[92px] items-end gap-2">
      {heights.map((h, i) => (
        <motion.span
          key={i}
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ amount: 0.8 }}
          transition={{ duration: 0.9, delay: i * 0.07, ease: APPLE_EASE }}
          className={`w-full origin-bottom rounded-t-[6px] ${i === heights.length - 1 ? 'bg-[#E8672A]' : 'bg-[#1A1614]/15 dark:bg-white/15'}`}
          style={{ height: `${h}%` }}
        />
      ))}
    </span>
  )
}
