/**
 * Search fields written when an admin validates a place.
 * The chat catalog matches name_normalized, keywords and categories.
 * Embedding is scheduled separately and must not block this write.
 */

const GROUPS: string[][] = [
  ['tomato', 'tomatoes', 'tomate', 'tomates', 'inyanya'],
  ['vegetable', 'vegetables', 'legume', 'legumes', 'légume', 'légumes'],
  ['greengrocer', 'market', 'markets', 'marche', 'marches', 'marché', 'marchés', 'isoko', 'grocery'],
]

const PRODUCE = new Set(['tomato', 'tomate', 'tomates', 'inyanya', 'vegetable', 'legume', 'greengrocer'])

export function fold(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function validPoint(value: unknown): { type: 'Point'; coordinates: [number, number] } | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { type?: unknown; coordinates?: unknown }
  if (point.type !== 'Point' || !Array.isArray(point.coordinates) || point.coordinates.length < 2) return null
  const lng = Number(point.coordinates[0])
  const lat = Number(point.coordinates[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { type: 'Point', coordinates: [lng, lat] }
}

export function buildSearchDocument(doc: Record<string, unknown>): Record<string, unknown> {
  const name = typeof doc.name === 'string' ? doc.name : ''
  const description = typeof doc.description === 'string'
    ? doc.description
    : typeof doc.summary === 'string' ? doc.summary : ''
  const tags = asStrings(doc.tags)
  const categories = asStrings(doc.categories)
  const blob = fold([name, description, tags.join(' '), categories.join(' ')].join(' '))
  const keywords = new Set<string>()
  for (const group of GROUPS) {
    if (group.some((word) => blob.includes(fold(word)))) {
      for (const word of group) keywords.add(fold(word))
    }
  }
  for (const token of blob.split(/[^a-z0-9]+/)) {
    if (token.length >= 3) keywords.add(token)
  }
  const nextCategories = [...categories]
  if ([...keywords].some((word) => PRODUCE.has(word)) && !nextCategories.includes('market')) {
    nextCategories.push('market')
  }
  const location = validPoint(doc.location)
  const fields: Record<string, unknown> = {
    name_normalized: fold(name),
    keywords: [...keywords].slice(0, 48),
    categories: nextCategories,
    search_indexed_at: new Date().toISOString(),
  }
  if (location) fields.location = location
  return fields
}

export function searchText(doc: Record<string, unknown>): string {
  const name = typeof doc.name === 'string' ? doc.name : ''
  const description = typeof doc.description === 'string' ? doc.description : ''
  const keywords = asStrings(doc.keywords).join(' ')
  return [name, description, keywords].filter(Boolean).join('. ').slice(0, 2000)
}
