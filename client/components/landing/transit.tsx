'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { Accessibility, Bus, Navigation } from 'lucide-react'
import { useLive } from '@/components/landing/live'
import { APPLE_EASE, useScrollRoot } from '@/components/landing/scrollFx'
import { useI18n } from '@/components/I18nProvider'

/**
 * Live public-transport demo for the landing page: a stylised Kigali bus line
 * with buses moving between stops, and an arrivals board that counts down.
 * Decorative (aria-hidden) — the facts are in the surrounding text. Runs only
 * on screen and stops with the page's pause control / reduced motion.
 */

type Pt = [number, number]

// One line across a 640×380 canvas: Nyabugogo → Mu Mujyi → Kacyiru → Remera → Kimironko
const ROUTE: Pt[] = [
  [40, 300], [120, 270], [190, 210], [250, 190], [320, 205], [380, 160],
  [450, 140], [510, 110], [570, 80], [610, 60],
]
const STOPS = [
  { at: 0, name: 'Nyabugogo' },
  { at: 0.27, name: 'Mu Mujyi' },
  { at: 0.5, name: 'Kacyiru' },
  { at: 0.74, name: 'Remera', you: true },
  { at: 1, name: 'Kimironko' },
]
// A second, crossing line (decorative)
const ROUTE_B: Pt[] = [[90, 70], [170, 110], [250, 190], [300, 260], [360, 330], [440, 350]]

function lengths(path: Pt[]) {
  const segs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]))
  return { segs, total: segs.reduce((a, b) => a + b, 0) }
}

function pointAt(path: Pt[], t: number): Pt {
  const { segs, total } = lengths(path)
  let d = Math.max(0, Math.min(1, t)) * total
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i]) {
      const k = segs[i] ? d / segs[i] : 0
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]
    }
    d -= segs[i]
  }
  return path[path.length - 1]
}

const toD = (path: Pt[]) => path.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')

function useRunning(ref: RefObject<Element | null>) {
  const root = useScrollRoot()
  const inView = useInView(ref as RefObject<Element>, { root: root as RefObject<Element> | undefined, amount: 0.25 })
  const { paused } = useLive()
  const reduced = useReducedMotion()
  return inView && !paused && !reduced
}

/** Progress 0..1 that loops every `ms` while running. */
function useLoop(ms: number, running: boolean, offset = 0) {
  const [t, setT] = useState(offset)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!running) { last.current = null; return }
    let raf = 0
    const tick = (now: number) => {
      if (last.current != null) setT((v) => (v + (now - last.current!) / ms) % 1)
      last.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); last.current = null }
  }, [ms, running])
  return t
}

export function BusLiveMap({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref)
  const a = useLoop(16000, running, 0.52)
  const b = useLoop(16000, running, 0.08)
  const c = useLoop(11000, running, 0.4)
  const busA = pointAt(ROUTE, a)
  const busB = pointAt(ROUTE, b)
  const busC = pointAt(ROUTE_B, c)
  const remera = pointAt(ROUTE, 0.74)
  // minutes until bus A reaches Remera (0.74), looping
  const etaA = Math.max(1, Math.round((((0.74 - a) + 1) % 1) * 16))

  return (
    <div ref={ref} aria-hidden className={`relative overflow-hidden rounded-[28px] border border-black/[0.05] bg-[#F4EEE6] shadow-[0_30px_80px_-30px_rgba(90,40,10,0.45)] dark:border-white/[0.07] dark:bg-[#1A1714] ${className}`}>
      <svg viewBox="0 0 640 380" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        {/* streets */}
        <g className="stroke-white dark:stroke-white/[0.07]" strokeWidth="10" fill="none" strokeLinecap="round">
          <path d="M0,120 C120,140 220,90 330,110 S520,170 640,150" />
          <path d="M80,380 C120,300 160,240 230,180 S330,40 380,0" />
          <path d="M0,330 C140,320 260,350 400,300 S560,260 640,270" />
          <path d="M470,380 C480,300 520,220 560,160 S620,60 640,40" />
        </g>
        <g className="fill-[#DCE9D2] dark:fill-[#22301F]">
          <ellipse cx="560" cy="300" rx="70" ry="40" />
          <ellipse cx="90" cy="60" rx="60" ry="32" />
        </g>
        {/* crossing line */}
        <path d={toD(ROUTE_B)} fill="none" stroke="#2F7DD1" strokeOpacity="0.45" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 12" />
        {/* main line */}
        <path d={toD(ROUTE)} fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-[#2A2520]" />
        <path d={toD(ROUTE)} fill="none" stroke="#E8672A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        {/* stops */}
        {STOPS.map((s) => {
          const [x, y] = pointAt(ROUTE, s.at)
          return (
            <g key={s.name}>
              <circle cx={x} cy={y} r={s.you ? 9 : 7} fill="#fff" stroke={s.you ? '#1A1614' : '#E8672A'} strokeWidth={s.you ? 4 : 3} />
              <text x={x} y={y + 26} textAnchor="middle" className="fill-[#1A1614] text-[13px] font-semibold dark:fill-gray-200" style={{ fontFamily: 'inherit' }}>{s.name}</text>
            </g>
          )
        })}
      </svg>

      {/* moving buses (HTML so they stay crisp) */}
      {[
        { p: busA, label: '302', main: true },
        { p: busB, label: '302' },
        { p: busC, label: '205', blue: true },
      ].map((bus, i) => (
        <span
          key={i}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-white shadow-[0_6px_16px_-4px_rgba(0,0,0,0.45)] will-change-[left,top]"
          style={{ left: `${(bus.p[0] / 640) * 100}%`, top: `${(bus.p[1] / 380) * 100}%`, background: bus.blue ? '#2F7DD1' : bus.main ? '#1A1614' : '#E8672A' }}
        >
          <Bus size={12} strokeWidth={2.5} />
          {bus.label}
        </span>
      ))}

      {/* "you are here" + ETA bubble at Remera */}
      <span
        className="absolute -translate-x-1/2 -translate-y-[150%]"
        style={{ left: `${(remera[0] / 640) * 100}%`, top: `${(remera[1] / 380) * 100}%` }}
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-[#1A1614] shadow-lg backdrop-blur-xl dark:bg-[#231F1B]/90 dark:text-gray-50">
          <Navigation size={12} className="fill-[#2F7DD1] text-[#2F7DD1]" />
          302 · {etaA} {t('landing.transit.min')}
        </span>
      </span>

      <span className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[12px] font-semibold text-[#1A1614] shadow-md backdrop-blur-xl dark:bg-[#231F1B]/85 dark:text-gray-50">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full bg-[#1F8A5B] opacity-60 ${running ? 'animate-ping' : ''}`} />
          <span className="relative h-2 w-2 rounded-full bg-[#1F8A5B]" />
        </span>
        {t('landing.transit.gps')}
      </span>
    </div>
  )
}

/** Arrivals board for one stop, counting down. */
export function ArrivalsBoard({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const running = useRunning(ref)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick((v) => v + 1), 2200)
    return () => clearInterval(id)
  }, [running])

  const rows = useMemo(() => {
    const base = [
      { line: '302', to: 'Nyabugogo', eta: 4, color: '#1A1614', access: true },
      { line: '205', to: 'Kimironko', eta: 9, color: '#2F7DD1', access: true },
      { line: '101', to: 'Mu Mujyi', eta: 14, color: '#E8672A', access: false },
    ]
    return base
      .map((r) => {
        const cycle = r.eta + 6
        const left = ((r.eta - tick) % cycle + cycle) % cycle
        return { ...r, left }
      })
      .sort((x, y) => x.left - y.left)
  }, [tick])

  return (
    <div ref={ref} aria-hidden className={`rounded-[26px] border border-black/[0.05] bg-white p-5 shadow-[0_24px_60px_-28px_rgba(90,40,10,0.4)] dark:border-white/[0.07] dark:bg-[#1C1916] ${className}`}>
      <div className="flex items-center justify-between">
        <span>
          <span className="block text-[17px] font-semibold tracking-[-0.02em] text-[#1A1614] dark:text-gray-50">{t('landing.transit.stop')}</span>
          <span className="block text-[13px] text-[#6E5B50] dark:text-gray-400">{t('landing.transit.stopMeta')}</span>
        </span>
        <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#E8672A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
          <Bus size={19} />
        </span>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li
              key={r.line}
              layout
              transition={{ duration: 0.6, ease: APPLE_EASE }}
              className="flex items-center gap-3 rounded-[16px] bg-[#FBF3E7] px-3 py-2.5 dark:bg-white/[0.05]"
            >
              <span className="flex h-8 min-w-[44px] items-center justify-center rounded-[10px] px-2 text-[13px] font-bold text-white" style={{ background: r.color }}>
                {r.line}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#1A1614] dark:text-gray-50">→ {r.to}</span>
                {r.access && (
                  <span className="flex items-center gap-1 text-[12px] text-[#1F8A5B]">
                    <Accessibility size={12} /> {t('landing.transit.lowFloor')}
                  </span>
                )}
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={r.left}
                  initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                  transition={{ duration: 0.45, ease: APPLE_EASE }}
                  className={`text-right text-[17px] font-semibold tabular-nums tracking-[-0.02em] ${r.left <= 1 ? 'text-[#1F8A5B]' : 'text-[#1A1614] dark:text-gray-50'}`}
                >
                  {r.left <= 0 ? t('landing.transit.now') : `${r.left} ${t('landing.transit.min')}`}
                </motion.span>
              </AnimatePresence>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
