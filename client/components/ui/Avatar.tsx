'use client'

import { useState } from 'react'
import { cn } from '@/lib/design/cn'

type Size = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  src?: string | null
  /** Used for the alt text and the initials fallback. */
  name: string
  size?: Size
  /** Presence dot: green = online, muted = away/offline. */
  status?: 'online' | 'offline'
  className?: string
}

const SIZES: Record<Size, string> = { sm: 'w-7 h-7 text-[11px]', md: 'w-9 h-9 text-xs', lg: 'w-12 h-12 text-sm' }
const DOT: Record<Size, string> = { sm: 'w-2 h-2', md: 'w-2.5 h-2.5', lg: 'w-3 h-3' }

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

function toneFromName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

/** Avatar — image with graceful initials fallback and an optional presence dot. */
export function Avatar({ src, name, size = 'md', status, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed
  const tone = toneFromName(name || '?')

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full overflow-hidden',
          'border border-border font-mono font-medium uppercase',
          showImg ? 'bg-surface2 text-text2' : tone,
          SIZES[size],
        )}
      >
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <span aria-hidden>{initials(name) || '?'}</span>
        )}
      </span>
      {status && (
        <span
          aria-label={status === 'online' ? 'Online' : 'Offline'}
          className={cn(
            'absolute -bottom-0 -right-0 rounded-full ring-2 ring-bg',
            DOT[size],
            status === 'online' ? 'bg-green' : 'bg-text3',
          )}
        />
      )}
    </span>
  )
}
