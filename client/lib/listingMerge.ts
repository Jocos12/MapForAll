/** Pick the richer listing and the fields to copy across when an admin merges a duplicate. */

export interface MergeDoc {
  place_id?: string
  name?: string
  description?: string
  summary?: string
  phone?: string | null
  hours?: string | null
  hours_week?: unknown
  photos?: unknown
  photo_url?: string | null
  status?: string
  views?: number
  rating?: number
}

function richness(doc: MergeDoc): number {
  const photos = Array.isArray(doc.photos) ? doc.photos.length : 0
  let score = photos * 3
  if (doc.photo_url) score += 2
  if (doc.description && doc.description !== doc.name) score += 2
  if (doc.hours_week || doc.hours) score += 2
  if (doc.phone) score += 1
  if (typeof doc.rating === 'number') score += 2
  if (doc.status === 'validated') score += 5
  if (typeof doc.views === 'number') score += Math.min(3, doc.views > 0 ? 1 : 0)
  return score
}

export function chooseKeeper<T extends MergeDoc>(left: T, right: T): { keeper: T; loser: T } {
  if (richness(left) >= richness(right)) return { keeper: left, loser: right }
  return { keeper: right, loser: left }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : []
}

/** Fields copied onto the keeper. Photos are capped at 4. */
export function mergedKeeperPatch(keeper: MergeDoc, loser: MergeDoc): Record<string, unknown> {
  const photos = [...stringList(keeper.photos)]
  for (const url of stringList(loser.photos)) {
    if (!photos.includes(url)) photos.push(url)
  }
  const capped = photos.slice(0, 4)
  const patch: Record<string, unknown> = { merged_from: loser.place_id ?? null, updated_at: new Date().toISOString() }
  if (capped.length) {
    patch.photos = capped
    patch.photo_count = capped.length
    if (!keeper.photo_url) patch.photo_url = capped[0]
  }
  if ((!keeper.description || keeper.description === keeper.name) && loser.description) patch.description = loser.description
  if (!keeper.hours_week && loser.hours_week) patch.hours_week = loser.hours_week
  if (!keeper.hours && loser.hours) patch.hours = loser.hours
  if (!keeper.phone && loser.phone) patch.phone = loser.phone
  if (!keeper.summary && loser.summary) patch.summary = loser.summary
  return patch
}
