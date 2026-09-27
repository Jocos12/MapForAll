'use client'

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, HeartHandshake, Link2, Loader2, MessageCircle, Plus, Printer, Search, Share2, Users, X } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { CategoryIcon } from '@/components/CategoryIcon'
import { MAX_RECOMMENDS } from '@/lib/places'
import { withPlace, type PlaceLite } from '@/components/business/types'
import { BIZ } from '@/components/business/ui'

export function shareUrlFor(placeId: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/p/${encodeURIComponent(placeId)}`
}

export function ShareCard({ placeId, placeName, published }: { placeId: string; placeName: string; published: boolean }) {
  const { t } = useI18n()
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const shareUrl = useMemo(() => shareUrlFor(placeId), [placeId])
  const shareText = t('biz.share.message').replace('{name}', placeName)

  useEffect(() => {
    void QRCode.toDataURL(shareUrl, { width: 640, margin: 1, color: { dark: '#1A1614', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [shareUrl])

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the link stays visible and selectable */
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: placeName, text: shareText, url: shareUrl })
    } catch {
      /* dismissed */
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <section className={`${BIZ.card} p-5`} aria-labelledby="share-title">
      <h2 id="share-title" className={BIZ.cardTitle}>
        <Share2 size={16} className="text-[#E8672A]" aria-hidden />
        {t('biz.share.title')}
      </h2>
      <p className="mt-0.5 text-[12.5px] text-[#52525B]">{t('biz.share.subtitle')}</p>
      {!published && (
        <p className="mt-3 rounded-lg border border-[#E0A800]/40 bg-[#FFF8E1] px-3 py-2 text-[12.5px] text-[#713F12]">{t('biz.share.notYet')}</p>
      )}
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label htmlFor="share-link" className={BIZ.label}>{t('biz.share.link')}</label>
          <div className="flex items-center gap-2">
            <span className="relative min-w-0 flex-1">
              <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" aria-hidden />
              <input id="share-link" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${BIZ.field} pl-8 font-mono text-[12.5px]`} />
            </span>
            <button type="button" onClick={() => void copy()} className={`${BIZ.primary} h-[42px] shrink-0`} aria-live="polite">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t('biz.share.copied') : t('biz.share.copy')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0F7A41] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#0B6636] ${BIZ.focus}`}
            >
              <MessageCircle size={14} />
              WhatsApp
            </a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className={`${BIZ.secondary} h-9`}>
              <Share2 size={14} />
              Facebook
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BIZ.secondary} h-9`}
            >
              <Share2 size={14} />
              X
            </a>
            {canShare && (
              <button type="button" onClick={() => void nativeShare()} className={`${BIZ.secondary} h-9`}>
                <Share2 size={14} />
                {t('biz.share.more')}
              </button>
            )}
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-[#3F3F46]">{t('biz.share.posterHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={withPlace('/business/poster', placeId)} target="_blank" rel="noopener" className={`${BIZ.primary} h-9`}>
              <Printer size={14} />
              {t('biz.share.poster')}
            </a>
            {qr && (
              <a href={qr} download={`mapforall-qr-${placeId}.png`} className={`${BIZ.secondary} h-9`}>
                <Download size={14} />
                {t('biz.share.downloadQr')}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={t('biz.share.qrAlt')} className="h-44 w-44 rounded-xl border border-[#E4E4E7] bg-white p-2" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-[#E4E4E7]"><Loader2 className="animate-spin text-[#71717A]" /></div>
          )}
          <span className="max-w-[11rem] text-center text-[11.5px] text-[#52525B]">{t('biz.share.qrCaption')}</span>
        </div>
      </div>
    </section>
  )
}

interface RecommendProps {
  placeId: string
  initial: PlaceLite[]
  recommendedBy: number
  onSaved: (list: PlaceLite[]) => void
}

export function RecommendCard({ placeId, initial, recommendedBy, onSaved }: RecommendProps) {
  const { t } = useI18n()
  const [catalog, setCatalog] = useState<PlaceLite[]>([])
  const [selected, setSelected] = useState<PlaceLite[]>(initial)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void fetch('/api/places', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { places: [] }))
      .then((data: { places?: Array<PlaceLite & { status?: string }> }) => {
        setCatalog((data.places ?? []).filter((row) => row.place_id !== placeId && (row.status ?? 'validated') === 'validated'))
      })
      .catch(() => {})
  }, [placeId])

  const dirty = selected.map((row) => row.place_id).join('|') !== initial.map((row) => row.place_id).join('|')
  const matchesList = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const chosen = new Set(selected.map((row) => row.place_id))
    return catalog
      .filter((row) => !chosen.has(row.place_id) && (!needle || row.name.toLowerCase().includes(needle)))
      .slice(0, 8)
  }, [catalog, query, selected])

  async function save() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(withPlace('/api/business', placeId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommends: selected.map((row) => row.place_id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? t('auth.errors.generic'))
        return
      }
      setMessage(t('biz.reco.saved'))
      onSaved(selected)
    } catch {
      setError(t('auth.errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="promo-reco" className={`${BIZ.card} scroll-mt-24 p-5`} aria-labelledby="reco-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reco-title" className={BIZ.cardTitle}>
            <HeartHandshake size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.reco.title')}
          </h2>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-[#52525B]">{t('biz.reco.subtitle')}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${recommendedBy ? 'bg-[#2E8B57]/10 text-[#1F6B43]' : 'bg-[#F4F4F5] text-[#3F3F46]'}`}>
          <Users size={14} aria-hidden />
          {recommendedBy
            ? t('biz.reco.recommendedBy').replace('{n}', String(recommendedBy))
            : t('biz.reco.recommendedByNone')}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {selected.length === 0 && <p className="text-[13px] text-[#52525B]">{t('biz.reco.none')}</p>}
        {selected.map((row) => (
          <span key={row.place_id} className="inline-flex items-center gap-1.5 rounded-full border border-[#E8672A]/40 bg-[#FFF7F2] py-1 pl-2.5 pr-1.5 text-[12.5px] font-medium text-[#9A3412]">
            <CategoryIcon categories={row.categories} className="h-3.5 w-3.5" />
            {row.name}
            <button
              type="button"
              onClick={() => setSelected((prev) => prev.filter((item) => item.place_id !== row.place_id))}
              aria-label={`${t('biz.form.removeTag')} ${row.name}`}
              className={`flex h-5 w-5 items-center justify-center rounded-full hover:bg-white ${BIZ.focus}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      {selected.length < MAX_RECOMMENDS && (
        <div className="mt-4">
          <label className="relative block">
            <span className="sr-only">{t('biz.reco.search')}</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('biz.reco.search')} className={`${BIZ.field} pl-9`} />
          </label>
          <ul className="mt-2 max-h-60 divide-y divide-[#F4F4F5] overflow-y-auto rounded-xl border border-[#E4E4E7]">
            {matchesList.length === 0 && <li className="px-3.5 py-3 text-[12.5px] text-[#52525B]">{t('biz.reco.noMatch')}</li>}
            {matchesList.map((row) => (
              <li key={row.place_id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-[#18181B]">
                  <CategoryIcon categories={row.categories} className="h-4 w-4 shrink-0 text-[#71717A]" />
                  <span className="truncate">{row.name}</span>
                  {row.categories[0] && <span className="shrink-0 text-[11.5px] text-[#52525B]">· {t(`categories.${row.categories[0]}`)}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => { setSelected((prev) => [...prev, row].slice(0, MAX_RECOMMENDS)); setQuery('') }}
                  className={`${BIZ.secondary} h-8 shrink-0 px-3 text-[12px]`}
                >
                  <Plus size={13} />
                  {t('biz.reco.add')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-[#52525B]">{t('biz.reco.limit').replace('{n}', String(MAX_RECOMMENDS))}</p>

      {error && <p className="mt-3 text-[13px] text-[#B91C1C]" role="alert">{error}</p>}
      {message && !dirty && <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-[#1F6B43]" role="status"><Check size={15} />{message}</p>}
      <button type="button" disabled={!dirty || busy} onClick={() => void save()} className={`${BIZ.primary} mt-4 h-10`}>
        {busy && <Loader2 size={15} className="animate-spin" />}
        {t('biz.reco.save')}
      </button>
    </section>
  )
}
