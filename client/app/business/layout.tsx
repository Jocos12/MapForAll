import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { findUserById } from '@/lib/users'

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const session = verifySession(jar.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login')
  const user = await findUserById(session.uid).catch(() => null)
  if (user?.role !== 'business_owner') redirect('/login')
  return children
}
