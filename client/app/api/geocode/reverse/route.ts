import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Nominatim asks for ≤1 req/s; keep a tiny process-local gate. */
let lastNominatimAt = 0

/**
 * Reverse-geocode lat/lng via OpenStreetMap Nominatim (server-side so we can
 * send a proper User-Agent per their usage policy).
 */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get('lat'))
  const lng = Number(req.nextUrl.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'Invalid coordinates.' }, { status: 400 })
  }

  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  lastNominatimAt = Date.now()

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('zoom', '18')
  url.searchParams.set('addressdetails', '1')

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en,fr',
        'User-Agent': 'MapForAll/1.0 (business-onboarding; contact@mapforall.local)',
      },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    })
    if (!upstream.ok) {
      return NextResponse.json({ address: null, failed: true }, { status: 200 })
    }
    const data = (await upstream.json()) as {
      display_name?: string
      address?: Record<string, string>
    }
    const address = formatAddress(data) || data.display_name?.trim() || null
    return NextResponse.json({ address, failed: !address })
  } catch {
    return NextResponse.json({ address: null, failed: true }, { status: 200 })
  }
}

function formatAddress(data: { display_name?: string; address?: Record<string, string> }): string | null {
  const a = data.address
  if (!a) return null
  const road = a.road || a.pedestrian || a.path || a.neighbourhood || a.suburb
  const area = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village
  const city = a.city || a.town || a.municipality || a.county || 'Kigali'
  const parts = [road, area, city].filter((p, i, arr) => p && arr.indexOf(p) === i)
  return parts.length ? parts.join(', ') : null
}
