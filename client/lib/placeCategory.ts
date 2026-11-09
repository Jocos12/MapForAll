import type { Place } from '@/lib/types'
import { queryTokens } from '@/lib/placeTextMatch'

const CATEGORIES: Array<[string, RegExp]> = [
  ['phone', /iphones?|smartphones?|telephones?|electronics|\bphones?\b/i],
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
  phone: ['phone', 'iphone', 'smartphone', 'electronics', 'telephone'],
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
  return [place.name, place.summary, place.description, place.why, ...(place.categories ?? []), ...(place.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

const GROUP_EXACT: Record<string, string[]> = {
  phone: ['iphone', 'smartphone', 'telephone'],
  market: ['tomato', 'tomatoes', 'tomate', 'tomates', 'inyanya'],
  cafe: ['coffee', 'cafe', 'café'],
  hotel: ['hotel', 'hôtel', 'lodging', 'auberge'],
  restaurant: ['restaurant', 'resto'],
}

const GROUP_RELATED: Record<string, string[]> = {
  phone: ['apple', 'electronics', 'phone', 'mobile'],
  market: ['vegetable', 'legume', 'légume', 'greengrocer', 'grocery', 'market', 'supermarket', 'épicerie', 'epicerie'],
  cafe: ['espresso', 'kawa'],
  hotel: ['hostel', 'guest house', 'guest'],
  restaurant: ['dining', 'burger'],
}

const GROUP_PATTERN: Array<[string, RegExp]> = [
  ['phone', /iphones?|smartphones?|telephones?|electronics|phone\s*shops?|\bphones?\b/i],
  ['market', /tomato|tomatoes|tomate|tomates|inyanya|vegetable|légume|legume|grocery|épicerie|epicerie|supermarket|supermarché|marché|market\b|isoko/i],
  ['cafe', /caf[eé]s?|coffee/i],
  ['hotel', /h[oô]tels?|hotels?|lodging|auberge|guest\s*house/i],
  ['restaurant', /restaurants?|restos?/i],
]

function askGroup(text: string): string | null {
  for (const [group, pattern] of GROUP_PATTERN) {
    if (pattern.test(text)) return group
  }
  return requestedCategory(text)
}

export function matchesCategory(place: Place, category: string): boolean {
  const text = blob(place)
  return (SIGNALS[category] ?? []).some((word) => text.includes(word))
}

/** Drop places that are not the kind of place the user asked for. Bonuses never run here. */
export function placesForAsk(places: Place[], ask: string): Place[] {
  const group = askGroup(ask)
  if (group && (GROUP_EXACT[group] || GROUP_RELATED[group])) {
    const terms = [...(GROUP_EXACT[group] ?? []), ...(GROUP_RELATED[group] ?? [])]
    return places.filter((place) => {
      const text = blob(place)
      return terms.some((word) => text.includes(word))
    })
  }
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

/** The product word after filler is removed. Never the raw sentence. */
export function extractedKeyword(ask: string): string {
  const tokens = queryTokens(ask)
  return tokens[0] || 'that'
}

/** Chat text built only from the cards, never from places that were filtered out. */
export function replyFromPlaces(places: Place[], ask: string): string {
  const subject = extractedKeyword(ask)
  if (!places.length) {
    return `I couldn't find places for '${subject}' near you. I can widen the area if you want.`
  }
  const lines = places.slice(0, 8).map((place) => {
    const extra = [place.distance, place.why].filter(Boolean).join(', ')
    return `- ${place.name}${extra ? ` (${extra})` : ''}`
  })
  if (places.length < 5) {
    const noun = places.length === 1 ? 'place' : 'places'
    return `I found ${places.length} ${noun} for ${subject} near you. I can widen the area if you want.\n${lines.join('\n')}`
  }
  return lines.join('\n')
}
