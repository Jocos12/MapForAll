import { sendMail } from '@/lib/mailer'
import {
  placeValidatedEmail,
  placeRejectedEmail,
  mailLang,
  withAdminMailOverrides,
} from '@/lib/emailTemplates'
import { findUserById, setOwnedPlaces } from '@/lib/users'

export async function notifyAuthorModeration(opts: {
  addedBy?: string
  placeName: string
  status: 'validated' | 'rejected'
  reason: string
  appUrl: string
}): Promise<void> {
  if (!opts.addedBy) return
  const author = await findUserById(opts.addedBy).catch(() => null)
  if (!author?.email) return
  const lang = mailLang(author.languages?.[0])
  const name = author.name ?? author.email.split('@')[0]
  const vars = { name, place: opts.placeName, reason: opts.reason }
  const base =
    opts.status === 'validated'
      ? placeValidatedEmail({ name, placeName: opts.placeName, lang, appUrl: opts.appUrl })
      : placeRejectedEmail({
          name,
          placeName: opts.placeName,
          reason: opts.reason,
          lang,
          appUrl: opts.appUrl,
        })
  const content = await withAdminMailOverrides(
    opts.status === 'validated' ? 'validate' : 'reject',
    base,
    vars,
    lang,
  )
  await sendMail(author.email, content)
}
export async function linkValidatedOwner(placeId: string, existing: Record<string, unknown>): Promise<void> {
  if (existing?.claimed_by_owner !== true || typeof existing.added_by !== 'string') return
  const owner = await findUserById(existing.added_by)
  if (owner?.role === 'business_owner' && !owner.owned_place_ids.includes(placeId)) {
    await setOwnedPlaces(owner.user_id, [...owner.owned_place_ids, placeId])
  }
}
