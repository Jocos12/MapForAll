'use client'

import { useState } from 'react'
import { Accessibility, Store, X } from 'lucide-react'
import { PLACE_CATEGORIES } from '@/lib/places'
import { useI18n } from '@/components/I18nProvider'

const PHOTO_LIMIT = 150_000

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
  const [accessible, setAccessible] = useState(false)
  const [photo, setPhoto] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  if (!open) return null

  async function onPhoto(file: File | undefined) {
    setPhotoError('')
    setPhoto('')
    if (!file) return
    const data = await file.arrayBuffer()
    const bytes = new Uint8Array(data)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const url = `data:${file.type || 'image/jpeg'};base64,${btoa(binary)}`
    if (url.length > PHOTO_LIMIT) {
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
          accessible,
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

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 right-16 z-[60] max-h-[min(70vh,520px)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-header)] p-4 shadow-[0_16px_40px_-20px_rgba(26,22,20,0.55)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">{t('add.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('add.close')} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[#F56A00]/10">
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
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
          <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} />
          <Accessibility className="h-3.5 w-3.5 text-[#0F6E56]" aria-hidden />
          {t('add.accessible')}
        </label>
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
  )
}
