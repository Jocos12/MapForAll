'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/design/cn'

type Size = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  src?: string | null
  /** Used for the alt text and the initials fallback. */
  name: string
  /** Stable id so the fallback color does not change when the display name does. */
  seed?: string | null
  size?: Size
  /** Presence ring: green = online, muted = away/offline. Omit when presence is irrelevant. */
  status?: 'online' | 'offline'
  className?: string
}

const SIZES: Record<Size, string> = { sm: 'w-7 h-7 text-[11px]', md: 'w-9 h-9 text-xs', lg: 'w-12 h-12 text-sm' }
const PX: Record<Size, number> = { sm: 28, md: 36, lg: 48 }

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

const AVATAR_TONES = [
  'bg-[#E8672A]/20 text-[#C2410C]',
  'bg-sky-500/20 text-sky-800 dark:text-sky-300',
  'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300',
  'bg-violet-500/20 text-violet-800 dark:text-violet-300',
  'bg-amber-500/20 text-amber-900 dark:text-amber-300',
  'bg-rose-500/20 text-rose-800 dark:text-rose-300',
]

function toneFromSeed(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

const BLUR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Avatar — photo or initials on a color picked from the user id, plus an optional presence ring. */
export function Avatar({ src, name, seed, size = 'md', status, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImg = Boolean(src) && !failed
  const tone = toneFromSeed(seed || name || '?')
  const px = PX[size]
  const local = !!src && src.startsWith('/') && !src.startsWith('//')

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'relative inline-flex items-center justify-center overflow-hidden rounded-full',
          'border border-border font-mono font-medium uppercase',
          showImg ? 'bg-surface2 text-text2' : tone,
          status === 'online' && 'ring-2 ring-emerald-500',
          status === 'offline' && 'ring-2 ring-zinc-300 dark:ring-white/30',
          SIZES[size],
        )}
      >
        {showImg && src ? (
          <Image
            src={src}
            alt={name}
            width={px}
            height={px}
            sizes={`${px}px`}
            className="h-full w-full object-cover"
            placeholder={local ? 'blur' : 'empty'}
            blurDataURL={local ? BLUR : undefined}
            unoptimized={!local || src.startsWith('data:')}
            onError={() => setFailed(true)}
          />
        ) : (
          <span aria-hidden>{initials(name) || '?'}</span>
        )}
      </span>
    </span>
  )
}
