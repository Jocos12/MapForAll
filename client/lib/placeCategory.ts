import type { Place } from '@/lib/types'

const CATEGORIES: Array<[string, RegExp]> = [
  ['clinic', /centres?\s+de\s+sant[eé]|health\s+cent(?:er|re)s?|cliniques?|clinics?|h[oô]pitaux|h[oô]pital|hospitals?|dispensaires?/i],
  ['pharmacy', /pharmacies|pharmacie|pharmacy/i],
  ['hotel', /h[oô]tels?|hotels?|lodging|h[eé]bergements?/i],
  ['cafe', /caf[eé]s?|coffee/i],
  ['restaurant', /restaurants?|restos?/i],
  ['market', /supermarch[eé]s?|supermarkets?|march[eé]s?|markets?/i],
  ['shop', /boutiques?|magasins?|shops?/i],
]

const SIGNALS: Record<string, string[]> = {
  hotel: ['hotel', 'hôtel', 'lodging', 'hostel', 'marriott', 'radisson'],
  pharmacy: ['pharmacy', 'pharmacie', 'drugstore'],
  clinic: ['clinic', 'clinique', 'hospital', 'hôpital', 'hopital', 'dispensaire', 'health'],
  restaurant: ['restaurant', 'resto', 'dining'],
  cafe: ['cafe', 'café', 'coffee'],
  market: ['market', 'marché', 'marche', 'supermarket', 'supermarché', 'supermarche'],
  shop: ['shop', 'boutique', 'magasin', 'store'],
}

export function requestedCategory(text: string): string | null {
  for (const [category, pattern] of CATEGORIES) {
    if (pattern.test(text)) return category
  }
  return null
}

function blob(place: Place): string {
  return [place.name, ...(place.categories ?? [])].join(' ').toLowerCase()
}

export function matchesCategory(place: Place, category: string): boolean {
  const text = blob(place)
  return (SIGNALS[category] ?? []).some((word) => text.includes(word))
}

/** Drop places from another category. Unfiltered when the ask has no category. */
export function placesForAsk(places: Place[], ask: string): Place[] {
  const category = requestedCategory(ask)
  if (!category) return places
  return places.filter((place) => matchesCategory(place, category))
}
