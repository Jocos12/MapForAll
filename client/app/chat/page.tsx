'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MapForAllApp from '@/components/LandingPage'
import { useI18n } from '@/components/I18nProvider'
import { clearLocalAuth } from '@/lib/authClient'

/** The chat app lives behind the sign-in gate; the server session is the source of truth. */
export default function ChatPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [authed, setAuthed] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let hadIdentity = false
    try {
      hadIdentity = Boolean(localStorage.getItem('hodari_email') || localStorage.getItem('hodari_uid'))
    } catch { /* private mode */ }

    fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 503) {
          setDegraded(true)
          window.setTimeout(() => { if (!cancelled) setAttempt((n) => n + 1) }, 5_000)
          return
        }
        if (r.status === 401) {
          clearLocalAuth()
          router.replace(hadIdentity ? '/login?expired=1' : '/login')
          return
        }
        const data = r.ok ? await r.json() : null
        if (data?.authed && data.user?.email) {
          try {
            localStorage.setItem('hodari_uid', data.user.user_id)
            localStorage.setItem('hodari_email', data.user.email)
            if (data.user.name) localStorage.setItem('hodari_name', data.user.name)
          } catch { /* private mode */ }
          setDegraded(false)
          setAuthed(true)
        } else {
          clearLocalAuth()
          router.replace('/login')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDegraded(true)
          window.setTimeout(() => { if (!cancelled) setAttempt((n) => n + 1) }, 5_000)
        }
      })
    return () => { cancelled = true }
  }, [router, attempt])

  if (degraded && !authed) {
    return (
      <p role="status" className="p-8 text-center text-[15px]">
        {t('biz.load.reconnecting')}
      </p>
    )
  }
  if (!authed) return null
  return <MapForAllApp />
}
