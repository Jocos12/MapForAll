import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Demo health: model and region, plus whether the agent process answers. */
export async function GET() {
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash'
  const region = process.env.GOOGLE_CLOUD_LOCATION || process.env.GEMINI_LOCATION || 'global'
  const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash'
  const base = process.env.ADK_BASE_URL ?? 'http://localhost:8000'
  let agent: 'ok' | 'down' = 'down'
  try {
    const res = await fetch(`${base}/list-apps`, { signal: AbortSignal.timeout(1500) })
    agent = res.ok ? 'ok' : 'down'
  } catch {
    agent = 'down'
  }
  return NextResponse.json({ ok: agent === 'ok', model, region, fallback, agent })
}
