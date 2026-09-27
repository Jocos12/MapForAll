import { hoursAreFresh } from '@/lib/hours'
import type { OwnerDashboard } from '@/components/business/types'

export interface ChecklistItem {
  id: 'photos' | 'description' | 'hours' | 'access' | 'phone' | 'tags' | 'recommend'
  done: boolean
  /** Form anchor to jump to, or an inline action handled by the promotion page. */
  target: string
  /** Key under `biz.checklist.items`; hours read "set" until a weekly schedule exists, then "confirm". */
  label: string
}

export const MIN_PHOTOS = 3
export const MIN_DESCRIPTION = 40

/** Completeness items. A fuller listing gives the ranking more to score on. */
export function checklistFor(data: OwnerDashboard): ChecklistItem[] {
  const form = data.form
  return [
    { id: 'photos', done: form.photos.length >= MIN_PHOTOS, target: 'biz-photos', label: 'photos' },
    { id: 'description', done: form.description.trim().length >= MIN_DESCRIPTION, target: 'biz-description', label: 'description' },
    { id: 'hours', done: !!form.hoursWeek && hoursAreFresh(data.hoursConfirmedAt), target: 'biz-hours', label: form.hoursWeek ? 'hours' : 'hoursSet' },
    { id: 'access', done: form.access.declared, target: 'biz-access', label: 'access' },
    { id: 'phone', done: !!form.phone, target: 'biz-phone', label: 'phone' },
    { id: 'tags', done: form.tags.length >= 3, target: 'biz-tags', label: 'tags' },
    { id: 'recommend', done: data.recommends.length > 0, target: 'promo-reco', label: 'recommend' },
  ]
}
