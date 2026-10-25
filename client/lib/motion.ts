/**
 * Shared motion tokens. Durations stay between 150 ms and 300 ms.
 * Page moves are opacity and transform only so navigation is never blocked.
 */
export const motionTokens = {
  duration: { fast: 0.15, base: 0.2, max: 0.3 },
  ease: [0.22, 1, 0.36, 1] as const,
  page: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
  },
  slide: {
    enter: (dir: number) => ({ opacity: 0, x: dir * 16 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -16 }),
  },
} as const

export function motionTransition(reduce: boolean, seconds: number = motionTokens.duration.fast) {
  if (reduce) return { duration: 0 }
  return { duration: Math.min(seconds, motionTokens.duration.max), ease: motionTokens.ease }
}
