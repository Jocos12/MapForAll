import { sendMail } from '@/lib/mailer'
import {
  placeValidatedEmail,
  placeRejectedEmail,
  placeChangesEmail,
  mailLang,
  withAdminMailOverrides,
} from '@/lib/emailTemplates'
import { findUserById, setOwnedPlaces } from '@/lib/users'
import { buildSearchDocument, searchText } from '@/lib/searchIndex'
import { scheduleSearchEmbedding } from '@/lib/searchEmbed'

export async function notifyAuthorModeration(opts: {
  addedBy?: string
  placeName: string
  status: 'validated' | 'rejected' | 'changes_requested'
  reason: string
  appUrl: string
}): Promise<void> {
  if (!opts.addedBy) return
  const author = await findUserById(opts.addedBy).catch(() => null)
  if (!author?.email) return
  const lang = mailLang(author.lang ?? author.languages?.[0])
  const name = author.name ?? author.email.split('@')[0]
  const vars = { name, place: opts.placeName, reason: opts.reason }
  const base =
    opts.status === 'validated'
      ? placeValidatedEmail({ name, placeName: opts.placeName, lang, appUrl: opts.appUrl })
      : opts.status === 'changes_requested'
        ? placeChangesEmail({ name, placeName: opts.placeName, reason: opts.reason, lang, appUrl: opts.appUrl })
        : placeRejectedEmail({
            name,
            placeName: opts.placeName,
            reason: opts.reason,
            lang,
            appUrl: opts.appUrl,
          })
  const content = opts.status === 'changes_requested'
    ? base
    : await withAdminMailOverrides(opts.status === 'validated' ? 'validate' : 'reject', base, vars, lang)
  await sendMail(author.email, content)
}
export async function linkValidatedOwner(placeId: string, existing: Record<string, unknown>): Promise<void> {
  const { mcpCall, mcpConnected } = await import('@/lib/mcp')
  const sid = await mcpConnected()
  const fields = buildSearchDocument(existing)
  await mcpCall(sid, 'update-many', {
    database: process.env.MONGODB_DATABASE ?? 'hodari',
    collection: 'places',
    filter: { place_id: placeId },
    update: { $set: fields },
  }).catch(() => [])
  scheduleSearchEmbedding(placeId, searchText({ ...existing, ...fields }))
  const addedBy = typeof existing.owner_id === 'string' ? existing.owner_id : typeof existing.added_by === 'string' ? existing.added_by : ''
  if (!addedBy) return
  await mcpCall(sid, 'update-many', {
    database: process.env.MONGODB_DATABASE ?? 'hodari',
    collection: 'places',
    filter: { place_id: placeId, owner_id: { $in: [null, ''] } },
    update: { $set: { owner_id: addedBy } },
  }).catch(() => [])
  if (existing?.claimed_by_owner !== true && existing?.source !== 'owner_claimed') return
  const owner = await findUserById(addedBy)
  if (owner?.role === 'business_owner' && !owner.owned_place_ids.includes(placeId)) {
    await setOwnedPlaces(owner.user_id, [...owner.owned_place_ids, placeId])
  }
}
