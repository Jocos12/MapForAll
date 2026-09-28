'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MapForAllApp from '@/components/LandingPage'
import { clearLocalAuth } from '@/lib/authClient'

/** The chat app lives behind the sign-in gate; the server session is the source of truth. */
export default function ChatPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let hadIdentity = false
    try {
      hadIdentity = Boolean(localStorage.getItem('hodari_email') || localStorage.getItem('hodari_uid'))
    } catch { /* private mode */ }

    fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
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
          setAuthed(true)
        } else {
          clearLocalAuth()
          router.replace('/login')
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/login')
      })
    return () => { cancelled = true }
  }, [router])

  if (!authed) return null
  return <MapForAllApp />
}
