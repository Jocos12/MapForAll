import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'

export const runtime = 'nodejs'

const FILE = path.join(process.cwd(), '..', 'agents', 'hodari', 'config', 'query_expansions.json')

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'expansions-get' })
  if (!gate.ok) return gate.response
  try {
    const text = await readFile(FILE, 'utf8')
    return withSessionRefresh(NextResponse.json({ expansions: JSON.parse(text) }), gate.refreshedCookie)
  } catch {
    return NextResponse.json({ error: 'Could not read query expansions.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'expansions-put' })
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null) as { expansions?: unknown } | null
  const expansions = body?.expansions
  if (!expansions || typeof expansions !== 'object' || Array.isArray(expansions)) {
    return NextResponse.json({ error: 'Expected an object of term lists.' }, { status: 400 })
  }
  for (const value of Object.values(expansions)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return NextResponse.json({ error: 'Each category must be a list of words.' }, { status: 400 })
    }
  }
  await writeFile(FILE, `${JSON.stringify(expansions, null, 2)}\n`, 'utf8')
  return withSessionRefresh(NextResponse.json({ ok: true }), gate.refreshedCookie)
}
