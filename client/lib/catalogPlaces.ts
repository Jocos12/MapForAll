import type { Place } from '@/lib/types'
import { requestedCategory } from '@/lib/placeCategory'
import { dedupePlaces } from '@/lib/placeDedupe'

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
    .slice(0, 120)
  // Free-text q always — API matches name + description (+ synonyms). Exact names still win.
  if (q.length >= 2) params.set('q', q)

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

/** Catalog (Mongo validated) first, then agent/Maps. The same venue is kept once. */
export function mergeCatalogFirst(catalog: Place[], agent: Place[]): Place[] {
  return dedupePlaces([...catalog, ...agent])
}
