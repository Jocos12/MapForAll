import { NextRequest, NextResponse } from 'next/server'

const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const SERVER_KEY =
  process.env.GOOGLE_MAPS_SERVER_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  ''

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export async function POST(req: NextRequest) {
  if (!SERVER_KEY) {
    return NextResponse.json({ error: 'Server maps key not configured' }, { status: 500 })
  }

  const { origin, destination, travelMode } = await req.json()

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: travelMode ?? 'WALK',
    computeAlternativeRoutes: false,
    polylineQuality: 'HIGH_QUALITY',
    languageCode: 'en-US',
    units: 'METRIC',
  }

  const res = await fetch(ROUTES_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': SERVER_KEY,
      'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = await res.json()
  const route = data?.routes?.[0]
  if (!route) {
    return NextResponse.json({ error: 'No route found' }, { status: 404 })
  }

  const leg = route.legs?.[0] ?? {}
  const distanceMeters: number = leg.distanceMeters ?? 0
  const durationSeconds: number = parseInt((leg.duration ?? '0s').replace('s', ''), 10)
  const steps = Array.isArray(leg.steps)
    ? leg.steps
        .map((step: { distanceMeters?: number; staticDuration?: string; navigationInstruction?: { instructions?: string } }) => {
          const instruction = step.navigationInstruction?.instructions?.trim() ?? ''
          if (!instruction) return null
          const seconds = parseInt((step.staticDuration ?? '0s').replace('s', ''), 10)
          return {
            instruction,
            distance: formatDistance(step.distanceMeters ?? 0),
            duration: formatDuration(Number.isFinite(seconds) ? seconds : 0),
          }
        })
        .filter((step: { instruction: string } | null): step is { instruction: string; distance: string; duration: string } => !!step)
    : []

  return NextResponse.json({
    distance: formatDistance(distanceMeters),
    duration: formatDuration(durationSeconds),
    polyline: route.polyline?.encodedPolyline ?? '',
    steps,
  })
}
