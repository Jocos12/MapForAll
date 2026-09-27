'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/** Separate from the client app's `hodari_theme`: the back-office defaults to light. */
const KEY = 'hodari_biz_theme'
const CLASS = 'biz-dark'

const BizThemeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} })

export function BizThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    let stored = false
    try { stored = localStorage.getItem(KEY) === 'dark' } catch { /* private mode */ }
    root.classList.toggle(CLASS, stored)
    setDark(stored)
    return () => root.classList.remove(CLASS)
  }, [])

  const toggle = useCallback(() => {
    const root = document.documentElement
    const next = !root.classList.contains(CLASS)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('biz-theming')
      window.setTimeout(() => root.classList.remove('biz-theming'), 260)
    }
    root.classList.toggle(CLASS, next)
    try { localStorage.setItem(KEY, next ? 'dark' : 'light') } catch { /* private mode */ }
    setDark(next)
  }, [])

  return <BizThemeContext.Provider value={{ dark, toggle }}>{children}</BizThemeContext.Provider>
}

export function useBizTheme() {
  return useContext(BizThemeContext)
}
