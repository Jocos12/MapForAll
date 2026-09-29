import type { Place } from '@/lib/types'
import { hasStepFreeEntrance } from '@/lib/access'
import type { ScoringSettings } from '@/lib/adminSettings'

/** Scale 0–1 admin weights to rating bonus points (5★ scale). */
export const WEIGHT_SCALE = 10

export type ScoringWeights = Pick<ScoringSettings, 'local_bonus' | 'accessible_bonus'>

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  local_bonus: 0.15,
  accessible_bonus: 0.12,
}

export function inclusionBonus(
  place: Place,
  preferLocal: boolean,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  let points = 0
  const localW = weights.local_bonus * WEIGHT_SCALE
  const accessW = weights.accessible_bonus * WEIGHT_SCALE
  if (place.local_business) points += preferLocal ? localW : localW * 0.5
  if (place.accessible || hasStepFreeEntrance(place)) {
    points += accessW
    if (place.access?.toilet) points += accessW * 0.35
    if (place.access?.parking) points += accessW * 0.35
  }
  return points
}

export function scorePlace(
  place: Place,
  preferLocal: boolean,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  return (place.rating ?? 0) + inclusionBonus(place, preferLocal, weights)
}

export function sortPlacesByScore(
  places: Place[],
  preferLocal = false,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): Place[] {
  return [...places]
    .map((place, index) => ({ place, index, score: scorePlace(place, preferLocal, weights) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.place)
}

/**
 * Sort by rating + inclusion bonus. `prioritized` is true only when that
 * bonus moved the place above where rating alone would have put it.
 */
export function markPrioritized(
  places: Place[],
  preferLocal = false,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): Place[] {
  const rows = places.map((place, index) => ({
    index,
    base: place.rating ?? 0,
    extra: inclusionBonus(place, preferLocal, weights),
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

/** Share of top-K slots held by local vs formal businesses. */
export function visibilityShare(
  places: Place[],
  topK: number,
  preferLocal: boolean,
  weights: ScoringWeights,
): { local: number; formal: number; accessible: number } {
  const ranked = sortPlacesByScore(places, preferLocal, weights)
  const top = ranked.slice(0, topK)
  if (!top.length) return { local: 0, formal: 0, accessible: 0 }
  const local = top.filter((p) => p.local_business).length / top.length
  const accessible = top.filter((p) => p.accessible || hasStepFreeEntrance(p)).length / top.length
  return { local, formal: 1 - local, accessible }
}
