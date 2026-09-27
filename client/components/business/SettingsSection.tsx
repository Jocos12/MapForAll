'use client'

import { Check, ChevronRight, Globe, Moon, Palette, Sun, UserRound } from 'lucide-react'
import { useI18n, type Lang } from '@/components/I18nProvider'
import { useBizTheme } from '@/components/business/theme'
import { BIZ } from '@/components/business/ui'

const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'rw', label: 'Kinyarwanda' },
]

function optionClass(active: boolean) {
  return `flex items-center justify-between rounded-xl border px-4 py-3 text-left text-[14px] transition-colors ${BIZ.focus} ${
    active ? 'border-[#E8672A] bg-[#FFF7F2] font-semibold text-[#18181B] ring-1 ring-[#E8672A]' : 'border-[#E4E4E7] text-[#27272A] hover:border-[#A1A1AA]'
  }`
}

export function SettingsSection({ onProfile }: { onProfile: () => void }) {
  const { t, lang, setLang } = useI18n()
  const { dark, toggle } = useBizTheme()
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={`${BIZ.card} animate-fade-up p-5`} aria-labelledby="lang-title">
        <h2 id="lang-title" className={BIZ.cardTitle}>
          <Globe size={16} className="text-[#E8672A]" aria-hidden />
          {t('biz.settings.language')}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.settings.languageHint')}</p>
        <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-labelledby="lang-title">
          {LANGS.map(({ code, label }) => {
            const active = lang === code
            return (
              <button key={code} type="button" role="radio" aria-checked={active} onClick={() => setLang(code)} className={optionClass(active)}>
                <span className="flex items-center gap-3">
                  <span className="w-7 text-[12px] font-bold uppercase text-[#52525B]">{code}</span>
                  {label}
                </span>
                {active && <Check size={16} className="text-[#C2410C]" aria-hidden />}
              </button>
            )
          })}
        </div>
      </section>

      <div className="flex flex-col gap-5">
        <section className={`${BIZ.card} animate-fade-up p-5`} style={{ animationDelay: '60ms' }} aria-labelledby="theme-title">
          <h2 id="theme-title" className={BIZ.cardTitle}>
            <Palette size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.settings.appearance')}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.settings.appearanceHint')}</p>
          <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="theme-title">
            {([false, true] as const).map((option) => (
              <button
                key={String(option)}
                type="button"
                role="radio"
                aria-checked={dark === option}
                onClick={() => { if (dark !== option) toggle() }}
                className={optionClass(dark === option)}
              >
                <span className="flex items-center gap-2.5">
                  {option ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
                  {t(option ? 'biz.settings.dark' : 'biz.settings.light')}
                </span>
                {dark === option && <Check size={16} className="text-[#C2410C]" aria-hidden />}
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={onProfile}
          className={`${BIZ.card} group flex animate-fade-up items-center gap-3 p-5 text-left transition-[border-color,box-shadow] hover:border-[#E8672A]/50 hover:shadow-md ${BIZ.focus}`}
          style={{ animationDelay: '120ms' }}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FDE8DC] text-[#C2410C]"><UserRound size={18} aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-[#18181B]">{t('biz.settings.profileLink')}</span>
            <span className="block text-[12.5px] text-[#52525B]">{t('biz.settings.profileLinkHint')}</span>
          </span>
          <ChevronRight size={18} className="text-[#71717A] transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
