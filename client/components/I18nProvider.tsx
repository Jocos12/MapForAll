'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from '@/locales/en.json'
import fr from '@/locales/fr.json'
import rw from '@/locales/rw.json'

export type Lang = 'fr' | 'en' | 'rw'

const STORAGE_KEY = 'hodari_lang'
const DICTS: Record<Lang, typeof en> = { en, fr, rw }

type I18nValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, dict)
  return typeof value === 'string' ? value : undefined
}

function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en'
  const code = navigator.language.toLowerCase()
  if (code.startsWith('fr')) return 'fr'
  if (code.startsWith('rw')) return 'rw'
  return 'en'
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'fr' || saved === 'en' || saved === 'rw') {
        setLangState(saved)
        return
      }
    } catch { /* private mode */ }
    setLangState(detectLang())
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    if (typeof document !== 'undefined') document.documentElement.lang = next === 'rw' ? 'rw' : next
  }, [])

  const t = useCallback((key: string) => {
    return lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key
  }, [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return {
      lang: 'en',
      setLang: () => {},
      t: (key) => lookup(DICTS.en, key) ?? key,
    }
  }
  return ctx
}
