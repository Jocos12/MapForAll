'use client'

import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { motionTokens, motionTransition } from '@/lib/motion'

/** Opacity and a short slide. The old page is not held back. */
export function MotionFade({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const reduce = useReducedMotion()
  return (
    <motion.div
      key={path}
      initial={reduce ? false : motionTokens.page.initial}
      animate={motionTokens.page.animate}
      transition={motionTransition(!!reduce, motionTokens.duration.fast)}
    >
      {children}
    </motion.div>
  )
}
