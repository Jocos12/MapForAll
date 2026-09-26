'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Bookmark,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Globe,
  History,
  Leaf,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Send,
  Square,
  Sun,
  Trash2,
  Users,
  Utensils,
  Volume2,
  VolumeX,
  Accessibility,
  Store,
} from 'lucide-react'
import type { ChatMessage, Place, Theme } from '@/lib/types'
import type { MapSnapshot } from '@/lib/mapHistory'
import type { VoiceState } from '@/hooks/useVoice'
import { ModelSwitcher, MODELS, type ModelId } from './ModelSwitcher'
import { CollapsibleMessage } from './CollapsedReply'
import { TypingIndicator, ThinkingTrace } from './TypingIndicator'
import { OpenMapButton } from './OpenMapButton'
import { InlinePlaceGallery } from './InlinePlaceGallery'
import { googleCalendarUrl } from '@/lib/calendar'
import { shownMessages } from '@/lib/animationMemory'
import { focusRing } from '@/lib/design/tokens'
import { DUR, EASE } from './ui/motion'
import { useI18n, type Lang } from './I18nProvider'

interface Props {
  messages: ChatMessage[]
  loading: boolean
  thinkingSteps: string[]
  streamingStarted: boolean
  onSend: (text: string) => void
  /** Quick inclusion filters. The parent fetches places and sends the agent tokens. */
  onInclusionFilter?: (mode: 'local' | 'accessible') => void
  inclusionLocal?: boolean
  inclusionAccessible?: boolean
  /** Single shared voice instance, owned by the parent (avoids duplicate recorders). */
  voiceState?: VoiceState
  voiceSupported?: boolean
  voiceWarning?: string
  voiceLiveText?: string
  onVoiceToggle?: () => void
  /** Stops everything: dictation, speech output, and the in-flight request. */
  onVoiceStop?: () => void
  historyItems: Array<{ id: string; title: string; updatedAt: number }>
  mapArchive?: MapSnapshot[]
  onSelectMapArchive?: (id: string) => void
  onNewChat: () => void
  onSelectHistory: (id: string) => void
  onDeleteHistory?: (id: string) => void
  mapExpanded: boolean
  mapVisible: boolean
  hasMapData: boolean
  onOpenMapPanel: () => void
  onExpandMap: () => void
  onCollapseMap: () => void
  onOpenMapFromMessage: (message: ChatMessage) => void
  /** Edit a sent user message and re-send it (drops the turns after it). */
  onEditMessage?: (id: string, text: string) => void
  /** Opens the in-app place details panel from the inline chat gallery. */
  onPlaceDetails?: (place: Place) => void
  onToggleMapPanel?: () => void
  selectedModel: ModelId
  onModelChange: (id: ModelId) => void
  theme: Theme
  onToggleTheme: () => void
  hasLocation: boolean
  /** Manual "set my city" fallback in effect (GPS denied/unavailable). */
  manualCity?: string | null
  /** Explicit user-gesture location request — the only thing that may prompt. */
  onUseMyLocation?: () => void
  /** Store a typed city as the location fallback (empty string clears it). */
  onSetCity?: (city: string) => void
  /** Actionable geolocation failure message (denied / no GPS / timeout / http). */
  locationNotice?: string | null
  onDismissLocationNotice?: () => void
  locationPending?: boolean
  speakReplies?: boolean
  speechOutSupported?: boolean
  onToggleSpeakReplies?: () => void
  onCollapse?: () => void
  onStop?: () => void
  uiMode?: 'chat' | 'voice'
  onEnterChatMode?: () => void
  onEnterVoiceMode?: () => void
  userName?: string
  onLogout?: () => void
  /** Opens the community panel (people, encrypted chats, shared pins). */
  onOpenCommunity?: () => void
  /** Pending invite count shown as a badge on the community icon. */
  communityInviteCount?: number
}

const CHIPS = [
  { key: 'chips.kigali', query: '4 hours in Kigali under $60', Icon: Clock },
  { key: 'chips.vegetarian', query: 'Vegetarian food nearby', Icon: Leaf },
  { key: 'chips.food', query: 'Best food and sights nearby', Icon: Utensils },
  { key: 'chips.plan', query: 'Plan my trip today', Icon: Compass },
]

export function ChatPanel({
  messages,
  loading,
  thinkingSteps,
  streamingStarted,
  onSend,
  onInclusionFilter,
  inclusionLocal = false,
  inclusionAccessible = false,
  voiceState = 'idle',
  voiceSupported = false,
  voiceWarning,
  voiceLiveText,
  onVoiceToggle,
  onVoiceStop,
  historyItems,
  onNewChat,
  onSelectHistory,
  onDeleteHistory,
  mapArchive = [],
  onSelectMapArchive,
  hasMapData,
  mapVisible,
  onOpenMapPanel,
  onExpandMap,
  onCollapseMap,
  mapExpanded,
  onOpenMapFromMessage,
  onEditMessage,
  onPlaceDetails,
  onToggleMapPanel,
  selectedModel,
  onModelChange,
  theme,
  onToggleTheme,
  hasLocation,
  manualCity,
  onUseMyLocation,
  onSetCity,
  locationNotice,
  onDismissLocationNotice,
  locationPending = false,
  speakReplies,
  speechOutSupported,
  onToggleSpeakReplies,
  onCollapse,
  onStop,
  uiMode = 'chat',
  onEnterChatMode,
  onEnterVoiceMode,
  userName,
  onLogout,
  onOpenCommunity,
  communityInviteCount,
}: Props) {
  const { t, lang, setLang } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [hasNewBelow, setHasNewBelow] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  // Below md the header has room for only a few icons — theme, speak-replies
  // and the model switcher fold into this "More" popover so community,
  // history and new-chat (the actions people reach for mid-conversation) keep
  // a full 44px target instead of being squeezed to fit ~7 controls at once.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const [caretVisible, setCaretVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [cityEditing, setCityEditing] = useState(false)
  const [cityDraft, setCityDraft] = useState('')

  function submitCity(e: React.FormEvent) {
    e.preventDefault()
    const city = cityDraft.trim()
    if (!city) return
    onSetCity?.(city)
    setCityDraft('')
    setCityEditing(false)
  }

  function submitEdit() {
    const text = editText.trim()
    const id = editingId
    setEditingId(null)
    if (id && text) onEditMessage?.(id, text)
  }
  const reduced = useReducedMotion()
  /** Messages present on first render get a staggered entrance; newly appended ones animate immediately. */
  const initialCountRef = useRef(messages.length)

  const streaming = loading && streamingStarted
  const voiceActive = voiceState !== 'idle'
  const lastMsgId = messages[messages.length - 1]?.id
  const showThinking = loading && !streamingStarted
  const showWriting = streaming
  const isEmpty = messages.length === 0 && !loading

  const visibleHistoryItems = historyQuery.trim()
    ? historyItems.filter((item) =>
        item.title.toLowerCase().includes(historyQuery.trim().toLowerCase()),
      )
    : historyItems

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nextAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    autoScrollRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
    if (nextAtBottom) setHasNewBelow(false)
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    else bottomRef.current?.scrollIntoView({ behavior })
    autoScrollRef.current = true
    setAtBottom(true)
    setHasNewBelow(false)
  }

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') {
      autoScrollRef.current = true
      setAtBottom(true)
      setHasNewBelow(false)
    }
    if (autoScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom(reduced ? 'auto' : 'smooth'))
    } else if (loading || messages.length) {
      setHasNewBelow(true)
    }
  }, [messages, loading, streamingStarted, reduced])

  useEffect(() => {
    if (streaming) setCaretVisible(true)
    else if (caretVisible) {
      const t = setTimeout(() => setCaretVisible(false), 400)
      return () => clearTimeout(t)
    }
  }, [streaming, caretVisible])

  // Once a message has been rendered, remember it so its entrance/typewriter
  // does not replay when this panel remounts (switching chat <-> map, or pages).
  useEffect(() => {
    messages.forEach((m) => shownMessages.add(m.id))
  }, [messages])

  useEffect(() => {
    if (!moreOpen) return
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // After the stream ends, the last reply keeps typing out for a beat. Keep the
  // view pinned to the bottom while it reveals — unless the user scrolled up.
  useEffect(() => {
    if (streaming) return
    let raf = 0
    let start = 0
    const follow = (now: number) => {
      if (!start) start = now
      if (autoScrollRef.current) scrollToBottom('auto')
      if (now - start < 2600) raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [streaming])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = inputRef.current?.value.trim()
    if (!text || loading) return
    autoScrollRef.current = true
    setAtBottom(true)
    onSend(text)
    inputRef.current!.value = ''
  }

  const composer = (
    <div className="mx-auto w-full max-w-[720px]">
      {hasMapData && onToggleMapPanel && (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={onToggleMapPanel}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-header)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[#F56A00]/40 hover:bg-[#F56A00]/[0.06] dark:hover:bg-[#F56A00]/10"
          >
            {mapVisible && !mapExpanded ? (
              <>
                <PanelRightClose className="h-3.5 w-3.5" />
                Hide map
              </>
            ) : (
              <>
                <MapIcon className="h-3.5 w-3.5" />
                Show map
              </>
            )}
          </button>
        </div>
      )}
      {hasLocation ? (
        <p className="mb-2 ml-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
          <MapPin className="h-3 w-3" />
          Location active
        </p>
      ) : (onUseMyLocation || onSetCity) ? (
        <div className="mb-2 ml-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {manualCity && !cityEditing && (
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
              <MapPin className="h-3 w-3" />
              City: {manualCity}
            </span>
          )}
          {onUseMyLocation && (
            <button
              type="button"
              onClick={onUseMyLocation}
              disabled={locationPending}
              className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00] disabled:opacity-50 max-md:min-h-[44px]"
            >
              <LocateFixed className={`h-3.5 w-3.5 ${locationPending ? 'animate-pulse' : ''}`} />
              {locationPending ? 'Locating…' : 'Use my location'}
            </button>
          )}
          {onSetCity && (
            <button
              type="button"
              onClick={() => { setCityEditing((v) => !v); setCityDraft(manualCity ?? '') }}
              className="flex min-h-[32px] items-center rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00] max-md:min-h-[44px]"
            >
              {manualCity ? 'Change city' : 'Set my city'}
            </button>
          )}
        </div>
      ) : null}
      {locationNotice && (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-header)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-secondary)]"
        >
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F56A00]" />
          <span className="flex-1">{locationNotice}</span>
          {onDismissLocationNotice && (
            <button
              type="button"
              onClick={onDismissLocationNotice}
              aria-label="Dismiss location message"
              className="-m-1 shrink-0 p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              ×
            </button>
          )}
        </div>
      )}
      {cityEditing && onSetCity && !hasLocation && (
        <form onSubmit={submitCity} className="mb-2 flex items-center gap-2">
          <input
            type="text"
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            placeholder="e.g. Kigali, or New York"
            autoFocus
            className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--bg-header)] px-4 py-2 text-[16px] text-[var(--text-primary)] outline-none transition-[border-color] focus:border-[#F56A00]/60 md:text-[13px]"
          />
          <button
            type="submit"
            disabled={!cityDraft.trim()}
            className="min-h-[36px] rounded-full bg-[#F56A00] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-40 max-md:min-h-[44px]"
          >
            Set
          </button>
        </form>
      )}
      {voiceState === 'listening' && voiceLiveText && (
        <p className="mb-1.5 ml-1 truncate text-[12px] italic text-[var(--text-secondary)]">
          “{voiceLiveText}”
        </p>
      )}
      {voiceWarning && voiceState === 'idle' && (
        <p className="mb-1.5 ml-1 text-[11px] text-[var(--text-secondary)]">{voiceWarning}</p>
      )}
      <form onSubmit={handleSubmit}>
        <div
          className={`flex items-center gap-2 rounded-full border bg-[var(--bg-header)]/95 px-2 py-1 shadow-[0_14px_36px_-18px_rgba(90,40,0,0.45)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-[#F56A00]/70 focus-within:shadow-[0_0_0_4px_rgba(245,106,0,0.16),0_16px_36px_-16px_rgba(245,106,0,0.45)] motion-reduce:transition-none dark:shadow-[0_16px_40px_-18px_rgba(0,0,0,0.7)] dark:focus-within:shadow-[0_0_0_4px_rgba(245,106,0,0.24),0_16px_36px_-16px_rgba(245,106,0,0.35)] sm:px-3 ${
            voiceActive ? 'border-[#F56A00]/60' : 'border-black/10 dark:border-white/10'
          }`}
        >
          {voiceSupported && onVoiceToggle && (
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={loading && voiceState === 'idle'}
              aria-label={voiceState === 'listening' ? 'Stop listening and send' : 'Start voice input'}
              title={voiceState === 'listening' ? 'Stop listening and send' : 'Start voice input'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 max-md:h-11 max-md:w-11 ${
                voiceState === 'listening'
                  ? 'bg-red-500 text-white'
                  : 'text-gray-500 hover:bg-[#F56A00]/10 hover:text-[#F56A00] dark:hover:bg-[#F56A00]/15'
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder={
              voiceState === 'listening' ? 'Listening…'
              : voiceState === 'thinking' ? 'Thinking…'
              : voiceState === 'speaking' ? 'Hodari is speaking…'
              : voiceState === 'paused' ? 'Paused — tap Stop or the mic'
              : t('composer.placeholder')
            }
            aria-label={t('composer.placeholder')}
            className={`min-w-0 flex-1 bg-transparent py-3 text-[16px] text-[var(--text-primary)] outline-none md:text-[14px] ${
              voiceActive ? 'placeholder:text-[#F56A00]/80' : 'placeholder:text-[var(--text-secondary)]'
            }`}
            disabled={loading}
          />
          {(loading || voiceActive) && (onStop || onVoiceStop) ? (
            <button
              type="button"
              onClick={() => { onVoiceStop?.(); if (!onVoiceStop) onStop?.() }}
              aria-label="Stop"
              title="Stop voice and generation"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-red-500 px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-red-600 max-md:h-11"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              aria-label={t('composer.send')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F56A00] text-white shadow-[0_6px_16px_-6px_rgba(245,106,0,0.7)] transition-[transform,background-color,box-shadow] duration-150 ease-out hover:scale-105 hover:bg-terracotta hover:shadow-[0_10px_20px_-8px_rgba(196,92,38,0.75)] active:scale-95 disabled:opacity-40 disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100 max-md:h-11 max-md:w-11"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
      <div className="mt-3 flex max-w-full flex-wrap justify-center gap-2">
        {onInclusionFilter && (
          <>
            <button
              type="button"
              onClick={() => onInclusionFilter('local')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${inclusionLocal ? 'border-terracotta bg-terracotta/15 text-terracotta' : 'border-[var(--border)] bg-[var(--bg-header)]/80 text-[var(--text-primary)]'} hover:border-[#F56A00]/45`}
            >
              <Store className="h-3.5 w-3.5 text-terracotta" aria-hidden />
              {t('filters.local')}
            </button>
            <button
              type="button"
              onClick={() => onInclusionFilter('accessible')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${inclusionAccessible ? 'border-[#0F6E56] bg-[#0F6E56]/15 text-[#0F6E56]' : 'border-[var(--border)] bg-[var(--bg-header)]/80 text-[var(--text-primary)]'} hover:border-[#0F6E56]/45`}
            >
              <Accessibility className="h-3.5 w-3.5 text-[#0F6E56]" aria-hidden />
              {t('filters.accessible')}
            </button>
          </>
        )}
        {messages.length === 0 && CHIPS.map(({ key, query, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onSend(query)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-header)]/80 px-3 py-1.5 text-left text-[12px] leading-snug text-[var(--text-primary)] shadow-sm transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:border-[#F56A00]/45 hover:bg-[#F56A00]/10 hover:shadow-[0_8px_18px_-12px_rgba(245,106,0,0.7)] motion-reduce:transition-none motion-reduce:hover:scale-100 sm:px-3.5 sm:text-[13px]"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-terracotta dark:text-[#FF8C2F]" aria-hidden="true" />
            <span className="min-w-0">{t(key)}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const messageList = (
    <>
      <div className="relative min-h-0 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="chat-scroll h-full min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto w-full max-w-[720px] space-y-5">
            {isEmpty && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.45, ease: EASE }}
                className="flex flex-col items-center px-2 pb-6 pt-[6vh] text-center sm:pt-[8vh]"
              >
                <div className="hodari-orb relative mb-6 flex h-[88px] w-[88px] items-center justify-center motion-reduce:animate-none">
                  <span className="absolute -inset-3 rounded-full bg-[#F56A00]/15 blur-md dark:bg-[#F56A00]/20" />
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#FF8C2F] via-[#F56A00] to-terracotta shadow-[0_18px_40px_-12px_rgba(196,92,38,0.7)]" />
                  <Globe className="relative h-9 w-9 text-white" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="font-display text-[clamp(2.4rem,6vw,3rem)] font-semibold italic tracking-tight text-ink dark:text-cream">Where to?</p>
                <p className="mx-auto mt-4 max-w-sm text-[14px] leading-relaxed text-[var(--text-secondary)]">
                  Tell me your time, budget, and preferences, and I&apos;ll build your matchday plan.
                </p>
              </motion.div>
            )}

            {messages.map((msg, i) => (
            <motion.div
              key={msg.id}
              // Just-sent bubble rises from the composer (fast + small offset);
              // messages restored from history/streamed in glide like every
              // other surface (base duration, slightly taller rise).
              initial={reduced || shownMessages.has(msg.id) ? false : { opacity: 0, y: msg.role === 'user' ? 6 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduced ? 0 : msg.role === 'user' ? DUR.fast : DUR.base,
                ease: EASE,
                delay: reduced || i >= initialCountRef.current ? 0 : Math.min(i * 0.05, 0.4),
              }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                editingId === msg.id ? (
                  <div className="w-full max-w-[min(680px,90%)]">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      rows={Math.min(6, Math.max(2, editText.split('\n').length))}
                      className="w-full resize-none rounded-2xl border border-[#F56A00]/50 bg-[var(--bg-header)] px-4 py-2.5 text-[16px] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[#F56A00]/30 md:text-[14px]"
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-full px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                        Cancel
                      </button>
                      <button type="button" disabled={!editText.trim()} onClick={submitEdit} className="rounded-full bg-[#F56A00] px-3.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-40">
                        Send
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group flex items-end gap-1.5">
                    {onEditMessage && !loading && (
                      <button
                        type="button"
                        onClick={() => { setEditingId(msg.id); setEditText(msg.content) }}
                        title="Edit & resend"
                        aria-label="Edit and resend message"
                        className="mb-1 shrink-0 rounded-full p-1 text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-[#F56A00] group-hover:opacity-100 max-md:p-2 max-md:opacity-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <div className="max-w-[min(680px,90%)] rounded-2xl rounded-br-md bg-gradient-to-br from-[#FF8C2F] to-[#F56A00] px-4 py-2.5 shadow-[0_3px_12px_rgba(245,106,0,0.28)]">
                      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white">{msg.content}</p>
                    </div>
                  </div>
                )
              ) : (
                <div className="w-full max-w-[min(680px,100%)] text-left">
                  <p className="mb-1.5 ml-1 text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
                    Hodari
                  </p>
                  {msg.content ? (
                    <div className="w-full px-1">
                      <CollapsibleMessage
                        content={msg.content}
                        streaming={streaming && msg.id === lastMsgId}
                        showCaret={caretVisible && streaming && msg.id === lastMsgId}
                        animate={msg.id === lastMsgId}
                        messageKey={msg.id}
                      />
                    </div>
                  ) : (
                    <TypingIndicator />
                  )}
                  {showWriting && msg.id === lastMsgId && (
                    <p className="animate-fade-up ml-1 mt-1.5 text-[11px] text-gray-500">
                      Hodari is writing…
                    </p>
                  )}
                  {msg.places?.length ? (
                    <InlinePlaceGallery places={msg.places} onDetails={onPlaceDetails} />
                  ) : null}
                  {msg.calendarEvents?.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {msg.calendarEvents.map((ev, i) => (
                        <a
                          key={`${ev.title}-${i}`}
                          href={googleCalendarUrl(ev)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-header)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          Add “{ev.title}” to Calendar
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {(msg.places?.length || msg.itinerary?.stops?.length) ? (
                    <OpenMapButton
                      message={msg}
                      mapVisible={mapVisible}
                      onOpen={() => onOpenMapFromMessage(msg)}
                    />
                  ) : null}
                </div>
              )}
            </motion.div>
          ))}

          {showThinking && (
            <div className="flex justify-start">
              <div className="w-full max-w-[min(680px,100%)]">
                <p className="mb-1.5 ml-1 text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
                  Hodari
                </p>
                <div className="animate-fade-up">
                  <ThinkingTrace steps={thinkingSteps} />
                </div>
              </div>
            </div>
          )}

            <div ref={bottomRef} />
          </div>
        </div>

        <AnimatePresence>
          {(!atBottom || hasNewBelow) && messages.length > 0 && (
            <motion.button
              type="button"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 8 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              onClick={() => scrollToBottom(reduced ? 'auto' : 'smooth')}
              className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-header)]/95 px-4 py-1.5 text-[13px] text-[var(--text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm transition-colors hover:border-[#F56A00]/40 dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            >
              <ChevronDown className="h-4 w-4" />
              New message
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="pb-safe relative z-10 shrink-0 border-t border-[var(--border)] bg-[var(--bg-chat)]/90 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4">
        {composer}
      </div>
    </>
  )

  const modeToggle = onEnterChatMode && onEnterVoiceMode ? (
    <div className="relative grid grid-cols-2 rounded-full border border-[var(--border)] bg-[var(--bg-header)]/90 p-1 shadow-sm backdrop-blur-sm">
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-full bg-[#F56A00] shadow-[0_2px_8px_rgba(245,106,0,0.35)] transition-transform duration-300 ease-[var(--ease-glide)] motion-reduce:transition-none ${
          uiMode === 'voice' ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      <button
        type="button"
        onClick={onEnterChatMode}
        aria-pressed={uiMode === 'chat'}
        className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-300 sm:px-3.5 sm:text-[12px] ${
          uiMode === 'chat' ? 'text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat
      </button>
      <button
        type="button"
        onClick={onEnterVoiceMode}
        aria-pressed={uiMode === 'voice'}
        className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-300 sm:px-3.5 sm:text-[12px] ${
          uiMode === 'voice' ? 'text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Mic className="h-3.5 w-3.5" />
        Voice
      </button>
    </div>
  ) : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      {historyOpen && (
        <button
          type="button"
          aria-label="Close chat history"
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 z-[49]"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.28)' }}
        />
      )}

      <aside
        aria-hidden={!historyOpen}
        className={`fixed left-0 top-0 z-50 flex h-full w-[min(100%,272px)] flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] shadow-[8px_0_40px_-16px_rgba(26,22,20,0.28)] transition-transform duration-300 ease-[var(--ease-glide)] motion-reduce:transition-none dark:shadow-[8px_0_40px_-12px_rgba(0,0,0,0.55)] ${
          historyOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3.5">
          <span className="font-display text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            Hodari
          </span>
          <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close chat history" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[#F56A00]/10 hover:text-[#F56A00]">
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <input
            type="search"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder={t('header.searchChats')}
            className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-header)] px-3 py-2 text-[16px] text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] focus:border-[#F56A00]/60 focus:ring-2 focus:ring-[#F56A00]/20 motion-reduce:transition-none md:text-[13px] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <button
            type="button"
            onClick={() => { onNewChat(); setHistoryOpen(false) }}
            className="flex w-full items-center gap-2 rounded-xl bg-[#F56A00] px-3 py-2.5 text-left text-[13px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(245,106,0,0.9)] transition-[transform,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#e05a1a] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            {t('header.newChat')}
          </button>
          <a
            href="/saved"
            onClick={() => setHistoryOpen(false)}
            className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[#F56A00]/10"
          >
            <Bookmark className="h-4 w-4 shrink-0 text-terracotta dark:text-[#FF8C2F]" />
            {t('header.saved')}
          </a>
          {mapArchive.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
                <MapIcon className="h-3 w-3" /> Saved maps (kept on device)
              </p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {mapArchive.slice(0, 12).map((snap) => (
                  <button
                    key={snap.id}
                    type="button"
                    onClick={() => { onSelectMapArchive?.(snap.id); setHistoryOpen(false) }}
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[#F56A00]/40 hover:bg-[#F56A00]/[0.06] dark:hover:bg-[#F56A00]/10"
                  >
                    <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">{snap.title}</p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(snap.savedAt).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              <History className="h-3 w-3" /> {t('header.recent')}
            </p>
            <div className="space-y-1">
            {visibleHistoryItems.length === 0 ? (
              <p className="px-1 text-[13px] text-[var(--text-secondary)]">No recent chats yet.</p>
            ) : (
              visibleHistoryItems.map((item) => (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => { onSelectHistory(item.id); setHistoryOpen(false) }}
                    className="w-full rounded-xl px-2.5 py-2 pr-8 text-left transition-colors hover:bg-[#F56A00]/10"
                  >
                    <span className="block truncate text-[13px] text-[var(--text-primary)]">{item.title}</span>
                    <span className="mt-0.5 block text-[11px] text-gray-500">
                      {new Date(item.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                  {onDeleteHistory && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteHistory(item.id) }}
                      aria-label="Delete chat"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 max-md:p-2 max-md:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
            </div>
          </div>
        </div>

        {onLogout && (
          <div className="shrink-0 border-t border-[var(--border)] p-3">
            <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-header)] px-3 py-2.5 shadow-[0_8px_20px_-14px_rgba(26,22,20,0.45)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF8C2F] to-terracotta text-[13px] font-semibold text-white shadow-[0_6px_14px_-6px_rgba(196,92,38,0.8)] ring-2 ring-white dark:ring-[#3A322C]">
                {(userName?.trim()?.[0] ?? 'U').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {userName || t('header.signedIn')}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">{t('header.account')}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                aria-label={t('header.logout')}
                title={t('header.logout')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-red-500/10 hover:text-red-500"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* History is an overlay drawer (with a backdrop), NOT a layout push —
          the chat panel can be a narrow centered column, and pushing it by the
          drawer width crushed the header. */}
      <div className="flex min-h-0 flex-1 flex-col bg-transparent">
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-3.5 sm:px-5"
          style={{ backgroundColor: theme === 'dark' ? 'rgba(28, 25, 22, 0.55)' : 'rgba(255, 251, 246, 0.62)' }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold text-[var(--text-primary)]">{t('app.name')}</h1>
              <div className="mt-0.5 flex gap-1" role="group" aria-label={t('header.language')}>
                {(['fr', 'en', 'rw'] as Lang[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${lang === code ? 'bg-[#F56A00] text-white' : 'text-[var(--text-secondary)] hover:bg-[#F56A00]/10'}`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
            {modeToggle}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-full bg-white/70 p-1 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/10 max-md:hidden">
            {speechOutSupported && onToggleSpeakReplies && (
              <button
                type="button"
                onClick={onToggleSpeakReplies}
                aria-label={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                title={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                className={`rounded-full p-1.5 transition-colors ${speakReplies ? 'bg-[#F56A00]/15 text-[#F56A00]' : 'text-[var(--text-secondary)] hover:bg-[#F56A00]/10 hover:text-[#F56A00]'}`}
              >
                {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[#F56A00]/10 hover:text-[#F56A00]"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            </div>
            <div className="flex items-center gap-0.5 rounded-full bg-white/70 p-1 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/10">
            {onOpenCommunity && (
              <button
                type="button"
                aria-label={
                  communityInviteCount
                    ? `Open community, ${communityInviteCount} pending invite${communityInviteCount === 1 ? '' : 's'}`
                    : 'Open community'
                }
                title="Community"
                onClick={onOpenCommunity}
                className={`relative rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[#F56A00]/10 hover:text-[#F56A00] max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:p-0 ${focusRing}`}
              >
                <Users className="h-4 w-4" />
                {!!communityInviteCount && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#F56A00] text-[9px] font-semibold leading-none text-white"
                  >
                    {communityInviteCount > 9 ? '9+' : communityInviteCount}
                  </span>
                )}
              </button>
            )}
            {/* New chat: buried one level deep in the history drawer on
                desktop, but promoted to a direct header action on phones. */}
            <button
              type="button"
              aria-label="New chat"
              title="New chat"
              onClick={onNewChat}
              className={`hidden rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[#F56A00]/10 hover:text-[#F56A00] max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center ${focusRing}`}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Open chat history"
              onClick={() => setHistoryOpen((open) => !open)}
              className={`rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[#F56A00]/10 hover:text-[#F56A00] max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:p-0 ${focusRing}`}
            >
              <Menu className="h-4 w-4" />
            </button>
            </div>
            {hasMapData && (
              <button
                type="button"
                onClick={() => {
                  if (mapExpanded) onCollapseMap()
                  else if (mapVisible) onExpandMap()
                  else onOpenMapPanel()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00] max-md:hidden"
              >
                <MapIcon className="h-3.5 w-3.5" />
                {mapExpanded ? 'Compact map' : mapVisible ? 'Full map' : 'Open map'}
              </button>
            )}
            <div className="max-md:hidden">
              <ModelSwitcher selected={selectedModel} onChange={onModelChange} />
            </div>
            {/* More popover (below md only): theme, speak-replies, model. */}
            <div ref={moreRef} className="relative hidden max-md:block">
              <button
                type="button"
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-[var(--text-secondary)] transition-colors ${moreOpen ? 'border-[#F56A00]/50 text-[#F56A00]' : 'border-[var(--border)] hover:border-[#F56A00]/40 hover:text-[#F56A00]'} ${focusRing}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  aria-label="More options"
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-header)] shadow-2xl"
                >
                  <div className="p-1.5">
                    {speechOutSupported && onToggleSpeakReplies && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onToggleSpeakReplies(); setMoreOpen(false) }}
                        aria-label={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                        className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[#F56A00]/[0.06] ${focusRing}`}
                      >
                        {speakReplies ? <Volume2 className="h-4 w-4 shrink-0" /> : <VolumeX className="h-4 w-4 shrink-0" />}
                        {speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onToggleTheme(); setMoreOpen(false) }}
                      aria-label="Toggle theme"
                      className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[#F56A00]/[0.06] ${focusRing}`}
                    >
                      {theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
                      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                    </button>
                  </div>
                  <div className="border-t border-[var(--border)] p-1.5">
                    <p className="px-3 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                      AI Model
                    </p>
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={m.id === selectedModel}
                        disabled={!m.available}
                        onClick={() => { if (m.available) { onModelChange(m.id); setMoreOpen(false) } }}
                        className={`flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                          m.id === selectedModel
                            ? 'bg-[#F56A00]/10 text-[var(--text-primary)]'
                            : m.available
                              ? 'text-[var(--text-primary)] hover:bg-[#F56A00]/[0.06]'
                              : 'cursor-not-allowed text-[var(--text-secondary)] opacity-40'
                        } ${focusRing}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        {m.id === selectedModel ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-[#F56A00]" />
                        ) : !m.available ? (
                          <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]">
                            Soon
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {onCollapse && (
              <button type="button" onClick={onCollapse} aria-label="Collapse chat" className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--text-secondary)] max-md:p-2.5">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="h-px shrink-0 bg-gradient-to-r from-transparent via-[#F56A00]/20 to-transparent dark:via-[#FF8C2F]/15" />

        <div className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] overflow-hidden">
          {messageList}
        </div>
      </div>
    </div>
  )
}
