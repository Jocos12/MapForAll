'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { BizShell, isSection, type SectionId } from '@/components/business/BizShell'
import type { BusinessFormValues } from '@/components/business/BusinessForm'
import { BusinessSection } from '@/components/business/BusinessSection'
import { OverviewSection } from '@/components/business/OverviewSection'
import { PromotionSection } from '@/components/business/PromotionSection'
import { ReviewsSection } from '@/components/business/ReviewsSection'
import { SettingsSection } from '@/components/business/SettingsSection'
import { StatsSection } from '@/components/business/StatsSection'
import { ProfileSection } from '@/components/business/ProfileSection'
import { BizThemeProvider } from '@/components/business/theme'
import { withPlace, type ListingTimeline, type OwnerAccount, type OwnerDashboard } from '@/components/business/types'
import { BIZ, scrollBizTop } from '@/components/business/ui'

const NO_TIMELINE: ListingTimeline = { createdAt: null, moderatedAt: null, resubmittedAt: null }

/** Form anchors (`biz-*`) live in "Mon commerce"; `promo-*` ones on the promotion page. */
function anchorSection(anchor: string): SectionId {
  return anchor.startsWith('promo-') ? 'promotion' : 'business'
}

/** After this long without an answer the skeleton gives way to a retry card. */
const SLOW_MS = 5_000
const ABORT_MS = 15_000

function Skeleton() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <div key={i} className={`${BIZ.card} h-[118px] animate-pulse`} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-3" aria-hidden>
        <div className={`${BIZ.card} h-[280px] animate-pulse lg:col-span-2`} />
        <div className={`${BIZ.card} h-[280px] animate-pulse`} />
      </div>
      {/* Pure CSS: shows up only if the page script never took over (no React timer can fire then). */}
      <p className="biz-stuck text-[13.5px] text-[#52525B]">
        {t('biz.load.stuck')}{' '}
        <a href="" className="font-semibold text-[#C2410C] underline underline-offset-2">{t('biz.load.reload')}</a>
      </p>
    </div>
  )
}

export default function BusinessDashboard() {
  const { t } = useI18n()
  const router = useRouter()
  const [section, setSection] = useState<SectionId>('overview')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [data, setData] = useState<OwnerDashboard | null>(null)
  const [account, setAccount] = useState<OwnerAccount | null>(null)
  const [loadError, setLoadError] = useState('')
  const [slow, setSlow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk, setSaveOk] = useState('')
  const [formKey, setFormKey] = useState(0)
  const pendingAnchor = useRef<string | null>(null)
  const requested = useRef<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async (placeId: string | null) => {
    const seq = ++loadSeq.current
    const current = () => seq === loadSeq.current
    requested.current = placeId
    setLoadError('')
    setSlow(false)
    const slowTimer = window.setTimeout(() => { if (current()) setSlow(true) }, SLOW_MS)
    const get = (url: string) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) })
    try {
      let res = await get(withPlace('/api/business', placeId))
      if (res.status === 403 && placeId) res = await get('/api/business')
      const json = await res.json().catch(() => ({}))
      if (!current()) return
      if (res.status === 401 || res.status === 403) {
        router.replace('/login')
        return
      }
      if (!res.ok) {
        setLoadError(res.status === 503 ? t('biz.load.unavailable') : json.error ?? t('auth.errors.generic'))
        return
      }
      if (!json.place) {
        router.replace('/business/onboarding')
        return
      }
      const next = json as OwnerDashboard
      setData(next)
      setActiveId(next.place?.place_id ?? null)
    } catch (err) {
      if (!current()) return
      setLoadError(err instanceof DOMException && err.name === 'TimeoutError' ? t('biz.load.timeout') : t('auth.errors.network'))
    } finally {
      window.clearTimeout(slowTimer)
      if (current()) setSlow(false)
    }
  }, [router, t])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromHash = window.location.hash.slice(1)
    if (isSection(fromHash)) setSection(fromHash)
    void load(params.get('place'))
    void fetch('/api/account', { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) })
      .then((res) => res.json())
      .then((json) => { if (json?.profile) setAccount(json.profile as OwnerAccount) })
      .catch(() => {})
  }, [load])

  useEffect(() => {
    if (!activeId) return
    const url = new URL(window.location.href)
    url.searchParams.set('place', activeId)
    url.hash = section
    window.history.replaceState(null, '', url.toString())
  }, [activeId, section])

  useEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor || section !== anchorSection(anchor) || !data) return
    pendingAnchor.current = null
    window.setTimeout(() => {
      const el = document.getElementById(anchor)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true })
      el.classList.add('ring-2', 'ring-[#E8672A]', 'rounded-xl')
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-[#E8672A]', 'rounded-xl'), 1800)
    }, 120)
  }, [section, data])

  function go(id: SectionId) {
    setSection(id)
    setSaveOk('')
    setSaveError('')
    scrollBizTop()
  }

  function jump(anchor: string) {
    const target = anchorSection(anchor)
    if (target === section) {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    pendingAnchor.current = anchor
    setSection(target)
  }

  function switchPlace(id: string) {
    setData(null)
    setSaveOk('')
    setSaveError('')
    setActiveId(id)
    void load(id)
  }

  async function saveEdits(values: BusinessFormValues) {
    setSaving(true)
    setSaveError('')
    setSaveOk('')
    try {
      const res = await fetch(withPlace('/api/business', activeId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(json.error ?? t('auth.errors.generic'))
        return
      }
      await load(activeId)
      setFormKey((key) => key + 1)
      setSaveOk(
        json.remoderated
          ? t('biz.form.savedPending')
          : json.status === 'validated'
            ? t('biz.form.savedLive')
            : t('biz.form.saved'),
      )
    } catch {
      setSaveError(t('auth.errors.network'))
    } finally {
      setSaving(false)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.replace('/login')
  }

  function openPlace(id: string) {
    if (id !== activeId) switchPlace(id)
    go('overview')
  }

  const place = data?.place
  const needsData = section !== 'settings' && section !== 'profile'
  const retry = () => void load(requested.current ?? activeId)

  return (
    <BizThemeProvider>
    <BizShell
      section={section}
      onSection={go}
      places={data?.places ?? []}
      activeId={activeId}
      onSwitch={switchPlace}
      status={place?.status ?? 'pending'}
      reason={place?.rejection_reason}
      timeline={data?.timeline ?? NO_TIMELINE}
      reviews={data?.reviews ?? []}
      account={account}
      onLogout={() => void logout()}
    >
      <div className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-[#18181B] md:text-[30px]">{t(`biz.nav.${section}`)}</h1>
        <p className="mt-1 text-[13.5px] text-[#52525B]">{t(`biz.sections.${section}`)}</p>
      </div>

      {!data && !loadError && !slow && needsData && (
        <>
          <p className="sr-only" role="status">{t('biz.loading')}</p>
          <Skeleton />
        </>
      )}
      {!data && (loadError || slow) && needsData && (
        <div className={`${BIZ.card} flex animate-fade-up items-start gap-3 border-red-200 p-5`} role="alert">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-[#B91C1C]"><AlertTriangle size={17} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#18181B]">{loadError ? t('biz.load.failedTitle') : t('biz.load.slowTitle')}</p>
            <p className="mt-0.5 text-[13px] text-[#52525B]">{loadError || t('biz.load.slowBody')}</p>
            <button type="button" onClick={retry} className={`${BIZ.secondary} mt-3 h-9`}>
              <RefreshCw size={13} aria-hidden />{t('biz.retry')}
            </button>
          </div>
        </div>
      )}
      {data && loadError && (
        <div className={`${BIZ.card} mb-5 flex items-center gap-3 border-red-200 px-4 py-3 text-[13px]`} role="alert">
          <AlertTriangle size={15} className="shrink-0 text-[#B91C1C]" aria-hidden />
          <p className="min-w-0 flex-1 text-[#B91C1C]">{loadError}</p>
          <button type="button" onClick={retry} className={`${BIZ.secondary} h-8`}>
            <RefreshCw size={13} aria-hidden />{t('biz.retry')}
          </button>
        </div>
      )}

      {data && place && section === 'overview' && <OverviewSection data={data} go={go} jump={jump} />}

      <div key={`${section}-${activeId ?? ''}`} className={section === 'overview' || !needsData ? '' : 'animate-fade-up'}>
      {data && place && section === 'business' && (
        <BusinessSection
          data={data}
          formKey={formKey}
          saving={saving}
          saveError={saveError}
          saveOk={saveOk}
          onSave={(values) => void saveEdits(values)}
          onSwitch={switchPlace}
          onPauseChanged={() => void load(activeId)}
          onClosed={(remaining) => {
            if (remaining > 0) {
              setData(null)
              setActiveId(null)
              setSection('business')
              void load(null)
            } else router.replace('/business/onboarding')
          }}
        />
      )}

      {data && section === 'stats' && (
        <StatsSection stats={data.stats} published={place?.status === 'validated' && !place?.paused} placeName={place?.name ?? ''} onOpen={go} />
      )}

      {data && place && section === 'reviews' && (
        <ReviewsSection
          placeId={place.place_id}
          reviews={data.reviews}
          onReplied={(key, reply) =>
            setData((prev) => prev && { ...prev, reviews: prev.reviews.map((row) => (row.key === key ? { ...row, reply } : row)) })
          }
        />
      )}

      {data && place && section === 'promotion' && (
        <PromotionSection
          data={data}
          onJump={jump}
          onRefresh={() => load(activeId)}
          onRecommendsSaved={(list) => setData((prev) => prev && {
            ...prev,
            recommends: list,
            place: prev.place && { ...prev.place, recommends: list.map((row) => row.place_id) },
          })}
        />
      )}
      </div>

      {section === 'settings' && <SettingsSection onProfile={() => go('profile')} />}

      {section === 'profile' && (
        <ProfileSection
          account={account}
          places={data?.places ?? []}
          activeId={activeId}
          onAccount={(next) => {
            setAccount(next)
            try { localStorage.setItem('hodari_name', next.name) } catch { /* private mode */ }
          }}
          onOpenPlace={openPlace}
          onLogout={() => void logout()}
        />
      )}
    </BizShell>
    </BizThemeProvider>
  )
}
