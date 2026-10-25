import { NextResponse } from 'next/server'
import { slowestSpans } from '@/lib/devTiming'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Dev-only snapshot of the slowest spans recorded in this process. */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return NextResponse.json({ slowest: slowestSpans() })
}
