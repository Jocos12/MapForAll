'use client'

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Check, Loader2, Mail, RotateCcw, ShieldAlert } from 'lucide-react'
import { APPLE_EASE } from '@/components/landing/scrollFx'
import { useI18n } from '@/components/I18nProvider'

const LENGTH = 6
const EMPTY = Array<string>(LENGTH).fill('')

export interface OtpChallenge {
  email: string
  expiresIn: number
  resendIn: number
  demoCode?: string
}

/**
 * Second sign-in step: six one-digit boxes. Typing moves to the next box,
 * Backspace goes back, a pasted or autofilled code fills every box, and the
 * code is checked as soon as the sixth digit is in.
 */
export function OtpStep({
  challenge,
  onVerified,
  onRestart,
}: {
  challenge: OtpChallenge
  onVerified: (redirect: string) => void
  onRestart: (message: string) => void
}) {
  const { t, lang } = useI18n()
  const reduced = useReducedMotion()
  const shake = useAnimationControls()
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const [digits, setDigits] = useState<string[]>(EMPTY)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(challenge.resendIn)
  const [lockLeft, setLockLeft] = useState(0)
  const [demoCode, setDemoCode] = useState(challenge.demoCode)
  const wasLocked = useRef(false)

  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setCooldown((s) => (s > 0 ? s - 1 : 0))
      setLockLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Once a lock runs out, the old code is spent: point to a new one.
  useEffect(() => {
    if (lockLeft > 0) wasLocked.current = true
    else if (wasLocked.current) {
      wasLocked.current = false
      setError(t('auth.otp.errors.otp_locked_now'))
    }
  }, [lockLeft, t])

  const locked = lockLeft > 0
  const disabled = busy || done || locked

  const refuse = useCallback((message: string) => {
    setError(message)
    setInfo('')
    setDigits(EMPTY)
    if (!reduced) shake.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.42, ease: 'easeInOut' } })
    window.setTimeout(() => refs.current[0]?.focus(), 60)
  }, [reduced, shake])

  const lockedMessage = useCallback((seconds: number) => (
    t('auth.otp.errors.otp_locked').replace('{m}', String(Math.max(1, Math.ceil(seconds / 60))))
  ), [t])

  const submit = useCallback(async (code: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setDone(true)
        onVerified(typeof data.redirect === 'string' ? data.redirect : '/chat')
        return
      }
      switch (data.code) {
        case 'otp_wrong':
          refuse(t('auth.otp.errors.otp_wrong').replace('{n}', String(data.remaining ?? 0)))
          break
        case 'otp_locked':
          setLockLeft(Number(data.retry_after) || 600)
          refuse(lockedMessage(Number(data.retry_after) || 600))
          break
        case 'otp_expired':
          refuse(t('auth.otp.errors.otp_expired'))
          break
        case 'otp_invalid':
          onRestart(t('auth.otp.errors.otp_invalid'))
          break
        case 'incomplete':
          refuse(t('auth.otp.errors.incomplete'))
          break
        default:
          refuse(res.status === 503 ? t('auth.errors.unavailable') : res.status === 429 ? t('auth.errors.rate') : t('auth.errors.generic'))
      }
    } catch {
      refuse(t('auth.errors.network'))
    } finally {
      setBusy(false)
    }
  }, [lockedMessage, onRestart, onVerified, refuse, t])

  useEffect(() => {
    const code = digits.join('')
    if (code.length === LENGTH && !busy && !done && !locked) void submit(code)
  }, [digits, busy, done, locked, submit])

  function fillFrom(index: number, raw: string) {
    const clean = raw.replace(/\D/g, '')
    if (!clean) return
    const start = clean.length >= LENGTH ? 0 : index
    setDigits((prev) => {
      const next = [...prev]
      for (let k = 0; k < clean.length && start + k < LENGTH; k++) next[start + k] = clean[k]
      return next
    })
    refs.current[Math.min(start + clean.length, LENGTH - 1)]?.focus()
    setError('')
  }

  function onChange(index: number, value: string) {
    const clean = value.replace(/\D/g, '')
    if (!clean) {
      setDigits((prev) => prev.map((d, k) => (k === index ? '' : d)))
      return
    }
    if (clean.length > 1) {
      fillFrom(index, clean)
      return
    }
    setDigits((prev) => prev.map((d, k) => (k === index ? clean : d)))
    setError('')
    if (index < LENGTH - 1) refs.current[index + 1]?.focus()
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault()
      setDigits((prev) => prev.map((d, k) => (k === index - 1 ? '' : d)))
      refs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      refs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      e.preventDefault()
      refs.current[index + 1]?.focus()
    }
  }

  function onPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    fillFrom(index, e.clipboardData.getData('text'))
  }

  async function resend() {
    if (sending || cooldown > 0 || locked) return
    setSending(true)
    setError('')
    setInfo('')
    try {
      const res = await fetch('/api/auth/otp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCooldown(Number(data.resend_in) || 45)
        setDemoCode(typeof data.demo_code === 'string' ? data.demo_code : undefined)
        setDigits(EMPTY)
        setInfo(t('auth.otp.resent'))
        refs.current[0]?.focus()
        return
      }
      switch (data.code) {
        case 'otp_wait':
          setCooldown(Number(data.retry_after) || 30)
          break
        case 'otp_locked':
          setLockLeft(Number(data.retry_after) || 600)
          setError(lockedMessage(Number(data.retry_after) || 600))
          break
        case 'otp_invalid':
        case 'otp_too_many':
          onRestart(t(`auth.otp.errors.${data.code}`))
          break
        case 'email_failed':
          setError(t('auth.otp.errors.email_failed'))
          break
        default:
          setError(res.status === 503 ? t('auth.errors.unavailable') : t('auth.errors.generic'))
      }
    } catch {
      setError(t('auth.errors.network'))
    } finally {
      setSending(false)
    }
  }

  const minutes = String(Math.round(challenge.expiresIn / 60))
  const spacedDemo = demoCode ? `${demoCode.slice(0, 3)} ${demoCode.slice(3)}` : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: APPLE_EASE }}
    >
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDE8DC] text-[#E8672A] dark:bg-[#E8672A]/20">
        <Mail size={22} strokeWidth={2} />
      </span>
      <h1 className="mt-4 text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] text-[#1A1614] dark:text-gray-50">
        {t('auth.otp.title')}
      </h1>
      <p className="mt-1.5 text-[14px] leading-snug text-[#6E5B50] dark:text-gray-400">
        {t('auth.otp.body').replace('{email}', challenge.email).replace('{minutes}', minutes)}
      </p>

      <AnimatePresence initial={false}>
        {demoCode && (
          <motion.div
            key="demo"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: APPLE_EASE }}
            className="overflow-hidden"
          >
            <div role="status" className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-[#F2C94C]/60 bg-[#FFF7DB] px-3.5 py-3 text-[13px] leading-snug text-[#6B4E00] dark:border-[#F2C94C]/30 dark:bg-[#F2C94C]/10 dark:text-[#F5D77A]">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t('auth.otp.demoTitle')}</p>
                <p className="mt-0.5">
                  {t('auth.otp.demoBody')}{' '}
                  <span className="whitespace-nowrap font-mono text-[15px] font-bold tracking-[0.12em]">{spacedDemo}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => fillFrom(0, demoCode)}
                disabled={disabled}
                className="shrink-0 rounded-full bg-[#6B4E00]/10 px-3 py-1.5 text-[12.5px] font-semibold transition-colors hover:bg-[#6B4E00]/20 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20"
              >
                {t('auth.otp.demoUse')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div animate={shake} className="mt-5">
        <div role="group" aria-label={t('auth.otp.label')} className="flex justify-between gap-2">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el }}
              value={digit}
              onChange={(e) => onChange(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onFocus={(e) => e.target.select()}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              aria-label={t('auth.otp.digit').replace('{n}', String(i + 1))}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'otp-error' : undefined}
              disabled={disabled}
              className={`h-14 w-full min-w-0 rounded-[14px] border bg-white text-center text-[22px] font-semibold text-[#1A1614] outline-none transition-[border-color,box-shadow] duration-200 disabled:opacity-60 dark:bg-white/[0.04] dark:text-gray-50 ${error
                ? 'border-[#B42318] shadow-[0_0_0_4px_rgba(180,35,24,0.10)] dark:border-[#FF8A7A]'
                : done
                  ? 'border-[#1F8A5B] shadow-[0_0_0_4px_rgba(31,138,91,0.14)]'
                  : 'border-black/[0.09] hover:border-black/20 focus:!border-[#E8672A] focus:shadow-[0_0_0_4px_rgba(232,103,42,0.16)] dark:border-white/10 dark:hover:border-white/20'}`}
            />
          ))}
        </div>
      </motion.div>

      <div className="mt-2 min-h-[20px]" aria-live="polite">
        {error ? (
          <p id="otp-error" role="alert" className="flex items-start gap-1.5 text-[12.5px] leading-snug text-[#B42318] dark:text-[#FF8A7A]">
            <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
            {error}
          </p>
        ) : busy || done ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[#6E5B50] dark:text-gray-400">
            {done ? <Check size={13} className="text-[#1F8A5B]" aria-hidden /> : <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {done ? t('auth.otp.success') : t('auth.otp.verifying')}
          </p>
        ) : info ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[#1F8A5B] dark:text-[#5BD49A]">
            <Check size={13} aria-hidden />
            {info}
          </p>
        ) : (
          <p className="text-[12.5px] text-[#6E5B50] dark:text-gray-400">{t('auth.otp.spam')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void submit(digits.join(''))}
        disabled={disabled || digits.join('').length < LENGTH}
        className={`mt-4 flex h-12 w-full items-center justify-center gap-2.5 rounded-full text-[15px] font-medium text-white transition-[background-color,opacity] duration-300 disabled:cursor-default ${done ? 'bg-[#1F8A5B]' : 'bg-[#1A1614] enabled:hover:bg-black disabled:opacity-50 dark:bg-white dark:text-[#1A1614] dark:enabled:hover:bg-gray-100'}`}
      >
        {done ? <Check size={18} strokeWidth={2.75} aria-hidden /> : busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {done ? t('auth.otp.success') : busy ? t('auth.otp.verifying') : t('auth.otp.verify')}
      </button>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onRestart('')}
          disabled={busy || done}
          className="flex min-h-[36px] items-center gap-1 rounded-full px-1 text-[13px] font-medium text-[#6E5B50] transition-colors hover:text-[#1A1614] disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} aria-hidden />
          {t('auth.otp.back')}
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={sending || cooldown > 0 || locked || done}
          className="flex min-h-[36px] items-center gap-1.5 rounded-full px-1 text-[13px] font-medium text-[#B8441A] underline-offset-4 enabled:hover:underline disabled:text-[#6E5B50] dark:text-[#FF9A63] dark:disabled:text-gray-500"
        >
          {sending ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw size={13} aria-hidden />}
          {sending
            ? t('auth.otp.sending')
            : cooldown > 0
              ? t('auth.otp.resendIn').replace('{s}', String(cooldown))
              : t('auth.otp.resend')}
        </button>
      </div>
    </motion.div>
  )
}
