'use client'

import { useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { Accessibility, Check, Clock, MapPin, Navigation } from 'lucide-react'
import { DeviceFrame } from '@/components/landing/live'
import { APPLE_EASE, ScrollReveal, useScrollRoot } from '@/components/landing/scrollFx'
import { useI18n } from '@/components/I18nProvider'

/**
 * "How it works" in Apple's pinned-story format: on large screens the phone
 * stays pinned while three steps scroll past; the active step lights up, its
 * progress bar fills, and the phone screen changes with it. Scrolling up
 * rewinds it. On small screens the steps simply stack, each with its screen.
 */

const PINS = [
  { x: '28%', y: '36%' },
  { x: '62%', y: '30%' },
  { x: '48%', y: '58%', main: true },
  { x: '72%', y: '66%' },
  { x: '22%', y: '70%' },
]

function Screen({ step }: { step: number }) {
  const { t } = useI18n()
  const fade = {
    initial: { opacity: 0, scale: 1.04, filter: 'blur(10px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.98, filter: 'blur(10px)' },
    transition: { duration: 0.7, ease: APPLE_EASE },
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {step === 0 && (
        <motion.div key="ask" {...fade} className="absolute inset-0 flex flex-col justify-end gap-3 bg-gradient-to-b from-[#FBF3E7] to-[#F3E6D4] px-4 pb-6 pt-16">
          <span className="mb-auto mt-8 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#E8672A] text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">MF</span>
            <span className="block text-[22px] font-semibold tracking-[-0.02em] text-[#1A1614]">Muraho 👋</span>
          </span>
          <motion.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: APPLE_EASE }}
            className="ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-[#1A1614] px-3.5 py-2 text-[13px] leading-snug text-white"
          >
            {t('landing.talk.ask')}
          </motion.span>
          <span className="flex items-center rounded-full bg-white py-2 pl-4 pr-2 text-[13px] text-[#8A7364] shadow-sm">
            <span className="flex-1">{t('landing.talk.placeholder')}</span>
            <span className="h-7 w-7 rounded-full bg-[#E8672A]" />
          </span>
        </motion.div>
      )}
      {step === 1 && (
        <motion.div key="search" {...fade} className="absolute inset-0">
          <img src="/landing/kigali-aerial.webp" alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 bg-[#1A1614]/20" />
          {PINS.map((p, i) => (
            <motion.span
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: p.x, top: p.y }}
              initial={{ opacity: 0, y: -24, scale: 0.5 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.25 + i * 0.12, ease: APPLE_EASE }}
            >
              {p.main && <span className="absolute -inset-3 animate-ping rounded-full bg-[#E8672A]/40" />}
              <span className={`relative flex items-center justify-center rounded-full border-2 border-white shadow-lg ${p.main ? 'h-8 w-8 bg-[#E8672A]' : 'h-5 w-5 bg-[#1A1614]'}`}>
                {p.main && <Accessibility size={15} className="text-white" />}
              </span>
            </motion.span>
          ))}
          <motion.span
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: APPLE_EASE }}
            className="absolute inset-x-4 top-14 flex items-center gap-2 rounded-[18px] bg-white/90 px-3.5 py-2.5 text-[13px] font-semibold text-[#1A1614] shadow-lg backdrop-blur-xl"
          >
            <MapPin size={15} className="text-[#D4581F]" />
            {t('landing.how.found')}
          </motion.span>
        </motion.div>
      )}
      {step === 2 && (
        <motion.div key="go" {...fade} className="absolute inset-0 flex flex-col bg-[#FBF3E7]">
          <img src="/landing/kigali-ramp.webp" alt="" className="h-[48%] w-full object-cover" />
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: APPLE_EASE }}
            className="-mt-6 flex flex-1 flex-col gap-3 rounded-t-[26px] bg-white px-5 pb-6 pt-5"
          >
            <span className="mx-auto h-1 w-9 rounded-full bg-black/10" />
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-[#1A1614]">{t('landing.hero.card2Title')}</span>
            <span className="flex flex-wrap gap-1.5">
              <span className="flex items-center gap-1 rounded-full bg-[#FBF3E7] px-2.5 py-1 text-[11px] font-medium text-[#1A1614]"><Accessibility size={12} />{t('landing.bento.accessBadge')}</span>
              <span className="flex items-center gap-1 rounded-full bg-[#FBF3E7] px-2.5 py-1 text-[11px] font-medium text-[#1A1614]"><Clock size={12} />{t('landing.how.walk')}</span>
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#6E5B50]"><Check size={12} strokeWidth={3} className="text-[#1F8A5B]" />{t('landing.hero.card2Meta')}</span>
            <span className="mt-auto flex items-center justify-center gap-2 rounded-full bg-[#1A1614] py-3 text-[14px] font-semibold text-white">
              <Navigation size={15} />
              {t('landing.how.go')}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StepBar({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const scaleY = useTransform(progress, [index / 3, (index + 1) / 3], [0, 1])
  return (
    <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[3px] overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/10">
      <motion.span style={{ scaleY }} className="block h-full w-full origin-top rounded-full bg-[#E8672A]" />
    </span>
  )
}

export default function HowItWorks() {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const container = useScrollRoot()
  const { scrollYProgress } = useScroll({ target: ref, container, offset: ['start start', 'end end'] })
  const [step, setStep] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) => setStep(p < 1 / 3 ? 0 : p < 2 / 3 ? 1 : 2))

  const steps = [1, 2, 3].map((n) => ({ n, title: t(`landing.how.s${n}Title`), body: t(`landing.how.s${n}Body`) }))

  const heading = (
    <>
      <p className="mb-2.5 text-[14px] font-semibold text-[#B8441A] dark:text-[#FF9A63] sm:text-[15px]">{t('landing.nav.how')}</p>
      <h2 className="text-[clamp(1.9rem,3.8vw,3.1rem)] font-semibold leading-[1.06] tracking-[-0.032em] text-[#1A1614] dark:text-gray-50">
        {t('landing.how.title')}
      </h2>
    </>
  )

  return (
    <section id="how" aria-label={t('landing.how.title')} className="bg-[#FFF9F2] dark:bg-[#1A1614]">

      {/* Large screens: pinned phone, steps scroll past */}
      <div ref={ref} className="relative hidden h-[300vh] lg:block">
        <div className="sticky top-[68px] flex h-[calc(100vh-68px)] items-center">
          <div className="mx-auto grid w-full max-w-[1080px] grid-cols-[1fr_auto] items-center gap-16 px-12">
            <div>
              {heading}
              <ol className="mt-10 flex flex-col gap-1">
                {steps.map((s, i) => {
                  const active = step === i
                  return (
                    <li key={s.n} aria-current={active ? 'step' : undefined} className="relative py-3.5 pl-6">
                      <StepBar progress={scrollYProgress} index={i} />
                      <motion.div animate={{ opacity: active ? 1 : 0.38 }} transition={{ duration: 0.5, ease: APPLE_EASE }}>
                        <h3 className="flex items-baseline gap-3 text-[22px] font-semibold tracking-[-0.022em] text-[#1A1614] dark:text-gray-50">
                          <span className="text-[13px] font-semibold tabular-nums text-[#B8441A] dark:text-[#FF9A63]">0{s.n}</span>
                          {s.title}
                        </h3>
                        <motion.p
                          initial={false}
                          animate={{ height: active ? 'auto' : 0, opacity: active ? 1 : 0 }}
                          transition={{ duration: 0.55, ease: APPLE_EASE }}
                          className="max-w-[40ch] overflow-hidden pl-8 text-[15px] leading-relaxed text-[#6E5B50] dark:text-gray-300"
                        >
                          <span className="block pt-2">{s.body}</span>
                        </motion.p>
                      </motion.div>
                    </li>
                  )
                })}
              </ol>
            </div>
            <div aria-hidden className="w-[270px]">
              <DeviceFrame className="aspect-[9/18.5] w-full">
                <Screen step={step} />
              </DeviceFrame>
            </div>
          </div>
        </div>
      </div>

      {/* Small screens: stacked steps */}
      <div className="px-5 py-20 sm:px-8 lg:hidden">
        <ScrollReveal exit={false}>{heading}</ScrollReveal>
        <ol className="mt-10 flex flex-col gap-14">
          {steps.map((s, i) => (
            <li key={s.n}>
              <ScrollReveal exit={false}>
                <h3 className="flex items-baseline gap-3 text-[21px] font-semibold tracking-[-0.022em] text-[#1A1614] dark:text-gray-50">
                  <span className="text-[13px] font-semibold tabular-nums text-[#B8441A] dark:text-[#FF9A63]">0{s.n}</span>
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#6E5B50] dark:text-gray-300">{s.body}</p>
              </ScrollReveal>
              <ScrollReveal exit={false} stagger={0.04} className="mx-auto mt-7 w-[240px]">
                <div aria-hidden>
                  <DeviceFrame className="aspect-[9/18.5] w-full">
                    <Screen step={i} />
                  </DeviceFrame>
                </div>
              </ScrollReveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
