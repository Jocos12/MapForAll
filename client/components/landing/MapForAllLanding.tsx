'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowRight, ChevronDown, Globe, MapPin, Menu, X } from 'lucide-react'
import {
  LiveClock,
  Reveal,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'
import HeroMap from '@/components/landing/HeroMap'
import ShowcaseMarquee from '@/components/landing/ShowcaseMarquee'
import DistrictMap from '@/components/landing/DistrictMap'
import { useI18n, type Lang } from '@/components/I18nProvider'

const LANGS: Lang[] = ['fr', 'en', 'rw']

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

function OrangeCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-2 rounded-full bg-[#E8672A] py-2.5 pl-5 pr-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#d4581f] active:opacity-70 sm:text-[14px]"
    >
      {label}
      <ArrowRight size={14} />
    </Link>
  )
}

function SectionBadge({ number, label }: { number: string; label: string }) {
  return (
    <div className="mb-6 flex items-center gap-3 px-5 sm:mb-8 sm:px-8 lg:px-12">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A1614] text-[11px] font-semibold text-white dark:bg-white dark:text-[#1A1614] sm:h-7 sm:w-7 sm:text-[12px]">
        {number}
      </span>
      <span className="rounded-full border border-[#E4D2BE] px-3 py-1 text-[12px] font-medium text-[#1A1614] dark:border-white/15 dark:text-gray-100 sm:px-4 sm:py-1.5 sm:text-[13px]">
        {label}
      </span>
    </div>
  )
}

function LangMenu() {
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
      if (event.key === 'Escape') setPos(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
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
        aria-label={t('landing.nav.lang')}
        aria-expanded={pos !== null}
        onClick={() => {
          if (pos) {
            setPos(null)
            return
          }
          const rect = btnRef.current?.getBoundingClientRect()
          if (!rect) return
          setPos({ top: rect.bottom + 12, right: window.innerWidth - rect.right })
        }}
        className="relative flex items-center gap-1.5 rounded-full border border-black/10 bg-[#FBF3E7] px-2.5 py-1.5 text-[12px] font-medium uppercase tracking-wide text-[#1A1614] transition-colors duration-150 hover:bg-[#F3E6D4] active:opacity-70 dark:border-white/15 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15"
      >
        <Globe size={13} />
        {lang}
        <ChevronDown size={12} className={`transition-transform duration-150 ${pos ? 'rotate-180' : 'rotate-0'}`} />
      </button>
      {pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 2000 }}
          className="mf-menu-in min-w-[92px] origin-top-right overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_12px_32px_rgba(26,22,20,0.18)] dark:border-white/10 dark:bg-[#1C1916]"
        >
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => { setLang(code); setPos(null) }}
              className={`block w-full px-3 py-1.5 text-left text-[12px] uppercase transition-colors duration-150 active:opacity-70 ${lang === code ? 'text-[#E8672A]' : 'text-[#1A1614] hover:bg-[#FBF3E7] dark:text-gray-100 dark:hover:bg-white/5'}`}
            >
              {code}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function MapForAllLanding() {
  const { dark, toggle } = useLandingTheme()
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    setSignedIn(!!localStorage.getItem('hodari_email'))
  }, [])

  useEffect(() => {
    if (menuOpen) {
      const id = requestAnimationFrame(() => setMenuVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setMenuVisible(false)
  }, [menuOpen])

  const ctaHref = signedIn ? '/chat' : '/login'
  const nav = [
    { label: t('landing.nav.how'), href: '#about' },
    { label: t('landing.nav.businesses'), href: '#businesses' },
    { label: t('landing.nav.access'), href: '#access' },
  ]
  const slides = [
    { src: '/landing/kigali-market-real.jpg', tag: t('landing.cards.localKicker'), title: t('landing.cards.localTitle') },
    { src: '/landing/kigali-stall-real.jpg', tag: t('landing.cards.tableKicker'), title: t('landing.cards.tableTitle') },
    { src: '/landing/kigali-street-real.jpg', tag: t('landing.cards.accessKicker'), title: t('landing.cards.accessTitle') },
    { src: '/landing/kigali-city-real.jpg', tag: t('landing.cards.missionKicker'), title: t('landing.cards.missionTitle') },
    { src: '/landing/kigali-view-real.jpg', tag: t('landing.cards.sceneKicker'), title: t('landing.cards.sceneTitle') },
  ]

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden scroll-smooth bg-[#FBF3E7] dark:bg-[#12100E]">
      <header className="sticky top-0 z-40 mx-auto mb-2 w-full max-w-[1440px] p-2 sm:p-3">
        <nav className="flex items-center justify-between rounded-full border border-black/[0.04] bg-white/90 p-[5px] shadow-[0_8px_28px_rgba(90,40,10,0.08)] backdrop-blur-md dark:border-white/10 dark:bg-[#1C1916]/90 dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-6 pl-1">
            <Link href="/" className="flex items-center gap-2.5">
              <Mark />
              <span className="text-[14px] font-semibold tracking-tight text-[#1A1614] dark:text-gray-100">
                MapForAll
                <span className="ml-2 hidden text-[11px] font-normal text-[#8A7364] dark:text-gray-400 lg:inline">Ikarita ya Bose</span>
              </span>
            </Link>
            <div className="hidden items-center gap-6 lg:flex">
              {nav.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault() }}
                  className="text-[14px] text-[#1A1614] transition-colors duration-150 hover:text-[#E8672A] active:opacity-70 dark:text-gray-100"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <span className="hidden text-[13px] text-[#6E5B50] dark:text-gray-400 lg:block">{t('landing.nav.live')}</span>
            <LiveClock city="Kigali" timeZone="Africa/Kigali" />
            <ThemeToggle dark={dark} onToggle={toggle} />
            <LangMenu />
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-full bg-[#1A1614] py-2.5 pl-5 pr-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-black active:opacity-70 dark:bg-white dark:text-[#1A1614] dark:hover:bg-gray-100"
            >
              {t('landing.nav.open')}
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <LangMenu />
            <ThemeToggle dark={dark} onToggle={toggle} />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex items-center gap-2 rounded-full bg-[#1A1614] px-4 py-2.5 text-[13px] font-medium text-white transition-colors duration-150 active:opacity-70 dark:bg-white dark:text-[#1A1614]"
            >
              <Menu size={15} />
              {t('landing.nav.menu')}
            </button>
          </div>
        </nav>
      </header>

      <section id="top" className="relative overflow-hidden">
        <div className="mx-auto grid min-h-[calc(100svh-88px)] w-full max-w-[1440px] items-center gap-8 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:px-12 lg:pb-20 lg:pt-4">
          <div className="relative z-10">
            <p className="mb-5 animate-[fadeUp_280ms_40ms_both] text-[13px] tracking-wide text-[#1A1614] motion-reduce:animate-none dark:text-gray-200 sm:mb-7 sm:text-[14px]">
              {t('landing.hero.kicker')}
            </p>
            <h1 className="max-w-[16ch] animate-[fadeUp_280ms_80ms_both] font-display text-[clamp(2rem,5.4vw,4.4rem)] font-semibold leading-[1.04] tracking-[-0.025em] text-[#1A1614] motion-reduce:animate-none dark:text-gray-50">
              {t('landing.hero.title')}
            </h1>
            <p className="mt-5 max-w-[48ch] animate-[fadeUp_280ms_120ms_both] text-[15px] leading-relaxed text-[#6E5B50] motion-reduce:animate-none dark:text-gray-300 sm:mt-6 sm:text-[17px]">
              {t('landing.hero.body')}
            </p>
            <div className="mt-8 flex animate-[fadeUp_280ms_160ms_both] flex-col gap-4 motion-reduce:animate-none sm:mt-10 sm:flex-row sm:items-center sm:gap-5">
              <OrangeCta href={ctaHref} label={t('landing.hero.cta')} />
              <span className="flex w-fit items-center gap-2.5 rounded-full bg-white px-3 py-2 shadow-[0_8px_24px_rgba(90,40,10,0.08)] dark:bg-[#1C1916]">
                <MapPin size={15} strokeWidth={2.5} className="text-[#E8672A]" />
                <span className="text-[13px] font-medium text-[#1A1614] dark:text-gray-100 sm:text-[14px]">{t('landing.hero.badge')}</span>
                <span className="rounded-full bg-[#E8672A] px-2 py-0.5 text-[10px] text-white sm:text-[11px]">{t('landing.hero.live')}</span>
              </span>
            </div>
          </div>
          <HeroMap
            className="relative mx-auto w-full max-w-[460px] lg:mt-10 lg:max-w-none"
            marketTitle={t('landing.hero.card1Title')}
            marketMeta={t('landing.hero.card1Meta')}
            placeTitle={t('landing.hero.card2Title')}
            placeMeta={t('landing.hero.card2Meta')}
          />
        </div>
      </section>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${menuVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setMenuOpen(false)}
          />
          <div className={`absolute inset-x-0 bottom-0 mx-3 mb-3 rounded-2xl bg-[#FFF9F2] p-6 transition-transform duration-200 ease-out dark:bg-[#1C1916] ${menuVisible ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="mb-6 flex items-center justify-between">
              <LiveClock city="Kigali" timeZone="Africa/Kigali" />
              <button type="button" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-full bg-[#1A1614] px-4 py-2.5 text-[13px] font-medium text-white dark:bg-white dark:text-[#1A1614]">
                <X size={15} />
                {t('landing.nav.close')}
              </button>
            </div>
            <div className="mb-8 flex flex-col gap-4">
              {nav.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault(); setMenuOpen(false) }}
                  className="font-display text-[28px] leading-[32px] text-[#1A1614] dark:text-gray-100"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <OrangeCta href={ctaHref} label={t('landing.hero.cta')} />
          </div>
        </div>
      )}

      <section id="about" className="overflow-hidden bg-[#FFF9F2] pb-14 pt-16 dark:bg-[#1A1614] sm:pb-16 sm:pt-20 lg:pb-24 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="1" label={t('landing.about.badge')} />
          <div className="grid items-end gap-8 px-5 sm:px-8 lg:grid-cols-[1.3fr_0.7fr] lg:px-12">
            <Reveal>
              <h2 className="font-display text-[clamp(1.7rem,4.2vw,3.3rem)] font-semibold italic leading-[1.12] tracking-[-0.02em] text-[#1A1614] dark:text-gray-50">
                « {t('landing.about.quote')} »
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="text-[15px] font-medium leading-[1.65] text-[#3A2E28] dark:text-gray-200 sm:text-[17px]">
                {t('landing.about.body')}
              </p>
              <div className="mt-6">
                <OrangeCta href={ctaHref} label={t('landing.about.cta')} />
              </div>
            </Reveal>
          </div>
          <div className="mt-10 grid gap-4 px-5 sm:mt-14 sm:grid-cols-2 sm:gap-5 sm:px-8 lg:px-12">
            <Reveal>
              <img src="/landing/kigali-market-real.jpg" alt={t('landing.about.marketAlt')} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-2xl object-cover" />
            </Reveal>
            <Reveal delay={80}>
              <img src="/landing/kigali-view-real.jpg" alt={t('landing.about.aerialAlt')} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-2xl object-cover" />
            </Reveal>
          </div>
          <p className="mt-3 px-5 text-[11px] text-[#8A7364] dark:text-gray-500 sm:px-8 lg:px-12">{t('landing.about.credit')}</p>
        </div>
      </section>

      <section id="businesses" className="overflow-hidden bg-[#F3E6D4] pb-16 pt-16 dark:bg-[#0E0C0A] sm:pb-20 sm:pt-20 lg:pb-28 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="2" label={t('landing.work.badge')} />
          <Reveal>
            <h2 className="mb-4 px-5 font-display text-[clamp(1.9rem,6vw,4.2rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[#1A1614] dark:text-gray-50 sm:px-8 lg:px-12">
              {t('landing.work.title')}
            </h2>
            <p className="mb-10 max-w-[58ch] px-5 text-[14px] leading-relaxed text-[#6E5B50] dark:text-gray-400 sm:mb-12 sm:px-8 sm:text-[16px] lg:px-12">
              {t('landing.work.body')}
            </p>
          </Reveal>
        </div>
        <Reveal delay={100}>
          <ShowcaseMarquee slides={slides} />
        </Reveal>
        <div className="mx-auto mt-10 max-w-[1440px] px-5 sm:mt-12 sm:px-8 lg:px-12">
          <OrangeCta href={ctaHref} label={t('landing.work.cta')} />
        </div>
      </section>

      <section id="access" className="overflow-hidden bg-[#FFF9F2] pb-16 pt-16 dark:bg-[#1A1614] sm:pb-20 sm:pt-20 lg:pb-28 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="3" label={t('landing.demo.badge')} />
          <div className="grid items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-12">
            <Reveal>
              <h2 className="mb-5 font-display text-[clamp(1.7rem,4.4vw,3.2rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-[#1A1614] dark:text-gray-50">
                {t('landing.demo.title')}
              </h2>
              <p className="mb-8 max-w-[46ch] text-[15px] leading-relaxed text-[#6E5B50] dark:text-gray-300 sm:text-[17px]">
                {t('landing.demo.body')}
              </p>
              <OrangeCta href={ctaHref} label={t('landing.demo.cta')} />
            </Reveal>
            <Reveal delay={120}>
              <DistrictMap bubble={t('landing.demo.bubble')} />
            </Reveal>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#E4D2BE] bg-[#F3E6D4] dark:border-white/10 dark:bg-[#0E0C0A]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-4 px-5 py-8 text-[13px] text-[#6E5B50] dark:text-gray-400 sm:flex-row sm:items-center sm:px-8 lg:px-12">
          <span className="flex items-center gap-2.5">
            <Mark size="sm" />
            {t('landing.footer.copy')}
          </span>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/login" className="transition-colors duration-150 hover:text-[#1A1614] active:opacity-70 dark:hover:text-gray-100">{t('landing.footer.signin')}</Link>
            <a href="#top" onClick={(e) => { if (scrollToHash('#top')) e.preventDefault() }} className="transition-colors duration-150 hover:text-[#1A1614] active:opacity-70 dark:hover:text-gray-100">{t('landing.footer.top')}</a>
            <span className="text-[12px] text-[#8A7364] dark:text-gray-500">{t('landing.footer.unipod')}</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
