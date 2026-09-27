import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAdminEmail } from '@/lib/places'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { findUserById } from '@/lib/users'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const session = verifySession(jar.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login')
  if (isAdminEmail(session.email)) return children
  const user = await findUserById(session.uid).catch(() => null)
  if (user?.role === 'admin') return children
  redirect('/chat')
}
