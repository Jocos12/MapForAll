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

const DEFAULT_LANG: Lang = 'fr'

function isLang(value: string | null): value is Lang {
  return value === 'fr' || value === 'en' || value === 'rw'
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Server render and the first client render both use French. A language
  // the visitor explicitly picked is applied only after mount. The browser
  // language does not override this default.
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG)

  useEffect(() => {
    let next: Lang = DEFAULT_LANG
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (isLang(saved)) next = saved
    } catch { /* keep French */ }
    if (next !== DEFAULT_LANG) setLangState(next)
    document.documentElement.lang = next
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    document.documentElement.lang = next
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
      lang: 'fr',
      setLang: () => {},
      t: (key) => lookup(DICTS.fr, key) ?? lookup(DICTS.en, key) ?? key,
    }
  }
  return ctx
}
