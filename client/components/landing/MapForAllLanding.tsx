'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { Accessibility, ArrowRight, Check, ChevronDown, ChevronRight, MapPin, Menu, Store, X } from 'lucide-react'
import {
  LiveClock,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'
import ShowcaseMarquee from '@/components/landing/ShowcaseMarquee'
import DistrictMap from '@/components/landing/DistrictMap'
import HowItWorks from '@/components/landing/HowItWorks'
import { Flag, LANG_NAMES } from '@/components/landing/flags'
import { useTransitionLinks } from '@/components/landing/pageTransition'
import {
  AddPlaceDemo,
  CommunityTicker,
  ConfirmDemo,
  CountUp,
  GreetingCycler,
  GrowingBars,
  LiveProvider,
  NotificationBanner,
  PauseToggle,
  RankingDemo,
  TalkingDevice,
  VoiceDemo,
  useLive,
} from '@/components/landing/live'
import {
  APPLE_EASE,
  BlurInWords,
  HeroLayer,
  IntroIn,
  ParallaxImage,
  ScrollDriftX,
  ScrollHighlight,
  ScrollReveal,
  ScrollRootProvider,
  ScrollZoom,
} from '@/components/landing/scrollFx'
import { useI18n, type Lang } from '@/components/I18nProvider'

const LANGS: Lang[] = ['fr', 'en', 'rw']

/** Apple's easing, as a Tailwind arbitrary value for CSS transitions. */
const EASE_CSS = 'ease-[cubic-bezier(0.28,0.11,0.32,1)]'

/** Ghost control used by every icon/text button in the header. */
const HEADER_GHOST =
  'flex h-9 items-center justify-center rounded-full text-[#1A1614] transition-colors duration-200 hover:bg-black/[0.05] active:opacity-70 dark:text-gray-100 dark:hover:bg-white/10'

/** Shared type scale — one place to tune the whole page. */
const EYEBROW = 'mb-2.5 text-[14px] font-semibold tracking-[-0.01em] text-[#B8441A] dark:text-[#FF9A63] sm:text-[15px]'
const H2 = 'text-[clamp(1.9rem,3.8vw,3.1rem)] font-semibold leading-[1.06] tracking-[-0.032em] text-[#1A1614] dark:text-gray-50'
const LEAD = 'text-[16px] leading-[1.55] text-[#6E5B50] dark:text-gray-300 sm:text-[17px]'
const TILE = 'h-full rounded-[26px] border border-black/[0.05] bg-white p-6 shadow-[0_1px_2px_rgba(26,22,20,0.04),0_18px_48px_-24px_rgba(90,40,10,0.22)] transition-[transform,box-shadow] duration-500 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(26,22,20,0.05),0_28px_60px_-24px_rgba(90,40,10,0.3)] dark:border-white/[0.07] dark:bg-[#1C1916] sm:p-7'
const TILE_TITLE = 'text-[21px] font-semibold leading-[1.18] tracking-[-0.022em] text-[#1A1614] dark:text-gray-50 sm:text-[23px]'
const TILE_BODY = 'mt-2 text-[14px] leading-relaxed text-[#6E5B50] dark:text-gray-400 sm:text-[15px]'
/** Vertical rhythm shared by every full-width section. */
const SECTION_Y = 'py-20 sm:py-24 lg:py-28'

function scrollToHash(href: string) {
  if (!href.startsWith('#')) return false
  const el = document.getElementById(href.slice(1))
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

function Mark({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const box = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-[11px]'
  return (
    <span className={`flex items-center justify-center rounded-full bg-[#E8672A] font-bold tracking-tight text-white ${box}`}>
      MF
    </span>
  )
}

/**
 * The page's one button style: a pill with an orange arrow disc. On hover it
 * lifts a pixel, a sheen sweeps across, and the arrow slides out while a new
 * one slides in. `light` is for dark backgrounds.
 */
function PillButton({
  href,
  label,
  size = 'md',
  variant = 'dark',
  onClick,
}: {
  href: string
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'dark' | 'light'
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const sizes = {
    sm: 'h-10 gap-3 pl-5 pr-1.5 text-[13px]',
    md: 'h-11 gap-3 pl-5 pr-1.5 text-[14px]',
    lg: 'h-12 gap-3.5 pl-6 pr-2 text-[15px]',
  }[size]
  const disc = { sm: 'h-7 w-7', md: 'h-8 w-8', lg: 'h-8 w-8' }[size]
  const colors = variant === 'dark'
    ? 'bg-[#1A1614] text-white hover:bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(26,22,20,0.22),0_10px_24px_-10px_rgba(26,22,20,0.55)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_4px_rgba(26,22,20,0.2),0_18px_34px_-12px_rgba(26,22,20,0.6)] dark:bg-white dark:text-[#1A1614] dark:hover:bg-gray-100'
    : 'bg-white text-[#1A1614] hover:bg-[#FBF3E7] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_14px_30px_-12px_rgba(0,0,0,0.6)]'
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group relative inline-flex w-fit shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[transform,box-shadow,background-color] duration-300 ${EASE_CSS} hover:-translate-y-px active:translate-y-0 active:scale-[0.98] ${sizes} ${colors}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 -translate-x-[120%] skew-x-[-20deg] bg-gradient-to-r from-transparent to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[260%] ${variant === 'dark' ? 'via-white/20 dark:via-black/10' : 'via-[#E8672A]/15'}`}
      />
      <span className="relative">{label}</span>
      <span aria-hidden className={`relative flex items-center justify-center overflow-hidden rounded-full bg-[#E8672A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-transform duration-300 ${EASE_CSS} group-hover:scale-[1.06] ${disc}`}>
        <ArrowRight size={size === 'lg' ? 15 : 14} strokeWidth={2.25} className={`absolute transition-transform duration-300 ${EASE_CSS} group-hover:translate-x-[220%]`} />
        <ArrowRight size={size === 'lg' ? 15 : 14} strokeWidth={2.25} className={`absolute -translate-x-[220%] transition-transform duration-300 ${EASE_CSS} group-hover:translate-x-0`} />
      </span>
    </Link>
  )
}

/** Apple's "Learn more ›" link. */
function TextLink({
  href,
  label,
  tone = 'default',
  onClick,
}: {
  href: string
  label: string
  tone?: 'default' | 'light'
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group inline-flex min-h-[44px] items-center gap-0.5 rounded-full px-1 text-[15px] font-medium tracking-[-0.01em] ${tone === 'light' ? 'text-white' : 'text-[#B8441A] dark:text-[#FF9A63]'}`}
    >
      <span className="underline-offset-4 group-hover:underline">{label}</span>
      <ChevronRight size={16} strokeWidth={2.25} className={`transition-transform duration-300 ${EASE_CSS} group-hover:translate-x-1`} />
    </Link>
  )
}

export function LangMenu() {
  const { lang, setLang, t } = useI18n()
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!pos) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setPos(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPos(null)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    // Move focus into the menu so keyboard users land on the current language.
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${t('landing.nav.lang')} : ${LANG_NAMES[lang]}`}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={() => {
          if (pos) {
            setPos(null)
            return
          }
          const rect = btnRef.current?.getBoundingClientRect()
          if (!rect) return
          setPos({ top: rect.bottom + 10, right: window.innerWidth - rect.right })
        }}
        className={`${HEADER_GHOST} gap-2 px-2.5 text-[13px] font-medium uppercase tracking-wide`}
      >
        <Flag lang={lang} />
        {lang}
        <ChevronDown size={13} className={`opacity-60 transition-transform duration-200 ${pos ? 'rotate-180' : 'rotate-0'}`} />
      </button>
      {pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('landing.nav.lang')}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 2000 }}
          className="mf-menu-in mf-landing min-w-[210px] origin-top-right rounded-2xl border border-black/[0.06] bg-white/95 p-1.5 font-[family-name:var(--font-inter)] shadow-[0_16px_40px_-8px_rgba(26,22,20,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1C1916]/95"
        >
          {LANGS.map((code) => {
            const active = lang === code
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                lang={code}
                onClick={() => { setLang(code); setPos(null); btnRef.current?.focus() }}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors duration-150 active:opacity-70 ${active ? 'bg-[#FBF3E7] font-semibold text-[#1A1614] dark:bg-white/[0.06] dark:text-gray-50' : 'text-[#1A1614] hover:bg-[#FBF3E7] dark:text-gray-100 dark:hover:bg-white/5'}`}
              >
                <Flag lang={code} className="h-[16px] w-[24px]" />
                <span className="flex-1">{LANG_NAMES[code]}</span>
                {active
                  ? <Check size={15} strokeWidth={2.5} className="text-[#D4581F]" />
                  : <span className="text-[11px] uppercase tracking-wide text-[#6E5B50] dark:text-gray-400">{code}</span>}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function MapForAllLanding() {
  return (
    <LiveProvider>
      <Landing />
    </LiveProvider>
  )
}

function Landing() {
  const { dark, toggle } = useLandingTheme()
  const { t } = useI18n()
  const { paused } = useLive()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)

  // Every way into the app (header, hero, sections, footer) plays the
  // curtain transition instead of a hard page swap.
  useTransitionLinks(scrollRef, ['/login', '/chat'])

  // The page scrolls inside scrollRef, not the window.
  const { scrollY } = useScroll({ container: scrollRef })
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8))

  useEffect(() => {
    setSignedIn(!!localStorage.getItem('hodari_email'))
  }, [])

  useEffect(() => {
    if (menuOpen) {
      const id = requestAnimationFrame(() => setMenuVisible(true))
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
      document.addEventListener('keydown', onKey)
      return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', onKey) }
    }
    setMenuVisible(false)
  }, [menuOpen])

  const ctaHref = signedIn ? '/chat' : '/login'
  const goHow = (e: React.MouseEvent<HTMLAnchorElement>) => { if (scrollToHash('#how')) e.preventDefault() }
  const nav = [
    { label: t('landing.nav.how'), href: '#how' },
    { label: t('landing.nav.businesses'), href: '#businesses' },
    { label: t('landing.nav.access'), href: '#access' },
  ]
  const slides = [
    { src: '/landing/kigali-market-real.webp', tag: t('landing.cards.localKicker'), title: t('landing.cards.localTitle') },
    { src: '/landing/kigali-stall-real.webp', tag: t('landing.cards.tableKicker'), title: t('landing.cards.tableTitle') },
    { src: '/landing/kigali-street-real.webp', tag: t('landing.cards.accessKicker'), title: t('landing.cards.accessTitle') },
    { src: '/landing/kigali-city-real.webp', tag: t('landing.cards.missionKicker'), title: t('landing.cards.missionTitle') },
    { src: '/landing/kigali-view-real.webp', tag: t('landing.cards.sceneKicker'), title: t('landing.cards.sceneTitle') },
  ]
  const accessList = [1, 2, 3, 4].map((n) => t(`landing.access2.l${n}`))

  return (
    <ScrollRootProvider value={scrollRef}>
    <div
      ref={scrollRef}
      className={`mf-landing relative h-screen overflow-y-auto overflow-x-hidden scroll-smooth bg-[#FBF3E7] font-[family-name:var(--font-inter)] antialiased dark:bg-[#12100E] ${paused ? 'mf-paused' : ''}`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[3000] focus:rounded-full focus:bg-[#1A1614] focus:px-5 focus:py-3 focus:text-[14px] focus:font-medium focus:text-white"
      >
        {t('landing.a11y.skip')}
      </a>

      {/*
        Transparent header: no fill at the top of the page. Once content
        scrolls under it, it frosts with the page's own cream (not a new
        color) so text stays legible. z-[1000] keeps every page layer —
        Leaflet panes, map cards, transformed sections — underneath it.
      */}
      <header
        className={`sticky top-0 z-[1000] w-full border-b transition-[background-color,border-color,backdrop-filter] duration-500 ${EASE_CSS} ${scrolled
          ? 'border-black/[0.06] bg-[#FBF3E7]/75 backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.06] dark:bg-[#12100E]/75'
          : 'border-transparent bg-transparent'}`}
      >
        <nav aria-label="MapForAll" className="mx-auto flex h-[68px] w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <div className="flex items-center gap-8 xl:gap-10">
            <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full">
              <Mark />
              <span className="text-[15px] font-semibold tracking-[-0.015em] text-[#1A1614] dark:text-gray-100">
                MapForAll
                <span className="ml-2 hidden text-[11px] font-normal tracking-normal text-[#6E5B50] dark:text-gray-400 xl:inline">Ikarita ya Bose</span>
              </span>
            </Link>
            <div className="hidden items-center gap-6 lg:flex xl:gap-8">
              {nav.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault() }}
                  className="whitespace-nowrap text-[14px] font-medium tracking-[-0.01em] text-[#1A1614] transition-colors duration-200 hover:text-[#D4581F] active:opacity-70 dark:text-gray-100 dark:hover:text-[#FF9A63]"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-1.5 lg:flex">
            <span className="ml-4 mr-2 flex items-center gap-2 whitespace-nowrap text-[13px] text-[#6E5B50] dark:text-gray-400">
              <span aria-hidden className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8672A] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E8672A]" />
              </span>
              <span className="hidden xl:inline">{t('landing.nav.live')}</span>
              <span className="font-medium text-[#1A1614] dark:text-gray-100">
                <LiveClock timeZone="Africa/Kigali" bare />
              </span>
            </span>
            <span aria-hidden className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" />
            <ThemeToggle dark={dark} onToggle={toggle} className={`${HEADER_GHOST} w-9`} />
            <LangMenu />
            <span className="ml-2">
              <PillButton href={ctaHref} label={t('landing.nav.open')} size="sm" />
            </span>
          </div>

          <div className="flex items-center gap-1 lg:hidden">
            <LangMenu />
            <ThemeToggle dark={dark} onToggle={toggle} className={`${HEADER_GHOST} w-9`} />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              className="ml-1 flex h-10 items-center gap-2 rounded-full bg-[#1A1614] px-4 text-[14px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-colors duration-150 active:opacity-70 dark:bg-white dark:text-[#1A1614]"
            >
              <Menu size={16} />
              {t('landing.nav.menu')}
            </button>
          </div>
        </nav>
      </header>

      {menuOpen && (
        <div role="dialog" aria-modal="true" aria-label={t('landing.nav.menu')} className="fixed inset-0 z-[1100] lg:hidden">
          <div
            className={`absolute inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-300 ${menuVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setMenuOpen(false)}
          />
          <div className={`absolute inset-x-0 bottom-0 mx-3 mb-3 rounded-[32px] bg-[#FFF9F2] p-6 font-[family-name:var(--font-inter)] transition-transform duration-500 ${EASE_CSS} dark:bg-[#1C1916] ${menuVisible ? 'translate-y-0' : 'translate-y-[110%]'}`}>
            <div className="mb-6 flex items-center justify-between">
              <span className="text-[14px] text-[#6E5B50] dark:text-gray-400">
                {t('landing.nav.live')} · <span className="font-semibold text-[#1A1614] dark:text-gray-100"><LiveClock timeZone="Africa/Kigali" bare /></span>
              </span>
              <button type="button" autoFocus onClick={() => setMenuOpen(false)} className="flex h-10 items-center gap-2 rounded-full bg-[#1A1614] px-4 text-[14px] font-medium text-white dark:bg-white dark:text-[#1A1614]">
                <X size={16} />
                {t('landing.nav.close')}
              </button>
            </div>
            <div className="mb-8 flex flex-col gap-1">
              {nav.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault(); setMenuOpen(false) }}
                  className="flex min-h-[48px] items-center justify-between text-[23px] font-semibold tracking-[-0.025em] text-[#1A1614] dark:text-gray-100"
                >
                  {l.label}
                  <ChevronRight size={22} className="text-[#6E5B50]" />
                </Link>
              ))}
            </div>
            <PillButton href={ctaHref} label={t('landing.hero.cta')} size="md" />
          </div>
        </div>
      )}

      <main id="main" tabIndex={-1} className="outline-none">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        {/* Pulled up under the transparent header so the glow runs behind it
            instead of stopping at a hard line. */}
        <section id="top" ref={heroRef} className="relative -mt-[69px] overflow-hidden pb-16 pt-[69px] sm:pb-20">
          {/* Downtown Kigali at dusk, drifting slowly. A cream veil keeps the
              headline area almost solid and lets the city show through
              behind the phone; the bottom fades into the ticker. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <img
              src="/landing/kigali-city-real.webp"
              alt=""
              fetchPriority="high"
              className="hero-map-drift h-full w-full object-cover object-[center_45%] [filter:saturate(1.15)_sepia(0.22)]"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#FBF3E7]/[0.96] via-[#FBF3E7]/[0.82] to-[#FBF3E7]/[0.45] dark:from-[#12100E]/[0.94] dark:via-[#12100E]/[0.8] dark:to-[#12100E]/[0.45]" />
            <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#FBF3E7] to-transparent dark:from-[#12100E]" />
          </div>
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-220px] h-[760px] w-[1000px] -translate-x-1/2">
            <div className="mf-glow-drift h-full w-full rounded-full bg-[radial-gradient(closest-side,rgba(232,103,42,0.22),transparent)] blur-2xl dark:bg-[radial-gradient(closest-side,rgba(232,103,42,0.18),transparent)]" />
          </div>

          <HeroLayer target={heroRef} variant="copy" className="relative z-10 mx-auto max-w-[860px] px-5 pt-8 text-center sm:px-8 sm:pt-12">
            <IntroIn delay={0}>
              <Link
                href="#how"
                onClick={goHow}
                className="group mx-auto mb-6 inline-flex max-w-full items-center gap-2 rounded-full border border-black/[0.06] bg-white/75 py-1 pl-1 pr-3 text-[12px] font-medium text-[#1A1614] shadow-[0_6px_20px_-10px_rgba(90,40,10,0.35)] backdrop-blur-xl transition-colors duration-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100 sm:text-[13px]"
              >
                <span className="rounded-full bg-[#1A1614] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white dark:bg-white dark:text-[#1A1614]">{t('landing.hero2.pillNew')}</span>
                <span className="truncate">{t('landing.hero2.pill')}</span>
                <ChevronRight size={15} className={`shrink-0 transition-transform duration-300 ${EASE_CSS} group-hover:translate-x-0.5`} />
              </Link>
            </IntroIn>
            <h1 className="text-[clamp(2.5rem,6.4vw,5rem)] font-semibold leading-[1] tracking-[-0.042em] text-[#1A1614] dark:text-gray-50">
              <BlurInWords key={`a-${t('landing.hero2.titleA')}`} as="span" className="block" text={t('landing.hero2.titleA')} delay={0.1} />
              {' '}
              <BlurInWords key={`b-${t('landing.hero2.titleB')}`} as="span" className="block pb-[0.08em]" wordClassName="mf-gradient-text" text={t('landing.hero2.titleB')} delay={0.35} />
            </h1>
            <IntroIn delay={0.75}>
              <p className={`mx-auto mt-5 max-w-[40ch] sm:mt-6 ${LEAD}`}>{t('landing.hero2.sub')}</p>
            </IntroIn>
            <IntroIn delay={0.9} className="mt-7 flex flex-col items-center justify-center gap-2 sm:mt-8 sm:flex-row sm:gap-5">
              <PillButton href={ctaHref} label={t('landing.hero.cta')} size="lg" />
              <TextLink href="#how" label={t('landing.hero2.secondary')} onClick={goHow} />
            </IntroIn>
          </HeroLayer>

          <div className="relative mx-auto mt-10 max-w-[1080px] px-5 sm:mt-12 sm:px-8">
            <ScrollZoom>
              <div className="grid items-center gap-8 lg:grid-cols-[1fr_280px_1fr] lg:gap-10">
                <div className="hidden flex-col items-end gap-8 lg:flex">
                  <IntroIn delay={1.2} className="w-full max-w-[320px]">
                    <NotificationBanner offset={0} />
                  </IntroIn>
                  <IntroIn delay={1.45} className="hero-chip-float mr-10">
                    <span className="flex items-center gap-3 rounded-[20px] border border-black/[0.05] bg-white px-4 py-3 shadow-[0_16px_40px_-18px_rgba(90,40,10,0.35)] dark:border-white/10 dark:bg-[#1C1916]">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FBF3E7] text-[#D4581F] dark:bg-white/10"><MapPin size={17} /></span>
                      <span>
                        <span className="block text-[14px] font-semibold text-[#1A1614] dark:text-gray-50">{t('landing.hero.card1Title')}</span>
                        <span className="block text-[12px] text-[#6E5B50] dark:text-gray-400">{t('landing.hero.card1Meta')}</span>
                      </span>
                    </span>
                  </IntroIn>
                </div>

                <IntroIn delay={0.5} from="zoom" className="mx-auto w-[260px] sm:w-[280px] lg:w-full">
                  <TalkingDevice />
                </IntroIn>

                <div className="hidden flex-col items-start gap-8 lg:flex">
                  <IntroIn delay={1.35} className="hero-chip-float-late ml-10">
                    <span className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-black/[0.05] bg-white px-4 py-2.5 shadow-[0_16px_40px_-18px_rgba(90,40,10,0.35)] dark:border-white/10 dark:bg-[#1C1916]">
                      <Accessibility size={17} className="text-[#D4581F]" />
                      <span className="text-[14px] font-medium text-[#1A1614] dark:text-gray-50">{t('landing.hero.badge')}</span>
                      <span className="rounded-full bg-[#1A1614] px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white dark:text-[#1A1614]">{t('landing.hero.live')}</span>
                    </span>
                  </IntroIn>
                  <IntroIn delay={1.6} className="w-full max-w-[320px]">
                    <NotificationBanner offset={1} />
                  </IntroIn>
                </div>
              </div>
              <div className="mx-auto mt-8 flex max-w-[360px] items-center gap-3 lg:hidden">
                <NotificationBanner offset={0} className="flex-1" />
              </div>
            </ScrollZoom>
            <div className="mt-6 flex justify-center lg:absolute lg:bottom-0 lg:right-8 lg:mt-0">
              <PauseToggle />
            </div>
          </div>
        </section>

        <CommunityTicker />

        {/* ── The gap (quote) ──────────────────────────────────────────── */}
        <section id="about" className={`bg-[#FFF9F2] px-5 dark:bg-[#1A1614] sm:px-8 lg:px-12 ${SECTION_Y}`}>
          <div className="mx-auto max-w-[900px] text-center">
            <ScrollReveal exit={false}>
              <p className={EYEBROW}>{t('landing.about.badge')}</p>
            </ScrollReveal>
            <ScrollHighlight
              text={`« ${t('landing.about.quote')} »`}
              className="text-[clamp(1.7rem,3.6vw,2.9rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-[#1A1614] dark:text-gray-50"
            />
            <ScrollReveal stagger={0.05} className="mx-auto mt-8 max-w-[56ch]">
              <p className={LEAD}>{t('landing.about.body')}</p>
              <div className="mt-6 flex justify-center">
                <TextLink href={ctaHref} label={t('landing.about.cta')} />
              </div>
            </ScrollReveal>
          </div>
          <div className="mx-auto mt-12 grid max-w-[1120px] gap-4 sm:mt-16 sm:grid-cols-2">
            <ScrollZoom>
              <ParallaxImage src="/landing/kigali-market-real.webp" alt={t('landing.about.marketAlt')} className="aspect-[3/2] w-full rounded-[26px]" />
            </ScrollZoom>
            <ScrollZoom>
              <ParallaxImage src="/landing/kigali-view-real.webp" alt={t('landing.about.aerialAlt')} className="aspect-[3/2] w-full rounded-[26px]" />
            </ScrollZoom>
          </div>
          <p className="mx-auto mt-3 max-w-[1120px] text-[12px] text-[#6E5B50] dark:text-gray-400">{t('landing.about.credit')}</p>
        </section>

        {/* ── Numbers ──────────────────────────────────────────────────── */}
        <section aria-labelledby="stats-title" className={`px-5 sm:px-8 lg:px-12 ${SECTION_Y}`}>
          <div className="mx-auto max-w-[1080px]">
            <ScrollReveal exit={false} className="text-center">
              <p className={EYEBROW}>{t('landing.stats.eyebrow')}</p>
              <h2 id="stats-title" className={H2}>{t('landing.stats.title')}</h2>
            </ScrollReveal>
            <dl className="mt-10 grid gap-4 sm:mt-14 md:grid-cols-3">
              {[
                { value: <CountUp to={3} />, label: t('landing.stats.s1') },
                { value: <CountUp from={99} to={0} />, label: t('landing.stats.s2') },
                { value: <CountUp to={50} suffix=" m" />, label: t('landing.stats.s3') },
              ].map((s, i) => (
                <ScrollReveal key={i} stagger={i * 0.04} exit={false}>
                  <div className={TILE}>
                    <dt className="sr-only">{s.label}</dt>
                    <dd>
                      <span className="mf-gradient-text block text-[clamp(3rem,5.5vw,4.25rem)] font-semibold leading-none tracking-[-0.05em]">{s.value}</span>
                      <span className="mt-3 block text-[15px] leading-snug text-[#1A1614] dark:text-gray-200">{s.label}</span>
                    </dd>
                  </div>
                </ScrollReveal>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Bento ────────────────────────────────────────────────────── */}
        <section aria-labelledby="bento-title" className={`bg-[#F3E6D4] px-5 dark:bg-[#0E0C0A] sm:px-8 lg:px-12 ${SECTION_Y}`}>
          <div className="mx-auto max-w-[1080px]">
            <ScrollReveal exit={false} className="mx-auto max-w-[720px] text-center">
              <p className={EYEBROW}>{t('landing.bento.eyebrow')}</p>
              <h2 id="bento-title" className={H2}>{t('landing.bento.title')}</h2>
            </ScrollReveal>

            <div className="mt-10 grid gap-4 sm:mt-14 lg:grid-cols-6">
              <ScrollReveal exit={false} className="lg:col-span-4">
                <article className={`${TILE} grid items-center gap-8 md:grid-cols-2`}>
                  <div>
                    <Store size={24} className="mb-4 text-[#D4581F]" aria-hidden />
                    <h3 className={TILE_TITLE}>{t('landing.bento.localTitle')}</h3>
                    <p className={TILE_BODY}>{t('landing.bento.localBody')}</p>
                  </div>
                  <RankingDemo />
                </article>
              </ScrollReveal>

              <ScrollReveal exit={false} stagger={0.04} className="lg:col-span-2 lg:row-span-2">
                <article className="group relative h-full min-h-[360px] overflow-hidden rounded-[26px] bg-[#1A1614] shadow-[0_18px_48px_-24px_rgba(90,40,10,0.4)]">
                  <img src="/landing/kigali-ramp.webp" alt="" loading="lazy" className={`absolute inset-0 h-full w-full object-cover transition-transform duration-[1.2s] ${EASE_CSS} group-hover:scale-105`} />
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                  <span aria-hidden className="absolute left-6 top-6 flex items-center gap-2 rounded-full bg-white/90 py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold text-[#1A1614] shadow-lg backdrop-blur-xl">
                    <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-[#1F8A5B] text-white">
                      <span className="absolute inset-0 animate-ping rounded-full bg-[#1F8A5B]/50" />
                      <Check size={13} strokeWidth={3} className="relative" />
                    </span>
                    {t('landing.bento.accessBadge')}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
                    <h3 className="text-[21px] font-semibold leading-[1.18] tracking-[-0.022em] text-white sm:text-[23px]">{t('landing.bento.accessTitle')}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-white/85 sm:text-[15px]">{t('landing.bento.accessBody')}</p>
                  </div>
                </article>
              </ScrollReveal>

              <ScrollReveal exit={false} className="lg:col-span-2">
                <article className={`${TILE} flex flex-col justify-between gap-8`}>
                  <div>
                    <h3 className={TILE_TITLE}>{t('landing.bento.voiceTitle')}</h3>
                    <p className={TILE_BODY}>{t('landing.bento.voiceBody')}</p>
                  </div>
                  <VoiceDemo />
                </article>
              </ScrollReveal>

              <ScrollReveal exit={false} stagger={0.04} className="lg:col-span-2">
                <article className={`${TILE} flex flex-col justify-between gap-6`}>
                  <div>
                    <h3 className={TILE_TITLE}>{t('landing.bento.langTitle')}</h3>
                    <p className={TILE_BODY}>{t('landing.bento.langBody')}</p>
                  </div>
                  <GreetingCycler />
                  <p className="flex flex-wrap gap-2">
                    {LANGS.map((code) => (
                      <span key={code} lang={code} className="flex items-center gap-1.5 rounded-full bg-[#FBF3E7] px-2.5 py-1 text-[12px] font-medium text-[#1A1614] dark:bg-white/[0.06] dark:text-gray-200">
                        <Flag lang={code} className="h-[11px] w-[16px] rounded-[2px]" />
                        {LANG_NAMES[code]}
                      </span>
                    ))}
                  </p>
                </article>
              </ScrollReveal>

              <ScrollReveal exit={false} className="lg:col-span-3">
                <article className={`${TILE} grid items-center gap-8 sm:grid-cols-2`}>
                  <h3 className={TILE_TITLE}>{t('landing.bento.addTitle')}</h3>
                  <AddPlaceDemo />
                </article>
              </ScrollReveal>

              <ScrollReveal exit={false} stagger={0.04} className="lg:col-span-3">
                <article className={`${TILE} flex flex-col justify-between gap-8`}>
                  <div>
                    <h3 className={TILE_TITLE}>{t('landing.bento.trustTitle')}</h3>
                    <p className={TILE_BODY}>{t('landing.bento.trustBody')}</p>
                  </div>
                  <ConfirmDemo />
                </article>
              </ScrollReveal>
            </div>
          </div>
        </section>

        <HowItWorks />

        {/* ── Businesses ───────────────────────────────────────────────── */}
        <section id="businesses" className={`overflow-hidden bg-[#F3E6D4] dark:bg-[#0E0C0A] ${SECTION_Y}`}>
          <div className="mx-auto grid max-w-[1080px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-12">
            <ScrollReveal exit={false}>
              <p className={EYEBROW}>{t('landing.work.badge')}</p>
              <h2 className={H2}>{t('landing.work.title')}</h2>
              <p className={`mt-5 max-w-[42ch] ${LEAD}`}>{t('landing.work.body')}</p>
              <div className="mt-7">
                <PillButton href={ctaHref} label={t('landing.work.cta')} />
              </div>
            </ScrollReveal>

            <ScrollZoom>
              <div aria-hidden className="relative mx-auto max-w-[380px]">
                <div className="rounded-[28px] border border-black/[0.05] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(90,40,10,0.45)] dark:border-white/[0.07] dark:bg-[#1C1916]">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[#6E5B50] dark:text-gray-400">{t('landing.biz.card')}</span>
                    <span className="rounded-full bg-[#FBF3E7] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#B8441A] dark:bg-white/10 dark:text-[#FF9A63]">{t('landing.biz.preview')}</span>
                  </div>
                  <div className="mt-5 flex items-center gap-3.5">
                    <img src="/landing/kigali-table.webp" alt="" className="h-12 w-12 rounded-[14px] object-cover" />
                    <span>
                      <span className="block text-[17px] font-semibold tracking-[-0.02em] text-[#1A1614] dark:text-gray-50">Duka rya Jean</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-[#1F8A5B]">
                        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1F8A5B] opacity-60" /><span className="relative h-2 w-2 rounded-full bg-[#1F8A5B]" /></span>
                        {t('landing.biz.visible')}
                      </span>
                    </span>
                  </div>
                  <div className="mt-6 flex items-end justify-between gap-6">
                    <span>
                      <CountUp to={248} className="block text-[42px] font-semibold leading-none tracking-[-0.04em] text-[#1A1614] dark:text-gray-50" />
                      <span className="mt-2 block max-w-[16ch] text-[14px] leading-snug text-[#6E5B50] dark:text-gray-400">{t('landing.biz.views')}</span>
                    </span>
                    <span className="w-[55%]"><GrowingBars /></span>
                  </div>
                </div>
                <span className="hero-chip-float absolute -right-3 -top-5 flex items-center gap-2 rounded-full bg-[#1A1614] px-3.5 py-2 text-[12px] font-semibold text-white shadow-xl dark:bg-white dark:text-[#1A1614] sm:-right-8">
                  <MapPin size={13} className="text-[#E8672A]" />
                  {t('landing.hero.card1Title')}
                </span>
              </div>
            </ScrollZoom>
          </div>

          <div className="mt-16">
            <ScrollDriftX>
              <ShowcaseMarquee slides={slides} />
            </ScrollDriftX>
          </div>
        </section>

        {/* ── Accessibility ────────────────────────────────────────────── */}
        <section id="access" className={`bg-[#FFF9F2] px-5 dark:bg-[#1A1614] sm:px-8 lg:px-12 ${SECTION_Y}`}>
          <div className="mx-auto grid max-w-[1080px] items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <ScrollReveal exit={false}>
                <p className={EYEBROW}>{t('landing.nav.access')}</p>
                <h2 className={H2}>{t('landing.access2.title')}</h2>
                <p className={`mt-5 max-w-[42ch] ${LEAD}`}>{t('landing.access2.body')}</p>
              </ScrollReveal>
              <ul className="mt-7 flex flex-col gap-2.5">
                {accessList.map((item, i) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ amount: 0.8 }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: APPLE_EASE }}
                    className="flex items-center gap-3 text-[15px] font-medium text-[#1A1614] dark:text-gray-100"
                  >
                    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1F8A5B] text-white">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {item}
                  </motion.li>
                ))}
              </ul>
              <ScrollReveal exit={false} className="mt-8">
                <PillButton href={ctaHref} label={t('landing.demo.cta')} />
              </ScrollReveal>
            </div>
            <ScrollZoom>
              <div className="overflow-hidden rounded-[28px] shadow-[0_30px_80px_-30px_rgba(90,40,10,0.45)] [&>div]:h-[400px] [&>div]:max-w-none [&>div]:rounded-[28px]">
                <DistrictMap bubble={t('landing.demo.bubble')} />
              </div>
            </ScrollZoom>
          </div>
        </section>

        {/* ── Closing call to action ───────────────────────────────────── */}
        <section className="px-3 py-14 sm:px-8 sm:py-20 lg:px-12">
          <ScrollZoom>
            <div className="relative mx-auto max-w-[1120px] overflow-hidden rounded-[34px] bg-[#0E0C0A] px-6 py-20 text-center sm:py-24">
              {/* Kigali Convention Centre at night (Wikimedia Commons, IGANZE,
                  CC0), drifting slowly. The veil is darkest in the middle,
                  where the white text sits, so it always reads clearly. */}
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <img
                  src="/landing/kigali-convention-center.webp"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="hero-map-drift h-full w-full object-cover object-[center_40%]"
                />
                <div className="absolute inset-0 bg-[#0E0C0A]/40" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(14,12,10,0.7),transparent)]" />
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0E0C0A]/80 to-transparent" />
              </div>
              <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2">
                <div className="mf-glow-drift h-full w-full rounded-full bg-[radial-gradient(closest-side,rgba(232,103,42,0.28),transparent)] blur-3xl" />
              </div>
              <div className="relative">
                <div className="flex justify-center"><Mark /></div>
                <h2 className="mx-auto mt-6 max-w-[14ch] text-[clamp(2.2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.042em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]">
                  {t('landing.final.title')}
                </h2>
                <p className="mx-auto mt-5 max-w-[36ch] text-[16px] leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.5)] sm:text-[18px]">{t('landing.final.body')}</p>
                <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-5">
                  <PillButton href={ctaHref} label={t('landing.hero.cta')} size="lg" variant="light" />
                  <TextLink href={ctaHref} label={t('landing.about.cta')} tone="light" />
                </div>
              </div>
            </div>
          </ScrollZoom>
        </section>
      </main>

      <footer className="border-t border-black/[0.06] dark:border-white/10">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-5 px-5 py-10 text-[14px] text-[#6E5B50] dark:text-gray-400 sm:flex-row sm:items-center sm:px-8 lg:px-12">
          <span className="flex items-center gap-2.5">
            <Mark size="sm" />
            {t('landing.footer.copy')}
          </span>
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/login" className="inline-flex min-h-[44px] items-center transition-colors duration-150 hover:text-[#1A1614] active:opacity-70 dark:hover:text-gray-100">{t('landing.footer.signin')}</Link>
            <a href="#top" onClick={(e) => { if (scrollToHash('#top')) e.preventDefault() }} className="inline-flex min-h-[44px] items-center transition-colors duration-150 hover:text-[#1A1614] active:opacity-70 dark:hover:text-gray-100">{t('landing.footer.top')}</a>
            <span className="text-[13px]">{t('landing.footer.unipod')}</span>
          </span>
        </div>
      </footer>
    </div>
    </ScrollRootProvider>
  )
}
