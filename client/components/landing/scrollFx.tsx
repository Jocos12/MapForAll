'use client'

import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'

/**
 * Apple-style scroll choreography for the landing page.
 *
 * Everything here is scroll-*linked*, not scroll-triggered: each effect is a
 * pure function of scroll position, so scrolling back up plays it in reverse,
 * exactly like apple.com's iOS pages. Progress runs through a light spring so
 * motion trails the wheel slightly instead of stepping with it.
 *
 * The landing scrolls inside its own div (html/body are overflow:hidden), so
 * that div is shared through ScrollRootProvider and passed to useScroll as
 * `container`.
 */

/** Apple's own marketing-page easing curve. */
export const APPLE_EASE = [0.28, 0.11, 0.32, 1] as const

type Offset = NonNullable<Parameters<typeof useScroll>[0]>['offset']

const ScrollRootContext = createContext<RefObject<HTMLElement | null> | null>(null)
export const ScrollRootProvider = ScrollRootContext.Provider

export function useScrollRoot() {
  return useContext(ScrollRootContext) ?? undefined
}

const SPRING = { stiffness: 140, damping: 30, mass: 0.35, restDelta: 0.0005 }

function useSmoothProgress(target: RefObject<HTMLElement | null>, offset: Offset) {
  const container = useScrollRoot()
  const { scrollYProgress } = useScroll({ target, container, offset })
  return useSpring(scrollYProgress, SPRING)
}

/**
 * Text/content block: fades and rises as it enters from the bottom, and
 * softly lifts away as it leaves through the top.
 * `stagger` (0–0.2, fraction of viewport) delays a block behind its siblings.
 *
 * Only opacity and transforms are scroll-linked: both run on the GPU
 * compositor. A blur filter here would repaint the block on every scroll
 * frame, which is what made long pages stutter.
 */
export function ScrollReveal({
  children,
  className = '',
  stagger = 0,
  distance = 56,
  exit = true,
}: {
  children: ReactNode
  className?: string
  stagger?: number
  distance?: number
  exit?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  // Sharp by the time its top reaches the lower quarter of the screen: the
  // effect is felt on the way in, but nothing on screen stays blurry.
  const enter = useSmoothProgress(ref, [`start ${1 - stagger}`, `start ${0.76 - stagger}`] as Offset)
  // Exit starts only once the block is almost gone, so text stays readable
  // right up to the header.
  const leave = useSmoothProgress(ref, ['end 0.18', 'end 0'] as Offset)

  const opacity = useTransform([enter, leave], ([e, l]: number[]) => e * (exit ? 1 - l * 0.7 : 1))
  const y = useTransform([enter, leave], ([e, l]: number[]) => (1 - e) * distance - (exit ? l * distance * 0.7 : 0))
  const scale = useTransform(enter, [0, 1], [0.97, 1])

  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div ref={ref} style={{ opacity, y, scale }} className={`will-change-transform ${className}`}>
      {children}
    </motion.div>
  )
}

/**
 * Media block (photos, maps): grows from a smaller, lower card into place as
 * it crosses the lower half of the viewport, the "device zooms toward you"
 * move from Apple's product pages.
 */
export function ScrollZoom({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const p = useSmoothProgress(ref, ['start end', 'start 0.45'] as Offset)

  const scale = useTransform(p, [0, 1], [0.86, 1])
  const y = useTransform(p, [0, 1], [80, 0])
  const opacity = useTransform(p, [0, 0.45, 1], [0, 0.85, 1])

  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div ref={ref} style={{ scale, y, opacity }} className={`origin-bottom will-change-transform ${className}`}>
      {children}
    </motion.div>
  )
}

/** Photo with a slow inner parallax: the image drifts inside its frame. */
export function ParallaxImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const p = useSmoothProgress(ref, ['start end', 'end start'])
  const y = useTransform(p, [0, 1], ['-7%', '7%'])

  return (
    <div ref={ref} className={`overflow-hidden ${className}`}>
      <motion.img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={reduced ? undefined : { y, scale: 1.16 }}
        className="h-full w-full object-cover"
      />
    </div>
  )
}

function HighlightWord({ word, progress, range }: { word: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.16, 1])
  return <motion.span style={{ opacity }}>{word}</motion.span>
}

/**
 * Large statement that lights up word by word as it is read down the page,
 * and dims again word by word when scrolling back up.
 */
export function ScrollHighlight({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const reduced = useReducedMotion()
  const p = useSmoothProgress(ref, ['start 0.88', 'end 0.5'] as Offset)
  const words = text.split(' ')

  return (
    <h2 ref={ref} className={className}>
      {reduced
        ? text
        : words.map((word, i) => (
          <span key={i}>
            <HighlightWord word={word} progress={p} range={[i / words.length, (i + 1) / words.length]} />
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
    </h2>
  )
}

/**
 * Load-time headline: each word arrives out of a blur, one after another.
 * Plays once on mount (the hero is already on screen).
 */
export function BlurInWords({
  text,
  className = '',
  wordClassName = '',
  delay = 0,
  as: Tag = 'h1',
}: {
  text: string
  className?: string
  /** Applied to each word; gradients must go here, since a clipped
      background on the parent does not reach transformed children. */
  wordClassName?: string
  delay?: number
  as?: 'h1' | 'h2' | 'p' | 'span'
}) {
  const reduced = useReducedMotion()
  const words = text.split(' ')
  if (reduced) {
    return (
      <Tag className={className}>
        {words.map((word, i) => (
          <span key={`${word}-${i}`}><span className={wordClassName}>{word}</span>{i < words.length - 1 ? ' ' : ''}</span>
        ))}
      </Tag>
    )
  }
  return (
    <Tag className={className}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <motion.span
            className={`inline-block will-change-transform ${wordClassName}`}
            initial={{ opacity: 0, y: '0.4em', filter: 'blur(14px)' }}
            animate={{ opacity: 1, y: '0em', filter: 'blur(0px)' }}
            transition={{ duration: 1.1, delay: delay + i * 0.055, ease: APPLE_EASE }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  )
}

/** Load-time fade for the smaller hero pieces (kicker, body, CTAs, map). */
export function IntroIn({
  children,
  className = '',
  delay = 0,
  from = 'up',
}: {
  children: ReactNode
  className?: string
  delay?: number
  from?: 'up' | 'zoom'
}) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  const initial = from === 'zoom'
    ? { opacity: 0, scale: 0.92, filter: 'blur(10px)' }
    : { opacity: 0, y: 28, filter: 'blur(10px)' }
  return (
    <motion.div
      className={className}
      initial={initial}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: from === 'zoom' ? 1.4 : 1, delay, ease: APPLE_EASE }}
    >
      {children}
    </motion.div>
  )
}

/**
 * Hero exit: as the hero scrolls away, the copy lifts and fades while
 * the visual sinks back and shrinks — and both come back on the way up.
 * `target` is the hero <section>.
 */
export function HeroLayer({
  target,
  variant,
  children,
  className = '',
}: {
  target: RefObject<HTMLElement | null>
  variant: 'copy' | 'visual'
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()
  const p = useSmoothProgress(target, ['start start', 'end start'])

  const isCopy = variant === 'copy'
  const y = useTransform(p, [0, 1], isCopy ? [0, -140] : [0, 90])
  const scale = useTransform(p, [0, 1], isCopy ? [1, 0.94] : [1, 0.88])
  const opacity = useTransform(p, isCopy ? [0, 0.55] : [0.1, 0.85], [1, 0])

  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div style={{ y, scale, opacity }} className={`will-change-transform ${className}`}>
      {children}
    </motion.div>
  )
}

/** Horizontal drift tied to vertical scroll (the gallery slides sideways). */
export function ScrollDriftX({
  children,
  className = '',
  from = '5%',
  to = '-7%',
}: {
  children: ReactNode
  className?: string
  from?: string
  to?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const p = useSmoothProgress(ref, ['start end', 'end start'])
  const x = useTransform(p, [0, 1], [from, to])
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div ref={ref} style={{ x }} className={`will-change-transform ${className}`}>
      {children}
    </motion.div>
  )
}
