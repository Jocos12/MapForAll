import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const LANGS = ['fr', 'en', 'rw'] as const
const FIELDS = ['name', 'summary'] as const

const Query = z.object({
  q: z.string().max(120).optional(),
  incomplete: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
})

type LangContent = Record<string, { name?: string; summary?: string }>

function completeness(doc: Record<string, unknown>) {
  const baseName = typeof doc.name === 'string' ? doc.name.trim() : ''
  const baseSummary =
    (typeof doc.summary === 'string' && doc.summary.trim()) ||
    (typeof doc.description === 'string' && doc.description.trim()) ||
    ''
  const lang = (doc.lang_content ?? {}) as LangContent
  const perLang: Record<string, { name: boolean; summary: boolean; pct: number }> = {}
  let totalFields = 0
  let filled = 0
  for (const code of LANGS) {
    const entry = lang[code] ?? {}
    const nameOk = !!(entry.name?.trim() || (code === 'fr' && baseName))
    const sumOk = !!(entry.summary?.trim() || (code === 'fr' && baseSummary))
    const pct = Math.round(((nameOk ? 1 : 0) + (sumOk ? 1 : 0)) / 2 * 100)
    perLang[code] = { name: nameOk, summary: sumOk, pct }
    totalFields += 2
    filled += (nameOk ? 1 : 0) + (sumOk ? 1 : 0)
  }
  return { perLang, overall: totalFields ? Math.round((filled / totalFields) * 100) : 0 }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'translations' })
  if (!gate.ok) return gate.response

  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query.' }, { status: 400 })

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const filter: Record<string, unknown> = {}
    if (parsed.data.q) {
      filter.$or = [
        { name: { $regex: parsed.data.q, $options: 'i' } },
        { place_id: { $regex: parsed.data.q, $options: 'i' } },
      ]
    }
    const skip = (parsed.data.page - 1) * parsed.data.limit
    const rows = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter,
        projection: { name: 1, summary: 1, description: 1, place_id: 1, lang_content: 1, status: 1 },
        sort: { name: 1 },
        skip,
        limit: parsed.data.limit,
      }),
    )

    let items = rows.map((doc) => {
      const comp = completeness(doc)
      const lang = (doc.lang_content ?? {}) as LangContent
      return {
        place_id: String(doc.place_id ?? ''),
        name: String(doc.name ?? ''),
        status: String(doc.status ?? 'validated'),
        lang_content: lang,
        completeness: comp,
      }
    })

    if (parsed.data.incomplete === 'true') {
      items = items.filter((row) => row.completeness.overall < 100)
    }

    const res = NextResponse.json({
      langs: LANGS,
      fields: FIELDS,
      items,
      page: parsed.data.page,
      limit: parsed.data.limit,
    })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load translations.' }, { status: 500 })
  }
}
