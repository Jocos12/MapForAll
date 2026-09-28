/**
 * Inclusion scoring weights from admin_settings (Scoring Lab).
 * Cached ~30s so the public map stays snappy.
 */
import { getScoringSettings, invalidateAdminSettingsCache, type ScoringSettings } from '@/lib/adminSettings'
import type { ScoringWeights } from '@/lib/priority'
import { DEFAULT_SCORING_WEIGHTS } from '@/lib/priority'

export type { ScoringWeights }

export const SCORING_DEFAULTS: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS }

export type PublicScoringWeights = ScoringWeights & {
  confirmationThreshold: number
}

let cache: { at: number; value: PublicScoringWeights } | null = null
const TTL_MS = 30_000

export async function getScoringWeights(): Promise<PublicScoringWeights> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const doc: ScoringSettings = await getScoringSettings()
  const value: PublicScoringWeights = {
    local_bonus: doc.local_bonus,
    accessible_bonus: doc.accessible_bonus,
    confirmationThreshold: doc.confirmation_threshold,
  }
  cache = { at: Date.now(), value }
  return value
}

export function invalidateScoringCache() {
  cache = null
  invalidateAdminSettingsCache('scoring')
}
