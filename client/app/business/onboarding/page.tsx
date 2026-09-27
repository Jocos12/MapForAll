'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { BusinessForm, EMPTY_FORM, type BusinessFormValues } from '@/components/business/BusinessForm'
import { BIZ, BIZ_SCROLL, BIZ_SCROLL_ID } from '@/components/business/ui'

export default function BusinessOnboarding() {
  const { t } = useI18n()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [hasPlaces, setHasPlaces] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => { if (wasDark) root.classList.add('dark') }
  }, [])

  useEffect(() => {
    const addingAnother = new URLSearchParams(window.location.search).get('new') === '1'
    void fetch('/api/business', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.place) return
        if (addingAnother) setHasPlaces(true)
        else router.replace('/business/dashboard')
      })
      .catch(() => {})
  }, [router])

  async function submit(values: BusinessFormValues) {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          category: values.category,
          description: values.description,
          address: values.address,
          phone: values.phone,
          hours: values.hours,
          hoursWeek: values.hoursWeek,
          tags: values.tags,
          photos: values.photos,
          access: values.access,
          claim: true,
          local_business: true,
          latitude: values.latitude,
          longitude: values.longitude,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? t('auth.errors.generic'))
        setBusy(false)
        return
      }
      setDone(true)
      const target = typeof data.place_id === 'string' ? `/business/dashboard?place=${encodeURIComponent(data.place_id)}#overview` : '/business/dashboard'
      window.setTimeout(() => router.push(target), 700)
    } catch {
      setError(t('auth.errors.network'))
      setBusy(false)
    }
  }

  return (
    <div id={BIZ_SCROLL_ID} className={`${BIZ_SCROLL} ${BIZ.bg} text-[#18181B]`}>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#1A1614]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <span className="flex items-center gap-2">
            <MapPin size={16} className="text-[#E8672A]" aria-hidden />
            <span className="text-[14.5px] font-semibold text-white">MapForAll</span>
            <span className="rounded-md bg-[#E8672A] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1A1614]">Business</span>
          </span>
          {hasPlaces && (
            <a href="/business/dashboard" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-[#D6D3D1] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8672A]">
              <ArrowLeft size={14} aria-hidden />
              {t('biz.poster.back')}
            </a>
          )}
        </div>
      </header>
      <main className="px-4 py-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#C2410C]">{hasPlaces ? t('biz.places.addKicker') : t('business.kicker')}</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{hasPlaces ? t('biz.places.addTitle') : t('business.onboardTitle')}</h1>
          <p className="mb-6 mt-2 text-[14px] leading-relaxed text-[#3F3F46]">{t('business.onboardBody')}</p>
          <BusinessForm
            mode="create"
            initial={EMPTY_FORM}
            busy={busy}
            error={error}
            success={done ? t('business.thanks') : ''}
            onSubmit={(values) => void submit(values)}
          />
        </div>
      </main>
    </div>
  )
}
