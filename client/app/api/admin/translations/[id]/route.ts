import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import { isMcpUnavailable, extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

export const runtime = 'nodejs'

const LangPatch = z.object({
  lang: z.enum(['fr', 'en', 'rw']),
  field: z.enum(['name', 'summary']),
  value: z.string().max(2000),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'translations-patch' })
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  const body = LangPatch.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  try {
    const sid = await mcpConnected()
    const DB = process.env.MONGODB_DATABASE ?? 'hodari'
    const existing = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'places',
        filter: { place_id: id },
        limit: 1,
      }),
    )
    if (!existing.length) return NextResponse.json({ error: 'Place not found.' }, { status: 404 })

    const doc = existing[0] as Record<string, unknown>
    const langContent = { ...((doc.lang_content ?? {}) as Record<string, Record<string, string>>) }
    const entry = { ...(langContent[body.data.lang] ?? {}) }
    entry[body.data.field] = body.data.value.trim()
    langContent[body.data.lang] = entry

    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'places',
      filter: { place_id: id },
      update: { $set: { lang_content: langContent, updated_at: new Date().toISOString() } },
    })

    await writeAudit({
      actor: gate.actor,
      action: 'place.update',
      targetType: 'place',
      targetId: id,
      after: { lang: body.data.lang, field: body.data.field },
      meta: { translation: true },
    })

    const res = NextResponse.json({ ok: true, lang_content: langContent })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save translation.' }, { status: 500 })
  }
}
