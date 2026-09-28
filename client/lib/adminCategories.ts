import { PLACE_CATEGORIES } from '@/lib/places'
import { DB } from '@/lib/adminPlaces'

export { DB }

export type AdminCategory = {
  category_id: string
  slug: string
  name_fr: string
  name_en: string
  name_rw: string
  icon: string
  color: string
  order: number
  place_count?: number
}

export type AccessCriterion = {
  criterion_id: string
  label_fr: string
  label_en: string
  label_rw: string
  order: number
}

const DEFAULT_ICONS: Record<string, string> = {
  market: 'shopping-basket',
  restaurant: 'utensils',
  cafe: 'coffee',
  shop: 'store',
  pharmacy: 'pill',
  hotel: 'bed',
  clinic: 'stethoscope',
  attraction: 'landmark',
  other: 'map-pin',
}

const DEFAULT_COLORS: Record<string, string> = {
  market: '#E8672A',
  restaurant: '#C2410C',
  cafe: '#92400E',
  shop: '#B45309',
  pharmacy: '#059669',
  hotel: '#2563EB',
  clinic: '#0D9488',
  attraction: '#7C3AED',
  other: '#6E5B50',
}

function slugTitle(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, ' ')
}

export function defaultCategories(): Omit<AdminCategory, 'place_count'>[] {
  return PLACE_CATEGORIES.map((slug, index) => ({
    category_id: `cat_${slug}`,
    slug,
    name_en: slugTitle(slug),
    name_fr: slugTitle(slug),
    name_rw: slugTitle(slug),
    icon: DEFAULT_ICONS[slug] ?? 'map-pin',
    color: DEFAULT_COLORS[slug] ?? '#E8672A',
    order: index,
  }))
}

export function toAdminCategory(doc: Record<string, unknown>): AdminCategory | null {
  const category_id = typeof doc.category_id === 'string' ? doc.category_id : ''
  const slug = typeof doc.slug === 'string' ? doc.slug : ''
  if (!category_id || !slug) return null
  return {
    category_id,
    slug,
    name_fr: typeof doc.name_fr === 'string' ? doc.name_fr : slug,
    name_en: typeof doc.name_en === 'string' ? doc.name_en : slug,
    name_rw: typeof doc.name_rw === 'string' ? doc.name_rw : slug,
    icon: typeof doc.icon === 'string' ? doc.icon : 'map-pin',
    color: typeof doc.color === 'string' ? doc.color : '#E8672A',
    order: typeof doc.order === 'number' ? doc.order : 0,
    place_count: typeof doc.place_count === 'number' ? doc.place_count : undefined,
  }
}

export function toAccessCriterion(doc: Record<string, unknown>): AccessCriterion | null {
  const criterion_id = typeof doc.criterion_id === 'string' ? doc.criterion_id : ''
  if (!criterion_id) return null
  return {
    criterion_id,
    label_fr: typeof doc.label_fr === 'string' ? doc.label_fr : '',
    label_en: typeof doc.label_en === 'string' ? doc.label_en : '',
    label_rw: typeof doc.label_rw === 'string' ? doc.label_rw : '',
    order: typeof doc.order === 'number' ? doc.order : 0,
  }
}

export function countPlacesByCategory(places: Record<string, unknown>[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of places) {
    const cats = Array.isArray(p.categories) ? p.categories : []
    for (const c of cats) {
      if (typeof c !== 'string') continue
      const key = c.toLowerCase()
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }
  return map
}
