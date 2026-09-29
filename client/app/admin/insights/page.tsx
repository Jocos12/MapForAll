'use client'

import { FormEvent, useState } from 'react'
import { Bot, Loader2, Send, Sparkles } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { cn } from '@/lib/design/cn'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTION_KEYS = [
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
] as const

export default function AdminInsightsPage() {
  const { t, lang } = useI18n()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setError('')
    setBusy(true)
    const nextHistory = [...messages, { role: 'user' as const, content: q }]
    setMessages(nextHistory)
    setInput('')
    try {
      const res = await fetch('/api/admin/insights/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q,
          uiLang: lang === 'fr' || lang === 'rw' ? lang : 'en',
          history: nextHistory.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || t('admin.shell.loadError'))
        setMessages((prev) => [...prev, { role: 'assistant', content: t('admin.insights.error') }])
        return
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: String(json.reply ?? '') }])
    } catch {
      setError(t('admin.shell.loadError'))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-7.5rem)] max-w-3xl flex-col gap-4">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#E8672A]">{t('admin.shell.console')}</p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-[26px] font-semibold tracking-tight">
          <Sparkles size={22} className="text-[#E8672A]" /> {t('admin.nav.insights')}
        </h1>
        <p className="mt-1 text-[14px] text-[#6E5B50] dark:text-white/55">{t('admin.insights.subtitle')}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.04]">
        <div className="admin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-4 py-6">
              <div className="mx-auto flex max-w-md flex-col items-center text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8672A]/12 text-[#E8672A]">
                  <Bot size={24} />
                </span>
                <p className="text-[14px] font-medium">{t('admin.insights.welcome')}</p>
                <p className="mt-1 text-[12px] text-[#6E5B50] dark:text-white/50">{t('admin.insights.welcomeHint')}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(t(`admin.insights.suggestions.${key}`))}
                    className="rounded-xl border border-black/10 px-3 py-2.5 text-left text-[13px] transition hover:border-[#E8672A]/40 hover:bg-[#E8672A]/[0.04] dark:border-white/15"
                  >
                    {t(`admin.insights.suggestions.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed',
                  m.role === 'user'
                    ? 'bg-[#E8672A] text-white'
                    : 'border border-black/8 bg-[#F7F1E8] text-[#1A1614] dark:border-white/10 dark:bg-white/[0.06] dark:text-[#FBF3E7]',
                )}
              >
                {m.content}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-[12px] text-[#6E5B50] dark:text-white/50">
              <Loader2 size={14} className="animate-spin text-[#E8672A]" />
              {t('admin.insights.thinking')}
            </div>
          )}
        </div>

        {error && (
          <p className="border-t border-red-500/20 bg-red-500/5 px-4 py-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>
        )}

        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-black/5 p-3 dark:border-white/10">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder={t('admin.insights.placeholder')}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-black/10 bg-transparent px-3 py-2.5 text-[13px] dark:border-white/15"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(input)
              }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E8672A] text-white disabled:opacity-50"
            aria-label={t('admin.insights.send')}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </div>
  )
}
