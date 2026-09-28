'use client'

import Link from 'next/link'
import { useI18n } from '@/components/I18nProvider'

export default function AccessDeniedPage() {
  const { t } = useI18n()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F7F1E8] px-4 text-center dark:bg-[#0F0D0B]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#E8672A]">403</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-[#1A1614] dark:text-[#FBF3E7]">{t('admin.denied')}</h1>
      <p className="mt-2 max-w-md text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.shell.deniedBody')}</p>
      <Link href="/chat" className="mt-6 rounded-full bg-[#E8672A] px-5 py-2.5 text-[14px] font-medium text-white">
        {t('admin.shell.backApp')}
      </Link>
    </main>
  )
}
