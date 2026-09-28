import { NextResponse } from 'next/server'
import { getScoringWeights } from '@/lib/scoringSettings'

export const runtime = 'nodejs'

/** Public weights used by the map ranking (Scoring Lab). Short cache. */
export async function GET() {
  const weights = await getScoringWeights()
  const res = NextResponse.json(weights)
  res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  return res
}
