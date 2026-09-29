import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { DB, categoryOk, coordsOf, normalizePlaceName, metersBetween, DUPLICATE_METERS } from '@/lib/adminPlaces'
import { writeAudit } from '@/lib/audit'
import { PLACE_CATEGORIES } from '@/lib/places'

export const runtime = 'nodejs'

const CsvRow = z.object({
  place_id: z.string().max(200).optional(),
  name: z.string().min(2).max(120),
  category: z.string().min(1).max(40).optional(),
  categories: z.union([z.string(), z.array(z.string())]).optional(),
  latitude: z.union([z.number(), z.string()]),
  longitude: z.union([z.number(), z.string()]),
  address: z.string().max(200).optional(),
  local_business: z.union([z.boolean(), z.string()]).optional(),
  accessible: z.union([z.boolean(), z.string()]).optional(),
  status: z.enum(['pending', 'validated', 'rejected']).optional(),
  source: z.string().max(40).optional(),
})

const GeoFeature = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.record(z.string(), z.unknown()).optional(),
})

const Body = z.object({
  format: z.enum(['csv', 'geojson']),
  rows: z.array(z.unknown()).min(1).max(500),
  dryRun: z.boolean().optional().default(false),
})

function parseBool(v: unknown): boolean {
  return v === true || v === '1' || v === 'true' || v === 'yes'
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function rowCategory(row: z.infer<typeof CsvRow>): string {
  if (row.category && categoryOk(row.category)) return row.category
  if (typeof row.categories === 'string') {
    const first = row.categories.split('|')[0]?.trim().toLowerCase()
    if (first && categoryOk(first)) return first
  }
  if (Array.isArray(row.categories) && row.categories[0] && categoryOk(row.categories[0])) return row.categories[0]
  return 'other'
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'places-import' })
  if (!gate.ok) return gate.response
  const raw = await req.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.', details: parsed.error.flatten() }, { status: 400 })
  }
  const { format, rows, dryRun } = parsed.data

  const normalized: Array<{
    index: number
    ok: boolean
    errors: string[]
    doc?: Record<string, unknown>
    duplicate_of?: string
  }> = []

  let existing: Record<string, unknown>[] = []
  try {
    const sid = await mcpConnected()
    existing = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: {},
        projection: { name: 1, place_id: 1, location: 1 },
        limit: 2000,
      }),
    )

    for (let index = 0; index < rows.length; index += 1) {
      const errors: string[] = []
      let rowInput = rows[index]
      if (format === 'geojson') {
        const feat = GeoFeature.safeParse(rowInput)
        if (!feat.success) {
          normalized.push({ index, ok: false, errors: ['invalid_geojson_feature'] })
          continue
        }
        const props = feat.data.properties ?? {}
        rowInput = {
          name: props.name,
          category: props.category,
          latitude: feat.data.geometry.coordinates[1],
          longitude: feat.data.geometry.coordinates[0],
          address: props.address,
          local_business: props.local_business,
          accessible: props.accessible,
          status: props.status,
          source: props.source,
          place_id: props.place_id,
        }
      }
      const row = CsvRow.safeParse(rowInput)
      if (!row.success) {
        normalized.push({ index, ok: false, errors: ['invalid_row'] })
        continue
      }
      const lat = num(row.data.latitude)
      const lng = num(row.data.longitude)
      if (lat == null || lng == null) errors.push('invalid_coordinates')
      const cat = rowCategory(row.data)
      if (!PLACE_CATEGORIES.includes(cat as (typeof PLACE_CATEGORIES)[number])) errors.push('invalid_category')
      const name = row.data.name.trim()
      if (name.length < 2) errors.push('invalid_name')

      let duplicate_of: string | undefined
      if (lat != null && lng != null) {
        const norm = normalizePlaceName(name)
        for (const doc of existing) {
          if (typeof doc.name !== 'string') continue
          if (normalizePlaceName(doc.name) !== norm) continue
          const c = coordsOf(doc)
          if (!c) continue
          if (metersBetween([lng, lat], c) <= DUPLICATE_METERS) {
            duplicate_of = String(doc.place_id)
            errors.push('possible_duplicate')
            break
          }
        }
      }

      const placeId =
        row.data.place_id?.trim() ||
        `imp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const doc: Record<string, unknown> = {
        place_id: placeId,
        name,
        city: 'Kigali',
        country: 'Rwanda',
        categories: [cat],
        description: name,
        address: row.data.address?.trim() || null,
        location: lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined,
        local_business: parseBool(row.data.local_business),
        accessible: parseBool(row.data.accessible),
        access: { entrance: parseBool(row.data.accessible), toilet: false, parking: false },
        status: row.data.status ?? 'validated',
        source: row.data.source ?? 'import',
        paused: false,
        archived: false,
        created_at: new Date().toISOString(),
        added_by: gate.actor.uid,
        views: 0,
      }
      normalized.push({
        index,
        ok: errors.length === 0,
        errors,
        doc: errors.length === 0 ? doc : undefined,
        duplicate_of,
      })
    }

    if (!dryRun) {
      const toInsert = normalized.filter((r) => r.ok && r.doc).map((r) => r.doc!)
      if (toInsert.length) {
        await mcpCall(sid, 'insert-many', { database: DB, collection: 'places', documents: toInsert })
        await writeAudit({
          actor: gate.actor,
          action: 'place.update',
          targetType: 'place',
          targetId: 'import',
          meta: { count: toInsert.length },
        })
      }
    }

    const res = NextResponse.json({
      ok: true,
      dryRun,
      summary: {
        total: normalized.length,
        valid: normalized.filter((r) => r.ok).length,
        invalid: normalized.filter((r) => !r.ok).length,
      },
      rows: normalized.map(({ doc, ...rest }) => rest),
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Import failed.' }, { status: 500 })
  }
}
