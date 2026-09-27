'use client'

import { useCallback, useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { StarRatingInput } from '@/components/community/profile/Stars'
import { useI18n } from '@/components/I18nProvider'

export interface ReviewSummary {
  average: number | null
  count: number
  mine: { rating: number; comment: string } | null
}

export interface PublicReview {
  firstName: string
  rating: number
  comment: string
  createdAt: string
  mine: boolean
  reply?: { text: string; at: string } | null
}

interface Loaded extends ReviewSummary {
  reviews: PublicReview[]
}

async function loadReviews(placeId: string): Promise<Loaded | 'down'> {
  try {
    const res = await fetch(`/api/reviews?placeId=${encodeURIComponent(placeId)}`)
    if (!res.ok) return 'down'
    const data = await res.json() as Loaded & { unavailable?: boolean }
    if (data.unavailable) return 'down'
    return data
  } catch {
    return 'down'
  }
}

export function reviewLabel(count: number, average: number, lang: string): string {
  const score = lang === 'fr' ? average.toFixed(1).replace('.', ',') : average.toFixed(1)
  return `★ ${score} (${count})`
}

/** Five-star picker. One review per person; a later click updates it. */
export function PlaceRatePopover({
  placeId,
  initial,
  onSaved,
  onClose,
}: {
  placeId: string
  initial?: ReviewSummary | null
  onSaved: (summary: ReviewSummary) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [rating, setRating] = useState(initial?.mine?.rating ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async (value: number) => {
    setRating(value)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, rating: value }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(res.status === 401 ? t('reviews.signIn') : (data.error ?? t('reviews.error')))
        return
      }
      const loaded = await loadReviews(placeId)
      if (loaded !== 'down') onSaved(loaded)
      onClose()
    } catch {
      setError(t('reviews.error'))
    } finally {
      setBusy(false)
    }
  }, [onClose, onSaved, placeId, t])

  return (
    <div className="w-56 rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#15151a]">
      <p className="mb-2 text-[12px] font-medium text-gray-800 dark:text-gray-100">{t('reviews.rate')}</p>
      <StarRatingInput value={rating} onChange={(value) => { void save(value) }} disabled={busy} size="md" label={t('reviews.rate')} />
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

/** Reviews on the place sheet: one form, then the newest comments. */
export function PlaceReviews({ placeId, onSummary }: { placeId: string; onSummary?: (summary: ReviewSummary) => void }) {
  const { t, lang } = useI18n()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const refresh = useCallback(async () => {
    const data = await loadReviews(placeId)
    if (data === 'down') {
      setUnavailable(true)
      setLoaded({ average: null, count: 0, mine: null, reviews: [] })
      return
    }
    setUnavailable(false)
    setLoaded(data)
    setRating(data.mine?.rating ?? 0)
    setComment(data.mine?.comment ?? '')
    onSummary?.(data)
  }, [onSummary, placeId])

  useEffect(() => { void refresh() }, [refresh])

  const save = async () => {
    if (rating < 1 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, rating, comment }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setError(res.status === 401 ? t('reviews.signIn') : (data.error ?? t('reviews.error')))
        return
      }
      setOpen(false)
      await refresh()
    } catch {
      setError(t('reviews.error'))
    } finally {
      setBusy(false)
    }
  }

  const summary = loaded && loaded.count > 0 && loaded.average != null
    ? reviewLabel(loaded.count, loaded.average, lang)
    : null

  return (
    <section className="mt-4 border-t border-[var(--border)] pt-4" aria-label={t('reviews.title')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{t('reviews.title')}</h3>
        {summary && <span className="text-[12px] text-amber-700">{summary}</span>}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-4 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
      >
        <Star className="h-3.5 w-3.5" />
        {loaded?.mine ? t('reviews.update') : t('reviews.leave')}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
          <StarRatingInput value={rating} onChange={setRating} size="md" label={t('reviews.rate')} />
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 400))}
            rows={3}
            placeholder={t('reviews.placeholder')}
            className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            disabled={rating < 1 || busy}
            onClick={() => void save()}
            className="mt-2 inline-flex h-9 items-center rounded-full bg-[#F56A00] px-4 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t('reviews.save')}
          </button>
          {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {unavailable ? (
          <li className="text-[12.5px] text-[var(--text-secondary)]">{t('reviews.unavailable')}</li>
        ) : (loaded?.reviews ?? []).length === 0 && (
          <li className="text-[12.5px] text-[var(--text-secondary)]">{t('reviews.empty')}</li>
        )}
        {(loaded?.reviews ?? []).map((review, index) => (
          <li key={`${review.createdAt}-${index}`} className="rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04]">
            <p className="text-[12px] text-[var(--text-primary)]">
              <span className="font-medium">{review.firstName}</span>
              <span className="text-amber-600"> · ★ {review.rating}</span>
              {review.createdAt && (
                <span className="text-[var(--text-secondary)]"> · {new Date(review.createdAt).toLocaleDateString(lang)}</span>
              )}
            </p>
            {review.comment && <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{review.comment}</p>}
            {review.reply && (
              <div className="mt-2 border-l-2 border-[#E8672A] pl-2.5">
                <p className="text-[11px] font-medium text-[#E8672A]">{t('reviews.ownerReply')}</p>
                <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{review.reply.text}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
