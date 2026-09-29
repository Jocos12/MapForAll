'use client'

import { useEffect, type RefObject } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Landing ⇄ login page transition, drawn as the flag of Rwanda.
 *
 * 1. The flag's three bands — sky blue (top half), yellow, green — sweep in
 *    from the left one after another, then the golden sun rises and turns
 *    into place at the top right, where it sits on the real flag.
 * 2. Only then does the client-side navigation start. The curtain lives on
 *    <body>, outside React, so it survives the route change; the sun keeps
 *    turning slowly while the next page loads.
 * 3. Once the new route has painted, the sun sets and the bands sweep out to
 *    the right, uncovering the next page while its own intro plays.
 *
 * Visitors who prefer reduced motion navigate instantly.
 */

const CURTAIN_ID = 'mf-curtain'
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'
const EASE_OUT = 'cubic-bezier(0.28, 0.11, 0.32, 1)'

// The flag's colours as gentle gradients: bright and close to the official
// shades, with just enough tonal shift to avoid a flat slab. Band heights
// follow the flag (1/2, 1/4, 1/4).
const BANDS = [
  { color: 'linear-gradient(120deg, #12A6DE 0%, #0A8FC7 55%, #0776A8 100%)', top: '0%', height: '50%' },
  { color: 'linear-gradient(120deg, #F6CF14 0%, #E9C000 60%, #D2AA00 100%)', top: '50%', height: '25%' },
  { color: 'linear-gradient(120deg, #2A7A4E 0%, #22683F 60%, #1A5433 100%)', top: '75%', height: '25%' },
]

/** Rwanda's 24-ray sun as an SVG string (same drawing as the header flag). */
function sunSvg() {
  const points = Array.from({ length: 48 }, (_, i) => {
    const r = i % 2 === 0 ? 50 : 30.7
    const a = (i * Math.PI) / 24
    return `${(60 + r * Math.cos(a)).toFixed(2)},${(60 + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
  return `<svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true">
    <polygon points="${points}" fill="#E5BE01"/>
    <circle cx="60" cy="60" r="24.7" fill="#00A1DE"/>
    <circle cx="60" cy="60" r="20.7" fill="#E5BE01"/>
  </svg>`
}

function waitForRoute(from: string, timeoutMs = 6000) {
  return new Promise<void>((resolve) => {
    const start = performance.now()
    const tick = () => {
      if (location.pathname !== from || performance.now() - start > timeoutMs) {
        // Two frames so the new page has actually painted under the curtain.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        return
      }
      setTimeout(tick, 40)
    }
    tick()
  })
}

export function transitionTo(href: string, push: (href: string) => void) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.body.animate) {
    push(href)
    return
  }
  if (document.getElementById(CURTAIN_ID)) return

  const curtain = document.createElement('div')
  curtain.id = CURTAIN_ID
  curtain.setAttribute('aria-hidden', 'true')
  Object.assign(curtain.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '5000',
    overflow: 'hidden',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)

  const bands = BANDS.map(({ color, top, height }) => {
    const band = document.createElement('div')
    Object.assign(band.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top,
      height,
      background: color,
      transform: 'translateX(-101%)',
      // A soft leading edge so each band reads as a sweep, not a hard slab.
      boxShadow: '24px 0 40px -12px rgba(0,0,0,0.45)',
    } satisfies Partial<CSSStyleDeclaration>)
    curtain.appendChild(band)
    return band
  })

  // Light vignette over the bands: a soft glow around the sun and only a
  // gentle darkening at the edges, so the flag stays bright but has depth.
  const shade = document.createElement('div')
  Object.assign(shade.style, {
    position: 'absolute',
    inset: '0',
    background: 'radial-gradient(ellipse 75% 85% at 78% 25%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.18) 100%)',
    opacity: '0',
  } satisfies Partial<CSSStyleDeclaration>)
  curtain.appendChild(shade)

  // The sun sits in the upper fly of the flag: centred in the blue band,
  // three quarters of the way across.
  const sunSize = 'min(34vh, 26vw, 280px)'
  const sun = document.createElement('div')
  Object.assign(sun.style, {
    position: 'absolute',
    left: '78%',
    top: '25%',
    width: sunSize,
    height: sunSize,
    marginLeft: `calc(${sunSize} / -2)`,
    marginTop: `calc(${sunSize} / -2)`,
    opacity: '0',
    filter: 'drop-shadow(0 0 36px rgba(229,190,1,0.45))',
  } satisfies Partial<CSSStyleDeclaration>)
  sun.innerHTML = sunSvg()
  curtain.appendChild(sun)
  document.body.appendChild(curtain)

  // Quick and snappy: the whole round trip is about 0.7 s.
  const sweepIn = bands.map((band, i) =>
    band.animate([{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }], {
      duration: 280,
      delay: i * 30,
      easing: EASE_IN_OUT,
      fill: 'forwards',
    }),
  )
  shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 100, easing: EASE_OUT, fill: 'forwards' })
  sun.animate(
    [
      { opacity: 0, transform: 'scale(0.4) rotate(-90deg)' },
      { opacity: 1, transform: 'scale(1) rotate(0deg)' },
    ],
    { duration: 280, delay: 140, easing: EASE_OUT, fill: 'forwards' },
  )
  // Keep the sun turning gently while the next page loads.
  const spin = sun.firstElementChild?.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: 24000, iterations: Infinity },
  )

  let pushed = false
  const go = () => {
    if (pushed) return
    pushed = true
    push(href)
  }

  // Safety net: never leave the curtain up if something goes wrong. Browsers
  // pause animations in a hidden tab, so a visitor who switches tabs mid-sweep
  // would otherwise stay on this page: the net still takes them where they
  // clicked.
  const failsafe = setTimeout(() => {
    go()
    curtain.remove()
  }, 4000)
  const from = location.pathname

  // Navigate as soon as the screen is covered — no idle hold.
  Promise.all(sweepIn.map((a) => a.finished))
    .then(() => {
      go()
      return waitForRoute(from)
    })
    .then(() => {
      sun.animate(
        [
          { opacity: 1, transform: 'scale(1) rotate(0deg)' },
          { opacity: 0, transform: 'scale(0.7) rotate(60deg)' },
        ],
        { duration: 180, easing: EASE_IN_OUT, fill: 'forwards' },
      )
      shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: EASE_OUT, fill: 'forwards' })
      const sweepOut = bands.map((band, i) =>
        band.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(101%)' }], {
          duration: 300,
          delay: 20 + i * 30,
          easing: EASE_IN_OUT,
          fill: 'forwards',
        }),
      )
      return Promise.all(sweepOut.map((a) => a.finished))
    })
    .finally(() => {
      clearTimeout(failsafe)
      spin?.cancel()
      curtain.remove()
    })
}

/**
 * Sends plain left-clicks on links under `root` whose href is in `hrefs`
 * through the flag transition. Modified clicks (new tab, etc.) behave as
 * normal links.
 */
export function useTransitionLinks(root: RefObject<HTMLElement | null>, hrefs: string[]) {
  const router = useRouter()
  const key = hrefs.join('|')

  // Get the destination pages ready while the visitor is still reading, so a
  // click never waits on the network (production prefetch) or, in `next dev`,
  // on the first compile of the page — that wait is what kept the flag on
  // screen. Runs once, when the browser is idle.
  useEffect(() => {
    const targets = key.split('|')
    const warm = () => {
      for (const href of targets) {
        router.prefetch(href)
        if (process.env.NODE_ENV !== 'production') {
          fetch(href, { credentials: 'same-origin' }).catch(() => {})
        }
      }
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm)
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(warm, 1200)
    return () => window.clearTimeout(id)
  }, [key, router])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const targets = key.split('|')
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest('a')
      const href = link?.getAttribute('href')
      if (!link || !href || !targets.includes(href) || link.target === '_blank') return
      e.preventDefault()
      // Start loading the next page while the flag sweeps in, so the
      // curtain rarely has to wait on the network.
      router.prefetch(href)
      transitionTo(href, router.push)
    }
    el.addEventListener('click', onClick, true)
    return () => el.removeEventListener('click', onClick, true)
  }, [root, key, router])
}
