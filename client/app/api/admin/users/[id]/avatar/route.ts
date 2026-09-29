import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin, withSessionRefresh } from '@/lib/adminAuth'
import { writeAudit } from '@/lib/audit'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME,
  deleteAvatarFiles,
  parseDataUrl,
  saveAvatarBuffer,
} from '@/lib/adminAvatar'
import { readUserDocRaw, updateAdminUser } from '@/lib/adminUsers'

export const runtime = 'nodejs'

const JsonBody = z.object({
  image_base64: z.string().min(20).max(3_000_000),
})

type RouteCtx = { params: Promise<{ id: string }> }

async function saveFromBuffer(userId: string, mime: string, buffer: Buffer) {
  const url = await saveAvatarBuffer(userId, mime, buffer)
  const user = await updateAdminUser(userId, { avatar_url: url })
  return { url, user }
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-avatar' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params

  const existing = await readUserDocRaw(id)
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const contentType = req.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Missing file.' }, { status: 400 })
      }
      if (!AVATAR_MIME.has(file.type)) {
        return NextResponse.json({ error: 'Invalid image type.' }, { status: 400 })
      }
      if (file.size > AVATAR_MAX_BYTES) {
        return NextResponse.json({ error: 'Image too large (max 2 MB).' }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const { url, user } = await saveFromBuffer(id, file.type, buffer)
      await writeAudit({
        actor: gate.actor,
        action: 'user.update',
        targetType: 'user',
        targetId: id,
        meta: { avatar: url },
      })
      const res = NextResponse.json({ avatar_url: url, user })
      return withSessionRefresh(res, gate.refreshedCookie)
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
    }
    const parsed = JsonBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
    }
    const img = parseDataUrl(parsed.data.image_base64)
    if (!img) return NextResponse.json({ error: 'Invalid image data.' }, { status: 400 })
    const { url, user } = await saveFromBuffer(id, img.mime, img.buffer)
    await writeAudit({
      actor: gate.actor,
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      meta: { avatar: url },
    })
    const res = NextResponse.json({ avatar_url: url, user })
    return withSessionRefresh(res, gate.refreshedCookie)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'too_large') return NextResponse.json({ error: 'Image too large (max 2 MB).' }, { status: 400 })
    if (msg === 'invalid_mime') return NextResponse.json({ error: 'Invalid image type.' }, { status: 400 })
    return NextResponse.json({ error: 'Could not save avatar.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdmin(req, { minRole: 'admin', rateKey: 'users-avatar-del' })
  if (!gate.ok) return gate.response
  const { id } = await ctx.params

  const existing = await readUserDocRaw(id)
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  await deleteAvatarFiles(id)
  const user = await updateAdminUser(id, { avatar_url: null })
  await writeAudit({
    actor: gate.actor,
    action: 'user.update',
    targetType: 'user',
    targetId: id,
    meta: { avatar_removed: true },
  })
  const res = NextResponse.json({ ok: true, user })
  return withSessionRefresh(res, gate.refreshedCookie)
}
