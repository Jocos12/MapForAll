/**
 * Shared onboarding rules for the client form and POST /api/places.
 * Messages are i18n keys so fr / en / rw stay in the selected language.
 */
import { z } from 'zod'

/** Keep aligned with PLACE_CATEGORIES in lib/places.ts */
export const FORM_CATEGORIES = ['market', 'restaurant', 'cafe', 'shop', 'pharmacy', 'hotel', 'clinic', 'attraction', 'other'] as const

const phoneOk = (value: string) => value === '' || /^[+\d][\d\s().-]{6,}$/.test(value)

export const identitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).refine((value) => (FORM_CATEGORIES as readonly string[]).includes(value)),
  phone: z.string().trim().max(30).refine(phoneOk),
  description: z.string().max(400),
})

export const addressSchema = z.object({
  address: z.string().trim().max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})

export const hoursSchema = z.object({
  hoursWeek: z.record(z.string(), z.object({
    closed: z.boolean(),
    open: z.string(),
    close: z.string(),
  })).nullable().refine((week) => week != null),
})

export const photosSchema = z.object({
  photos: z.array(z.string().min(1)).min(1).max(4),
})

export const claimPayloadSchema = identitySchema.merge(addressSchema).merge(photosSchema).extend({
  hoursWeek: hoursSchema.shape.hoursWeek,
})

export type FormStepId = 'identity' | 'address' | 'hours' | 'photos'

export interface FormSlice {
  name: string
  category: string
  phone: string
  description: string
  address: string
  latitude: number | null
  longitude: number | null
  hoursWeek: unknown
  photos: string[]
}

const STEP_FIELDS: Record<FormStepId, string[]> = {
  identity: ['name', 'category', 'phone', 'description'],
  address: ['address', 'latitude', 'longitude'],
  hours: ['hoursWeek'],
  photos: ['photos'],
}

const FIELD_KEY: Record<string, string> = {
  name: 'biz.form.errors.name',
  category: 'biz.form.errors.category',
  phone: 'biz.form.errors.phone',
  description: 'biz.form.errors.description',
  address: 'biz.form.errors.address',
  latitude: 'biz.form.errors.pin',
  longitude: 'biz.form.errors.pin',
  hoursWeek: 'biz.form.errors.hours',
  photos: 'biz.form.errors.photos',
}

function schemaFor(step: FormStepId) {
  if (step === 'identity') return identitySchema
  if (step === 'address') return addressSchema
  if (step === 'hours') return hoursSchema
  return photosSchema
}

/** Field → i18n key. Empty object means the step can continue. */
export function stepFieldErrors(step: FormStepId, values: FormSlice): Record<string, string> {
  const parsed = schemaFor(step).safeParse({
    name: values.name,
    category: values.category,
    phone: values.phone,
    description: values.description,
    address: values.address,
    latitude: values.latitude,
    longitude: values.longitude,
    hoursWeek: values.hoursWeek,
    photos: values.photos,
  })
  if (parsed.success) return {}
  const out: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? '')
    if (!STEP_FIELDS[step].includes(field) && !(step === 'address' && (field === 'latitude' || field === 'longitude'))) continue
    const key = field === 'latitude' || field === 'longitude' ? 'latitude' : field
    if (!out[key]) out[key] = FIELD_KEY[field] ?? 'biz.form.errors.generic'
  }
  if (step === 'address' && (values.latitude == null || values.longitude == null)) {
    out.latitude = 'biz.form.errors.pin'
  }
  return out
}

export function firstErrorField(errors: Record<string, string>): string | null {
  const order = ['name', 'category', 'phone', 'description', 'address', 'latitude', 'hoursWeek', 'photos']
  return order.find((field) => errors[field]) ?? Object.keys(errors)[0] ?? null
}
