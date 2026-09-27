'use client'

import { useMemo, useState } from 'react'
import { ArrowDownUp, CornerDownRight, Loader2, MessageSquare, Pencil, Star, Trash2 } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { withPlace, type OwnerReview } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

type Filter = 'all' | 'low' | 'mid' | 'high' | 'unanswered'
type Sort = 'recent' | 'lowest'

const FILTERS: Filter[] = ['all', 'low', 'mid', 'high', 'unanswered']

function matches(review: OwnerReview, filter: Filter): boolean {
  if (filter === 'low') return review.rating <= 2
  if (filter === 'mid') return review.rating === 3
  if (filter === 'high') return review.rating >= 4
  if (filter === 'unanswered') return !review.reply
  return true
}

function ReviewRow({ placeId, review, onReplied }: { placeId: string; review: OwnerReview; onReplied: (key: string, reply: OwnerReview['reply']) => void }) {
  const { t, lang } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(review.reply?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locale = lang === 'rw' ? 'en' : lang
  const low = review.rating <= 2

  async function save(text: string) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(withPlace('/api/business/reviews', placeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: review.key, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? t('auth.errors.generic'))
        return
      }
      onReplied(review.key, data.reply ?? null)
      setDraft(data.reply?.text ?? '')
      setEditing(false)
    } catch {
      setError(t('auth.errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`${BIZ.card} p-4 ${low && !review.reply ? 'border-l-4 border-l-[#DC2626]' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F4F4F5] text-[13px] font-semibold text-[#3F3F46]" aria-hidden>
          {review.firstName.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-[13.5px] font-semibold text-[#18181B]">{review.firstName}</span>
        <span className="inline-flex items-center gap-0.5" aria-label={t('biz.reviews.ratingLabel').replace('{n}', String(review.rating))}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={13} aria-hidden className={i < review.rating ? 'fill-amber-500 text-amber-500' : 'text-[#D4D4D8]'} />
          ))}
        </span>
        {review.createdAt && (
          <span className="text-[12px] text-[#52525B]">
            {new Date(review.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        {!review.reply && (
          <span className="ml-auto rounded-full bg-[#FDE8DC] px-2 py-0.5 text-[11px] font-semibold text-[#9A3412]">{t('biz.reviews.toAnswer')}</span>
        )}
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[#27272A]">
        {review.comment || <span className="italic text-[#52525B]">{t('biz.reviews.noComment')}</span>}
      </p>

      {review.reply && !editing && (
        <div className="mt-3 flex gap-2 rounded-xl bg-[#F7F7F8] px-3 py-2.5">
          <CornerDownRight size={14} className="mt-0.5 shrink-0 text-[#E8672A]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold text-[#C2410C]">{t('reviews.ownerReply')}</p>
            <p className="text-[13px] leading-relaxed text-[#27272A]">{review.reply.text}</p>
            <div className="mt-1.5 flex gap-3 text-[12px] text-[#52525B]">
              <button type="button" onClick={() => setEditing(true)} className={`inline-flex items-center gap-1 rounded hover:text-[#C2410C] ${BIZ.focus}`}>
                <Pencil size={12} />{t('biz.reviews.edit')}
              </button>
              <button type="button" disabled={busy} onClick={() => void save('')} className={`inline-flex items-center gap-1 rounded hover:text-[#B91C1C] ${BIZ.focus}`}>
                <Trash2 size={12} />{t('biz.reviews.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!review.reply && !editing && (
        <button type="button" onClick={() => setEditing(true)} className={`${BIZ.secondary} mt-3 h-9`}>
          <MessageSquare size={14} />
          {t('biz.reviews.reply')}
        </button>
      )}

      {editing && (
        <div className="mt-3">
          <label htmlFor={`reply-${review.key}`} className="sr-only">{t('biz.reviews.reply')}</label>
          <textarea
            id={`reply-${review.key}`}
            autoFocus
            rows={3}
            maxLength={400}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('biz.reviews.replyHint')}
            className={`${BIZ.field} resize-none`}
          />
          <p className="mt-1 text-[11.5px] text-[#52525B]">{t('biz.reviews.publicNote')}</p>
          {error && <p className="mt-1 text-[12.5px] text-[#B91C1C]" role="alert">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || !draft.trim()} onClick={() => void save(draft)} className={`${BIZ.primary} h-9`}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t('biz.reviews.publish')}
            </button>
            <button type="button" onClick={() => { setEditing(false); setDraft(review.reply?.text ?? '') }} className={`${BIZ.secondary} h-9`}>
              {t('biz.danger.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function ReviewsSection({
  placeId,
  reviews,
  onReplied,
}: {
  placeId: string
  reviews: OwnerReview[]
  onReplied: (key: string, reply: OwnerReview['reply']) => void
}) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((id) => [id, reviews.filter((row) => matches(row, id)).length])) as Record<Filter, number>,
    [reviews],
  )
  const shown = useMemo(() => {
    const list = reviews.filter((row) => matches(row, filter))
    return sort === 'lowest'
      ? [...list].sort((a, b) => a.rating - b.rating || b.createdAt.localeCompare(a.createdAt))
      : [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [reviews, filter, sort])

  return (
    <div className="flex flex-col gap-4">
      <section className={`${BIZ.card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={BIZ.cardTitle}>{t('biz.reviews.title').replace('{n}', String(reviews.length))}</h2>
            <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.reviews.subtitle')}</p>
          </div>
          <label className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[#3F3F46]">
            <ArrowDownUp size={14} aria-hidden />
            {t('biz.reviews.sort')}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${BIZ.field} h-9 w-auto py-0 text-[13px]`}>
              <option value="recent">{t('biz.reviews.sortRecent')}</option>
              <option value="lowest">{t('biz.reviews.sortLowest')}</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('biz.reviews.filter')}>
          {FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${BIZ.focus} ${
                filter === id ? 'border-[#1A1614] bg-[#1A1614] text-white' : 'border-[#D4D4D8] bg-white text-[#3F3F46] hover:border-[#A1A1AA]'
              }`}
            >
              {t(`biz.reviews.filters.${id}`)}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${filter === id ? 'bg-white/20' : 'bg-[#F4F4F5]'}`}>{counts[id]}</span>
            </button>
          ))}
        </div>
      </section>

      {reviews.length === 0 ? (
        <p className={`${BIZ.card} p-6 text-center text-[13px] text-[#52525B]`}>{t('biz.reviews.empty')}</p>
      ) : shown.length === 0 ? (
        <p className={`${BIZ.card} p-6 text-center text-[13px] text-[#52525B]`}>{t('biz.reviews.noneForFilter')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {shown.map((review) => (
            <ReviewRow key={review.key} placeId={placeId} review={review} onReplied={onReplied} />
          ))}
        </ul>
      )}
    </div>
  )
}
