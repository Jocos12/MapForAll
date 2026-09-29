import { NextRequest, NextResponse } from 'next/server'

import { z } from 'zod'

import { extractDocs, isMcpUnavailable, mcpCall, mcpConnected } from '@/lib/mcp'

import { requireAdmin, withSessionRefresh, type AdminActor } from '@/lib/adminAuth'

import { DB, toAdminPlace, withPhotoProxy } from '@/lib/adminPlaces'

import { linkValidatedOwner, notifyAuthorModeration } from '@/lib/adminPlaceModeration'

import { writeAudit } from '@/lib/audit'

import { cleanWeek } from '@/lib/hours'

import {

  PLACE_CATEGORIES,

  cleanPhotos,

  cleanText,

  writePlacePhotos,

} from '@/lib/places'

import { asId } from '@/lib/session'



export const runtime = 'nodejs'



const AccessSchema = z.object({

  entrance: z.boolean().optional(),

  toilet: z.boolean().optional(),

  parking: z.boolean().optional(),

})



const LangContentSchema = z.record(

  z.string().max(8),

  z.object({

    name: z.string().max(120).optional(),

    summary: z.string().max(400).optional(),

  }),

)



const PatchBody = z

  .object({

    name: z.string().min(2).max(120).optional(),

    categories: z.array(z.string().min(1).max(40)).min(1).max(4).optional(),

    latitude: z.number().min(-90).max(90).optional(),

    longitude: z.number().min(-180).max(180).optional(),

    hours: z.string().max(160).optional().nullable(),

    hours_week: z.unknown().optional().nullable(),

    local_business: z.boolean().optional(),

    accessible: z.boolean().optional(),

    access: AccessSchema.optional(),

    paused: z.boolean().optional(),

    photos: z.array(z.string()).max(4).optional(),

    lang_content: LangContentSchema.optional(),

    status: z.enum(['pending', 'validated', 'rejected', 'archived']).optional(),

    archived: z.boolean().optional(),

    rejection_reason: z.string().max(280).optional(),

  })

  .refine((body) => Object.keys(body).length > 0, { message: 'Empty update.' })



function appOrigin(req: NextRequest): string {

  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()

  if (env) return env.replace(/\/$/, '')

  return req.nextUrl.origin

}



async function findPlace(sid: string, placeId: string): Promise<Record<string, unknown> | null> {

  const doc = extractDocs(

    await mcpCall(sid, 'find', { database: DB, collection: 'places', filter: { place_id: placeId }, limit: 1 }),

  )[0]

  return doc ?? null

}



type RouteCtx = { params: Promise<{ id: string }> }



export async function GET(req: NextRequest, ctx: RouteCtx) {

  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-id-get' })

  if (!gate.ok) return gate.response

  let placeId: string

  try {

    placeId = asId((await ctx.params).id, 'id')

  } catch {

    return NextResponse.json({ error: 'Invalid place id.' }, { status: 400 })

  }

  try {

    const sid = await mcpConnected()

    const doc = await findPlace(sid, placeId)

    if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const place = toAdminPlace(doc)

    if (!place) return NextResponse.json({ error: 'Invalid place record.' }, { status: 500 })

    const res = NextResponse.json({ place: withPhotoProxy(place) })

    return withSessionRefresh(res, gate.refreshedCookie)

  } catch (err) {

    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })

    return NextResponse.json({ error: 'Could not load place.' }, { status: 500 })

  }

}



export async function PATCH(req: NextRequest, ctx: RouteCtx) {

  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-id-patch' })

  if (!gate.ok) return gate.response

  let placeId: string

  try {

    placeId = asId((await ctx.params).id, 'id')

  } catch {

    return NextResponse.json({ error: 'Invalid place id.' }, { status: 400 })

  }

  const raw = await req.json().catch(() => null)

  const parsed = PatchBody.safeParse(raw)

  if (!parsed.success) {

    return NextResponse.json({ error: 'Invalid payload.', details: parsed.error.flatten() }, { status: 400 })

  }

  const body = parsed.data

  if (body.categories) {

    for (const c of body.categories) {

      if (!PLACE_CATEGORIES.includes(c as (typeof PLACE_CATEGORIES)[number])) {

        return NextResponse.json({ error: 'Unknown category.' }, { status: 400 })

      }

    }

  }

  const photos = body.photos ? cleanPhotos(body.photos) : null

  if (body.photos && (!photos || photos.length !== body.photos.filter((u) => u.startsWith('data:image/')).length)) {

    return NextResponse.json({ error: 'Invalid photos.' }, { status: 400 })

  }



  try {

    const sid = await mcpConnected()

    const existing = await findPlace(sid, placeId)

    if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })



    const $set: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: gate.actor.uid }

    if (body.name !== undefined) $set.name = body.name.trim()

    if (body.categories !== undefined) $set.categories = body.categories

    if (body.latitude !== undefined && body.longitude !== undefined) {

      $set.location = { type: 'Point', coordinates: [body.longitude, body.latitude] }

    }

    if (body.hours !== undefined) $set.hours = body.hours

    if (body.hours_week !== undefined) $set.hours_week = cleanWeek(body.hours_week)

    if (body.local_business !== undefined) $set.local_business = body.local_business

    if (body.accessible !== undefined) $set.accessible = body.accessible

    if (body.access !== undefined) {

      $set.access = {

        entrance: body.access.entrance === true,

        toilet: body.access.toilet === true,

        parking: body.access.parking === true,

      }

    }

    if (body.paused !== undefined) $set.paused = body.paused

    if (body.lang_content !== undefined) $set.lang_content = body.lang_content

    if (body.archived === true || body.status === 'archived') {

      $set.archived = true

      $set.status = 'archived'

    } else if (body.status !== undefined) {

      $set.status = body.status

      $set.archived = false

    } else if (body.archived === false) {

      $set.archived = false

    }

    if (body.rejection_reason !== undefined) $set.rejection_reason = body.rejection_reason



    const prevStatus = typeof existing.status === 'string' ? existing.status : 'validated'

    await mcpCall(sid, 'update-many', {

      database: DB,

      collection: 'places',

      filter: { place_id: placeId },

      update: { $set },

    })

    if (photos?.length) {

      await writePlacePhotos((tool, args) => mcpCall(sid, tool, args), DB, placeId, photos)

    }



    const nextStatus = typeof $set.status === 'string' ? $set.status : prevStatus

    if (body.status === 'validated' && prevStatus !== 'validated') {

      await linkValidatedOwner(placeId, existing)

      await notifyAuthorModeration({

        addedBy: typeof existing.added_by === 'string' ? existing.added_by : undefined,

        placeName: typeof existing.name === 'string' ? existing.name : placeId,

        status: 'validated',

        reason: '',

        appUrl: appOrigin(req),

      })

    }

    if (body.status === 'rejected' && prevStatus !== 'rejected') {

      await notifyAuthorModeration({

        addedBy: typeof existing.added_by === 'string' ? existing.added_by : undefined,

        placeName: typeof existing.name === 'string' ? existing.name : placeId,

        status: 'rejected',

        reason: body.rejection_reason ?? '',

        appUrl: appOrigin(req),

      })

    }



    await writeAudit({

      actor: gate.actor,

      action: body.paused !== undefined ? 'place.pause' : 'place.update',

      targetType: 'place',

      targetId: placeId,

      before: { status: prevStatus, paused: existing.paused },

      after: $set,

    })



    const updated = await findPlace(sid, placeId)

    const place = updated ? toAdminPlace(updated) : null

    const res = NextResponse.json({ ok: true, place: place ? withPhotoProxy(place) : null })

    return withSessionRefresh(res, gate.refreshedCookie)

  } catch (err) {

    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })

    return NextResponse.json({ error: 'Could not update place.' }, { status: 500 })

  }

}



export async function DELETE(req: NextRequest, ctx: RouteCtx) {

  const gate = await requireAdmin(req, { minRole: 'moderator', rateKey: 'places-id-del' })

  if (!gate.ok) return gate.response

  let placeId: string

  try {

    placeId = asId((await ctx.params).id, 'id')

  } catch {

    return NextResponse.json({ error: 'Invalid place id.' }, { status: 400 })

  }

  try {

    const sid = await mcpConnected()

    const existing = await findPlace(sid, placeId)

    if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    await mcpCall(sid, 'update-many', {

      database: DB,

      collection: 'places',

      filter: { place_id: placeId },

      update: {

        $set: {

          archived: true,

          status: 'archived',

          archived_at: new Date().toISOString(),

          archived_by: gate.actor.uid,

        },

      },

    })

    await writeAudit({

      actor: gate.actor as AdminActor,

      action: 'place.delete',

      targetType: 'place',

      targetId: placeId,

      before: { status: existing.status },

      after: { archived: true },

    })

    const res = NextResponse.json({ ok: true, place_id: placeId, archived: true })

    return withSessionRefresh(res, gate.refreshedCookie)

  } catch (err) {

    if (isMcpUnavailable(err)) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })

    return NextResponse.json({ error: 'Could not archive place.' }, { status: 500 })

  }

}


