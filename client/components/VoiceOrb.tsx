'use client'

import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Mic, Pause, Play, Square } from 'lucide-react'
import { subscribeVoiceCaptions } from '@/lib/voice'
import { useMicLevel } from '@/hooks/useMicLevel'
import type { VoiceState } from '@/hooks/useVoice'

interface Props {
  state: VoiceState
  liveText?: string
  fallbackCaption?: string | null
  onToggle: () => void
  onPause?: () => void
  onResume?: () => void
  onStopSpeaking?: () => void
  /** When true, renders as a small floating corner widget instead of a full-screen modal */
  compact?: boolean
}

const WAVE_BASES = [0.4, 0.7, 1.0, 0.7, 0.4]

function ThinkingDots() {
  return (
    <div className="flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="scan-dot h-1.5 w-1.5 rounded-full bg-white" />
      ))}
    </div>
  )
}

function WaveBars({ level, reduced, small }: { level: number; reduced: boolean; small?: boolean }) {
  const h = small ? 12 : 32
  const w = small ? 'w-1' : 'w-1.5'
  return (
    <div className={`flex ${small ? 'h-4' : 'h-8'} items-end justify-center gap-1`} aria-hidden>
      {WAVE_BASES.map((base, i) => (
        <div
          key={i}
          className={`${w} origin-bottom rounded-full bg-amber-500`}
          style={{
            height: `${base * Math.max(level, 0.15) * h + (small ? 3 : 8)}px`,
            animation: reduced ? undefined : `waveBar ${0.6 + i * 0.1}s ease-in-out infinite`,
            animationDelay: reduced ? undefined : `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}

export function VoiceOrb({
  state,
  liveText = '',
  fallbackCaption = null,
  onToggle,
  onPause,
  onResume,
  onStopSpeaking,
  compact = false,
}: Props) {
  const reduced = useReducedMotion()
  const micLevel = useMicLevel(state === 'listening')
  const [streamCaption, setStreamCaption] = useState('')

  useEffect(() => subscribeVoiceCaptions(setStreamCaption), [])

  const currentCaption = useMemo(() => {
    const raw = (streamCaption || fallbackCaption || '').trim()
    if (!raw) return ''
    const lines = raw.split(/\n+/).filter(Boolean)
    if (lines.length >= 2) return lines.slice(-3).join(' ')
    const sentences = raw.match(/[^.!?]+[.!?]*/g)?.filter(Boolean) ?? [raw]
    return sentences.slice(-3).join(' ').trim()
  }, [streamCaption, fallbackCaption])

  const label =
    state === 'idle' ? 'Tap to speak'
    : state === 'listening' ? 'Listening…'
    : state === 'thinking' ? 'Thinking…'
    : state === 'paused' ? 'Paused'
    : 'MapForAll is speaking…'

  const showSpeechControls = state === 'speaking' || state === 'paused'
  const pulseScale = state === 'speaking' ? 1 + micLevel * 0.35 : 1

  // ── Compact floating corner widget ─────────────────────────────────────────
  if (compact) {
    return (
      <div className="flex flex-col items-end gap-2">
        {/* Caption / live transcript bubble */}
        {(liveText || currentCaption) && (
          <div className="animate-fade-up max-w-[220px] rounded-2xl border border-border bg-surface/95 px-3 py-2 text-[13px] leading-snug text-text shadow-lg backdrop-blur-md">
            {liveText || currentCaption}
          </div>
        )}

        {/* State pill with inline controls */}
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-[11px] font-medium text-text2 shadow-sm backdrop-blur-sm">
          <span
            className={`h-2 w-2 shrink-0 rounded-full bg-amber-500 ${
              state === 'listening' && !reduced ? 'animate-pulse' : ''
            }`}
          />
          <span>{label}</span>
          {state === 'speaking' && onPause && (
            <button
              type="button"
              onClick={onPause}
              aria-label="Pause MapForAll speaking"
              className="ml-0.5 text-text2 hover:text-text"
            >
              <Pause className="h-3 w-3" />
            </button>
          )}
          {state === 'paused' && onResume && (
            <button
              type="button"
              onClick={onResume}
              aria-label="Resume"
              className="ml-0.5 text-amber-500"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          {showSpeechControls && onStopSpeaking && (
            <button
              type="button"
              onClick={onStopSpeaking}
              aria-label="Stop and listen"
              className="ml-0.5 text-text2 hover:text-red-500"
            >
              <Square className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Wave bars (listening only) */}
        {state === 'listening' && (
          <WaveBars level={micLevel} reduced={!!reduced} small />
        )}

        {/* Main orb button */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          className="relative flex h-14 w-14 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          {/* Outer pulse ring */}
          <span
            className={`absolute inset-0 rounded-full bg-amber-500/15 ${
              (state === 'listening' || state === 'thinking') && !reduced ? 'voice-orb-pulse' : ''
            }`}
            style={
              state === 'speaking' && !reduced
                ? { transform: `scale(${pulseScale})`, transition: 'transform 70ms linear' }
                : undefined
            }
          />
          {/* Inner ring */}
          <span
            className={`absolute inset-2 rounded-full bg-amber-500/25 ${
              state === 'speaking' && !reduced ? 'voice-orb-pulse-2' : ''
            }`}
          />
          {/* Icon */}
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg shadow-amber-600/40">
            {state === 'thinking' ? <ThinkingDots /> : <Mic className="h-5 w-5" />}
          </span>
        </button>
      </div>
    )
  }

  // ── Full-size variant (used standalone, not in map/chat view) ──────────────
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        className="relative flex h-28 w-28 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <span
          className={`absolute inset-0 rounded-full bg-amber-500/20 ${
            (state === 'thinking' || state === 'listening') && !reduced ? 'voice-orb-pulse' : ''
          }`}
          style={
            state === 'speaking' && !reduced
              ? { transform: `scale(${pulseScale})`, transition: 'transform 70ms linear' }
              : undefined
          }
        />
        <span
          className={`absolute inset-3 rounded-full bg-amber-500/30 ${
            state === 'idle' && !reduced ? 'animate-pulse' : ''
          }`}
        />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg shadow-amber-600/30">
          {state === 'thinking' ? <ThinkingDots /> : <Mic className="h-6 w-6" />}
        </span>
      </button>

      {state === 'listening' && <WaveBars level={micLevel} reduced={!!reduced} />}

      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</p>

      {showSpeechControls && (
        <div className="mt-2 flex items-center gap-3">
          {state === 'speaking' && onPause && (
            <button
              type="button"
              onClick={onPause}
              aria-label="Pause MapForAll speaking"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-header)] text-[var(--text-primary)] shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50"
            >
              <Pause className="h-4 w-4" />
            </button>
          )}
          {state === 'paused' && onResume && (
            <button
              type="button"
              onClick={onResume}
              aria-label="Resume MapForAll speaking"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-500 bg-amber-500 text-white shadow-sm transition-colors hover:bg-amber-600"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {onStopSpeaking && (
            <button
              type="button"
              onClick={onStopSpeaking}
              aria-label="Stop speaking and listen"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-header)] text-[var(--text-primary)] shadow-sm transition-colors hover:border-red-300 hover:bg-red-50"
            >
              <Square className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {state === 'listening' && liveText && (
        <p className="max-w-md text-center text-[15px] text-[var(--text-primary)]">{liveText}</p>
      )}

      {(state === 'speaking' || state === 'paused') && currentCaption && (
        <div className="animate-fade-up mt-4 max-w-sm px-4 text-center">
          <p className="text-base leading-relaxed text-[var(--text-primary)] dark:text-gray-200">
            {currentCaption}
          </p>
        </div>
      )}
    </div>
  )
}
