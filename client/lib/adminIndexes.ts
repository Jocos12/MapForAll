/**
 * Idempotent Mongo indexes for admin list/aggregate hot paths.
 * Best-effort: failures must never break a request.
 */
import { mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

let started = false

const SPECS: { collection: string; name: string; keys: Record<string, 1 | -1> }[] = [
  { collection: 'places', name: 'admin_places_status_created', keys: { status: 1, created_at: -1 } },
  { collection: 'places', name: 'admin_places_category', keys: { categories: 1 } },
  { collection: 'places', name: 'admin_places_local_access', keys: { local_business: 1, accessible: 1 } },
  { collection: 'places', name: 'admin_places_source', keys: { source: 1, status: 1 } },
  { collection: 'users', name: 'admin_users_role_status', keys: { role: 1, status: 1 } },
  { collection: 'users', name: 'admin_users_created', keys: { created_at: -1 } },
  { collection: 'users', name: 'users_user_id_unique', keys: { user_id: 1 } },
  { collection: 'users', name: 'users_email_unique', keys: { email: 1 } },
  { collection: 'place_reports', name: 'admin_reports_status_created', keys: { status: 1, created_at: -1 } },
  { collection: 'admin_audit', name: 'admin_audit_at', keys: { at: -1 } },
  { collection: 'reviews', name: 'admin_reviews_created', keys: { createdAt: -1 } },
  { collection: 'search_logs', name: 'search_logs_at', keys: { at: -1 } },
  { collection: 'search_logs', name: 'search_logs_day', keys: { day: -1 } },
]

export function ensureAdminIndexes(): void {
  if (started) return
  started = true
  void (async () => {
    try {
      const sid = await mcpConnected()
      for (const spec of SPECS) {
        try {
          await mcpCall(sid, 'create-index', {
            database: DB,
            collection: spec.collection,
            name: spec.name,
            keys: spec.keys,
          })
        } catch (err) {
          console.warn(`[admin] create-index ${spec.collection}.${spec.name} failed (non-fatal)`, err)
        }
      }
    } catch (err) {
      console.warn('[admin] ensureAdminIndexes skipped', err)
    }
  })()
}
