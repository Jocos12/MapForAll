'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  ImageIcon,
  Loader2,
  MapPin,
  ShieldCheck,
  Store,
  Star,
  X,
} from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { compressImage } from '@/lib/imageCompress'
import { summarizeWeek, type WeekHours } from '@/lib/hours'
import { MAX_PHOTOS, MAX_TAGS, PLACE_CATEGORIES } from '@/lib/places'
import { HoursEditor } from '@/components/business/HoursEditor'
import { LocationPicker, type AddressResolveState } from '@/components/business/LocationPicker'
import { BIZ } from '@/components/business/ui'
import { motion, useReducedMotion } from 'framer-motion'
import { firstErrorField, stepFieldErrors, type FormStepId } from '@/lib/businessFormSchema'
import { motionTransition } from '@/lib/motion'

export interface BusinessFormValues {
  name: string
  category: string
  description: string
  address: string
  phone: string
  hours: string
  hoursWeek: WeekHours | null
  tags: string[]
  photos: string[]
  access: { entrance: boolean; toilet: boolean; parking: boolean; declared: boolean }
  latitude: number | null
  longitude: number | null
}

export const EMPTY_FORM: BusinessFormValues = {
  name: '',
  category: '',
  description: '',
  address: '',
  phone: '',
  hours: '',
  hoursWeek: null,
  tags: [],
  photos: [],
  access: { entrance: false, toilet: false, parking: false, declared: false },
  latitude: null,
  longitude: null,
}

export const fieldClass = BIZ.field

/** Ignore auto-fill if the user typed in the address field within this window. */
const MANUAL_ADDRESS_MS = 4000

const CREATE_STEPS = [
  { id: 'identity', icon: Store, titleKey: 'biz.form.stepIdentity' },
  { id: 'address', icon: MapPin, titleKey: 'biz.form.stepAddress' },
  { id: 'hours', icon: Clock, titleKey: 'biz.form.stepHours' },
  { id: 'photos', icon: ImageIcon, titleKey: 'biz.form.stepPhotos' },
] as const

const DRAFT_KEY = 'hodari_biz_draft'

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1.5 text-[12.5px] text-[#B91C1C]" role="alert">{message}</p>
}

export function substantialChange(before: BusinessFormValues, after: BusinessFormValues): boolean {
  return (
    before.name.trim() !== after.name.trim() ||
    before.category !== after.category ||
    before.address.trim() !== after.address.trim() ||
    before.latitude !== after.latitude ||
    before.longitude !== after.longitude
  )
}

interface Props {
  mode: 'create' | 'edit'
  initial: BusinessFormValues
  busy: boolean
  error?: string
  success?: string
  onSubmit: (values: BusinessFormValues) => void
}

const ACCESS_KEYS = ['entrance', 'toilet', 'parking'] as const

export function BusinessForm({ mode, initial, busy, error, success, onSubmit }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [values, setValues] = useState<BusinessFormValues>(initial)
  const [reviewing, setReviewing] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [localError, setLocalError] = useState('')
  const [confirming, setConfirming] = useState<BusinessFormValues | null>(null)
  const [step, setStep] = useState(0)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoFailed, setGeoFailed] = useState(false)
  const addressManualAt = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const willRemoderate = mode === 'edit' && substantialChange(initial, values)
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial])
  const stepped = mode === 'create'
  const totalSteps = CREATE_STEPS.length

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setConfirming(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  useEffect(() => {
    if (mode !== 'create') return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) {
        if (!localStorage.getItem('hodari_biz_idem')) localStorage.setItem('hodari_biz_idem', crypto.randomUUID())
        return
      }
      const saved = JSON.parse(raw) as { values?: Partial<BusinessFormValues>; step?: number }
      if (saved.values) setValues((prev) => ({ ...prev, ...saved.values }))
      if (typeof saved.step === 'number') setStep(Math.min(CREATE_STEPS.length - 1, saved.step))
      if (!localStorage.getItem('hodari_biz_idem')) localStorage.setItem('hodari_biz_idem', crypto.randomUUID())
    } catch { /* ignore */ }
  }, [mode])

  useEffect(() => {
    if (mode !== 'create') return
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, step })) } catch { /* ignore */ }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [mode, step, values])

  function patch<K extends keyof BusinessFormValues>(key: K, value: BusinessFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function onAddressInput(value: string) {
    addressManualAt.current = Date.now()
    setGeoFailed(false)
    patch('address', value)
  }

  function onAddressResolve(state: AddressResolveState) {
    setGeoLoading(state.loading)
    if (state.loading) return
    setGeoFailed(state.failed && !state.address)
    if (!state.address) return
    const recentlyTyped = Date.now() - addressManualAt.current < MANUAL_ADDRESS_MS
    if (recentlyTyped) return
    patch('address', state.address)
  }

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '').slice(0, 24)
    if (!tag) return
    setValues((prev) => {
      if (prev.tags.length >= MAX_TAGS || prev.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return prev
      return { ...prev, tags: [...prev.tags, tag] }
    })
    setTagDraft('')
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagDraft)
    } else if (e.key === 'Backspace' && !tagDraft && values.tags.length) {
      patch('tags', values.tags.slice(0, -1))
    }
  }

  async function onFiles(files: FileList | null) {
    setPhotoError('')
    if (!files?.length) return
    const room = MAX_PHOTOS - values.photos.length
    const picked = Array.from(files).slice(0, room)
    const encoded: string[] = []
    for (const file of picked) {
      const url = await compressImage(file)
      if (url) encoded.push(url)
      else setPhotoError(t('biz.form.photoTooBig'))
    }
    if (files.length > room) setPhotoError(t('biz.form.photoMax'))
    if (encoded.length) setValues((prev) => ({ ...prev, photos: [...prev.photos, ...encoded].slice(0, MAX_PHOTOS) }))
    if (fileRef.current) fileRef.current.value = ''
  }

  function makeCover(index: number) {
    setValues((prev) => {
      const photos = [...prev.photos]
      const [cover] = photos.splice(index, 1)
      return { ...prev, photos: [cover, ...photos] }
    })
  }

  function toggleAccess(key: (typeof ACCESS_KEYS)[number], on: boolean) {
    setValues((prev) => ({ ...prev, access: { ...prev.access, [key]: on, declared: true } }))
  }

  function declareNone() {
    setValues((prev) => ({ ...prev, access: { entrance: false, toilet: false, parking: false, declared: true } }))
  }

  function finalValues(): BusinessFormValues {
    const pending = tagDraft.trim().replace(/^#/, '').slice(0, 24)
    const tags = pending && values.tags.length < MAX_TAGS && !values.tags.includes(pending)
      ? [...values.tags, pending]
      : values.tags
    const hours = values.hoursWeek
      ? summarizeWeek(values.hoursWeek, (day) => t(`biz.days.short.${day}`), t('biz.hours.closedShort'))
      : values.hours
    return { ...values, tags, hours }
  }

  const stepId = CREATE_STEPS[step].id
  const fieldErrors = stepped ? stepFieldErrors(stepId, values) : {}
  const stepValid = Object.keys(fieldErrors).length === 0

  function messageFor(field: string): string {
    const key = fieldErrors[field]
    return key ? t(key) : ''
  }

  function focusError(errors: Record<string, string>) {
    const field = firstErrorField(errors)
    const id = field === 'latitude' ? 'biz-pin' : field === 'hoursWeek' ? 'biz-hours' : field === 'photos' ? 'biz-photos' : field ? `biz-${field}` : ''
    if (!id) return
    const node = document.getElementById(id)
    if (node instanceof HTMLElement) node.focus()
  }

  function validateStep(index: number): string {
    const errors = stepFieldErrors(CREATE_STEPS[index].id as FormStepId, values)
    const first = firstErrorField(errors)
    return first ? t(errors[first]) : ''
  }

  function goNext() {
    const errors = stepFieldErrors(stepId, values)
    if (Object.keys(errors).length) {
      setLocalError('')
      focusError(errors)
      return
    }
    setLocalError('')
    if (step >= totalSteps - 1) {
      setReviewing(true)
      return
    }
    setStep((s) => Math.min(totalSteps - 1, s + 1))
  }

  function goBack() {
    setLocalError('')
    if (reviewing) {
      setReviewing(false)
      return
    }
    setStep((s) => Math.max(0, s - 1))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError('')
    if (reviewing) {
      onSubmit(finalValues())
      return
    }
    if (stepped) {
      goNext()
      return
    }
    for (let i = 0; i < totalSteps; i++) {
      const err = validateStep(i)
      if (err) {
        setLocalError(err)
        if (stepped) setStep(i)
        return
      }
    }
    if (values.latitude == null || values.longitude == null) {
      setLocalError(t('biz.form.pinNeed'))
      if (stepped) setStep(1)
      return
    }
    const next = finalValues()
    if (tagDraft.trim()) {
      setValues(next)
      setTagDraft('')
    }
    if (willRemoderate) {
      setConfirming(next)
      return
    }
    onSubmit(next)
  }

  const noneDeclared = values.access.declared && !ACCESS_KEYS.some((key) => values.access[key])
  const shownError = localError || error
  const chip = (on: boolean) =>
    `inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#E8672A] ${
      on ? 'border-[#E8672A] bg-[#FDE8DC] font-medium text-[#9A3412]' : 'border-[#D4D4D8] bg-white text-[#3F3F46] hover:border-[#A1A1AA]'
    }`

  const showIdentity = !reviewing && (!stepped || step === 0)
  const showAddress = !reviewing && (!stepped || step === 1)
  const showHours = !reviewing && (!stepped || step === 2)
  const showPhotos = !reviewing && (!stepped || step === 3)

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-24" noValidate>
      {stepped && (
        <nav aria-label={t('biz.form.stepsNav')} className={`${BIZ.card} p-4`}>
          <ol className="flex items-center gap-1 sm:gap-2">
            {CREATE_STEPS.map((s, i) => {
              const Icon = s.icon
              const done = i < step
              const active = i === step
              return (
                <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (i < step) {
                        setLocalError('')
                        setStep(i)
                      } else if (i > step) {
                        const err = validateStep(step)
                        if (err) setLocalError(err)
                        else {
                          setLocalError('')
                          setStep(i)
                        }
                      }
                    }}
                    className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center transition-colors ${BIZ.focus} ${
                      active ? 'bg-[#FDE8DC]' : done ? 'hover:bg-[#FAFAFA]' : 'opacity-60'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold ${
                        done || active ? 'bg-[#E8672A] text-white' : 'bg-[#F4F4F5] text-[#71717A]'
                      }`}
                    >
                      {done ? <CheckCircle2 size={16} /> : <Icon size={14} />}
                    </span>
                    <span className={`hidden truncate text-[11px] font-medium sm:block ${active ? 'text-[#9A3412]' : 'text-[#52525B]'}`}>
                      {t(s.titleKey)}
                    </span>
                  </button>
                  {i < CREATE_STEPS.length - 1 && (
                    <span className={`hidden h-0.5 w-3 shrink-0 rounded-full sm:block ${i < step ? 'bg-[#E8672A]' : 'bg-[#E4E4E7]'}`} aria-hidden />
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      {showIdentity && (
        <section id="biz-identity" className={`${BIZ.card} p-5`}>
          <h3 className={BIZ.cardTitle}>
            <Store size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.form.identity')}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={BIZ.label}>{t('business.name')} *</span>
              <input id="biz-name" required={stepped ? step === 0 : true} maxLength={120} value={values.name} onChange={(e) => patch('name', e.target.value)} className={BIZ.field} aria-invalid={!!messageFor('name')} />
              <FieldError message={showIdentity ? messageFor('name') : ''} />
            </label>
            <label className="block">
              <span className={BIZ.label}>{t('business.category')} *</span>
              <select id="biz-category" value={values.category} onChange={(e) => patch('category', e.target.value)} className={BIZ.field} aria-invalid={!!messageFor('category')}>
                <option value="">{t('biz.form.errors.category')}</option>
                {PLACE_CATEGORIES.map((id) => (
                  <option key={id} value={id}>{t(`categories.${id}`)}</option>
                ))}
              </select>
              <FieldError message={showIdentity ? messageFor('category') : ''} />
            </label>
              <label className="block">
              <span className={BIZ.label}>{t('biz.form.phone')}</span>
              <input
                id="biz-phone"
                type="tel"
                inputMode="tel"
                maxLength={30}
                value={values.phone}
                onChange={(e) => patch('phone', e.target.value)}
                placeholder="+250 7xx xxx xxx"
                className={BIZ.field}
                aria-invalid={!!messageFor('phone')}
              />
              <FieldError message={showIdentity ? messageFor('phone') : ''} />
            </label>
            <label id="biz-description" className="block sm:col-span-2">
              <span className={BIZ.label}>{t('biz.form.description')}</span>
              <p className="mb-1.5 text-[12px] text-[#71717A]">{t('biz.form.descriptionTone')}</p>
              <textarea
                rows={3}
                maxLength={400}
                value={values.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder={t('biz.form.descriptionHint')}
                className={`${BIZ.field} resize-none`}
              />
              <span className={`mt-1.5 flex justify-end text-[12px] tabular-nums ${values.description.length > 360 ? 'font-semibold text-[#C2410C]' : 'text-[#52525B]'}`}>
                {values.description.length}/400
              </span>
            </label>
          </div>
        </section>
      )}

      {showAddress && (
        <section id="biz-where" className={`${BIZ.card} p-5`}>
          <h3 className={BIZ.cardTitle}>
            <MapPin size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.form.where')}
          </h3>
          <label className="mt-4 block">
            <span className={`${BIZ.label} flex items-center gap-2`}>
              {t('biz.form.address')}
              {geoLoading && (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-normal normal-case tracking-normal text-[#71717A]">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  {t('biz.form.addressLooking')}
                </span>
              )}
            </span>
            <input
              maxLength={200}
              value={values.address}
              onChange={(e) => onAddressInput(e.target.value)}
              placeholder={t('biz.form.addressHint')}
              className={BIZ.field}
            />
            {geoFailed && !geoLoading && (
              <p className="mt-1.5 text-[12px] text-[#9A3412]">{t('biz.form.addressNotFound')}</p>
            )}
          </label>
          <div id="biz-pin" tabIndex={-1} className="mt-4 outline-none">
            <span className={BIZ.label}>{t('biz.form.position')} *</span>
            <FieldError message={showAddress ? messageFor('latitude') : ''} />
            <LocationPicker
              latitude={values.latitude}
              longitude={values.longitude}
              onChange={(latitude, longitude) => setValues((prev) => ({ ...prev, latitude, longitude }))}
              onAddressResolve={onAddressResolve}
            />
          </div>
        </section>
      )}

      {showHours && (
        <>
          <section id="biz-hours" tabIndex={-1} className={`${BIZ.card} p-5 outline-none`}>
            <h3 className={BIZ.cardTitle}>
              <Clock size={16} className="text-[#E8672A]" aria-hidden />
              {t('business.hours')}
            </h3>
            <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.hours.hint')}</p>
            <div className="mt-4">
              <HoursEditor value={values.hoursWeek} legacy={initial.hours} onChange={(week) => patch('hoursWeek', week)} />
              <FieldError message={showHours ? messageFor('hoursWeek') : ''} />
            </div>
          </section>

          <section id="biz-access" className={`${BIZ.card} p-5`}>
            <h3 className={BIZ.cardTitle}>
              <ShieldCheck size={16} className="text-[#2E8B57]" />
              {t('biz.form.access')}
            </h3>
            <p className="mt-1 text-[12.5px] text-[#52525B]">{t('biz.form.accessHint')}</p>
            <fieldset className="mt-4">
              <legend className="sr-only">{t('biz.form.access')}</legend>
              <div className="flex flex-wrap gap-2">
                {ACCESS_KEYS.map((key) => (
                  <label key={key} className={chip(values.access[key])}>
                    <input type="checkbox" className="sr-only" checked={values.access[key]} onChange={(e) => toggleAccess(key, e.target.checked)} />
                    {values.access[key] && <CheckCircle2 size={14} />}
                    {t(`biz.form.access_${key}`)}
                  </label>
                ))}
                <label className={chip(noneDeclared)}>
                  <input type="checkbox" className="sr-only" checked={noneDeclared} onChange={declareNone} />
                  {noneDeclared && <CheckCircle2 size={14} />}
                  {t('biz.form.access_none')}
                </label>
              </div>
            </fieldset>
          </section>
        </>
      )}

      {showPhotos && (
        <section id="biz-photos" className={`${BIZ.card} p-5`}>
          <h3 className={BIZ.cardTitle}>
            <ImageIcon size={16} className="text-[#E8672A]" aria-hidden />
            {t('biz.form.showcase')}
          </h3>
          <span className={`${BIZ.label} mt-4`}>{t('biz.form.photos')} ({values.photos.length}/{MAX_PHOTOS})</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {values.photos.map((url, index) => (
              <div key={`${index}-${url.slice(-24)}`} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#E4E4E7]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${t('biz.form.photos')} ${index + 1}`} className="h-full w-full object-cover" />
                {index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-[#1A1614] px-2 py-0.5 text-[10.5px] font-medium text-white">{t('biz.form.cover')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makeCover(index)}
                    aria-label={t('biz.form.makeCover')}
                    title={t('biz.form.makeCover')}
                    className={`absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-[#E8672A] ${BIZ.focus}`}
                  >
                    <Star size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => patch('photos', values.photos.filter((_, i) => i !== index))}
                  aria-label={t('biz.form.removePhoto')}
                  title={t('biz.form.removePhoto')}
                  className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600 ${BIZ.focus}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {values.photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#A1A1AA] bg-[#FAFAFA] text-[12.5px] text-[#3F3F46] transition-colors hover:border-[#E8672A] hover:text-[#C2410C] ${BIZ.focus}`}
              >
                <Camera size={18} />
                {t('biz.form.addPhotos')}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          {photoError && <p className="mt-2 text-[12.5px] text-[#B91C1C]">{photoError}</p>}
          <FieldError message={showPhotos ? messageFor('photos') : ''} />

          <label id="biz-tags" className="mt-5 block">
            <span className={BIZ.label}>{t('biz.form.tags')} ({values.tags.length}/{MAX_TAGS})</span>
            <div className={`${BIZ.field} flex flex-wrap items-center gap-1.5 py-2`}>
              {values.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-[12.5px] text-[#18181B]">
                  {tag}
                  <button type="button" onClick={() => patch('tags', values.tags.filter((item) => item !== tag))} aria-label={`${t('biz.form.removeTag')} ${tag}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={onTagKey}
                onBlur={() => addTag(tagDraft)}
                disabled={values.tags.length >= MAX_TAGS}
                placeholder={values.tags.length ? '' : t('biz.form.tagsHint')}
                className="min-w-[8rem] flex-1 bg-transparent text-[14px] outline-none"
              />
            </div>
          </label>
        </section>
      )}

      {mode === 'edit' && (
        <p
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${
            willRemoderate ? 'border-amber-400 bg-amber-50 text-amber-950' : 'border-[#E4E4E7] bg-white text-[#3F3F46]'
          }`}
          role={willRemoderate ? 'alert' : undefined}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {willRemoderate ? t('biz.form.remoderateWarn') : t('biz.form.moderationRule')}
        </p>
      )}

      {reviewing && (
        <section className={`${BIZ.card} p-5`} aria-labelledby="biz-review">
          <h3 id="biz-review" className={BIZ.cardTitle}>{t('biz.form.reviewTitle')}</h3>
          <dl className="mt-4 grid gap-2 text-[13.5px] text-[#27272A]">
            <div><dt className="text-[12px] text-[#71717A]">{t('business.name')}</dt><dd className="font-medium">{values.name}</dd></div>
            <div><dt className="text-[12px] text-[#71717A]">{t('business.category')}</dt><dd>{values.category ? t(`categories.${values.category}`) : '—'}</dd></div>
            <div><dt className="text-[12px] text-[#71717A]">{t('biz.form.address')}</dt><dd>{values.address || '—'}</dd></div>
            <div><dt className="text-[12px] text-[#71717A]">{t('biz.form.photos')}</dt><dd>{values.photos.length}</dd></div>
          </dl>
        </section>
      )}

      {shownError && <p className="text-[13px] text-[#B91C1C]" role="alert">{shownError}</p>}
      {success && (mode === 'create' || !dirty) && (
        <div className="relative overflow-hidden rounded-xl border border-[#2E8B57]/30 bg-[#2E8B57]/10 px-3.5 py-4 text-[13px] font-medium text-[#1F6B43]" role="status">
          <p className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
              <motion.circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={motionTransition(!!reduce, 0.35)} />
              <motion.path d="M7 12.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={motionTransition(!!reduce, 0.3)} />
            </svg>
            {success}
          </p>
          {!reduce && (
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center gap-3">
              {['#E8672A', '#2E8B57', '#F5C542', '#1A1614'].map((color, i) => (
                <motion.span key={color} className="mt-1 h-1.5 w-1.5 rounded-full" style={{ background: color }} initial={{ y: 0, opacity: 0 }} animate={{ y: 18, opacity: [0, 1, 0] }} transition={{ duration: 0.4, delay: i * 0.04 }} />
              ))}
            </span>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E4E4E7] bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/90 md:sticky md:bottom-0 md:rounded-xl md:border md:shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            {stepped ? (
              <p className="text-[12.5px] font-medium text-[#52525B]">
                {t('biz.form.stepOf').replace('{n}', String(step + 1)).replace('{total}', String(totalSteps))}
              </p>
            ) : (
              <span className="sr-only">{t('biz.form.save')}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stepped && (step > 0 || reviewing) && (
              <button type="button" onClick={goBack} className={`${BIZ.secondary} h-11 px-4`}>
                {t('biz.form.back')}
              </button>
            )}
            {stepped && !reviewing ? (
              <button type="submit" disabled={!stepValid} className={`${BIZ.primary} h-11 px-6 disabled:cursor-not-allowed disabled:opacity-50`}>
                {t('biz.form.next')}
              </button>
            ) : (
              <button type="submit" disabled={busy || (mode === 'edit' && !dirty)} className={`${BIZ.primary} h-11 px-6`}>
                {busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />}
                {mode === 'create'
                  ? busy ? t('business.submitting') : reviewing ? t('biz.form.reviewSubmit') : t('business.submit')
                  : busy ? t('biz.form.saving') : t('biz.form.save')}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="remoderate-title">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirming(null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-[#18181B] shadow-2xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <AlertTriangle size={20} />
            </span>
            <h4 id="remoderate-title" className="mt-3 text-[17px] font-semibold">{t('biz.form.recheckTitle')}</h4>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#3F3F46]">{t('biz.form.recheckBody')}</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" autoFocus onClick={() => setConfirming(null)} className={`${BIZ.secondary} h-10`}>{t('biz.danger.cancel')}</button>
              <button
                type="button"
                onClick={() => { const next = confirming; setConfirming(null); onSubmit(next) }}
                className={`${BIZ.primary} h-10`}
              >
                {t('biz.form.recheckConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
