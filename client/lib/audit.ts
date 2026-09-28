/**
 * Append-only admin audit log in MongoDB (`admin_audit`).
 */
import { mcpCall, mcpConnected } from '@/lib/mcp'
import type { AdminActor } from '@/lib/adminAuth'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COLLECTION = 'admin_audit'

export type AuditAction =
  | 'place.validate'
  | 'place.reject'
  | 'place.update'
  | 'place.delete'
  | 'place.pause'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.role_change'
  | 'user.suspend'
  | 'user.force_logout'
  | 'business.approve'
  | 'business.reject'
  | 'business.suspend'
  | 'business.revoke_badge'
  | 'report.resolve'
  | 'report.ignore'
  | 'report.disable_place'
  | 'review.hide'
  | 'review.delete'
  | 'category.update'
  | 'settings.update'
  | 'scoring.update'
  | 'demo.start'

export async function writeAudit(input: {
  actor: AdminActor
  action: AuditAction
  targetType: string
  targetId: string
  before?: unknown
  after?: unknown
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const sid = await mcpConnected()
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: COLLECTION,
      documents: [{
        audit_id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        actor_uid: input.actor.uid,
        actor_email: input.actor.email ?? null,
        actor_role: input.actor.role,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        before: input.before ?? null,
        after: input.after ?? null,
        meta: input.meta ?? null,
      }],
    })
  } catch (err) {
    console.error('[audit] write failed', err)
  }
}
