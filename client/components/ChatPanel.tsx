'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Accessibility,
  ArrowDown,
  ArrowUp,
  Bookmark,
  Building2,
  CalendarPlus,
  Coffee,
  Keyboard,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Mic,
  Moon,
  MoreHorizontal,
  Navigation,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Pill,
  Plus,
  RotateCw,
  Search,
  ShoppingBasket,
  Square,
  SquarePen,
  Store,
  Sun,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { ChatMessage, Place, Theme } from '@/lib/types'
import type { MapSnapshot } from '@/lib/mapHistory'
import type { VoiceState } from '@/hooks/useVoice'
import { ModelSwitcher, type ModelId } from './ModelSwitcher'
import { CollapsibleMessage } from './CollapsedReply'
import { TypingIndicator, ThinkingTrace } from './TypingIndicator'
import { InlineMapPreview } from './InlineMapPreview'
import type { WorkspaceLink } from './WorkspaceShortcut'
import { AccountPanel } from './AccountPanel'
import { InlinePlaceGallery, PhotoGallery } from './InlinePlaceGallery'
import { googleCalendarUrl } from '@/lib/calendar'
import { shownMessages } from '@/lib/animationMemory'
import { DUR, EASE } from './ui/motion'
import { useI18n, type Lang } from './I18nProvider'

const SHOW_MODEL = process.env.NEXT_PUBLIC_SHOW_MODEL_SWITCHER === '1'

interface Props {
  messages: ChatMessage[]
  loading: boolean
  thinkingSteps: string[]
  streamingStarted: boolean
  onSend: (text: string) => void
  onRetry?: () => void
  /** Quick inclusion filters. The parent fetches places and sends the agent tokens. */
  onInclusionFilter?: (mode: 'local' | 'accessible') => void
  onMarketFilter?: () => void
  inclusionLocal?: boolean
  inclusionAccessible?: boolean
  inclusionMarkets?: boolean
  /** Single shared voice instance, owned by the parent (avoids duplicate recorders). */
  voiceState?: VoiceState
  voiceSupported?: boolean
  voiceWarning?: string
  voiceLiveText?: string
  /** Exact SpeechRecognition.lang from the latest listen start. */
  voiceRecognitionLang?: string
  /** Drop the last spoken line and listen again. */
  onRetryVoice?: () => void
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
  /** Focus a chat card on the in-app map. */
  onFocusPlace?: (place: Place) => void
  activePlaceId?: string | null
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
  /** Called when the account panel saves a new display name. */
  onUserNameChange?: (name: string) => void
  /** Owner/admin shortcut back to their back-office; absent for plain client accounts. */
  workspace?: WorkspaceLink
  /** Opens the community panel (people, encrypted chats, shared pins). */
  onOpenCommunity?: () => void
  /** Pending invite count shown as a badge on the community icon. */
  communityInviteCount?: number
  /** Opens the community “add a place” sheet. */
  onAddPlace?: () => void
}


export function ChatPanel({
  messages,
  loading,
  thinkingSteps,
  streamingStarted,
  onSend,
  onRetry,
  onInclusionFilter,
  onMarketFilter,
  inclusionLocal = false,
  inclusionAccessible = false,
  inclusionMarkets = false,
  voiceState = 'idle',
  voiceSupported = false,
  voiceWarning,
  voiceLiveText,
  voiceRecognitionLang,
  onRetryVoice,
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
  onFocusPlace,
  activePlaceId,
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
  onUserNameChange,
  workspace,
  onOpenCommunity,
  communityInviteCount,
  onAddPlace,
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
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)
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

  // Desktop keeps the conversations sidebar open by default (like ChatGPT/Claude);
  // phones start with it closed and slide it over the chat.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) setHistoryOpen(true)
  }, [])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (voiceState === 'listening') el.value = voiceLiveText ?? ''
    else if (voiceState === 'thinking') el.value = ''
  }, [voiceState, voiceLiveText])
  /** Messages present on first render get a staggered entrance; newly appended ones animate immediately. */
  const initialCountRef = useRef(messages.length)

  const streaming = loading && streamingStarted
  const voiceActive = voiceState !== 'idle'
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastMsgId = messages[messages.length - 1]?.id
  const lastMessage = messages[messages.length - 1]
  const showThinking = loading && !streamingStarted && !(lastMessage?.role === 'assistant' && lastMessage.content)
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
    if (!moreOpen && !langOpen) return
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false)
      if (langRef.current && !langRef.current.contains(target)) setLangOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMoreOpen(false); setLangOpen(false) }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen, langOpen])

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

  const tr = (fr: string, en: string, rw?: string) => (lang === 'en' ? en : lang === 'rw' ? (rw ?? en) : fr)

  const conversationTitle = (() => {
    const first = messages.find((m) => m.role === 'user')?.content?.trim()
    if (!first) return tr('Nouvelle conversation', 'New chat', 'Ikiganiro gishya')
    return first.length > 42 ? `${first.slice(0, 42)}…` : first
  })()

  const SUGGESTIONS = [
    { Icon: Coffee, title: tr('Cafés', 'Cafés', 'Café'), query: tr('Cafés à Kimironko', 'Cafés in Kimironko', 'Café i Kimironko'), hint: 'Kimironko' },
    { Icon: Pill, title: tr('Pharmacie', 'Pharmacy', 'Farumasi'), query: tr('Pharmacie ouverte près de moi', 'Open pharmacy near me', 'Farumasi ifunguye hafi yanjye'), hint: tr('Près de moi', 'Near me', 'Hafi yanjye') },
    { Icon: Accessibility, title: tr('Accessible', 'Accessible', 'Bigerwaho'), query: tr('Restaurants accessibles en fauteuil roulant à Remera', 'Wheelchair accessible restaurants in Remera', 'Resitora zigerwaho i Remera'), hint: 'Remera' },
    { Icon: Store, title: tr('Commerces locaux', 'Local shops', 'Amaduka'), query: 'Local businesses near me in Kigali', hint: 'Kigali' },
  ]

  const composer = (
    <div className="mx-auto w-full max-w-[760px]">
      {locationNotice && (
        <div role="status" className="ios-glass ios-rise mb-2 flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug text-[var(--ios-label-2)]">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ios-tint)]" />
          <span className="flex-1">{locationNotice}</span>
          {onDismissLocationNotice && (
            <button type="button" onClick={onDismissLocationNotice} aria-label={tr('Fermer', 'Dismiss')} className="ios-icon-btn -m-1 h-7 w-7">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {cityEditing && onSetCity && !hasLocation && (
        <form onSubmit={submitCity} className="ios-glass ios-rise mb-2 flex items-center gap-2 rounded-full p-1.5 pl-4">
          <MapPin className="h-4 w-4 shrink-0 text-[var(--ios-tint)]" />
          <input
            type="text"
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            placeholder={t('composer.cityPlaceholder')}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--ios-label)] outline-none placeholder:text-[var(--ios-label-2)] md:text-[15px]"
          />
          <button type="submit" disabled={!cityDraft.trim()} className="ios-btn-tint h-9 px-4 text-[14px]">
            {t('composer.set')}
          </button>
        </form>
      )}
      {voiceState === 'listening' && voiceLiveText && <p className="sr-only" aria-live="polite">{voiceLiveText}</p>}
      {(voiceState === 'listening' && voiceRecognitionLang) || (voiceWarning && voiceState !== 'speaking' && voiceState !== 'thinking') ? (
        <p className="mb-1.5 ml-2 text-[12px] text-[var(--ios-label-2)]">
          {voiceState === 'listening' && voiceRecognitionLang ? `${t('composer.recognition')} : ${voiceRecognitionLang}` : voiceWarning}
        </p>
      ) : null}

      {/* Context chips: location + inclusion filters, one swipeable row */}
      <div className="ios-carousel mb-1.5 !gap-2 !pb-2 !pt-0">
        {hasLocation ? (
          <span className="ios-pill" aria-pressed="true">
            <Navigation className="h-3.5 w-3.5 fill-current" />
            {t('composer.locationActive')}
          </span>
        ) : (
          <>
            {manualCity && !cityEditing && (
              <button type="button" onClick={() => { setCityEditing(true); setCityDraft(manualCity) }} className="ios-pill" aria-pressed="true">
                <MapPin className="h-3.5 w-3.5" />
                {manualCity}
              </button>
            )}
            {onUseMyLocation && (
              <button type="button" onClick={onUseMyLocation} disabled={locationPending} className="ios-pill">
                <LocateFixed className={`h-3.5 w-3.5 ${locationPending ? 'animate-pulse' : ''}`} />
                {locationPending ? t('composer.locating') : t('composer.useLocation')}
              </button>
            )}
            {onSetCity && !manualCity && (
              <button type="button" onClick={() => { setCityEditing((v) => !v); setCityDraft('') }} className="ios-pill">
                <Building2 className="h-3.5 w-3.5" />
                {t('composer.setCity')}
              </button>
            )}
          </>
        )}
        {onInclusionFilter && (
          <>
            <button type="button" onClick={() => onInclusionFilter('local')} aria-pressed={inclusionLocal} className="ios-pill">
              <Store className="h-3.5 w-3.5" />
              {t('filters.local')}
            </button>
            {onMarketFilter && (
              <button type="button" onClick={onMarketFilter} aria-pressed={inclusionMarkets} className="ios-pill">
                <ShoppingBasket className="h-3.5 w-3.5" />
                {t('filters.markets')}
              </button>
            )}
            <button type="button" onClick={() => onInclusionFilter('accessible')} aria-pressed={inclusionAccessible} className="ios-pill">
              <Accessibility className="h-3.5 w-3.5" />
              {t('filters.accessible')}
            </button>
          </>
        )}
        {onAddPlace && (
          <button type="button" onClick={onAddPlace} className="ios-pill">
            <Plus className="h-3.5 w-3.5" />
            {t('chips.add')}
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className={`ios-glass-strong ios-composer flex items-center gap-1.5 p-1.5 pl-2 ${voiceActive ? 'ring-4 ring-[var(--ios-tint-soft)]' : ''}`}>
          {voiceSupported && onVoiceToggle && (
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={loading && voiceState === 'idle'}
              aria-label={voiceState === 'listening' ? 'Stop listening and send' : 'Start voice input'}
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 max-md:h-10 max-md:w-10 ${
                voiceState === 'listening' ? 'bg-[var(--ios-red)] text-white' : 'text-[var(--ios-label-2)] hover:bg-[var(--ios-fill)] hover:text-[var(--ios-label)]'
              }`}
            >
              {voiceState === 'listening' && (
                <span aria-hidden className="pointer-events-none absolute inset-[-4px] animate-ping rounded-full border-2 border-[var(--ios-red)]/60" />
              )}
              <Mic className="relative z-10 h-[18px] w-[18px]" />
            </button>
          )}
          {voiceSupported && uiMode === 'voice' && (
            <button
              type="button"
              onClick={() => { onVoiceStop?.(); onEnterChatMode?.(); inputRef.current?.focus() }}
              className="ios-pill h-9 shrink-0 !px-3 text-[13px]"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              <span className="max-w-[8rem] truncate">{t('composer.textMode')}</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder={
              voiceState === 'listening' ? t('composer.listening')
              : voiceState === 'thinking' ? t('composer.thinking')
              : voiceState === 'speaking' ? t('composer.speaking')
              : voiceState === 'paused' ? t('composer.paused')
              : tr('Demande un lieu à MapForAll…', 'Ask MapForAll for a place…', 'Baza MapForAll ahantu…')
            }
            aria-label={t('composer.placeholder')}
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[16px] tracking-[-0.02em] text-[var(--ios-label)] outline-none placeholder:text-[var(--ios-label-3)] md:text-[16px]"
            disabled={loading}
          />
          {(loading || voiceActive) && (onStop || onVoiceStop) ? (
            <button
              type="button"
              onClick={() => { onVoiceStop?.(); if (!onVoiceStop) onStop?.() }}
              aria-label={t('composer.stop')}
              title={t('composer.stop')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ios-label)] text-[var(--ios-bg)] transition-transform active:scale-90 max-md:h-10 max-md:w-10"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              aria-label={t('composer.send')}
              className="ios-btn-tint h-9 w-9 shrink-0 max-md:h-10 max-md:w-10"
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.6} />
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 hidden text-center text-[11px] text-[var(--ios-label-3)] md:block">
        {tr('MapForAll peut se tromper. Vérifie les horaires et l’accessibilité sur place.', 'MapForAll can make mistakes. Check hours and access on site.')}
      </p>
    </div>
  )

  const messageList = (
    <>
      <div className="relative min-h-0 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="chat-scroll h-full min-h-0 overflow-y-auto px-4 pb-8 pt-4 sm:px-6">
          <div className="mx-auto w-full max-w-[760px] space-y-6">
            {isEmpty && (
              <div className="ios-rise flex flex-col items-center px-2 pb-4 pt-[7vh] text-center sm:pt-[11vh]">
                <div className="ios-glass mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-[22px]">
                  <span className="ios-avatar-ai h-12 w-12 rounded-[15px] text-[15px]">MF</span>
                </div>
                <h1 className="ios-large-title text-[var(--ios-label)]">
                  {userName ? tr(`Bonjour, ${userName.split(' ')[0]}`, `Hi, ${userName.split(' ')[0]}`, `Muraho, ${userName.split(' ')[0]}`) : t('empty.title')}
                </h1>
                <p className="ios-callout mx-auto mt-2 max-w-md text-[var(--ios-label-2)]">{t('empty.body')}</p>
                <div className="mt-8 grid w-full max-w-xl grid-cols-2 gap-2.5">
                  {SUGGESTIONS.map(({ Icon, title, query, hint }) => (
                    <button
                      key={query}
                      type="button"
                      onClick={() => onSend(query)}
                      className="ios-glass group flex flex-col items-start gap-2 rounded-[20px] p-3.5 text-left transition-transform duration-200 active:scale-[0.97]"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ios-tint-soft)] text-[var(--ios-tint)]">
                        <Icon className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                      <span>
                        <span className="block text-[15px] font-semibold tracking-[-0.015em] text-[var(--ios-label)]">{title}</span>
                        <span className="block text-[13px] text-[var(--ios-label-2)]">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <motion.div
                key={msg.id}
                initial={reduced || shownMessages.has(msg.id) ? false : { opacity: 0, y: msg.role === 'user' ? 8 : 10, scale: msg.role === 'user' ? 0.98 : 1 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: reduced ? 0 : msg.role === 'user' ? DUR.fast : DUR.base,
                  ease: EASE,
                  delay: reduced || i >= initialCountRef.current ? 0 : Math.min(i * 0.05, 0.4),
                }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'user' ? (
                  editingId === msg.id ? (
                    <div className="w-full max-w-[min(600px,88%)]">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        autoFocus
                        rows={Math.min(6, Math.max(2, editText.split('\n').length))}
                        className="ios-glass-strong w-full resize-none rounded-[20px] px-4 py-3 text-[16px] text-[var(--ios-label)] outline-none"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingId(null)} className="ios-pill h-8">
                          {tr('Annuler', 'Cancel')}
                        </button>
                        <button type="button" disabled={!editText.trim()} onClick={submitEdit} className="ios-btn-tint h-8 px-4 text-[14px]">
                          {tr('Envoyer', 'Send')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="group flex max-w-[min(600px,86%)] items-end gap-1.5">
                      {msg.fromVoice && msg.id === lastUserMsg?.id && onRetryVoice && (
                        <button type="button" onClick={onRetryVoice} className="ios-pill mb-1 h-7 shrink-0 !px-2.5 text-[12px]">
                          {t('composer.retry')}
                        </button>
                      )}
                      {onEditMessage && !loading && (
                        <button
                          type="button"
                          onClick={() => { setEditingId(msg.id); setEditText(msg.content) }}
                          aria-label={tr('Modifier et renvoyer', 'Edit and resend')}
                          className="ios-icon-btn mb-1 h-7 w-7 shrink-0 text-[var(--ios-label-2)] opacity-0 group-hover:opacity-100 max-md:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <div className="ios-bubble-user px-4 py-2.5">
                        <p className="whitespace-pre-wrap text-[16px] leading-[22px] tracking-[-0.015em]">{msg.content}</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex w-full min-w-0 gap-3">
                    <span className="ios-avatar-ai mt-0.5 hidden sm:inline-flex">MF</span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ios-label)]">MapForAll</p>
                      {msg.content ? (
                        <div className="text-[16px] leading-[24px] tracking-[-0.015em] text-[var(--ios-label)] [&_a]:text-[var(--ios-tint)]">
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
                        <p className="mt-1.5 text-[12px] text-[var(--ios-label-2)]">{t('composer.thinking')}</p>
                      )}
                      {msg.gallery?.type === 'photo_gallery' && msg.gallery.photos.length > 0 ? (
                        <PhotoGallery placeName={msg.gallery.place_name} photos={msg.gallery.photos} attribution={msg.gallery.attribution} />
                      ) : msg.places?.length ? (
                        <InlinePlaceGallery places={msg.places} onDetails={onPlaceDetails} onFocusPlace={onFocusPlace} activePlaceId={activePlaceId} />
                      ) : null}
                      {(msg.places?.length || msg.itinerary?.stops?.length) ? (
                        <InlineMapPreview
                          pins={(msg.itinerary?.stops?.length ? msg.itinerary.stops : msg.places ?? []).map((p) => ({ name: p.name, coordinates: p.coordinates }))}
                          label={
                            msg.itinerary?.stops?.length
                              ? tr(`Itinéraire · ${msg.itinerary.stops.length} étapes`, `Route · ${msg.itinerary.stops.length} stops`)
                              : tr(`Voir ${msg.places!.length} lieu${msg.places!.length > 1 ? 'x' : ''} sur la carte`, `See ${msg.places!.length} place${msg.places!.length > 1 ? 's' : ''} on the map`)
                          }
                          onOpen={() => onOpenMapFromMessage(msg)}
                        />
                      ) : null}
                      {onRetry && msg.id === lastMsgId && /surcharg|overloaded|try again in a moment/i.test(msg.content) && (
                        <button type="button" onClick={onRetry} className="ios-pill mt-3" aria-pressed="true">
                          <RotateCw className="h-3.5 w-3.5" />
                          {t('composer.retry')}
                        </button>
                      )}
                      {msg.calendarEvents?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.calendarEvents.map((ev, j) => (
                            <a key={`${ev.title}-${j}`} href={googleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" className="ios-pill">
                              <CalendarPlus className="h-3.5 w-3.5 text-[var(--ios-tint)]" />
                              {tr(`Ajouter « ${ev.title} » au calendrier`, `Add “${ev.title}” to Calendar`)}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}

            {showThinking && (
              <div className="flex w-full gap-3">
                <span className="ios-avatar-ai mt-0.5 hidden sm:inline-flex">MF</span>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[13px] font-semibold text-[var(--ios-label)]">MapForAll</p>
                  <div className="ios-glass ios-rise inline-block rounded-[18px] px-3.5 py-2.5">
                    <ThinkingTrace steps={thinkingSteps} />
                  </div>
                  <div className="ios-carousel mt-3" aria-hidden>
                    {[0, 1].map((k) => (
                      <div key={k} className="ios-card h-[250px] w-[248px] animate-pulse motion-reduce:animate-none sm:w-[264px]">
                        <div className="h-[148px] bg-[var(--ios-fill)]" />
                        <div className="m-3.5 h-4 w-2/3 rounded-full bg-[var(--ios-fill)]" />
                        <div className="mx-3.5 h-3 w-1/2 rounded-full bg-[var(--ios-fill)]" />
                      </div>
                    ))}
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
              initial={reduced ? false : { opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, y: 8, scale: 0.9 }}
              transition={{ duration: reduced ? 0 : 0.22 }}
              onClick={() => scrollToBottom(reduced ? 'auto' : 'smooth')}
              aria-label={tr('Aller en bas', 'Scroll to bottom')}
              className="ios-glass-strong absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-[var(--ios-label)]"
            >
              <ArrowDown className="h-4 w-4" strokeWidth={2.4} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="pb-safe relative z-10 shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-[var(--ios-bg)] to-transparent" />
        {composer}
      </div>
    </>
  )

  const modeToggle = onEnterChatMode && onEnterVoiceMode ? (
    <div className="ios-segmented">
      <span aria-hidden className="ios-segmented-thumb" style={{ transform: uiMode === 'voice' ? 'translateX(100%)' : 'translateX(0)' }} />
      <button type="button" onClick={onEnterChatMode} aria-pressed={uiMode === 'chat'}>
        <MessageSquare className="h-3.5 w-3.5" />
        {t('header.chat')}
      </button>
      <button type="button" onClick={onEnterVoiceMode} aria-pressed={uiMode === 'voice'}>
        <Mic className="h-3.5 w-3.5" />
        {t('header.voice')}
      </button>
    </div>
  ) : null

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) setHistoryOpen(false)
  }

  const sidebar = (
    <div className="flex h-full w-[280px] flex-col">
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        <span className="ios-avatar-ai h-8 w-8 rounded-[10px]">MF</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[var(--ios-label)]">MapForAll</p>
          <p className="truncate text-[12px] text-[var(--ios-label-2)]">{t('app.subtitle')}</p>
        </div>
        <button type="button" onClick={() => setHistoryOpen(false)} aria-label={tr('Masquer la barre latérale', 'Hide sidebar')} className="ios-icon-btn text-[var(--ios-label-2)]">
          <PanelLeft className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={() => { onNewChat(); closeSidebarOnMobile() }}
          className="ios-btn-tint h-10 w-full justify-start gap-2.5 rounded-xl px-3 text-[15px]"
        >
          <SquarePen className="h-[18px] w-[18px]" />
          {t('header.newChat')}
        </button>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ios-label-2)]" />
          <input
            type="search"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder={t('header.searchChats')}
            className="ios-search"
          />
        </div>
      </div>

      <nav className="mt-3 space-y-0.5 px-3">
        <a href="/saved" className="ios-row">
          <Bookmark className="h-[18px] w-[18px] text-[var(--ios-tint)]" />
          {t('header.saved')}
        </a>
        {onOpenCommunity && (
          <button type="button" onClick={() => { onOpenCommunity(); closeSidebarOnMobile() }} className="ios-row">
            <Users className="h-[18px] w-[18px] text-[var(--ios-blue)]" />
            {t('header.community')}
            {!!communityInviteCount && (
              <span className="ml-auto rounded-full bg-[var(--ios-red)] px-1.5 text-[11px] font-semibold text-white">{communityInviteCount}</span>
            )}
          </button>
        )}
        {workspace && (
          <a href={workspace.href} className="ios-row">
            <Store className="h-[18px] w-[18px] text-[var(--ios-green)]" />
            {workspace.cta}
          </a>
        )}
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3 chat-scroll">
        <p className="mb-1 px-2.5 text-[13px] font-semibold text-[var(--ios-label-2)]">{t('header.recent')}</p>
        {mapArchive.length > 0 && (
          <div className="mb-2 space-y-0.5">
            {mapArchive.slice(0, 6).map((snap) => (
              <button key={snap.id} type="button" onClick={() => { onSelectMapArchive?.(snap.id); closeSidebarOnMobile() }} className="ios-row">
                <MapIcon className="h-4 w-4 shrink-0 text-[var(--ios-label-2)]" />
                <span className="truncate">{snap.title}</span>
              </button>
            ))}
          </div>
        )}
        {visibleHistoryItems.length === 0 ? (
          <p className="px-2.5 py-2 text-[14px] text-[var(--ios-label-2)]">{t('header.noChats')}</p>
        ) : (
          <div className="space-y-0.5">
            {visibleHistoryItems.map((item) => (
              <div key={item.id} className="group relative">
                <button
                  type="button"
                  onClick={() => { onSelectHistory(item.id); closeSidebarOnMobile() }}
                  className="ios-row pr-9"
                  title={item.title}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    <span className="block text-[12px] text-[var(--ios-label-2)]">
                      {new Date(item.updatedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short' })}
                      {' · '}
                      {new Date(item.updatedAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </button>
                {onDeleteHistory && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteHistory(item.id) }}
                    aria-label={tr('Supprimer la conversation', 'Delete chat')}
                    className="ios-icon-btn absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-[var(--ios-label-2)] opacity-0 hover:text-[var(--ios-red)] group-hover:opacity-100 max-md:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--ios-separator)] p-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <div className="flex items-center gap-1">
          <button
            ref={accountTriggerRef}
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={accountOpen}
            aria-label={t('accountPanel.open')}
            className="ios-row min-w-0 flex-1 !py-1.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#A1A1AA] to-[#71717A] text-[15px] font-semibold text-white">
              {(userName?.trim()?.[0] ?? 'U').toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[15px] font-semibold">{userName || t('header.signedIn')}</span>
              <span className="block text-[12px] text-[var(--ios-label-2)]">{t('header.account')}</span>
            </span>
          </button>
          <button type="button" onClick={onToggleTheme} aria-label={t('header.theme')} className="ios-icon-btn text-[var(--ios-label-2)]">
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          {onLogout && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onLogout() }} aria-label={t('header.logout')} title={t('header.logout')} className="ios-icon-btn text-[var(--ios-label-2)] hover:!text-[var(--ios-red)]">
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="ios-chat relative flex h-full overflow-hidden">
      {/* Sidebar: persistent column on desktop, slide-over drawer on phones */}
      {historyOpen && (
        <button
          type="button"
          aria-label={tr('Fermer', 'Close')}
          onClick={() => setHistoryOpen(false)}
          className="ios-fade-in fixed inset-0 z-[49] bg-black/30 backdrop-blur-[2px] lg:hidden"
        />
      )}
      <aside
        aria-label={t('header.history')}
        className={`ios-glass-bar z-50 h-full shrink-0 overflow-hidden border-r border-[var(--ios-separator)] transition-[width,transform] duration-[420ms] ease-[var(--ios-ease)] motion-reduce:transition-none max-lg:fixed max-lg:left-0 max-lg:top-0 max-lg:w-[280px] max-lg:shadow-[0_0_60px_rgba(0,0,0,0.25)] ${
          historyOpen ? 'lg:w-[280px] max-lg:translate-x-0' : 'lg:w-0 max-lg:-translate-x-full max-lg:pointer-events-none'
        }`}
      >
        {sidebar}
      </aside>

      <AccountPanel
        open={accountOpen}
        onClose={() => {
          setAccountOpen(false)
          queueMicrotask(() => accountTriggerRef.current?.focus())
        }}
        onNameChange={onUserNameChange}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="ios-glass-bar sticky top-0 z-30 shrink-0 border-b border-[var(--ios-separator)] pt-safe">
          <div className="flex h-14 items-center gap-1.5 px-2.5 sm:px-4">
            {!historyOpen && (
              <>
                <button type="button" onClick={() => setHistoryOpen(true)} aria-label={t('header.history')} className="ios-icon-btn">
                  <PanelLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={onNewChat} aria-label={t('header.newChat')} className="ios-icon-btn hidden sm:inline-flex">
                  <SquarePen className="h-5 w-5" />
                </button>
              </>
            )}
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-[17px] font-semibold tracking-[-0.022em] text-[var(--ios-label)]">{conversationTitle}</p>
            </div>
            <div className="hidden shrink-0 sm:block">{modeToggle}</div>
            <div className="flex shrink-0 items-center gap-0.5 pl-1">
              {hasMapData && (
                <button type="button" onClick={onExpandMap} aria-label={t('header.openMap')} title={t('header.openMap')} className="ios-icon-btn">
                  <MapIcon className="h-5 w-5" />
                </button>
              )}
              {speechOutSupported && onToggleSpeakReplies && (
                <button type="button" onClick={onToggleSpeakReplies} aria-pressed={!!speakReplies} aria-label={speakReplies ? t('header.mute') : t('header.unmute')} className="ios-icon-btn">
                  {speakReplies ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                </button>
              )}
              <div ref={moreRef} className="relative">
                <button type="button" aria-label={t('header.more')} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className="ios-icon-btn">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {moreOpen && (
                  <div role="menu" aria-label={t('header.more')} className="ios-glass-strong ios-rise absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-[18px] p-1.5">
                    <div className="mb-1 flex justify-center p-1 sm:hidden">{modeToggle}</div>
                    <button type="button" role="menuitem" onClick={() => { onNewChat(); setMoreOpen(false) }} className="ios-row">
                      <SquarePen className="h-[18px] w-[18px]" />
                      {t('header.newChat')}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { onToggleTheme(); setMoreOpen(false) }} className="ios-row">
                      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
                      {theme === 'dark' ? tr('Mode clair', 'Light mode', 'Urumuri') : tr('Mode sombre', 'Dark mode', 'Umwijima')}
                    </button>
                    <div className="my-1 h-px bg-[var(--ios-separator)]" />
                    <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold text-[var(--ios-label-2)]">{t('header.language')}</p>
                    <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                      {(['fr', 'en', 'rw'] as Lang[]).map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => { setLang(code); setMoreOpen(false) }}
                          aria-pressed={lang === code}
                          className="ios-pill h-8 justify-center !px-0 text-[13px] uppercase"
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                    {SHOW_MODEL && (
                      <div className="border-t border-[var(--ios-separator)] p-2">
                        <ModelSwitcher selected={selectedModel} onChange={onModelChange} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {onCollapse && (
                <button type="button" onClick={onCollapse} aria-label="Collapse chat" className="ios-icon-btn">
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] overflow-hidden">
          {messageList}
        </div>
      </div>
    </div>
  )
}
