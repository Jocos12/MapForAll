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

const PRODUCT_ASKS: Array<{ category: string; pattern: RegExp; signals: string[] }> = [
  {
    category: 'market',
    pattern: /tomato|tomatoes|tomate|tomates|inyanya|vegetable|légume|legume|grocery|épicerie|epicerie|supermarket|supermarché|marché|market\b|isoko/i,
    signals: ['market', 'marché', 'marche', 'supermarket', 'supermarché', 'supermarche', 'grocery', 'épicerie', 'epicerie', 'vegetable', 'shop', 'store'],
  },
]

export function requestedCategory(text: string): string | null {
  for (const ask of PRODUCT_ASKS) {
    if (ask.pattern.test(text)) return ask.category
  }
  for (const [category, pattern] of CATEGORIES) {
    if (pattern.test(text)) return category
  }
  return null
}

function productSignals(text: string): string[] | null {
  if (/h[oô]tels?|hotels?/i.test(text) && !/tomato|tomate|inyanya/i.test(text)) return null
  for (const ask of PRODUCT_ASKS) {
    if (ask.pattern.test(text)) return ask.signals
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

/** Drop places that are not the kind of place the user asked for. */
export function placesForAsk(places: Place[], ask: string): Place[] {
  const signals = productSignals(ask)
  if (signals) {
    return places.filter((place) => {
      const text = blob(place)
      return signals.some((word) => text.includes(word))
    })
  }
  const category = requestedCategory(ask)
  if (!category) return places
  return places.filter((place) => matchesCategory(place, category))
}
