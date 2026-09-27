import type { Place } from './types'

export interface AccessDetail {
  entrance: boolean
  toilet: boolean
  parking: boolean
  score: number
}

/** The badge is the step-free entrance. Older rows only have the boolean. */
export function accessDetail(place: Pick<Place, 'accessible' | 'access'>): AccessDetail {
  const entrance = place.access?.entrance ?? place.accessible === true
  const toilet = place.access?.toilet === true
  const parking = place.access?.parking === true
  const score = (entrance ? 1 : 0) + (toilet ? 1 : 0) + (parking ? 1 : 0)
  return { entrance, toilet, parking, score }
}

export function hasStepFreeEntrance(place: Pick<Place, 'accessible' | 'access'>): boolean {
  return accessDetail(place).entrance
}
