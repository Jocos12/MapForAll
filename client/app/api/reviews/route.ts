import { NextRequest, NextResponse } from 'next/server'
import { mcpConnected, mcpCall, extractDocs } from '@/lib/mcp'
import { asId, getSession } from '@/lib/session'
import { findUserById } from '@/lib/users'
import { clientIp, rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const MAX_COMMENT = 400

type ReviewDoc = {
  placeId: string
  userId: string
  rating: number
  comment: string
  firstName: string
  createdAt: string
  updatedAt: string
  ownerReply?: string
  ownerReplyAt?: string
}

function firstNameOf(name: string | null | undefined, email?: string): string {
  const token = (name ?? '').trim().split(/\s+/)[0]
  if (token) return token.slice(0, 40)
  const local = (email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  return (local || 'Visiteur').slice(0, 40)
}

function asReview(doc: Record<string, unknown>): ReviewDoc | null {
  const placeId = typeof doc.placeId === 'string' ? doc.placeId : ''
  const userId = typeof doc.userId === 'string' ? doc.userId : ''
  const rating = typeof doc.rating === 'number' ? doc.rating : NaN
  if (!placeId || !userId || !Number.isFinite(rating)) return null
  const createdAt = typeof doc.createdAt === 'string' ? doc.createdAt : ''
  return {
    placeId,
    userId,
    rating,
    comment: typeof doc.comment === 'string' ? doc.comment : '',
    firstName: typeof doc.firstName === 'string' && doc.firstName ? doc.firstName : 'Visiteur',
    createdAt,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : createdAt,
    ownerReply: typeof doc.ownerReply === 'string' && doc.ownerReply ? doc.ownerReply : undefined,
    ownerReplyAt: typeof doc.ownerReplyAt === 'string' ? doc.ownerReplyAt : undefined,
  }
}

function publicReview(review: ReviewDoc, viewerId: string | null) {
  return {
    firstName: review.firstName,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    mine: viewerId != null && review.userId === viewerId,
    reply: review.ownerReply ? { text: review.ownerReply, at: review.ownerReplyAt ?? '' } : null,
  }
}

export async function GET(req: NextRequest) {
  let placeId = ''
  try {
    placeId = asId(req.nextUrl.searchParams.get('placeId'), 'placeId')
  } catch {
    return NextResponse.json({ error: 'Missing place.' }, { status: 400 })
  }

  try {
    const sid = await mcpConnected()
    const docs = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'reviews',
        filter: { placeId },
        sort: { updatedAt: -1 },
        limit: 50,
      }),
    )
    const reviews = docs.map(asReview).filter((row): row is ReviewDoc => !!row)
    reviews.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    const count = reviews.length
    const average = count ? Math.round((reviews.reduce((sum, row) => sum + row.rating, 0) / count) * 10) / 10 : null
    const viewerId = (await getSession(req))?.uid ?? null
    const mine = viewerId ? reviews.find((row) => row.userId === viewerId) ?? null : null
    return NextResponse.json({
      average,
      count,
      mine: mine ? { rating: mine.rating, comment: mine.comment } : null,
      reviews: reviews.map((row) => publicReview(row, viewerId)),
    })
  } catch (err) {
    console.error('[reviews GET]', err)
    return NextResponse.json({ average: null, count: 0, mine: null, reviews: [], unavailable: true })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Sign in to leave a review.' }, { status: 401 })
  if (!rateLimit(`reviews:${session.uid}:${clientIp(req)}`, { capacity: 12, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many reviews. Please wait a moment.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  let placeId = ''
  try {
    placeId = asId(body.placeId, 'placeId')
  } catch {
    return NextResponse.json({ error: 'Missing place.' }, { status: 400 })
  }
  const rating = typeof body.rating === 'number' ? Math.round(body.rating) : NaN
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5.' }, { status: 400 })
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, MAX_COMMENT) : undefined

  try {
    const user = await findUserById(session.uid)
    const firstName = firstNameOf(user?.name, session.email)
    const now = new Date().toISOString()
    const sid = await mcpConnected()
    const existing = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'reviews',
        filter: { placeId, userId: session.uid },
        limit: 1,
      }),
    ).map(asReview).find((row): row is ReviewDoc => !!row)

    const nextComment = comment ?? existing?.comment ?? ''
    if (existing) {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'reviews',
        filter: { placeId, userId: session.uid },
        update: { $set: { rating, comment: nextComment, firstName, updatedAt: now } },
      })
    } else {
      await mcpCall(sid, 'insert-many', {
        database: DB,
        collection: 'reviews',
        documents: [{
          placeId,
          userId: session.uid,
          rating,
          comment: nextComment,
          firstName,
          createdAt: now,
          updatedAt: now,
        }],
      })
    }
    return NextResponse.json({ ok: true, rating, comment: nextComment, firstName })
  } catch (err) {
    console.error('[reviews POST]', err)
    return NextResponse.json({ error: 'Could not save the review.' }, { status: 503 })
  }
}
