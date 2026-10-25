import { NextRequest, NextResponse } from 'next/server'

const KEY =
  process.env.GOOGLE_MAPS_SERVER_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  ''

export async function GET(req: NextRequest) {
  if (!KEY) {
    return NextResponse.json({ error: 'Maps key not configured' }, { status: 500 })
  }

  const ref = req.nextUrl.searchParams.get('ref')
  const urlParam = req.nextUrl.searchParams.get('url')
  const name = req.nextUrl.searchParams.get('name')

  let fetchUrl: string | null = null
  const headers: Record<string, string> = {}
  if (name && /^places\/[^/?#]+\/photos\/[^/?#]+$/.test(name)) {
    fetchUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&maxHeightPx=800`
    headers['X-Goog-Api-Key'] = KEY
  } else if (ref) {
    fetchUrl =
      `https://maps.googleapis.com/maps/api/place/photo` +
      `?maxwidth=960&photo_reference=${encodeURIComponent(ref)}&key=${KEY}`
  } else if (urlParam) {
    fetchUrl = decodeURIComponent(urlParam)
  }

  if (!fetchUrl) {
    return NextResponse.json({ error: 'ref or url required' }, { status: 400 })
  }

  const res = await fetch(fetchUrl, { redirect: 'follow', headers })
  if (!res.ok) {
    return NextResponse.json({ error: 'Photo unavailable' }, { status: res.status })
  }

  const bytes = await res.arrayBuffer()
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
