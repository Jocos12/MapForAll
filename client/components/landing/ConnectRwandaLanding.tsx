'use client'

/**
 * ConnectRwanda AI landing page.
 *
 * Dark and light "smart mobility" design built only for ConnectRwanda AI.
 * Every scene about movement uses the real Leaflet map of Kigali
 * (components/landing/CityMap.tsx) from a different angle; aerial imagery
 * of Kigali (Esri World Imagery tiles) is used as section backgrounds.
 *
 * Performance: the hero film writes its progress bar through refs (no
 * React render per frame), decorative glows are plain radial gradients (no
 * animated CSS blur), and maps animate at ~30 fps only while visible.
 *
 * The page scrolls inside its own container (`scroller`) because the app's
 * global CSS keeps <html>/<body> at overflow:hidden for the chat screens.
 * Texts: client/locales/*.json under `cr.*` (some reuse `landing.*`).
 */

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import {
  Accessibility, ArrowRight, ArrowUp, BadgeCheck, Bus, Check, Clock, Cpu, Footprints, Languages, Menu, Mic, Moon, Navigation,
  Pause, Play, Radio, Satellite, Search, Smartphone, Sparkles, Store, Sun, Users, X,
} from 'lucide-react'
import { useI18n, type Lang } from '@/components/I18nProvider'
import { JOURNEY_CAMERA, type AccessType, type Camera, type Layers, type MapLabels, type Pal } from '@/components/landing/CityMap'

const CityMap = dynamic(() => import('@/components/landing/CityMap'), { ssr: false })

/* ── Themes ────────────────────────────────────────────────────────────── */
type Theme = 'dark' | 'light'
type Palette = Pal & {
  bg2: string; surface2: string; field: string; faint: string; yellowText: string; grid: string
  glass: string; glassLine: string; shadow: string; glow: string; veil: string; veil2: string
}
const DARK: Palette = {
  bg: '#050A16', bg2: '#081022', surface: '#0C1629', surface2: '#111E36', field: '#070E1E',
  line: 'rgba(148,178,255,0.14)', text: '#EAF1FF', muted: '#9AABCB', faint: '#7387AB', grid: 'rgba(148,178,255,0.16)',
  blue: '#21B3F2', green: '#22C47A', yellow: '#FAD201', yellowText: '#FAD201', violet: '#B48CFF', red: '#FF6B6B',
  glass: 'rgba(16,28,52,0.78)', glassLine: 'rgba(255,255,255,0.10)',
  shadow: '0 30px 80px -50px rgba(0,0,0,0.9)', glow: '33', veil: 'rgba(5,10,22,0.80)', veil2: 'rgba(5,10,22,0.95)',
}
/* Light: same character as the dark theme (glows, gradients, depth) on a
 * cool "morning sky" background with crisp white cards. */
const LIGHT: Palette = {
  bg: '#EEF3F9', bg2: '#F8FAFD', surface: '#FFFFFF', surface2: '#F2F6FB', field: '#F6F9FC',
  line: 'rgba(15,30,60,0.10)', text: '#08122B', muted: '#3A4A68', faint: '#5A6A85', grid: 'rgba(15,30,60,0.12)',
  blue: '#0077C8', green: '#0B8A50', yellow: '#F5C400', yellowText: '#7A5E00', violet: '#5B3FD0', red: '#C42F2F',
  glass: 'rgba(255,255,255,0.88)', glassLine: 'rgba(255,255,255,1)',
  shadow: '0 1px 2px rgba(15,30,60,0.06), 0 24px 60px -30px rgba(15,40,90,0.30)', glow: '2a', veil: 'rgba(238,243,249,0.84)', veil2: 'rgba(238,243,249,0.96)',
}
const PalCtx = createContext<Palette>(DARK)
const usePal = () => useContext(PalCtx)

const EASE = [0.22, 1, 0.36, 1] as const
const DISPLAY = 'font-[family-name:var(--font-display)]'
const SECTION = 'relative scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32 lg:px-12'
const WRAP = 'relative mx-auto w-full max-w-[1200px]'
const LEAD = 'text-[16px] leading-relaxed text-[var(--muted)] sm:text-[18px]'
const CARD = 'rounded-[28px] border border-[var(--line)] bg-[var(--surface)] [box-shadow:var(--shadow)]'
const H2 = `${DISPLAY} text-[clamp(2rem,4.6vw,3.6rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-[var(--text)]`

const CSS = `
@keyframes cr-ping { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(2.6); opacity: 0 } }
@keyframes cr-travel { 0% { transform: translateX(0); opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } 100% { transform: translateX(100%); opacity: 0 } }
@keyframes cr-bar { 0%, 100% { transform: scaleY(0.3) } 50% { transform: scaleY(1) } }
.cr-bar { transform-origin: bottom; animation: cr-bar 1.4s ease-in-out infinite; will-change: transform; }
@keyframes cr-spin { to { transform: rotate(360deg) } }
@keyframes cr-marquee { to { transform: translateX(-50%) } }
@keyframes cr-dash { to { stroke-dashoffset: -40; } }
.cr-dash { stroke-dasharray: 6 14; animation: cr-dash 1.6s linear infinite; }
.cr-ping-html { animation: cr-ping 2.4s ease-out infinite; }
.cr-travel { animation: cr-travel 2.8s cubic-bezier(.45,0,.2,1) infinite; }
.cr-spin { animation: cr-spin 60s linear infinite; transform-box: fill-box; transform-origin: center; }
.cr-marquee { animation: cr-marquee 70s linear infinite; will-change: transform; }
.cr-marquee-wrap:hover .cr-marquee { animation-play-state: paused; }
.cr-map { width: 100%; height: 100%; background: var(--surface2); isolation: isolate; z-index: 0; contain: layout paint; }
.cr-map.leaflet-container { font-family: inherit; background: var(--surface2); }
.cr-leaf.leaflet-div-icon { background: transparent; border: 0; }
.cr-bus { display:flex; align-items:center; justify-content:center; width:40px; height:22px; border-radius:7px; background:var(--c); color:#050A16; font:700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow:0 0 0 2px rgba(5,10,22,.55), 0 6px 18px -4px var(--c); }
.cr-you { position:relative; display:block; width:22px; height:22px; border-radius:50%; background:var(--c); border:3px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.15); }
.cr-you i { position:absolute; inset:-3px; border-radius:50%; background:var(--c); opacity:.4; animation: cr-ping 2.2s ease-out infinite; }
.cr-walker { display:block; width:18px; height:18px; border-radius:50%; background:var(--c); border:3px solid #fff; box-shadow:0 0 0 6px color-mix(in srgb, var(--c) 30%, transparent); }
.cr-dest { display:block; width:26px; height:34px; background:var(--c); clip-path: path('M13 0C5.8 0 0 5.6 0 12.6 0 22 13 34 13 34s13-12 13-21.4C26 5.6 20.2 0 13 0z'); }
.cr-a11y { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; background:var(--c); border:2px solid rgba(5,10,22,.85); box-shadow:0 8px 20px -6px var(--c); }
.cr-a11y.cr-pulse { animation: cr-a11y-pulse 1.1s ease-out; }
@keyframes cr-a11y-pulse { 0% { box-shadow: 0 0 0 0 var(--c) } 100% { box-shadow: 0 0 0 18px transparent } }
.cr-tip.leaflet-tooltip { background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 5px 9px; font-size: 12px; font-weight: 600; box-shadow: 0 10px 30px -10px rgba(0,0,0,.45); }
.cr-tip.leaflet-tooltip-top:before { border-top-color: var(--surface); }
.cr-pop .leaflet-popup-content-wrapper { background: var(--text); color: var(--bg); border-radius: 999px; font-size: 12px; box-shadow: 0 10px 30px -10px rgba(0,0,0,.5); }
.cr-pop .leaflet-popup-content { margin: 6px 12px; }
.cr-pop .leaflet-popup-tip { background: var(--text); }
.cr-map .leaflet-control-zoom a { background: var(--surface); color: var(--text); border-color: var(--line); }
.cr-map .leaflet-control-attribution { background: color-mix(in srgb, var(--surface) 80%, transparent); color: var(--faint); font-size: 10px; }
.cr-map .leaflet-control-attribution a { color: var(--muted); }
.cr-film .leaflet-control-attribution { display: none; }
.cr-gradtext { -webkit-background-clip: text; background-clip: text; color: transparent; }
@media (prefers-reduced-motion: reduce) {
  .cr-dash, .cr-ping-html, .cr-travel, .cr-spin, .cr-marquee, .cr-you i, .cr-bar { animation: none !important; }
}
`

/* ── Scrolling inside the page container ───────────────────────────────── */
function scrollToHash(root: HTMLElement | null, hash: string) {
  if (!root) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (hash === '#top') {
    root.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    history.replaceState(null, '', ' ')
    return true
  }
  const el = root.querySelector(hash) as HTMLElement | null
  if (!el) return false
  const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 68
  root.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
  history.replaceState(null, '', hash)
  return true
}
const ScrollCtx = createContext<React.RefObject<HTMLDivElement>>({ current: null })
function useGoTo() {
  const ref = useContext(ScrollCtx)
  return (hash: string) => scrollToHash(ref.current, hash)
}

/* ── Motion primitives ─────────────────────────────────────────────────── */
function useTicker(ms: number, active = true) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => { if (!document.hidden) setN((x) => x + 1) }, ms)
    return () => window.clearInterval(id)
  }, [ms, active])
  return n
}

function Reveal({ children, delay = 0, className = '', y = 26 }: { children: React.ReactNode; delay?: number; className?: string; y?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.1 })
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y }} animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }} transition={{ duration: 0.55, ease: EASE, delay }}>
      {children}
    </motion.div>
  )
}

function Unveil({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.15 })
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={{ duration: 0.6, ease: EASE, delay }}>
      {children}
    </motion.div>
  )
}

function Heading({ text, className = H2 }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const words = text.split(' ')
  return (
    <h2 ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} aria-hidden className="inline-block overflow-hidden pb-[0.1em] align-bottom">
          <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: inView ? '0%' : '110%' }} transition={{ duration: 0.55, ease: EASE, delay: Math.min(i * 0.03, 0.3) }}>
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </h2>
  )
}

/** Section label: a pill with the section number and name (no rule line). */
function Eyebrow({ children, color, index }: { children: React.ReactNode; color: string; index?: string }) {
  return (
    <span className="mb-5 inline-flex items-center gap-2.5 rounded-full border py-1 pl-1 pr-3.5 text-[12px] font-semibold uppercase tracking-[0.14em]"
      style={{ color, borderColor: `${color}40`, background: `${color}12`, paddingLeft: index ? 4 : 14 }}>
      {index && <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 font-mono text-[11px] text-white" style={{ background: color }}>{index}</span>}
      {children}
    </span>
  )
}

function CountUp({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!inView) return
    let raf = 0
    const start = performance.now()
    const run = (now: number) => {
      const k = Math.min((now - start) / 1600, 1)
      setV(Math.round(to * (1 - Math.pow(1 - k, 4))))
      if (k < 1) raf = requestAnimationFrame(run)
    }
    raf = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf)
  }, [inView, to])
  return <span ref={ref}>{prefix}{v}{suffix}</span>
}

/** Mounts its children only when they come near the screen (maps are heavy). */
function Lazy({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useInView(ref, { once: true, margin: '600px 0px' })
  return <div ref={ref} className={className}>{near ? children : null}</div>
}

/** Soft coloured light drawn with a radial gradient (no CSS blur: cheap to paint). */
function Glow({ color, className }: { color: string; className: string }) {
  const P = usePal()
  return <div aria-hidden className={`pointer-events-none absolute rounded-full ${className}`} style={{ background: `radial-gradient(closest-side, ${color}${P.glow}, transparent)` }} />
}

/** Real aerial photo of Kigali, assembled from Esri World Imagery tiles. */
function KigaliAerial({ lat, lng, z = 16, cols = 7, rows = 4 }: { lat: number; lng: number; z?: number; cols?: number; rows?: number }) {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const x0 = Math.floor(x) - Math.floor(cols / 2)
  const y0 = Math.floor(y) - Math.floor(rows / 2)
  const cx = Math.floor(cols / 2) * 256 + (x - Math.floor(x)) * 256
  const cy = Math.floor(rows / 2) * 256 + (y - Math.floor(y)) * 256
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute grid" style={{ gridTemplateColumns: `repeat(${cols}, 256px)`, left: `calc(50% - ${cx}px)`, top: `calc(50% - ${cy}px)`, transform: 'scale(1.3)', transformOrigin: `${cx}px ${cy}px` }}>
        {Array.from({ length: rows }).flatMap((_, ri) => Array.from({ length: cols }).map((__, ci) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${ri}-${ci}`} alt="" width={256} height={256} loading="lazy" decoding="async" className="block h-[256px] w-[256px]"
            src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y0 + ri}/${x0 + ci}`} />
        )))}
      </div>
    </div>
  )
}

/* ── Brand ─────────────────────────────────────────────────────────────── */
export function CRMark({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`r${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#22C47A" />
          <stop offset="1" stopColor="#21B3F2" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="#0B1630" stroke="rgba(255,255,255,0.14)" />
      <path d="M27.78 27.78 A11 11 0 1 1 27.78 12.22" fill="none" stroke={`url(#r${id})`} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="27.78" cy="12.22" r="3.4" fill="#FAD201" stroke="#0B1630" strokeWidth="1.6" />
      <circle cx="20" cy="20" r="2.6" fill="#EAF1FF" />
    </svg>
  )
}
function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      <CRMark size={size === 'lg' ? 40 : 34} />
      <span className={`${DISPLAY} ${size === 'lg' ? 'text-[19px]' : 'text-[17px]'} font-semibold tracking-[-0.02em] text-[var(--text)]`}>ConnectRwanda</span>
      <span className="rounded-md border border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-[var(--muted)]">AI</span>
    </span>
  )
}

function RwandaFlag({ className = '', animated = false }: { className?: string; animated?: boolean }) {
  const rays = Array.from({ length: 48 }).map((_, i) => {
    const r = i % 2 === 0 ? 112 : 74
    const a = (i * Math.PI) / 24 - Math.PI / 2
    return `${846 + r * Math.cos(a)},${186 + r * Math.sin(a)}`
  }).join(' ')
  const band = (y: number, h: number, fill: string, delay: number) => animated
    ? <motion.rect x="0" y={y} width="1080" height={h} fill={fill} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.1, ease: EASE, delay }} style={{ transformOrigin: '0px 0px' }} />
    : <rect x="0" y={y} width="1080" height={h} fill={fill} />
  return (
    <svg viewBox="0 0 1080 720" className={className} role="img" aria-label="Flag of Rwanda" preserveAspectRatio="xMidYMid slice">
      {band(0, 360, '#00A1DE', 0)}
      {band(360, 180, '#FAD201', 0.15)}
      {band(540, 180, '#20603D', 0.3)}
      <motion.g initial={animated ? { scale: 0, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.7 }} style={{ transformOrigin: '846px 186px' }}>
        <g className={animated ? 'cr-spin' : ''}><polygon points={rays} fill="#E5BE01" /></g>
        <circle cx="846" cy="186" r="66" fill="#00A1DE" />
        <circle cx="846" cy="186" r="56" fill="#E5BE01" />
      </motion.g>
    </svg>
  )
}

/* ── Controls ──────────────────────────────────────────────────────────── */
function Button({ href, children, variant = 'primary', className = '' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'ghost'; className?: string }) {
  const goTo = useGoTo()
  const base = 'group relative inline-flex min-h-[50px] items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full px-6 text-[15px] font-semibold transition-all duration-300 active:scale-[0.97]'
  const look = variant === 'primary'
    ? 'bg-[var(--yellow)] text-[#050A16] shadow-[0_14px_40px_-14px_rgba(242,197,0,0.8)] hover:shadow-[0_18px_50px_-12px_rgba(242,197,0,0.95)]'
    : 'border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] [box-shadow:var(--shadow)] hover:border-[var(--muted)]'
  const inner = (
    <>
      {variant === 'primary' && <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />}
      <span className="relative">{children}</span>
      <ArrowRight size={17} className="relative transition-transform duration-300 group-hover:translate-x-1" />
    </>
  )
  return href.startsWith('#')
    ? <a href={href} onClick={(e) => { if (goTo(href)) e.preventDefault() }} className={`${base} ${look} ${className}`}>{inner}</a>
    : <Link href={href} className={`${base} ${look} ${className}`}>{inner}</Link>
}

const LANGS: Lang[] = ['rw', 'fr', 'en']
function LangSwitch({ id }: { id: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="radiogroup" aria-label={t('landing.nav.lang')} className="relative flex shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5">
      {LANGS.map((code) => (
        <button key={code} type="button" role="radio" aria-checked={lang === code} onClick={() => setLang(code)}
          className={`relative min-h-[32px] rounded-full px-2.5 text-[12px] font-semibold uppercase tracking-wide transition-colors ${lang === code ? 'text-[var(--bg)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
          {lang === code && <motion.span layoutId={`cr-lang-${id}`} className="absolute inset-0 rounded-full bg-[var(--text)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative">{code}</span>
        </button>
      ))}
    </div>
  )
}

function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const { t } = useI18n()
  const label = t(theme === 'dark' ? 'cr.theme.light' : 'cr.theme.dark')
  return (
    <button type="button" onClick={onToggle} aria-label={label} title={label}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--text)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 16, rotate: -90, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: -16, rotate: 90, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/* ── Hero film ─────────────────────────────────────────────────────────── */
type Scene = { key: string; ms: number; layers: Layers; camera: Camera; rx: number; rz: number; s: number; shade: number }
const SCENES: Scene[] = [
  { key: 'intro', ms: 5200, layers: { lines: true }, camera: { center: [-1.9500, 30.0850], zoom: 12.6 }, rx: 0, rz: 0, s: 1, shade: 0.5 },
  { key: 'problem', ms: 5600, layers: {}, camera: { center: [-1.9520, 30.0780], zoom: 13.2 }, rx: 0, rz: 0, s: 1.04, shade: 0.45 },
  { key: 'buses', ms: 6600, layers: { lines: true, buses: true }, camera: { center: [-1.9480, 30.0880], zoom: 13.4 }, rx: 34, rz: -10, s: 1.06, shade: 0 },
  { key: 'navigate', ms: 7200, layers: { journey: true, you: true }, camera: JOURNEY_CAMERA, rx: 28, rz: 7, s: 1.05, shade: 0 },
  { key: 'voice', ms: 6200, layers: { journey: true }, camera: JOURNEY_CAMERA, rx: 0, rz: 0, s: 1.1, shade: 0.6 },
  { key: 'access', ms: 6400, layers: { access: true }, camera: { center: [-1.9505, 30.0930], zoom: 14.2 }, rx: 24, rz: -5, s: 1.05, shade: 0 },
  { key: 'outro', ms: 5600, layers: { lines: true, buses: true }, camera: { center: [-1.9500, 30.0850], zoom: 12.8 }, rx: 0, rz: 0, s: 1, shade: 0.55 },
]
const FILM_TOTAL = SCENES.reduce((a, s) => a + s.ms, 0)
const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

function HeroFilm({ theme, labels }: { theme: Theme; labels: MapLabels }) {
  const { t } = useI18n()
  const P = usePal()
  const reduce = useReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  const onScreen = useInView(box, { amount: 0.25 })
  const [playing, setPlaying] = useState(true)
  const [scene, setScene] = useState(0)
  const elapsed = useRef(0)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const clock = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (reduce) setPlaying(false) }, [reduce])
  /* The intro scene is the flag, so the map can wait until the page is
   * interactive: the first paint and the first clicks stay instant. */
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) { w.requestIdleCallback(() => setMapReady(true), { timeout: 1500 }); return }
    const id = window.setTimeout(() => setMapReady(true), 900)
    return () => window.clearTimeout(id)
  }, [])

  /* progress is written straight to the DOM: no React render per frame */
  useEffect(() => {
    // Only transforms change per frame (no layout); the clock text changes once per second.
    const before = SCENES.slice(0, scene).reduce((a, s) => a + s.ms, 0)
    const paint = () => {
      bars.current.forEach((el, i) => { if (el) el.style.transform = `scaleX(${i < scene ? 1 : i === scene ? Math.min(elapsed.current / SCENES[scene].ms, 1) : 0})` })
      const text = `${fmt(before + elapsed.current)} / ${fmt(FILM_TOTAL)}`
      if (clock.current && clock.current.textContent !== text) clock.current.textContent = text
    }
    paint()
    if (!playing || !onScreen) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      elapsed.current += Math.min(now - last, 100)
      last = now
      if (elapsed.current >= SCENES[scene].ms) {
        elapsed.current = 0
        setScene((s) => (s + 1) % SCENES.length)
        return
      }
      paint()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, onScreen, scene])

  const sc = SCENES[scene]
  const jump = (i: number) => { elapsed.current = 0; setScene(i) }
  const panel = 'rounded-2xl border border-white/15 bg-[#0A1326]/90 text-white shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]'

  return (
    <div ref={box} style={{ contain: 'layout paint' }} className="cr-film relative overflow-hidden rounded-[30px] border border-[var(--line)] bg-[#050A16] [box-shadow:var(--shadow)]" role="region" aria-label={t('cr.film.label')}>
      <div className="relative aspect-[16/11] w-full overflow-hidden sm:aspect-[16/10]">
        <motion.div className="absolute inset-[-16%]" animate={{ rotateX: sc.rx, rotateZ: sc.rz, scale: sc.s }} transition={{ duration: reduce ? 0 : 1.6, ease: EASE }} style={{ transformPerspective: 1400 }}>
          {mapReady && <CityMap theme={theme} pal={P} labels={labels} layers={sc.layers} camera={sc.camera} interactive={false} />}
        </motion.div>
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-[#050A16]" animate={{ opacity: sc.shade }} transition={{ duration: 1 }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,22,0.6)_0%,transparent_20%,transparent_55%,rgba(5,10,22,0.9)_100%)]" />

        <AnimatePresence mode="wait">
          <motion.div key={sc.key} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            {sc.key === 'intro' && (
              <div className="absolute inset-0">
                <motion.div className="absolute inset-0" initial={{ scale: 1.06 }} animate={{ scale: 1 }} transition={{ duration: 5.2, ease: 'linear' }}>
                  <RwandaFlag animated className="h-full w-full" />
                </motion.div>
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,22,0.35),rgba(5,10,22,0.1)_40%,rgba(5,10,22,0.88))]" />
                {/* title sits in the free space between the top bar and the captions */}
                <div className="absolute inset-x-0 bottom-[36%] top-12 flex flex-col items-start justify-center px-6 text-white sm:px-10">
                  <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.8 }} className="rounded-full bg-black/35 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-white/90">Kigali · Rwanda · 07:30</motion.p>
                  <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.9, ease: EASE }} className={`${DISPLAY} mt-3 text-[clamp(1.7rem,3.4vw,2.6rem)] font-semibold leading-none tracking-[-0.03em] [text-shadow:0_4px_24px_rgba(0,0,0,0.45)]`}>ConnectRwanda AI</motion.p>
                </div>
              </div>
            )}
            {sc.key === 'problem' && (
              <div className="absolute inset-0">
                {[{ k: 'q1', x: '8%', y: '20%' }, { k: 'q2', x: '40%', y: '36%' }, { k: 'q3', x: '14%', y: '52%' }].map((q, i) => (
                  <motion.span key={q.k} className={`absolute flex items-center gap-2 px-4 py-2.5 text-[14px] font-medium ${panel}`}
                    style={{ left: q.x, top: q.y }} initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.5 + i * 0.9, duration: 0.6, ease: EASE }}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF6B6B] text-[13px] font-bold text-[#050A16]">?</span>{t(`cr.film.${q.k}`)}
                  </motion.span>
                ))}
              </div>
            )}
            {sc.key === 'buses' && (
              <motion.div className={`absolute right-4 top-14 w-[230px] p-3.5 sm:right-6 sm:top-16 ${panel}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2, duration: 0.6, ease: EASE }}>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70"><span className="h-1.5 w-1.5 rounded-full bg-[#22C47A]" />{t('cr.film.eta')}</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="rounded-md bg-[#21B3F2] px-2 py-1 font-mono text-[13px] font-bold text-[#050A16]">302</span>
                  <span className="flex-1 text-[14px]">Kimironko</span>
                  <span className="font-mono text-[18px] font-bold text-[#FAD201]">3 min</span>
                </div>
              </motion.div>
            )}
            {sc.key === 'navigate' && (
              <motion.ol className={`absolute left-4 top-14 w-[250px] space-y-1.5 p-3 text-[13px] sm:left-6 sm:top-16 ${panel}`} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7, duration: 0.6, ease: EASE }}>
                {[{ I: Footprints, c: '#22C47A', k: 'step1' }, { I: Bus, c: '#21B3F2', k: 'step2' }, { I: Accessibility, c: '#FAD201', k: 'step3' }].map((s, i) => (
                  <motion.li key={s.k} className="flex items-center gap-2.5" initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 + i * 2 }}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${s.c}2a`, color: s.c }}><s.I size={15} /></span>
                    <span className="leading-tight">{t(`cr.navigate.${s.k}`)}</span>
                  </motion.li>
                ))}
              </motion.ol>
            )}
            {sc.key === 'voice' && (
              <div className="absolute inset-x-0 bottom-[30%] top-12 flex flex-col items-center justify-center gap-3 px-6">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <span className="cr-ping-html absolute inset-0 rounded-full bg-[#22C47A]/35" />
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#22C47A] text-[#050A16]"><Mic size={24} /></span>
                </div>
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="max-w-[90%] rounded-2xl bg-white px-4 py-2 text-center text-[14px] text-[#050A16]">“Bisi ijya i Kimironko izagera ryari?”</motion.p>
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2 }} className={`max-w-[90%] px-4 py-2 text-center text-[14px] ${panel}`}>Bisi 302 izagera ku cyapa cya Remera mu minota 3.</motion.p>
              </div>
            )}
            {sc.key === 'access' && (
              <motion.div className={`absolute right-4 top-14 flex flex-col gap-1.5 p-3 text-[12px] sm:right-6 sm:top-16 ${panel}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9, duration: 0.6, ease: EASE }}>
                {([['stepfree', '#22C47A'], ['ramp', '#FAD201'], ['toilet', '#21B3F2'], ['stairs', '#FF6B6B']] as const).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{t(`cr.access.${k}`)}</span>
                ))}
              </motion.div>
            )}
            {sc.key === 'outro' && (
              <div className="absolute inset-x-0 bottom-[30%] top-12 flex flex-col items-center justify-center px-6 text-center text-white">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8, ease: EASE }}><CRMark size={60} /></motion.div>
                <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8, ease: EASE }} className={`${DISPLAY} mt-4 text-[clamp(1.4rem,3vw,2.2rem)] font-semibold tracking-[-0.03em]`}>{t('cr.film.outro')}</motion.p>
                <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1, duration: 1, ease: EASE }} className="mt-4 flex h-1.5 w-40 overflow-hidden rounded-full">
                  <span className="flex-[2] bg-[#00A1DE]" /><span className="flex-1 bg-[#FAD201]" /><span className="flex-1 bg-[#20603D]" />
                </motion.div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 text-white sm:px-5">
          <span className="flex items-center gap-2 text-[12px] font-semibold">
            <span className="h-3 w-[18px] overflow-hidden rounded-[2px]"><RwandaFlag className="h-full w-full" /></span>
            <span className="font-mono text-white/60">{String(scene + 1).padStart(2, '0')}</span>
            {t(`cr.film.n${scene + 1}`)}
          </span>
          <span ref={clock} className="w-[96px] text-right font-mono text-[12px] tabular-nums text-white/75" />
        </div>

        <div className="absolute inset-x-0 bottom-14 flex justify-center px-5">
          <AnimatePresence mode="wait">
            <motion.p key={`${scene}-${t(`cr.film.c${scene + 1}`)}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.45, delay: 0.15 }}
              className="max-w-[92%] rounded-xl bg-black/70 px-4 py-2 text-center text-[14px] leading-snug text-white sm:text-[15px]">
              {t(`cr.film.c${scene + 1}`)}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-4 sm:px-5">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={t(playing ? 'cr.film.pause' : 'cr.film.play')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#050A16] transition-transform active:scale-90">
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-[1px]" />}
          </button>
          <div className="flex flex-1 gap-1.5">
            {SCENES.map((s, i) => (
              <button key={s.key} type="button" onClick={() => jump(i)} aria-label={t(`cr.film.n${i + 1}`)} className="group relative h-6 flex-1">
                <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-all group-hover:h-[5px]">
                  <span ref={(el) => { bars.current[i] = el }} className="absolute inset-0 origin-left scale-x-0 rounded-full bg-white will-change-transform" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Live network bulletin ─────────────────────────────────────────────── */
function useKigaliClock() {
  const [clock, setClock] = useState('')
  useEffect(() => {
    const f = () => setClock(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' }))
    f()
    const id = window.setInterval(f, 15000)
    return () => window.clearInterval(id)
  }, [])
  return clock
}

function LiveBulletin() {
  const { t } = useI18n()
  const P = usePal()
  const clock = useKigaliClock()
  type Item = { kind: 'bus'; line: string; color: string; from: string; to: string; eta: number; late: number; lowFloor: boolean } | { kind: 'note'; k: string; Icon: typeof Users; color: string }
  const items: Item[] = [
    { kind: 'bus', line: '302', color: P.blue, from: 'Nyabugogo', to: 'Kimironko', eta: 3, late: 0, lowFloor: true },
    { kind: 'note', k: 'm1', Icon: Accessibility, color: P.green },
    { kind: 'bus', line: '205', color: P.yellow, from: 'Kacyiru', to: 'Kicukiro', eta: 6, late: 2, lowFloor: false },
    { kind: 'bus', line: '101', color: P.green, from: 'Nyamirambo', to: 'Kibagabaga', eta: 2, late: 0, lowFloor: true },
    { kind: 'note', k: 'm2', Icon: Store, color: P.yellowText },
    { kind: 'bus', line: '302', color: P.blue, from: 'Kimironko', to: 'Mu Mujyi', eta: 9, late: 0, lowFloor: true },
    { kind: 'note', k: 'm3', Icon: Bus, color: P.blue },
    { kind: 'bus', line: '205', color: P.yellow, from: 'Kicukiro', to: 'Kacyiru', eta: 4, late: 0, lowFloor: true },
  ]
  const row = (copy: number) => items.map((it, i) => (
    <div key={`${copy}-${i}`} className="mx-2 flex shrink-0 items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
      {it.kind === 'bus' ? (
        <>
          <span className="rounded-lg px-2 py-1 font-mono text-[12px] font-bold text-[#050A16]" style={{ background: it.color }}>{it.line}</span>
          <span className="text-[14px] font-medium text-[var(--text)]">{it.from} <span className="text-[var(--faint)]">→</span> {it.to}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={it.late ? { background: `${P.red}1f`, color: P.red } : { background: `${P.green}1f`, color: P.green }}>
            {it.late ? `+${it.late} ${t('landing.transit.min')}` : t('cr.ticker.onTime')}
          </span>
          {it.lowFloor && <Accessibility size={15} style={{ color: P.blue }} aria-label={t('landing.transit.lowFloor')} />}
          <span className="font-mono text-[15px] font-bold" style={{ color: P.yellowText }}>{it.eta} {t('landing.transit.min')}</span>
        </>
      ) : (
        <>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${it.color}1f`, color: it.color }}><it.Icon size={15} /></span>
          <span className="text-[14px] text-[var(--muted)]">{t(`cr.ticker.${it.k}`)}</span>
        </>
      )}
    </div>
  ))
  return (
    <div className="relative border-y border-[var(--line)] bg-[var(--bg2)]">
      <div className="flex items-stretch">
        <div className="relative z-20 hidden shrink-0 items-center gap-4 border-r border-[var(--line)] bg-[var(--bg2)] py-4 pl-8 pr-6 md:flex lg:pl-12">
          <span className="flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ background: `${P.red}1c`, color: P.red }}>
            <span className="relative flex h-2 w-2"><span className="cr-ping-html absolute inset-0 rounded-full" style={{ background: P.red }} /><span className="relative h-2 w-2 rounded-full" style={{ background: P.red }} /></span>
            {t('cr.ticker.live')}
          </span>
          <div className="leading-tight">
            <p className="whitespace-nowrap text-[14px] font-semibold text-[var(--text)]">{t('cr.ticker.network')}</p>
            <p className="font-mono text-[12px] text-[var(--faint)]"><Clock size={11} className="mr-1 inline -translate-y-px" />{clock} · CAT</p>
          </div>
        </div>
        <div style={{ contain: 'layout paint' }} className="cr-marquee-wrap relative flex-1 overflow-hidden py-3.5" aria-label={t('cr.ticker.network')}>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16" style={{ background: `linear-gradient(90deg, ${P.bg2}, transparent)` }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24" style={{ background: `linear-gradient(270deg, ${P.bg2}, transparent)` }} />
          <div className="cr-marquee flex w-max">{row(0)}{row(1)}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Problem: iOS-style widgets on a static colour field (no flicker) ──── */
function ProblemWidgets() {
  const { t } = useI18n()
  const P = usePal()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })
  const widgets = [
    { n: 1, Icon: Navigation, c1: P.blue, c2: '#1E5BD8', where: 'Nyabugogo · 07:42' },
    { n: 2, Icon: Bus, c1: '#F5B300', c2: '#E07B00', where: 'Remera · 07:55' },
    { n: 3, Icon: Store, c1: P.green, c2: '#0A6B47', where: 'Kimironko · 12:10' },
    { n: 4, Icon: Accessibility, c1: P.violet, c2: '#3B2A9E', where: 'Mu Mujyi · 17:30' },
  ]
  return (
    <div ref={ref} className="relative mt-14 overflow-hidden rounded-[40px] border border-[var(--line)] p-3 sm:p-5 lg:p-6"
      style={{ background: `radial-gradient(60% 70% at 0% 0%, ${P.blue}26, transparent 70%), radial-gradient(50% 60% at 100% 20%, ${P.violet}22, transparent 70%), radial-gradient(60% 60% at 40% 100%, ${P.green}22, transparent 70%), ${P.surface2}` }}>
      <div className="relative grid gap-3 sm:gap-4 md:grid-cols-2">
        {widgets.map((w, i) => (
          <motion.article key={w.n}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={inView ? { opacity: 1, y: 0, scale: 1 } : undefined}
            transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.1 + i * 0.12 }}
            whileHover={{ y: -4 }}
            className="relative flex min-h-[250px] flex-col rounded-[30px] p-6 sm:p-7"
            style={{ background: P.glass, border: `1px solid ${P.glassLine}`, boxShadow: `inset 0 1px 0 ${P.glassLine}, ${P.shadow}` }}>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[13px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" style={{ background: `linear-gradient(160deg, ${w.c1}, ${w.c2})` }}>
                <w.Icon size={21} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">{t('cr.problem.label')} 0{w.n}</p>
                <p className="mt-0.5 text-[13px] text-[var(--muted)]">{w.where}</p>
              </div>
            </div>
            <h3 className={`${DISPLAY} mt-6 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text)]`}>{t(`landing.problem.p${w.n}Title`)}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--muted)]">{t(`landing.problem.p${w.n}Body`)}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: `${w.c1}1c`, color: w.n === 2 ? P.yellowText : w.c1 }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: w.c1 }} />{t(`cr.problem.p${w.n}Tag`)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--faint)]"><Check size={13} style={{ color: P.green }} />{t(`cr.problem.p${w.n}Fix`)}</span>
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  )
}

/* ── Platform orbit ────────────────────────────────────────────────────── */
function PlatformOrbit() {
  const { t } = useI18n()
  const P = usePal()
  const services = [
    { n: 1, Icon: Navigation, color: P.blue, pos: 'left-1/2 top-0 -translate-x-1/2' },
    { n: 2, Icon: Bus, color: P.yellow, pos: 'right-0 top-1/2 -translate-y-1/2' },
    { n: 3, Icon: Mic, color: P.green, pos: 'bottom-0 left-1/2 -translate-x-1/2' },
    { n: 4, Icon: Accessibility, color: P.violet, pos: 'left-0 top-1/2 -translate-y-1/2' },
  ]
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.2 })
  const [active, setActive] = useState(0)
  const [touched, setTouched] = useState(false)
  const tick = useTicker(4600, !touched && inView)
  useEffect(() => { if (!touched) setActive(tick % 4) }, [tick, touched])
  const s = services[active]
  const ink = (c: string) => (c === P.yellow ? P.yellowText : c)
  return (
    <div ref={ref} className="grid items-center gap-12 lg:grid-cols-2">
      <Unveil className="relative mx-auto aspect-square w-full max-w-[470px]">
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden>
          <circle cx="200" cy="200" r="150" fill="none" stroke={P.grid} strokeDasharray="3 7" />
          <circle cx="200" cy="200" r="95" fill="none" stroke={P.grid} />
          {[[200, 40], [360, 200], [200, 360], [40, 200]].map(([x, y], i) => (
            <line key={i} x1="200" y1="200" x2={x} y2={y} stroke={services[i].color} strokeWidth={active === i ? 3 : 1.5} opacity={active === i ? 1 : 0.35} className="cr-dash" />
          ))}
        </svg>
        <div className="absolute left-1/2 top-1/2 flex h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-[var(--line)] text-center"
          style={{ background: `radial-gradient(circle at 30% 30%, ${P.surface}, ${P.surface2})`, boxShadow: `0 0 80px -14px ${P.blue}` }}>
          <span className="cr-ping-html absolute inset-0 rounded-full border" style={{ borderColor: `${P.blue}66` }} />
          <CRMark size={40} />
          <span className={`${DISPLAY} mt-1.5 text-[12px] font-semibold text-[var(--text)]`}>{t('cr.platform.core')}</span>
        </div>
        {services.map((sv, i) => (
          <button key={sv.n} type="button" onClick={() => { setTouched(true); setActive(i) }} aria-pressed={active === i}
            className={`absolute ${sv.pos} flex h-[22%] w-[22%] flex-col items-center justify-center gap-1 rounded-[24px] border transition-all duration-500`}
            style={{ borderColor: active === i ? sv.color : P.line, background: active === i ? `${sv.color}22` : P.surface, boxShadow: active === i ? `0 0 50px -10px ${sv.color}` : P.shadow }}>
            <sv.Icon size={24} style={{ color: ink(sv.color) }} />
            <span className="hidden px-1 text-[11px] font-semibold leading-tight text-[var(--text)] sm:block">{t(`landing.solution.s${sv.n}Title`)}</span>
          </button>
        ))}
      </Unveil>
      <div>
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.45, ease: EASE }} className={`${CARD} p-7 sm:p-9`}>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: `${s.color}22`, color: ink(s.color) }}><s.Icon size={26} /></span>
            <p className="mt-6 font-mono text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: ink(s.color) }}>0{s.n} / 04</p>
            <h3 className={`${DISPLAY} mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[var(--text)]`}>{t(`landing.solution.s${s.n}Title`)}</h3>
            <p className="mt-3 text-[17px] leading-relaxed text-[var(--muted)]">{t(`landing.solution.s${s.n}Body`)}</p>
            <p className="mt-5 border-t border-[var(--line)] pt-5 text-[15px] leading-relaxed text-[var(--text)]">{t(`cr.platform.d${s.n}`)}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-5 flex gap-2">
          {services.map((sv, i) => (
            <button key={sv.n} type="button" aria-label={t(`landing.solution.s${sv.n}Title`)} onClick={() => { setTouched(true); setActive(i) }}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: P.line }}>
              {active === i && (
                <motion.span key={`${i}-${tick}`} className="absolute inset-0 origin-left rounded-full" style={{ background: sv.color }}
                  initial={{ scaleX: touched ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: touched ? 0 : 4.6, ease: 'linear' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Departures board: themed card (no black block) ────────────────────── */
function DeparturesBoard() {
  const { t } = useI18n()
  const P = usePal()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.1 })
  const tick = useTicker(2600, !reduce && inView)
  const clock = useKigaliClock()
  const deps = [
    { line: '302', to: 'Kimironko', via: 'Remera', start: 3, color: P.blue, lowFloor: true },
    { line: '205', to: 'Kicukiro', via: 'Sonatubes', start: 7, color: P.yellow, lowFloor: false },
    { line: '101', to: 'Kibagabaga', via: 'Kacyiru', start: 12, color: P.green, lowFloor: true },
    { line: '302', to: 'Nyabugogo', via: 'Mu Mujyi', start: 18, color: P.blue, lowFloor: true },
  ]
  const rows = deps.map((d) => { const c = d.start + 1; return { ...d, m: (d.start - (tick % c) + c) % c } }).sort((a, b) => a.m - b.m)
  return (
    <div ref={ref} className={`${CARD} relative overflow-hidden`}>
      <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${P.blue}, ${P.green}, ${P.yellow})` }} />
      <Glow color={P.blue} className="-right-20 -top-20 h-56 w-56" />
      <div className="relative flex items-center justify-between px-5 pb-4 pt-6 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${P.blue}1c`, color: P.blue }}><Bus size={20} /></span>
          <div className="leading-tight">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">{t('cr.transit.board')}</p>
            <p className={`${DISPLAY} text-[20px] font-semibold text-[var(--text)]`}>{t('landing.transit.stop')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[13px] font-semibold" style={{ background: `${P.green}18`, color: P.green }}>
          <span className="relative flex h-2 w-2"><span className="cr-ping-html absolute inset-0 rounded-full" style={{ background: P.green }} /><span className="relative h-2 w-2 rounded-full" style={{ background: P.green }} /></span>
          {clock}
        </div>
      </div>
      <ul className="relative space-y-2 px-3 pb-3 sm:px-4 sm:pb-4">
        {rows.map((r) => {
          const progress = 1 - r.m / (r.start + 1)
          return (
            <motion.li layout key={`${r.line}-${r.to}`} transition={{ duration: 0.5, ease: EASE }} className="rounded-2xl border border-[var(--line)] bg-[var(--surface2)] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-12 items-center justify-center rounded-xl font-mono text-[15px] font-bold text-[#050A16]" style={{ background: r.color }}>{r.line}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[15px] font-semibold text-[var(--text)]">{r.to}</p>
                  <p className="truncate text-[12px] text-[var(--faint)]">{t('cr.transit.via')} {r.via}</p>
                </div>
                {r.lowFloor && <Accessibility size={17} style={{ color: P.blue }} aria-label={t('landing.transit.lowFloor')} />}
                <span className="w-[74px] overflow-hidden text-right font-mono text-[18px] font-bold" style={{ color: r.m === 0 ? P.green : P.text }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={r.m} className="inline-block" initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ duration: 0.35 }}>
                      {r.m === 0 ? t('landing.transit.now') : `${r.m} ${t('landing.transit.min')}`}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--line)]">
                <motion.div className="h-full w-full origin-left rounded-full" style={{ background: r.color }} animate={{ scaleX: Math.max(progress, 0.04) }} transition={{ duration: 0.8, ease: EASE }} />
              </div>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── Navigation: tilted real map with the journey ──────────────────────── */
const NAV_LAYERS: Layers = { journey: true, you: true }
function NavigationMap({ theme, labels }: { theme: Theme; labels: MapLabels }) {
  const { t } = useI18n()
  const P = usePal()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.2 })
  const reduce = useReducedMotion()
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (reduce || !inView) return
    const id = window.setInterval(() => {
      const f = (Date.now() % 10800) / 9000
      setStep(f < 0.22 ? 0 : f < 0.86 ? 1 : 2)
    }, 400)
    return () => window.clearInterval(id)
  }, [reduce, inView])
  const steps = [
    { Icon: Footprints, color: P.green, text: t('cr.navigate.step1') },
    { Icon: Bus, color: P.blue, text: t('cr.navigate.step2') },
    { Icon: Accessibility, color: P.yellowText, text: t('cr.navigate.step3') },
  ]
  return (
    <div ref={ref} className={`${CARD} relative h-[520px] overflow-hidden sm:h-[560px]`}>
      <motion.div className="absolute inset-[-14%]" initial={{ rotateX: 0, rotateZ: 0, scale: 1 }} animate={inView && !reduce ? { rotateX: 30, rotateZ: -8, scale: 1.05 } : undefined} transition={{ duration: 2.2, ease: EASE, delay: 0.3 }} style={{ transformPerspective: 1300 }}>
        <Lazy className="absolute inset-0"><CityMap theme={theme} pal={P} labels={labels} layers={NAV_LAYERS} camera={JOURNEY_CAMERA} interactive={false} /></Lazy>
      </motion.div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: `linear-gradient(180deg, ${P.surface}, transparent)` }} />
      <div className="absolute inset-x-3 bottom-3 rounded-[24px] p-3 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[340px]" style={{ background: P.glass, border: `1px solid ${P.glassLine}`, boxShadow: P.shadow }}>
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2 transition-all duration-500" style={{ background: step === i ? `${s.color}1a` : 'transparent', opacity: step === i ? 1 : 0.6 }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${s.color}22`, color: s.color }}><s.Icon size={16} /></span>
              <span className="text-[14px] leading-snug text-[var(--text)]">{s.text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-1 flex items-center justify-between rounded-2xl px-3 py-2 text-[13px]">
          <span className="text-[var(--muted)]">{t('cr.navigate.total')}</span>
          <span className="font-mono font-bold" style={{ color: P.yellowText }}>18 min</span>
        </div>
      </div>
    </div>
  )
}

/* ── Voice ─────────────────────────────────────────────────────────────── */
const VOICE = [
  { lang: 'Kinyarwanda', q: 'Ndashaka farumasi iri hafi, igerwaho n’abafite ubumuga.', a: 'Farumasi Ubumwe iri kuri metero 400. Fata bisi 302, igera mu minota 3.' },
  { lang: 'Français', q: 'Quel bus pour aller au marché de Kimironko ?', a: 'Le bus 302 passe dans 4 minutes à l’arrêt Remera. Plancher bas, accès fauteuil.' },
  { lang: 'English', q: 'Find a quiet café with a step-free entrance near me.', a: 'Inzozi Café, 6 min walk. Step-free entrance confirmed by 12 people.' },
]
function VoiceDemo() {
  const { t } = useI18n()
  const P = usePal()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.2 })
  const tick = useTicker(5600, !reduce && inView)
  const v = VOICE[tick % VOICE.length]
  return (
    <div ref={ref} className={`${CARD} relative overflow-hidden p-6 sm:p-8`}>
      <Glow color={P.green} className="-left-24 -top-24 h-72 w-72" />
      <div className="relative flex flex-col items-center">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className="cr-ping-html absolute inset-0 rounded-full" style={{ background: `${P.green}40` }} />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full text-white" style={{ background: P.green, boxShadow: `0 0 60px -6px ${P.green}` }}><Mic size={32} /></span>
        </div>
        <div className="mt-6 flex h-16 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 34 }).map((_, i) => {
            const base = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55))
            return (
              <span key={i} className="cr-bar w-[5px] rounded-full" style={{ background: i % 5 === 0 ? P.yellow : P.green, height: `${base * 100}%`, animationDuration: `${1.2 + (i % 4) * 0.2}s`, animationDelay: `${-i * 0.07}s`, animationPlayState: inView ? 'running' : 'paused' }} />
            )
          })}
        </div>
        <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: P.green }}>{t('cr.voice.listening')} · {v.lang}</p>
      </div>
      <div className="relative mt-6 min-h-[180px]">
        <AnimatePresence mode="wait">
          <motion.div key={tick % VOICE.length} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: EASE }} className="space-y-3">
            <p className="ml-auto max-w-[88%] rounded-[20px] rounded-br-md bg-[var(--text)] px-4 py-3 text-[15px] leading-snug text-[var(--bg)]">“{v.q}”</p>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="max-w-[88%] rounded-[20px] rounded-bl-md border border-[var(--line)] bg-[var(--surface2)] px-4 py-3 text-[15px] leading-snug text-[var(--text)]">{v.a}</motion.p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── Business ranking ──────────────────────────────────────────────────── */
const BIZ = [
  { name: 'Inzozi Café', meta: 'Kimironko · 450 m', scores: [0.9, 1, 0.95, 0.85], total: 96 },
  { name: 'Isoko Market · Stall 12', meta: 'Kimironko · 700 m', scores: [0.75, 0.8, 1, 0.8], total: 88 },
  { name: 'Ubumwe Pharmacy', meta: 'Remera · 1.1 km', scores: [0.6, 1, 0.85, 0.9], total: 84 },
]
function BusinessRanking() {
  const { t } = useI18n()
  const P = usePal()
  const colors = [P.blue, P.green, P.yellow, P.violet]
  return (
    <div className={`${CARD} p-4 sm:p-6`}>
      <div className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--field)] px-4 text-[15px] text-[var(--text)]">
        <Search size={17} style={{ color: P.blue }} /><span className="truncate">{t('cr.biz.query')}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
        {[1, 2, 3, 4].map((n, i) => (
          <span key={n} className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><span className="h-2 w-2 rounded-full" style={{ background: colors[i] }} />{t(`landing.bento.f${n}`)}</span>
        ))}
      </div>
      <ul className="mt-4 space-y-3">
        {BIZ.map((b, bi) => (
          <li key={b.name} className="rounded-2xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${P.yellow}26`, color: P.yellowText }}><Store size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[var(--text)]">{b.name}</p>
                <p className="text-[13px] text-[var(--muted)]">{b.meta}</p>
              </div>
              <span className="font-mono text-[18px] font-bold" style={{ color: P.green }}><CountUp to={b.total} suffix="%" /></span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {b.scores.map((s, i) => (
                <div key={i} className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                  <motion.div className="h-full w-full origin-left rounded-full" style={{ background: colors[i] }} initial={{ scaleX: 0 }} whileInView={{ scaleX: s }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE, delay: 0.3 + bi * 0.2 + i * 0.08 }} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Key figures over an aerial view of Kigali ─────────────────────────── */
function KeyFigures() {
  const { t } = useI18n()
  const P = usePal()
  const cards = [
    { color: P.blue, v: <CountUp to={4} />, label: t('cr.stats.s1'),
      extra: <div className="flex gap-1.5">{[Navigation, Bus, Mic, Accessibility].map((I, i) => <span key={i} className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${[P.blue, P.yellow, P.green, P.violet][i]}22`, color: [P.blue, P.yellowText, P.green, P.violet][i] }}><I size={15} /></span>)}</div> },
    { color: P.green, v: <CountUp to={3} />, label: t('cr.stats.s2'),
      extra: <div className="flex items-center gap-1.5">{['RW', 'FR', 'EN'].map((l) => <span key={l} className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] px-2.5 py-1 font-mono text-[12px] font-bold text-[var(--text)]">{l}</span>)}<Languages size={18} className="ml-1" style={{ color: P.green }} /></div> },
    { color: P.yellow, v: <CountUp to={0} suffix=" RWF" />, label: t('cr.stats.s3'),
      extra: <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: `${P.yellow}26`, color: P.yellowText }}><BadgeCheck size={14} />{t('cr.stats.free')}</span> },
    { color: P.violet, v: '24/7', label: t('cr.stats.s4'),
      extra: (
        <svg viewBox="0 0 160 36" className="h-9 w-40" aria-hidden>
          <motion.path d="M0 26 L18 22 L30 28 L44 14 L58 20 L72 8 L88 18 L102 12 L118 24 L134 10 L148 16 L160 6" fill="none" stroke={P.violet} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.8, ease: EASE }} />
        </svg>
      ) },
  ]
  return (
    <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
      <KigaliAerial lat={-1.9536} lng={30.0930} />
      <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${P.veil}, ${P.veil2})` }} />
      <div className={WRAP}>
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Reveal><Eyebrow color={P.blue}>{t('cr.stats.eyebrow')}</Eyebrow></Reveal>
            <Heading text={t('cr.stats.title')} />
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--muted)]">
            <Satellite size={13} />{t('cr.stats.aerial')}
          </span>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <Reveal key={i} delay={i * 0.08} className="h-full">
              <motion.div whileHover={{ y: -6 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="relative flex h-full min-h-[250px] flex-col overflow-hidden rounded-[28px] p-6"
                style={{ background: P.glass, border: `1px solid ${P.glassLine}`, boxShadow: P.shadow }}>
                <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: c.color }} />
                <Glow color={c.color} className="-right-16 -top-16 h-48 w-48" />
                <p className={`${DISPLAY} cr-gradtext relative text-[clamp(2.6rem,4.6vw,3.8rem)] font-semibold leading-none tracking-[-0.04em]`} style={{ backgroundImage: `linear-gradient(120deg, ${P.text} 30%, ${c.color === P.yellow ? P.yellowText : c.color})` }}>{c.v}</p>
                <p className="relative mt-3 text-[15px] leading-snug text-[var(--muted)]">{c.label}</p>
                <div className="relative mt-auto pt-6">{c.extra}</div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Who it's for ──────────────────────────────────────────────────────── */
function WhoCards() {
  const { t } = useI18n()
  const P = usePal()
  const who = [
    { n: 1, Icon: Users, color: P.blue },
    { n: 2, Icon: Accessibility, color: P.violet },
    { n: 3, Icon: Store, color: P.yellow },
    { n: 4, Icon: Radio, color: P.green },
  ]
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {who.map((w, i) => (
        <Reveal key={w.n} delay={i * 0.08} className="h-full">
          <motion.article whileHover={{ y: -6 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }} className={`${CARD} group flex h-full flex-col overflow-hidden`}>
            <div className="relative h-32 overflow-hidden" style={{ background: `linear-gradient(135deg, ${w.color}33, ${w.color}0d)` }}>
              <svg viewBox="0 0 200 100" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
                <path d="M-10 70 C40 40 70 90 110 55 S170 20 210 40" fill="none" stroke={w.color} strokeOpacity="0.45" strokeWidth="2" strokeDasharray="3 6" />
                <path d="M-10 90 C50 70 90 100 130 80 S180 60 210 70" fill="none" stroke={w.color} strokeOpacity="0.25" strokeWidth="2" />
              </svg>
              <span className="absolute bottom-4 left-5 flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform duration-500 group-hover:scale-110"
                style={{ background: `linear-gradient(160deg, ${w.color}, ${w.color}bb)` }}>
                <w.Icon size={24} />
              </span>
              <span className="absolute right-4 top-4 font-mono text-[12px] font-semibold text-[var(--faint)]">0{w.n}</span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className={`${DISPLAY} text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]`}>{t(`cr.who.w${w.n}Title`)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{t(`cr.who.w${w.n}Body`)}</p>
              <ul className="mt-auto space-y-2 border-t border-[var(--line)] pt-4">
                {['a', 'b'].map((k) => (
                  <li key={k} className="flex items-start gap-2 text-[14px] text-[var(--text)]">
                    <Check size={15} className="mt-0.5 shrink-0" style={{ color: w.color === P.yellow ? P.yellowText : w.color }} />{t(`cr.who.w${w.n}${k}`)}
                  </li>
                ))}
              </ul>
            </div>
          </motion.article>
        </Reveal>
      ))}
    </div>
  )
}

/* ── How it works ──────────────────────────────────────────────────────── */
function DataFlow() {
  const { t } = useI18n()
  const P = usePal()
  const nodes = [
    { Icon: Satellite, color: P.yellow, ink: P.yellowText, title: t('cr.tech.n1'), sub: t('cr.tech.n1s'), desc: t('cr.tech.n1d') },
    { Icon: Cpu, color: P.blue, ink: P.blue, title: t('cr.tech.n2'), sub: t('cr.tech.n2s'), desc: t('cr.tech.n2d') },
    { Icon: Smartphone, color: P.green, ink: P.green, title: t('cr.tech.n3'), sub: t('cr.tech.n3s'), desc: t('cr.tech.n3d') },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
      {nodes.map((n, i) => (
        <FlowPart key={i} last={i === nodes.length - 1} color={n.color} next={nodes[i + 1]?.color}>
          <Reveal delay={i * 0.15} className="h-full">
            <div className="relative h-full overflow-hidden rounded-[28px] p-6 sm:p-7" style={{ background: P.glass, border: `1px solid ${P.glassLine}`, boxShadow: P.shadow }}>
              <Glow color={n.color} className="-right-16 -top-16 h-44 w-44" />
              <div className="relative flex items-center justify-between">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: `${n.color}24`, color: n.ink }}><n.Icon size={26} /></span>
                <span className={`${DISPLAY} text-[40px] font-semibold leading-none tracking-[-0.04em]`} style={{ color: `${n.color}66` }}>0{i + 1}</span>
              </div>
              <p className={`${DISPLAY} relative mt-6 text-[21px] font-semibold text-[var(--text)]`}>{n.title}</p>
              <p className="relative mt-1 text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: n.ink }}>{n.sub}</p>
              <p className="relative mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{n.desc}</p>
            </div>
          </Reveal>
        </FlowPart>
      ))}
    </div>
  )
}
function FlowPart({ children, last, color, next }: { children: React.ReactNode; last: boolean; color: string; next?: string }) {
  return (
    <>
      {children}
      {!last && (
        <div className="relative mx-auto h-12 w-[3px] self-center md:h-[3px] md:w-16" aria-hidden>
          <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(90deg, ${color}, ${next})` }} />
          <span className="cr-travel absolute inset-0 hidden md:block"><span className="absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: '#fff', boxShadow: `0 0 14px ${color}` }} /></span>
        </div>
      )}
    </>
  )
}

function Bullets({ prefix, color }: { prefix: string; color: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLUListElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  return (
    <ul ref={ref} className="mt-8 space-y-3.5">
      {[1, 2, 3].map((n, i) => (
        <motion.li key={n} initial={{ opacity: 0, x: -12 }} animate={inView ? { opacity: 1, x: 0 } : undefined} transition={{ duration: 0.6, ease: EASE, delay: 0.15 + i * 0.1 }}
          className="flex items-start gap-3 text-[16px] leading-relaxed text-[var(--text)]">
          <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: `${color}26`, color }}><Check size={12} strokeWidth={3} /></span>
          {t(`${prefix}${n}`)}
        </motion.li>
      ))}
    </ul>
  )
}

function FooterCol({ title, items, onHash }: { title: string; items: { href: string; label: string }[]; onHash: (h: string) => (e: React.MouseEvent) => void }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--faint)]">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {items.map((it, i) => (
          <li key={i}>
            {it.href.startsWith('#')
              ? <a href={it.href} onClick={onHash(it.href)} className="text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">{it.label}</a>
              : <Link href={it.href} className="text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">{it.label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */
const TRANSIT_LAYERS: Layers = { lines: true, buses: true, you: true }
const ACCESS_LAYERS: Layers = { access: true }

export default function ConnectRwandaLanding() {
  const { t } = useI18n()
  const [theme, setTheme] = useState<Theme>('dark')
  const P = theme === 'dark' ? DARK : LIGHT
  const scroller = useRef<HTMLDivElement>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)
  const [activeId, setActiveId] = useState('')
  const [hiddenA11y, setHiddenA11y] = useState<AccessType[]>([])
  const [follow, setFollow] = useState<string | null>(null)

  useEffect(() => {
    try {
      setSignedIn(!!localStorage.getItem('hodari_email'))
      const saved = localStorage.getItem('cr_theme')
      setTheme(saved === 'light' || saved === 'dark' ? saved : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
    } catch { /* storage unavailable */ }
  }, [])
  const toggleTheme = () => setTheme((th) => {
    const next: Theme = th === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('cr_theme', next) } catch { /* ignore */ }
    return next
  })

  const { scrollY, scrollYProgress } = useScroll({ container: scroller })
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 })
  useMotionValueEvent(scrollY, 'change', (y) => { const s = y > 10; setScrolled((p) => (p === s ? p : s)) })

  const nav = useMemo(() => [
    { href: '#platform', label: t('cr.nav.platform') },
    { href: '#transit', label: t('cr.nav.transit') },
    { href: '#navigate', label: t('cr.nav.navigate') },
    { href: '#voice', label: t('cr.nav.voice') },
    { href: '#access', label: t('cr.nav.access') },
    { href: '#businesses', label: t('cr.nav.businesses') },
  ], [t])

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const els = ['#problem', '#platform', '#transit', '#navigate', '#voice', '#access', '#businesses', '#who', '#tech'].map((h) => root.querySelector(h)).filter(Boolean) as Element[]
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActiveId(`#${e.target.id}`) })
    }, { root, rootMargin: '-45% 0px -50% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const mapLabels = useMemo<MapLabels>(() => ({ you: t('cr.navigate.you'), confirmed: t('cr.access.confirmed'), min: t('landing.transit.min'), dest: 'Kimironko Market' }), [t])
  const cta = signedIn ? '/chat' : '/login'
  const vars = Object.fromEntries(Object.entries(P).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties
  const goTo = (hash: string) => scrollToHash(scroller.current, hash)
  const link = (href: string) => (e: React.MouseEvent) => { if (goTo(href)) e.preventDefault(); setMenu(false) }
  const glass = (pct = 92) => `color-mix(in srgb, ${P.surface} ${pct}%, transparent)`
  const a11yTypes: { key: AccessType; color: string }[] = [
    { key: 'stepfree', color: P.green }, { key: 'ramp', color: P.yellow }, { key: 'toilet', color: P.blue }, { key: 'stairs', color: P.red },
  ]

  return (
    <PalCtx.Provider value={P}>
      <ScrollCtx.Provider value={scroller}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div ref={scroller} data-theme={theme} style={{ ...vars, colorScheme: theme }}
          className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-[var(--bg)] font-[family-name:var(--font-inter)] text-[var(--text)] antialiased selection:bg-[#FAD201] selection:text-[#050A16]">
          <a href="#main" onClick={link('#main')} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[2000] focus:rounded-full focus:bg-[#FAD201] focus:px-4 focus:py-2 focus:text-[#050A16]">{t('cr.skip')}</a>

          <header className="sticky top-0 z-[1000] transition-[background,border-color] duration-500"
            style={{ background: scrolled || menu ? `color-mix(in srgb, ${P.bg} 97%, transparent)` : 'transparent', borderBottom: `1px solid ${scrolled || menu ? P.line : 'transparent'}` }}>
            <motion.div aria-hidden className="absolute inset-x-0 bottom-[-1px] h-[2px] origin-left" style={{ scaleX: progress, background: `linear-gradient(90deg, ${P.blue}, ${P.green}, ${P.yellow})` }} />
            <div className="mx-auto flex h-[68px] w-full max-w-[1360px] items-center gap-3 whitespace-nowrap px-5 sm:px-8">
              <a href="#top" onClick={link('#top')} className="shrink-0" aria-label="ConnectRwanda AI"><Wordmark /></a>
              <nav className="ml-3 hidden flex-1 items-center justify-center min-[1280px]:flex" aria-label="Main">
                {nav.map((l) => (
                  <a key={l.href} href={l.href} onClick={link(l.href)} aria-current={activeId === l.href ? 'true' : undefined}
                    className={`relative whitespace-nowrap rounded-full px-3 py-2 text-[14px] transition-colors ${activeId === l.href ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                    {activeId === l.href && <motion.span layoutId="cr-nav" className="absolute inset-0 rounded-full border border-[var(--line)] bg-[var(--surface)]" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                    <span className="relative">{l.label}</span>
                  </a>
                ))}
              </nav>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <div className="hidden sm:block"><LangSwitch id="head" /></div>
                <ThemeSwitch theme={theme} onToggle={toggleTheme} />
                <Link href="/login" className="hidden min-h-[38px] items-center whitespace-nowrap rounded-full px-3 text-[14px] text-[var(--muted)] hover:text-[var(--text)] min-[1440px]:inline-flex">{t('cr.nav.signin')}</Link>
                <Link href={cta} className="hidden min-h-[38px] items-center whitespace-nowrap rounded-full bg-[var(--yellow)] px-4 text-[14px] font-semibold text-[#050A16] sm:inline-flex">{t('cr.nav.open')}</Link>
                <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={t(menu ? 'landing.nav.close' : 'landing.nav.menu')} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] min-[1280px]:hidden">
                  {menu ? <X size={17} /> : <Menu size={17} />}
                </button>
              </div>
            </div>
            <AnimatePresence>
              {menu && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden min-[1280px]:hidden">
                  <div className="mx-auto max-w-[1360px] space-y-1 px-5 pb-6 pt-2 sm:px-8">
                    {nav.map((l, i) => (
                      <motion.a key={l.href} href={l.href} onClick={link(l.href)} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                        className={`${DISPLAY} flex items-center justify-between rounded-2xl px-3 py-3 text-[22px] font-semibold`}>
                        {l.label}<span className="font-mono text-[12px] text-[var(--faint)]">0{i + 1}</span>
                      </motion.a>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                      <LangSwitch id="menu" />
                      <div className="flex gap-2">
                        <Link href="/login" className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--line)] px-5 text-[15px]">{t('cr.nav.signin')}</Link>
                        <Link href={cta} className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--yellow)] px-5 text-[15px] font-semibold text-[#050A16]">{t('cr.nav.open')}</Link>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          <main id="main">
            {/* Hero */}
            <section id="top" className="relative -mt-[68px] overflow-hidden px-5 pb-14 pt-28 sm:px-8 sm:pt-32 lg:px-12">
              <Glow color={P.blue} className="-right-40 -top-20 h-[720px] w-[720px]" />
              <Glow color={P.green} className="-left-48 bottom-[-200px] h-[620px] w-[620px]" />
              <Glow color={P.yellow} className="left-[35%] top-[-260px] h-[480px] w-[480px]" />
              <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14`}>
                <div>
                  <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
                    className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1.5 pl-1.5 pr-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] [box-shadow:var(--shadow)]">
                    <span className="h-4 w-6 overflow-hidden rounded-[3px]"><RwandaFlag className="h-full w-full" /></span>
                    {t('cr.hero.badge')}
                  </motion.span>
                  <h1 className={`${DISPLAY} text-[clamp(2.6rem,5.8vw,4.9rem)] font-semibold leading-[0.98] tracking-[-0.045em]`}>
                    {[t('cr.hero.title1'), t('cr.hero.title2')].map((line, i) => (
                      <span key={i} className="block overflow-hidden pb-[0.08em]">
                        <motion.span className={`block ${i === 1 ? 'cr-gradtext' : ''}`} initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.1 + i * 0.14 }}
                          style={i === 1 ? { backgroundImage: `linear-gradient(90deg, ${P.blue}, ${P.green} 55%, ${theme === 'dark' ? P.yellow : '#B08A00'})` } : undefined}>
                          {line}
                        </motion.span>
                      </span>
                    ))}
                  </h1>
                  <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.45, ease: EASE }} className={`mt-6 max-w-[50ch] ${LEAD}`}>
                    {t('landing.hero3.sub')}
                  </motion.p>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }} className="mt-8 flex flex-wrap gap-3">
                    <Button href={cta}>{t('cr.hero.cta')}</Button>
                    <Button href="#platform" variant="ghost">{t('cr.hero.secondary')}</Button>
                  </motion.div>
                  <motion.ul initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.1, delayChildren: 0.8 } } }} className="mt-9 flex flex-wrap gap-2">
                    {[1, 2, 3].map((n) => (
                      <motion.li key={n} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }}
                        className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--muted)]">
                        <Check size={14} style={{ color: P.green }} />{t(`cr.hero.point${n}`)}
                      </motion.li>
                    ))}
                  </motion.ul>
                </div>
                <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}>
                  <HeroFilm theme={theme} labels={mapLabels} />
                </motion.div>
              </div>
            </section>

            <LiveBulletin />

            {/* Problem */}
            <section id="problem" className={SECTION}>
              <div className={WRAP}>
                <div className="grid items-end gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                  <div>
                    <Reveal><Eyebrow color={P.red} index="01">{t('landing.problem.eyebrow')}</Eyebrow></Reveal>
                    <Heading text={t('cr.problem.title')} />
                  </div>
                  <Reveal delay={0.1}><p className={LEAD}>{t('landing.problem.body')}</p></Reveal>
                </div>
                <ProblemWidgets />
              </div>
            </section>

            {/* Platform */}
            <section id="platform" className={`${SECTION} overflow-hidden bg-[var(--bg2)]`}>
              <Glow color={P.blue} className="left-1/2 top-[30%] h-[700px] w-[900px] -translate-x-1/2" />
              <div className={WRAP}>
                <div className="mx-auto max-w-[860px] text-center">
                  <Reveal><Eyebrow color={P.blue} index="02">{t('cr.platform.eyebrow')}</Eyebrow></Reveal>
                  <Heading text={t('landing.solution.title')} />
                  <Reveal delay={0.1}><p className={`mx-auto mt-5 max-w-[62ch] ${LEAD}`}>{t('landing.solution.body')}</p></Reveal>
                </div>
                <div className="mt-16"><PlatformOrbit /></div>
                <Reveal className="mx-auto mt-16 max-w-[920px]">
                  <div className="relative overflow-hidden rounded-[28px] border p-7 text-center sm:p-10" style={{ borderColor: `${P.yellow}55`, background: `linear-gradient(110deg, ${P.yellow}18, ${P.blue}12, ${P.green}18), ${P.surface}`, boxShadow: P.shadow }}>
                    <Sparkles size={22} className="mx-auto" style={{ color: P.yellowText }} />
                    <p className={`${DISPLAY} mt-4 text-[clamp(1.2rem,2.4vw,1.65rem)] font-medium leading-snug tracking-[-0.02em]`}>{t('landing.solution.innovation')}</p>
                  </div>
                </Reveal>
              </div>
            </section>

            {/* Live buses */}
            <section id="transit" className={`${SECTION} overflow-hidden`}>
              <Glow color={P.yellow} className="-right-40 top-20 h-[600px] w-[600px]" />
              <div className={WRAP}>
                <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <Reveal><Eyebrow color={P.yellowText} index="03">{t('landing.transit.eyebrow')}</Eyebrow></Reveal>
                    <Heading text={t('landing.transit.title')} />
                    <Reveal delay={0.1}><p className={`mt-5 max-w-[56ch] ${LEAD}`}>{t('landing.transit.body')}</p></Reveal>
                  </div>
                  <Bullets prefix="cr.transit.b" color={P.yellowText} />
                </div>
                <div className="mt-14 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                  <Unveil className={`${CARD} relative h-[480px] overflow-hidden sm:h-[560px]`}>
                    <Lazy className="absolute inset-0"><CityMap theme={theme} pal={P} labels={mapLabels} layers={TRANSIT_LAYERS} fit="lines" follow={follow} /></Lazy>
                    <div className="absolute left-3 top-3 z-[500] flex flex-wrap gap-1.5 sm:left-4 sm:top-4">
                      {[null, '302', '205', '101'].map((id) => {
                        const on = follow === id
                        const color = id === '302' ? P.blue : id === '205' ? P.yellow : id === '101' ? P.green : P.text
                        return (
                          <button key={id ?? 'all'} type="button" onClick={() => setFollow(id)} aria-pressed={on}
                            className="flex min-h-[34px] items-center gap-2 rounded-full border px-3 text-[12px] font-semibold transition-all"
                            style={{ background: on ? P.text : glass(), color: on ? P.bg : P.text, borderColor: on ? P.text : P.line, boxShadow: P.shadow }}>
                            {id && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                            {id ? `${t('cr.transit.follow')} ${id}` : t('cr.transit.all')}
                          </button>
                        )
                      })}
                    </div>
                    <span className="pointer-events-none absolute bottom-8 left-4 z-[500] rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-medium text-[var(--muted)]" style={{ background: glass() }}>{t('cr.map.sim')}</span>
                  </Unveil>
                  <Reveal delay={0.2} className="flex flex-col gap-5">
                    <DeparturesBoard />
                    <Button href={cta} className="w-full">{t('landing.transit.cta')}</Button>
                  </Reveal>
                </div>
              </div>
            </section>

            {/* Navigation */}
            <section id="navigate" className={`${SECTION} overflow-hidden bg-[var(--bg2)]`}>
              <Glow color={P.blue} className="-left-40 top-10 h-[600px] w-[600px]" />
              <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]`}>
                <Unveil className="order-2 lg:order-1"><NavigationMap theme={theme} labels={mapLabels} /></Unveil>
                <div className="order-1 lg:order-2">
                  <Reveal><Eyebrow color={P.blue} index="04">{t('landing.solution.s1Title')}</Eyebrow></Reveal>
                  <Heading text={t('cr.navigate.title')} />
                  <Reveal delay={0.1}><p className={`mt-5 ${LEAD}`}>{t('cr.navigate.body')}</p></Reveal>
                  <Bullets prefix="cr.navigate.b" color={P.blue} />
                </div>
              </div>
            </section>

            {/* Voice */}
            <section id="voice" className={`${SECTION} overflow-hidden`}>
              <Glow color={P.green} className="-right-40 top-10 h-[600px] w-[600px]" />
              <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-2`}>
                <div>
                  <Reveal><Eyebrow color={P.green} index="05">{t('landing.solution.s3Title')}</Eyebrow></Reveal>
                  <Heading text={t('cr.voice.title')} />
                  <Reveal delay={0.1}><p className={`mt-5 ${LEAD}`}>{t('cr.voice.body')}</p></Reveal>
                  <Bullets prefix="cr.voice.b" color={P.green} />
                </div>
                <Unveil><VoiceDemo /></Unveil>
              </div>
            </section>

            {/* Accessibility */}
            <section id="access" className={`${SECTION} overflow-hidden bg-[var(--bg2)]`}>
              <Glow color={P.violet} className="-left-40 top-20 h-[600px] w-[600px]" />
              <div className={WRAP}>
                <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <Reveal><Eyebrow color={P.violet} index="06">{t('landing.solution.s4Title')}</Eyebrow></Reveal>
                    <Heading text={t('cr.access.title')} />
                    <Reveal delay={0.1}><p className={`mt-5 max-w-[56ch] ${LEAD}`}>{t('cr.access.body')}</p></Reveal>
                  </div>
                  <Bullets prefix="cr.access.b" color={P.violet} />
                </div>
                <Unveil className={`${CARD} mt-14 overflow-hidden`}>
                  <div className="relative h-[460px] sm:h-[540px]">
                    <Lazy className="absolute inset-0"><CityMap theme={theme} pal={P} labels={mapLabels} layers={ACCESS_LAYERS} hidden={hiddenA11y} fit="access" /></Lazy>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] p-4 sm:p-5">
                    {a11yTypes.map((ty) => {
                      const off = hiddenA11y.includes(ty.key)
                      return (
                        <button key={ty.key} type="button" aria-pressed={!off} onClick={() => setHiddenA11y((h) => (off ? h.filter((x) => x !== ty.key) : [...h, ty.key]))}
                          className="flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-all"
                          style={off ? { borderColor: P.line, color: P.faint } : { borderColor: `${ty.color}88`, background: `${ty.color}1c`, color: P.text }}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? P.line : ty.color }} />
                          {t(`cr.access.${ty.key}`)}
                        </button>
                      )
                    })}
                    <span className="ml-auto text-[12px] text-[var(--faint)]">{t('cr.map.demo')}</span>
                  </div>
                </Unveil>
                <Reveal className="mt-8 flex justify-center"><Button href={cta} variant="ghost">{t('cr.access.add')}</Button></Reveal>
              </div>
            </section>

            {/* Businesses */}
            <section id="businesses" className={`${SECTION} overflow-hidden`}>
              <Glow color={P.yellow} className="-right-40 top-20 h-[600px] w-[600px]" />
              <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-2`}>
                <div>
                  <Reveal><Eyebrow color={P.yellowText} index="07">{t('cr.biz.eyebrow')}</Eyebrow></Reveal>
                  <Heading text={t('cr.biz.title')} />
                  <Reveal delay={0.1}><p className={`mt-5 ${LEAD}`}>{t('cr.biz.body')}</p></Reveal>
                  <Bullets prefix="cr.biz.b" color={P.yellowText} />
                </div>
                <Unveil><BusinessRanking /></Unveil>
              </div>
            </section>

            <KeyFigures />

            {/* Who */}
            <section id="who" className={`${SECTION} overflow-hidden`}>
              <Glow color={P.violet} className="-left-40 top-20 h-[560px] w-[560px]" />
              <div className={WRAP}>
                <div className="grid items-end gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <Reveal><Eyebrow color={P.blue} index="08">{t('cr.who.eyebrow')}</Eyebrow></Reveal>
                    <Heading text={t('cr.who.title')} />
                  </div>
                  <Reveal delay={0.1}><p className={LEAD}>{t('cr.who.body')}</p></Reveal>
                </div>
                <WhoCards />
              </div>
            </section>

            {/* How it works over aerial Kigali */}
            <section id="tech" className={`${SECTION} overflow-hidden`}>
              <KigaliAerial lat={-1.9445} lng={30.0610} />
              <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${P.veil}, ${P.veil2})` }} />
              <div className={WRAP}>
                <div className="mx-auto max-w-[800px] text-center">
                  <Reveal><Eyebrow color={P.green} index="09">{t('cr.tech.eyebrow')}</Eyebrow></Reveal>
                  <Heading text={t('cr.tech.title')} />
                  <Reveal delay={0.1}><p className={`mx-auto mt-5 max-w-[60ch] ${LEAD}`}>{t('cr.tech.body')}</p></Reveal>
                </div>
                <div className="mt-14"><DataFlow /></div>
                <Reveal className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
                  {[Satellite, Radio, Cpu, Users].map((Icon, i) => (
                    <span key={i} className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-[14px] [box-shadow:var(--shadow)]">
                      <Icon size={15} style={{ color: P.blue }} />{t(`landing.solution.tech${i + 1}`)}
                    </span>
                  ))}
                </Reveal>
                <p className="mt-8 text-center text-[11px] text-[var(--faint)]">{t('cr.stats.aerial')} · Imagery © Esri</p>
              </div>
            </section>

            {/* Final CTA */}
            <section className="relative overflow-hidden px-5 py-28 sm:px-8 sm:py-36 lg:px-12">
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-1.5"><span className="flex-[2] bg-[#00A1DE]" /><span className="flex-1 bg-[#FAD201]" /><span className="flex-1 bg-[#20603D]" /></div>
              <Glow color={P.blue} className="left-1/2 top-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/2" />
              <div className="relative mx-auto max-w-[880px] text-center">
                <Reveal><div className="flex justify-center"><CRMark size={60} /></div></Reveal>
                <Heading text={t('landing.final.title')} className={`${DISPLAY} mt-8 text-[clamp(2.4rem,5.6vw,4.6rem)] font-semibold leading-[1] tracking-[-0.045em]`} />
                <Reveal delay={0.1}><p className={`mx-auto mt-6 max-w-[54ch] ${LEAD}`}>{t('landing.final.body')}</p></Reveal>
                <Reveal delay={0.2} className="mt-10 flex flex-wrap justify-center gap-3">
                  <Button href={cta}>{t('cr.hero.cta')}</Button>
                  <Button href="/login" variant="ghost">{t('cr.nav.signin')}</Button>
                </Reveal>
              </div>
            </section>
          </main>

          <footer className="border-t border-[var(--line)] bg-[var(--bg2)] px-5 pb-10 pt-16 sm:px-8 lg:px-12">
            <div className={`${WRAP} grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
              <div>
                <Wordmark size="lg" />
                <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-[var(--muted)]">{t('cr.footer.about')}</p>
                <div className="mt-6 flex items-center gap-2"><LangSwitch id="foot" /><ThemeSwitch theme={theme} onToggle={toggleTheme} /></div>
              </div>
              <FooterCol title={t('cr.footer.product')} items={nav} onHash={link} />
              <FooterCol title={t('cr.footer.for')} items={[1, 2, 3, 4].map((n) => ({ href: '#who', label: t(`cr.who.w${n}Title`) }))} onHash={link} />
              <FooterCol title={t('cr.footer.start')} items={[
                { href: cta, label: t('cr.nav.open') },
                { href: '/login', label: t('cr.nav.signin') },
                { href: '/login', label: t('cr.footer.listBiz') },
                { href: '#tech', label: t('cr.tech.eyebrow') },
              ]} onHash={link} />
            </div>
            <div className={`${WRAP} mt-14 flex flex-col gap-4 border-t border-[var(--line)] pt-6 text-[13px] text-[var(--faint)] md:flex-row md:items-center md:justify-between`}>
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-[21px] overflow-hidden rounded-[2px]"><RwandaFlag className="h-full w-full" /></span>
                © {new Date().getFullYear()} ConnectRwanda AI · {t('cr.footer.made')}
              </span>
              <span>{t('cr.footer.data')}</span>
              <a href="#top" onClick={link('#top')} className="inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--text)]">{t('cr.footer.top')} <ArrowUp size={14} /></a>
            </div>
          </footer>
        </div>
      </ScrollCtx.Provider>
    </PalCtx.Provider>
  )
}
