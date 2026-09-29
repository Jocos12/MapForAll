import type { Place } from '@/lib/types'
import { requestedCategory } from '@/lib/placeCategory'

/**
 * Fetch validated MapForAll listings that match the user ask.
 * Ensures owner-published businesses appear even when the agent/Maps path
 * returns nothing or an incomplete set (cahier §4.2 / §4.3).
 */
export async function fetchCatalogPlaces(ask: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams()
  const category = requestedCategory(ask)
  if (category) params.set('category', category)
  if (/prefer_local|local business|commerces?\s+locaux|petit(?:s)?\s+commerce/i.test(ask)) {
    params.set('local_business', '1')
  }
  if (/require_accessible|wheelchair|step-free|accessible|mobilit[eé]\s+r[eé]duite/i.test(ask)) {
    params.set('accessible', '1')
  }
  const q = ask
    .replace(/prefer_local|require_accessible/gi, ' ')
    .replace(/\b(show me|find|cherche|montre[-\s]?moi|please|svp|s'il te pla[iî]t)\b/gi, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  // Name search when no category/filter chip alone — "Coffee Shop", "Ivuka Arts", etc.
  if (q.length >= 2 && !category && !params.has('local_business') && !params.has('accessible')) {
    params.set('q', q)
  } else if (q.length >= 2 && category) {
    // Still pass q when category is set so exact names within the category rank first.
    params.set('q', q)
  }

  if (![...params.keys()].length) return []

  try {
    const res = await fetch(`/api/places?${params.toString()}`, { cache: 'no-store', signal })
    if (!res.ok) return []
    const data = (await res.json()) as { places?: Place[] }
    return Array.isArray(data.places) ? data.places : []
  } catch {
    return []
  }
}

/** Catalog (Mongo validated) first, then agent/Maps — same place_id kept once. */
export function mergeCatalogFirst(catalog: Place[], agent: Place[]): Place[] {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const place of [...catalog, ...agent]) {
    const id = place.place_id || place.name
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(place)
  }
  return out
}
