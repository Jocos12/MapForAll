'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Accessibility, Store, X } from 'lucide-react'
import { PHOTO_LIMIT, PLACE_CATEGORIES } from '@/lib/places'
import { compressImage } from '@/lib/imageCompress'
import { useI18n } from '@/components/I18nProvider'

export function AddPlaceSheet({
  open,
  onClose,
  lat,
  lng,
  onUseLocation,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  lat: string
  lng: string
  onUseLocation: () => void
  onSubmitted: (placeId: string) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(PLACE_CATEGORIES[0])
  const [localBusiness, setLocalBusiness] = useState(true)
  const [entrance, setEntrance] = useState(false)
  const [toilet, setToilet] = useState(false)
  const [parking, setParking] = useState(false)
  const [photo, setPhoto] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  async function onPhoto(file: File | undefined) {
    setPhotoError('')
    setPhoto('')
    if (!file) return
    const url = await compressImage(file, PHOTO_LIMIT)
    if (!url) {
      setPhotoError(t('add.photoTooBig'))
      return
    }
    setPhoto(url)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          latitude: Number(lat),
          longitude: Number(lng),
          local_business: localBusiness,
          accessible: entrance,
          access: { entrance, toilet, parking },
          photo_url: photo || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setError(t('add.needAuth'))
        return
      }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : t('add.error'))
        return
      }
      setMessage(t('add.thanks'))
      setName('')
      setPhoto('')
      onSubmitted(String(data.place_id ?? ''))
    } catch {
      setError(t('add.error'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end justify-center sm:items-center" role="presentation">
      <button
        type="button"
        aria-label={t('add.close')}
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-place-title"
        className="relative z-10 max-h-[min(85dvh,560px)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-header)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:rounded-2xl"
      >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="add-place-title" className="font-display text-base font-semibold text-[var(--text-primary)]">{t('add.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('add.close')} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors duration-150 hover:bg-gray-200 hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-[12px] text-[var(--text-secondary)]">
          {t('add.name')}
          <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] text-[var(--text-primary)] outline-none focus:border-[#F56A00]" />
        </label>
        <label className="text-[12px] text-[var(--text-secondary)]">
          {t('add.category')}
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] text-[var(--text-primary)]">
            {PLACE_CATEGORIES.map((id) => (
              <option key={id} value={id}>{t(`categories.${id}`)}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 text-[12px]">
          <span className="text-[var(--text-secondary)]">{t('add.lat')} {lat || '—'}</span>
          <span className="text-[var(--text-secondary)]">{t('add.lng')} {lng || '—'}</span>
        </div>
        <button type="button" onClick={onUseLocation} className="self-start rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:border-[#F56A00]/45">
          {t('add.useLocation')}
        </button>
        <p className="text-[11px] text-[var(--text-secondary)]">{t('add.tap')}</p>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
          <input type="checkbox" checked={localBusiness} onChange={(e) => setLocalBusiness(e.target.checked)} />
          <Store className="h-3.5 w-3.5 text-terracotta" aria-hidden />
          {t('add.local')}
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-[12px] font-medium text-[var(--text-primary)]">{t('access.legend')}</legend>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input type="checkbox" checked={entrance} onChange={(e) => setEntrance(e.target.checked)} />
            <Accessibility className="h-3.5 w-3.5 text-[#0F6E56]" aria-hidden />
            {t('access.entrance')}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input type="checkbox" checked={toilet} onChange={(e) => setToilet(e.target.checked)} />
            {t('access.toilet')}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} />
            {t('access.parking')}
          </label>
        </fieldset>
        <label className="text-[12px] text-[var(--text-secondary)]">
          {t('add.photo')}
          <input type="file" accept="image/*" onChange={(e) => void onPhoto(e.target.files?.[0])} className="mt-1 block w-full text-[12px]" />
        </label>
        {photoError && <p className="text-[12px] text-red-500">{photoError}</p>}
        {error && <p className="text-[12px] text-red-500">{error}</p>}
        {message && <p className="text-[13px] font-medium text-[#0F6E56]">{message}</p>}
        <button type="submit" disabled={busy || !lat || !lng} className="rounded-full bg-[#F56A00] px-4 py-2 text-[13px] font-medium text-white hover:bg-terracotta disabled:opacity-40">
          {busy ? t('add.submitting') : t('add.submit')}
        </button>
      </form>
      </div>
    </div>,
    document.body,
  )
}
