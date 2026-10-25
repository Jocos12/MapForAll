'use client'

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CloudSun, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { firstName, greetingBucket, type GreetingBucket } from '@/lib/greeting'
import { motionTokens, motionTransition } from '@/lib/motion'

const ICONS: Record<GreetingBucket, LucideIcon> = {
  morning: Sun,
  afternoon: CloudSun,
  evening: Moon,
}

const ABSENCE_MS = 14 * 24 * 60 * 60 * 1000

type Variant = 'hello' | 'welcome' | 'back' | GreetingBucket

function phraseKey(variant: Variant): string {
  if (variant === 'hello') return 'greet.hello'
  if (variant === 'welcome') return 'greet.welcome'
  if (variant === 'back') return 'greet.welcomeBack'
  return `greet.${variant}`
}

/**
 * Time-of-day greeting. The hour is read in the browser after mount so the
 * server render stays a neutral "Hello" and never uses the server timezone.
 */
export function Greeting({
  name,
  email,
  userId,
  detail,
}: {
  name?: string | null
  email?: string | null
  userId?: string | null
  detail?: string
}) {
  const { t, lang } = useI18n()
  const reduced = useReducedMotion()
  const [variant, setVariant] = useState<Variant>('hello')
  const [when, setWhen] = useState<Date | null>(null)

  useEffect(() => {
    const id = userId || email || 'guest'
    const firstKey = `hodari_greet_first_${id}`
    const seenKey = `hodari_greet_seen_${id}`
    const now = Date.now()
    let next: Variant = greetingBucket(new Date())
    try {
      const seen = Number(localStorage.getItem(seenKey) || 0)
      if (!localStorage.getItem(firstKey)) {
        next = 'welcome'
        localStorage.setItem(firstKey, '1')
      } else if (seen > 0 && now - seen > ABSENCE_MS) {
        next = 'back'
      }
      localStorage.setItem(seenKey, String(now))
    } catch { /* private mode */ }
    setVariant(next)
    setWhen(new Date())
  }, [userId, email])

  useEffect(() => {
    const bump = () => setWhen(new Date())
    const timer = window.setInterval(bump, 10 * 60 * 1000)
    const onFocus = () => bump()
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!when || variant === 'welcome' || variant === 'back' || variant === 'hello') return
    setVariant(greetingBucket(when))
  }, [when, variant])

  const who = firstName(name, email)
  const phrase = t(phraseKey(variant))
  const title = who ? `${phrase}, ${who}` : phrase
  const locale = lang === 'rw' ? 'rw-RW' : lang === 'en' ? 'en-GB' : 'fr-FR'
  const dateLine = when
    ? when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    : ''
  const Icon = variant === 'morning' || variant === 'afternoon' || variant === 'evening' ? ICONS[variant] : Sun

  return (
    <motion.div
      className="min-h-[76px]"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTransition(!!reduced, motionTokens.duration.fast)}
    >
      <p className="flex items-center gap-2 font-display text-[26px] font-semibold tracking-tight text-[#18181B] dark:text-[#FBF3E7] md:text-[30px]">
        <Icon size={22} className="shrink-0 text-[#E8672A]" aria-hidden />
        <span>{title}</span>
      </p>
      <p className="mt-1 min-h-[20px] text-[13.5px] text-[#52525B] dark:text-white/55">
        {dateLine}
        {dateLine && detail ? ' · ' : ''}
        {detail}
      </p>
    </motion.div>
  )
}
