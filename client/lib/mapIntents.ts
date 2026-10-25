import type { Place } from './types'

/** "location 2", "option 2", "#2", "the second one" → 0-based index */
export function parseListOrdinal(text: string, listLength: number): number | null {
  if (listLength === 0) return null
  const t = text.toLowerCase()
  const patterns = [
    /\b(?:location|option|number|#|pick|choice|item)\s*(\d{1,2})\b/,
    /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:one|option|pick|choice)\b/,
    /\bthe\s+(first|second|third|fourth|fifth|sixth)\b/,
  ]
  const words: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
  }
  for (const p of patterns) {
    const m = t.match(p)
    if (!m) continue
    const n = words[m[1]] ?? parseInt(m[1], 10)
    if (n >= 1 && n <= listLength) return n - 1
  }
  return null
}

export function findPlaceIndexInText(text: string, places: Place[]): number | null {
  const lower = text.toLowerCase()
  for (let i = 0; i < places.length; i++) {
    const name = places[i].name.toLowerCase()
    if (lower.includes(name)) return i
    const tokens = name.split(/[\s|.,/]+/).filter((w) => w.length > 3 || /^\d{2,}$/.test(w))
    const hits = tokens.filter((w) => lower.includes(w))
    if (hits.length >= 2 || (hits.length === 1 && tokens.length <= 2)) return i
  }
  return null
}

/** User wants the map camera zoomed on an existing pin — not a new search. */
export function isZoomFocusRequest(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(zoom|closer|close up|see it closer|see that closer|focus on)\b/.test(t)) return true
  if (/\b(see|show|view)\b.{0,30}\b(closer|close up|on the map)\b/.test(t)) return true
  if (/\b(center|centre)\b.{0,20}\b(map|on)\b/.test(t)) return true
  return false
}

/** User wants only one place visible — not a new search list. */
export function isKeepOnlyRequest(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(only|just)\b.{0,40}\b(one|this|that)\b/.test(t)) return true
  if (/\b(hide|remove|delete|drop)\b.{0,30}\b(other|others|rest|them)\b/.test(t)) return true
  if (/\bkeep\b.{0,20}\b(only|just)\b/.test(t)) return true
  if (/\bsingle\s+(spot|place|pin|restaurant)\b/.test(t)) return true
  if (/\bonly\s+\w+/.test(t) && /\b(displayed|shown|map|pin)\b/.test(t)) return true
  if (/\b(only|just)\s+need(ed)?\b/.test(t)) return true
  if (/\bneed(ed)?\s+(only\s+)?(this|that|one)\b/.test(t)) return true
  return false
}

/** Keep-only when the message names a specific place ("only Cantine Divino"). */
export function isNamedKeepOnlyRequest(text: string, places: Place[]): boolean {
  const t = text.toLowerCase()
  if (/\b(find|search|show me|best|near)\b/.test(t)) return false
  if (!/\b(only|just)\b/.test(t)) return false
  return findPlaceIndexInText(text, places) !== null
}

/** Fresh place search — clears solo-pin filter. */
export function isNewSearchRequest(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(find|search|show me|best|recommend|suggest|list)\b/.test(t)
    && /\b(restaurants?|hotels?|cafes?|coffee|bars?|places?|dining|spots?)\b/.test(t)
  )
}

/** Pick from numbered list without re-searching ("let's go with location 2"). */
export function isListPickRequest(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(let'?s\s+)?(go with|pick|choose|take|want)\b/.test(t) &&
    (/\b(location|option|number|#)\s*\d/.test(t) || parseListOrdinal(text, 6) !== null)
  )
}

export function resolvePlaceIndex(
  text: string,
  places: Place[],
  activeIndex: number | null,
): number | null {
  const byName = findPlaceIndexInText(text, places)
  if (byName !== null) return byName
  const byOrd = parseListOrdinal(text, places.length)
  if (byOrd !== null) return byOrd
  if (activeIndex !== null && activeIndex < places.length) return activeIndex
  return null
}
