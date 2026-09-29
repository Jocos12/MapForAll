import { storedPhotos, toClientPlace } from '@/lib/places'
import { DB } from '@/lib/adminPlaces'
import { resolveSector } from '@/lib/adminPlaces'

export { DB }

export type BusinessStatus = 'pending' | 'validated' | 'rejected' | 'suspended'

export type CompletenessItem = 'name' | 'address' | 'category' | 'hours' | 'photos' | 'accessibility' | 'proof'

export function isClaimedBusiness(doc: Record<string, unknown>): boolean {
  return doc.claimed_by_owner === true || doc.source === 'owner_claimed'
}

export function businessStatus(doc: Record<string, unknown>): BusinessStatus {
  const s = typeof doc.status === 'string' ? doc.status : 'pending'
  if (s === 'validated' || s === 'rejected' || s === 'suspended') return s
  return 'pending'
}

export function completenessChecklist(doc: Record<string, unknown>): Record<CompletenessItem, boolean> {
  const name = typeof doc.name === 'string' && doc.name.trim().length >= 2
  const address = typeof doc.address === 'string' && doc.address.trim().length >= 4
  const categories = Array.isArray(doc.categories) ? doc.categories : []
  const category = categories.some((c) => typeof c === 'string' && c.trim())
  const hours =
    (typeof doc.hours === 'string' && doc.hours.trim().length > 0) ||
    (doc.hours_week != null && typeof doc.hours_week === 'object')
  const photos = storedPhotos(doc).length > 0 || (typeof doc.photo_url === 'string' && !!doc.photo_url)
  const access = doc.access as { entrance?: boolean; toilet?: boolean; parking?: boolean } | undefined
  const accessibility =
    doc.accessible === true ||
    access?.entrance === true ||
    access?.toilet === true ||
    access?.parking === true ||
    doc.access_declared === true
  const proof =
    (typeof doc.proof_document === 'string' && doc.proof_document.length > 0) ||
    (typeof doc.ownership_proof === 'string' && doc.ownership_proof.length > 0)
  return { name, address, category, hours, photos, accessibility, proof }
}

export function completenessScore(doc: Record<string, unknown>): { done: number; total: number } {
  const c = completenessChecklist(doc)
  const values = Object.values(c)
  return { done: values.filter(Boolean).length, total: values.length }
}

export type AdminBusinessRow = {
  place_id: string
  name: string
  status: BusinessStatus
  sector: string
  categories: string[]
  local_business: boolean
  claimed_by_owner: boolean
  source: string
  added_by?: string
  created_at?: string
  completeness: { done: number; total: number }
}

export function toAdminBusinessRow(doc: Record<string, unknown>): AdminBusinessRow | null {
  const base = toClientPlace(doc)
  if (!base || !isClaimedBusiness(doc)) return null
  const score = completenessScore(doc)
  return {
    place_id: base.place_id,
    name: base.name,
    status: businessStatus(doc),
    sector: resolveSector(doc),
    categories: base.categories,
    local_business: base.local_business,
    claimed_by_owner: base.claimed_by_owner,
    source: base.source,
    added_by: base.added_by,
    created_at: base.created_at,
    completeness: score,
  }
}

export function matchesBusinessQuery(
  doc: Record<string, unknown>,
  q: { status?: string; q?: string },
): boolean {
  if (!isClaimedBusiness(doc)) return false
  if (q.status && q.status !== 'all' && businessStatus(doc) !== q.status) return false
  if (q.q) {
    const hay = `${doc.name ?? ''} ${doc.address ?? ''} ${doc.place_id ?? ''}`.toLowerCase()
    if (!hay.includes(q.q)) return false
  }
  return true
}

export function sortBusinesses(
  rows: AdminBusinessRow[],
  sort: 'created_desc' | 'created_asc' | 'name' | 'completeness',
): AdminBusinessRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'completeness') {
      const ra = a.completeness.done / a.completeness.total
      const rb = b.completeness.done / b.completeness.total
      return rb - ra || a.name.localeCompare(b.name)
    }
    const ta = a.created_at ?? ''
    const tb = b.created_at ?? ''
    return sort === 'created_asc' ? ta.localeCompare(tb) : tb.localeCompare(ta)
  })
  return copy
}
