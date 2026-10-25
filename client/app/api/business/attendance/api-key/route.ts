import { NextRequest, NextResponse } from 'next/server'
import { extractDocs, isMcpUnavailable, mcpCall } from '@/lib/mcp'
import { DB, requestedPlace, resolveOwnedPlace } from '@/lib/business'
import { getSession } from '@/lib/session'
import { PLACE_KEYS, ensureTeamIndexes, invalidateApiKeyCache, mintApiKey } from '@/lib/team'

/** Show whether this place has an RFID device key (never returns the secret). */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()

  try {
    const row = extractDocs(await mcpCall(sid, 'find', {
      database: DB,
      collection: PLACE_KEYS,
      filter: { place_id: placeId },
      projection: { _id: 0, key_prefix: 1, created_at: 1 },
      limit: 1,
    }))[0]
    return NextResponse.json({
      configured: !!row,
      prefix: typeof row?.key_prefix === 'string' ? row.key_prefix : null,
      created_at: typeof row?.created_at === 'string' ? row.created_at : null,
      endpoint: '/api/business/attendance/scan',
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not load API key.' }, { status: 500 })
  }
}

/** Generate or rotate the per-place RFID API key. Plaintext returned once. */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  const result = await resolveOwnedPlace(session.uid, requestedPlace(req.nextUrl))
  if (!result.ok) return result.response
  const { sid, placeId } = result.owned
  void ensureTeamIndexes()

  try {
    const { raw, hash, prefix } = mintApiKey()
    const now = new Date().toISOString()
    await mcpCall(sid, 'delete-many', {
      database: DB,
      collection: PLACE_KEYS,
      filter: { place_id: placeId },
    })
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: PLACE_KEYS,
      documents: [{ place_id: placeId, key_hash: hash, key_prefix: prefix, created_at: now }],
    })
    invalidateApiKeyCache(placeId)
    return NextResponse.json({
      ok: true,
      apiKey: raw,
      prefix,
      created_at: now,
      endpoint: '/api/business/attendance/scan',
      hint: 'Copy this key now — it will not be shown again. Put it in firmware/dumpInfo/config.h as RFID_API_KEY (header X-RFID-API-KEY).',
    })
  } catch (err) {
    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    return NextResponse.json({ error: 'Could not create API key.' }, { status: 500 })
  }
}
