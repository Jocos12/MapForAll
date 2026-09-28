import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import {
  DB,
  coordsOf,
  matchesFilters,
  placeStatus,
  resolveSector,
  type PlacesListQuery,
} from '@/lib/adminPlaces'

export const runtime = 'nodejs'

const Query = z.object({
  status: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  local: z.enum(['0', '1']).optional(),
  accessible: z.enum(['0', '1']).optional(),
  sector: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
})

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-export' })
  if (!gate.ok) return gate.response
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })
  }
  const q = parsed.data
  const listQuery: PlacesListQuery = {
    status: q.status,
    category: q.category?.toLowerCase(),
    source: q.source,
    local: q.local === '1' ? true : undefined,
    accessible: q.accessible === '1' ? true : undefined,
    sector: q.sector,
    q: q.q?.trim().toLowerCase(),
    sort: 'created_desc',
    page: 1,
    limit: 5000,
  }
  try {
    const sid = await mcpConnected()
    const raw = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: {},
        projection: { photos: 0 },
        sort: { created_at: -1 },
        limit: 2000,
      }),
    ).filter((doc) => matchesFilters(doc, listQuery))

    const header = [
      'place_id',
      'name',
      'status',
      'categories',
      'latitude',
      'longitude',
      'sector',
      'address',
      'local_business',
      'accessible',
      'source',
      'paused',
      'created_at',
    ]
    const lines = [header.join(',')]
    for (const doc of raw) {
      const coords = coordsOf(doc)
      const cats = Array.isArray(doc.categories) ? doc.categories.filter((c): c is string => typeof c === 'string') : []
      const row = [
        String(doc.place_id ?? ''),
        String(doc.name ?? ''),
        placeStatus(doc),
        cats.join('|'),
        coords ? String(coords[1]) : '',
        coords ? String(coords[0]) : '',
        resolveSector(doc),
        String(doc.address ?? ''),
        doc.local_business === true ? '1' : '0',
        doc.accessible === true ? '1' : '0',
        String(doc.source ?? ''),
        doc.paused === true ? '1' : '0',
        String(doc.created_at ?? ''),
      ].map((cell) => csvEscape(cell))
      lines.push(row.join(','))
    }
    const csv = lines.join('\r\n')
    const res = new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mapforall-places.csv"',
      },
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 })
  }
}
