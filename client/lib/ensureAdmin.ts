/**
 * Bootstrap an admin account from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 * Never hard-code credentials. Used by seed:demo and optional startup hooks.
 */
import { hashPassword, isValidEmail } from '@/lib/password'
import { extractDocs, mcpCall, mcpConnected } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export async function ensureAdminFromEnv(): Promise<{ created: boolean; email: string } | null> {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? ''
  if (!email || !password || !isValidEmail(email)) return null

  const sid = await mcpConnected()
  const existing = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { email },
      limit: 1,
    }),
  )[0]

  const now = new Date().toISOString()
  if (!existing) {
    const user_id = `admin_${Date.now().toString(36)}`
    await mcpCall(sid, 'insert-many', {
      database: DB,
      collection: 'users',
      documents: [
        {
          user_id,
          email,
          name: 'Admin MapForAll',
          password_hash: hashPassword(password),
          role: 'admin',
          status: 'active',
          token_version: 0,
          email_verified: true,
          languages: ['fr', 'en', 'rw'],
          lang: 'fr',
          budget_tier: 'moderate',
          home_country: 'RW',
          created_at: now,
          last_active_at: now,
        },
      ],
    })
    return { created: true, email }
  }

  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { email },
    update: {
      $set: {
        role: 'admin',
        status: 'active',
        password_hash: hashPassword(password),
        email_verified: true,
      },
    },
  })
  return { created: false, email }
}
