import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/admin/AdminShell'
import { resolveStaff } from '@/lib/adminAuth'
import { SESSION_COOKIE, resolveSessionToken } from '@/lib/session'
import { findUserById } from '@/lib/users'
import 'leaflet/dist/leaflet.css'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const session = await resolveSessionToken(jar.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login?expired=1')

  const staff = await resolveStaff(session.uid, session.email)
  if (!staff) redirect('/access-denied')

  const user = await findUserById(session.uid).catch(() => null)
  return (
    <AdminShell
      actor={{
        name: user?.name ?? null,
        email: session.email ?? user?.email ?? '',
        role: staff,
      }}
    >
      {children}
    </AdminShell>
  )
}
