'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/** Thin orange progress bar on admin route changes (instant click feedback). */
export function AdminNavProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [key, setKey] = useState(0)

  useEffect(() => {
    setVisible(true)
    setKey((k) => k + 1)
    const done = window.setTimeout(() => setVisible(false), 450)
    return () => window.clearTimeout(done)
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || !href.startsWith('/admin')) return
      if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (href.split('?')[0] === pathname) return
      setVisible(true)
      setKey((k) => k + 1)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [pathname])

  if (!visible) return null

  return (
    <div
      key={key}
      className="pointer-events-none fixed left-0 right-0 top-0 z-[60] h-[2px] overflow-hidden"
      aria-hidden
    >
      <div className="admin-nav-progress h-full w-full bg-[#E8672A]" />
    </div>
  )
}
