'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/I18nProvider'

/** Shown when the database is down. The cookie stays; Retry and a poll recover when it returns. */
export function ServiceUnavailable({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter()
  const { t } = useI18n()

  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 5_000)
    return () => window.clearInterval(id)
  }, [router])

  return (
    <div role="status" data-service-unavailable="1" className="mx-auto mt-16 max-w-md rounded-2xl border border-black/10 bg-white p-6 text-[#18181B] dark:border-white/10 dark:bg-[#1C1917] dark:text-white">
      <p className="text-[15px] font-semibold">{t('biz.load.reconnecting')}</p>
      <button
        type="button"
        className="mt-4 rounded-full border border-black/15 px-4 py-2 text-[13px] font-medium dark:border-white/20"
        onClick={() => {
          onRetry?.()
          router.refresh()
        }}
      >
        {t('biz.retry')}
      </button>
    </div>
  )
}
