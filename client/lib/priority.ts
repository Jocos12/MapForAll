import type { Place } from '@/lib/types'
import { hasStepFreeEntrance } from '@/lib/access'

/** Same weights as agents/hodari/tools/place_schema.py. */
const LOCAL_BONUS = 1.5
const ACCESS_BONUS = 1.0

function bonus(place: Place, preferLocal: boolean): number {
  let points = 0
  if (place.local_business) points += preferLocal ? LOCAL_BONUS : LOCAL_BONUS * 0.5
  if (place.accessible || hasStepFreeEntrance(place)) {
    points += ACCESS_BONUS
    if (place.access?.toilet) points += 0.35
    if (place.access?.parking) points += 0.35
  }
  return points
}

/**
 * Sort by rating + inclusion bonus. `prioritized` is true only when that
 * bonus moved the place above where rating alone would have put it, so a
 * list can show a boosted result next to a standard one.
 */
export function markPrioritized(places: Place[], preferLocal = false): Place[] {
  const rows = places.map((place, index) => ({
    index,
    base: place.rating ?? 0,
    extra: bonus(place, preferLocal),
  }))
  const byBase = [...rows].sort((a, b) => b.base - a.base || a.index - b.index)
  const byBoost = [...rows].sort((a, b) => (b.base + b.extra) - (a.base + a.extra) || a.index - b.index)
  const baseRank = new Map(byBase.map((row, rank) => [row.index, rank]))
  const boostRank = new Map(byBoost.map((row, rank) => [row.index, rank]))
  return byBoost.map((row) => {
    const place = places[row.index]
    const moved = (boostRank.get(row.index) ?? row.index) < (baseRank.get(row.index) ?? row.index)
    return { ...place, prioritized: row.extra > 0 && moved }
  })
}
