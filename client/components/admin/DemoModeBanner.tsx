'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, X } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'

const STORAGE_KEY = 'mapforall_demo_steps'

export function DemoModeBanner() {
  const { t } = useI18n()
  const [steps, setSteps] = useState<string[]>([])
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { steps?: string[]; place_id?: string }
      if (Array.isArray(parsed.steps)) setSteps(parsed.steps)
      if (parsed.place_id) setPlaceId(parsed.place_id)
    } catch { /* ignore */ }
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
    sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  if (dismissed || steps.length === 0) return null

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-[#E8672A]/30 bg-[#E8672A]/10 px-4 py-3 dark:border-[#E8672A]/40 dark:bg-[#E8672A]/15">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[#E8672A]">
          <Sparkles size={18} aria-hidden />
          <p className="text-[14px] font-semibold">{t('admin.demo.bannerTitle')}</p>
        </div>
        <button type="button" onClick={dismiss} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label={t('admin.demo.dismiss')}>
          <X size={16} />
        </button>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-[#1A1614] dark:text-[#FBF3E7]">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {placeId && (
        <Link href={`/admin/moderation?highlight=${encodeURIComponent(placeId)}`} className="text-[13px] font-medium text-[#E8672A] hover:underline">
          {t('admin.demo.openModeration')}
        </Link>
      )}
    </div>
  )
}

export function storeDemoSession(payload: { steps: string[]; place_id: string }) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}
