'use client'

/**
 * ConnectRwanda AI design tokens and brand pieces shared by the auth pages:
 * dark/light palettes, the logo mark and wordmark, the Rwanda flag, the
 * language and theme switches, and the theme preference (localStorage
 * `cr_theme`, the same key as the landing page).
 */

import { useEffect, useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useI18n, type Lang } from '@/components/I18nProvider'
import type { Pal } from '@/components/landing/CityMap'

export type Theme = 'dark' | 'light'
export type Palette = Pal & {
  bg2: string; surface2: string; field: string; faint: string; yellowText: string; grid: string
  glass: string; glassLine: string; shadow: string; glow: string
  accent: string; seg: string; segThumb: string
}
export const CR_DARK: Palette = {
  bg: '#050A16', bg2: '#081022', surface: '#0C1629', surface2: '#111E36', field: '#0A1427',
  line: 'rgba(148,178,255,0.14)', text: '#EAF1FF', muted: '#9AABCB', faint: '#7387AB', grid: 'rgba(148,178,255,0.16)',
  blue: '#21B3F2', green: '#22C47A', yellow: '#FAD201', yellowText: '#FAD201', violet: '#B48CFF', red: '#FF7A7A',
  glass: 'rgba(12,22,41,0.82)', glassLine: 'rgba(255,255,255,0.10)',
  shadow: '0 30px 80px -50px rgba(0,0,0,0.9)', glow: '33',
  accent: '#0A84FF', seg: 'rgba(118,118,128,0.24)', segThumb: '#636366',
}
export const CR_LIGHT: Palette = {
  bg: '#EEF3F9', bg2: '#F8FAFD', surface: '#FFFFFF', surface2: '#F2F6FB', field: '#F7F9FC',
  line: 'rgba(15,30,60,0.11)', text: '#08122B', muted: '#3A4A68', faint: '#5A6A85', grid: 'rgba(15,30,60,0.12)',
  blue: '#0077C8', green: '#0B8A50', yellow: '#F5C400', yellowText: '#7A5E00', violet: '#5B3FD0', red: '#C42F2F',
  glass: 'rgba(255,255,255,0.9)', glassLine: 'rgba(255,255,255,1)',
  shadow: '0 1px 2px rgba(15,30,60,0.06), 0 24px 60px -30px rgba(15,40,90,0.30)', glow: '2a',
  accent: '#0071E3', seg: 'rgba(118,118,128,0.12)', segThumb: '#FFFFFF',
}
export const CR_EASE = [0.22, 1, 0.36, 1] as const
export const CR_DISPLAY = 'font-[family-name:var(--font-display)]'

export function paletteVars(P: Palette): React.CSSProperties {
  return Object.fromEntries(Object.entries(P).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties
}

/** Theme preference shared with the landing page. */
export function useCrTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cr_theme')
      setTheme(saved === 'light' || saved === 'dark' ? saved : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
    } catch { /* storage unavailable */ }
  }, [])
  const toggle = () => setTheme((th) => {
    const next: Theme = th === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('cr_theme', next) } catch { /* ignore */ }
    return next
  })
  return { theme, toggle, P: theme === 'dark' ? CR_DARK : CR_LIGHT }
}

export function CRMark({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#22C47A" />
          <stop offset="1" stopColor="#21B3F2" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="#0B1630" stroke="rgba(255,255,255,0.14)" />
      <path d="M27.78 27.78 A11 11 0 1 1 27.78 12.22" fill="none" stroke={`url(#m${id})`} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="27.78" cy="12.22" r="3.4" fill="#FAD201" stroke="#0B1630" strokeWidth="1.6" />
      <circle cx="20" cy="20" r="2.6" fill="#EAF1FF" />
    </svg>
  )
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      <CRMark size={34} />
      <span className={`${CR_DISPLAY} text-[17px] font-semibold tracking-[-0.02em] ${light ? 'text-white' : 'text-[var(--text)]'}`}>ConnectRwanda</span>
      <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] ${light ? 'border-white/25 text-white/80' : 'border-[var(--line)] text-[var(--muted)]'}`}>AI</span>
    </span>
  )
}

export function RwandaFlag({ className = '' }: { className?: string }) {
  const rays = Array.from({ length: 48 }).map((_, i) => {
    const r = i % 2 === 0 ? 112 : 74
    const a = (i * Math.PI) / 24 - Math.PI / 2
    return `${846 + r * Math.cos(a)},${186 + r * Math.sin(a)}`
  }).join(' ')
  return (
    <svg viewBox="0 0 1080 720" className={className} role="img" aria-label="Flag of Rwanda" preserveAspectRatio="xMidYMid slice">
      <rect width="1080" height="360" fill="#00A1DE" />
      <rect y="360" width="1080" height="180" fill="#FAD201" />
      <rect y="540" width="1080" height="180" fill="#20603D" />
      <polygon points={rays} fill="#E5BE01" />
      <circle cx="846" cy="186" r="66" fill="#00A1DE" />
      <circle cx="846" cy="186" r="56" fill="#E5BE01" />
    </svg>
  )
}

const LANGS: Lang[] = ['rw', 'fr', 'en']
export function LangSwitch({ id }: { id: string }) {
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

export function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const { t } = useI18n()
  const label = t(theme === 'dark' ? 'cr.theme.light' : 'cr.theme.dark')
  return (
    <button type="button" onClick={onToggle} aria-label={label} title={label}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--text)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 16, rotate: -90, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: -16, rotate: 90, opacity: 0 }} transition={{ duration: 0.35, ease: CR_EASE }}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
