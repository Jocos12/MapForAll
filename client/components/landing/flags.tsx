'use client'

import { useId } from 'react'
import type { Lang } from '@/components/I18nProvider'

/**
 * Inline SVG flags for the language picker. Emoji flags are not an option:
 * Windows renders 🇫🇷 as the letters "FR", so every flag is drawn here.
 * All flags share a 3:2 box so they line up in the menu.
 */

function France() {
  return (
    <svg viewBox="0 0 3 2" preserveAspectRatio="none" className="block h-full w-full">
      <rect width="1" height="2" fill="#002395" />
      <rect x="1" width="1" height="2" fill="#FFFFFF" />
      <rect x="2" width="1" height="2" fill="#ED2939" />
    </svg>
  )
}

function UnitedKingdom() {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
      <defs>
        <clipPath id={`${id}-s`}><path d="M0,0 v40 h60 v-40 z" /></clipPath>
        <clipPath id={`${id}-t`}><path d="M30,20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-s)`}>
        <path d="M0,0 v40 h60 v-40 z" fill="#012169" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFFFFF" strokeWidth="8" />
        <path d="M0,0 L60,40 M60,0 L0,40" clipPath={`url(#${id}-t)`} stroke="#C8102E" strokeWidth="5" />
        <path d="M30,0 v40 M0,20 h60" stroke="#FFFFFF" strokeWidth="12" />
        <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="7" />
      </g>
    </svg>
  )
}

// Rwanda's 24-ray sun, precomputed once: points alternate between the ray
// tip radius and the notch radius around the sun's center.
const SUN_POINTS = Array.from({ length: 48 }, (_, i) => {
  const r = i % 2 === 0 ? 150 : 92
  const a = (i * Math.PI) / 24
  return `${(840 + r * Math.cos(a)).toFixed(1)},${(180 + r * Math.sin(a)).toFixed(1)}`
}).join(' ')

function Rwanda() {
  return (
    <svg viewBox="0 0 1080 720" preserveAspectRatio="none" className="block h-full w-full">
      <rect width="1080" height="720" fill="#20603D" />
      <rect width="1080" height="540" fill="#FAD201" />
      <rect width="1080" height="360" fill="#00A1DE" />
      <polygon points={SUN_POINTS} fill="#E5BE01" />
      <circle cx="840" cy="180" r="74" fill="#00A1DE" />
      <circle cx="840" cy="180" r="62" fill="#E5BE01" />
    </svg>
  )
}

const FLAGS: Record<Lang, () => JSX.Element> = { fr: France, en: UnitedKingdom, rw: Rwanda }

/** Language names in their own language, as mature pickers show them. */
export const LANG_NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', rw: 'Kinyarwanda' }

export function Flag({ lang, className = 'h-[14px] w-[21px]' }: { lang: Lang; className?: string }) {
  const Svg = FLAGS[lang]
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 overflow-hidden rounded-[3px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.18)] ${className}`}
    >
      <Svg />
    </span>
  )
}
