/**
 * Idempotent Mongo indexes for admin list/aggregate hot paths.
 * Best-effort: failures must never break a request.
 */
import { mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

let started = false

const SPECS: { collection: string; name: string; keys: Record<string, 1 | -1 | '2dsphere' | 'text'>; unique?: boolean; expireAfterSeconds?: number }[] = [
  { collection: 'places', name: 'admin_places_status_created', keys: { status: 1, created_at: -1 } },
  { collection: 'places', name: 'places_owner_id', keys: { owner_id: 1 } },
  { collection: 'places', name: 'places_place_id', keys: { place_id: 1 } },
  { collection: 'places', name: 'places_sector', keys: { sector: 1 } },
  { collection: 'places', name: 'places_location_2dsphere', keys: { location: '2dsphere' } },
  { collection: 'places', name: 'places_text_search', keys: { name: 'text', description: 'text', tags: 'text' } },
  { collection: 'places', name: 'admin_places_category', keys: { categories: 1 } },
  { collection: 'places', name: 'admin_places_local_access', keys: { local_business: 1, accessible: 1 } },
  { collection: 'places', name: 'admin_places_source', keys: { source: 1, status: 1 } },
  { collection: 'users', name: 'admin_users_role_status', keys: { role: 1, status: 1 } },
  { collection: 'users', name: 'admin_users_created', keys: { created_at: -1 } },
  { collection: 'users', name: 'users_user_id_unique', keys: { user_id: 1 } },
  { collection: 'users', name: 'users_email_unique', keys: { email: 1 }, unique: true },
  { collection: 'sessions', name: 'sessions_id_expiry', keys: { session_id: 1, expires_at: 1 } },
  { collection: 'employees', name: 'employees_place_date', keys: { place_id: 1, updated_at: -1 } },
  { collection: 'attendance_events', name: 'attendance_place_date', keys: { place_id: 1, date: -1 } },
  { collection: 'place_reports', name: 'admin_reports_status_created', keys: { status: 1, created_at: -1 } },
  { collection: 'admin_audit', name: 'admin_audit_at', keys: { at: -1 } },
  { collection: 'reviews', name: 'admin_reviews_created', keys: { createdAt: -1 } },
  { collection: 'search_logs', name: 'search_logs_at', keys: { at: -1 } },
  { collection: 'search_logs', name: 'search_logs_day', keys: { day: -1 } },
  { collection: 'place_stats_daily', name: 'stats_place_day', keys: { placeId: 1, day: 1 }, unique: true },
  { collection: 'place_view_events', name: 'view_events_place_visitor', keys: { placeId: 1, visitorHash: 1, at: -1 } },
  { collection: 'place_view_events', name: 'view_events_ttl', keys: { at: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 },
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
            ...(spec.unique ? { unique: true } : {}),
            ...(spec.expireAfterSeconds ? { expireAfterSeconds: spec.expireAfterSeconds } : {}),
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
