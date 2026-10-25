import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AdminShell } from '@/components/admin/AdminShell'
import { MotionFade } from '@/components/MotionFade'
import { ServiceUnavailable } from '@/components/ServiceUnavailable'
import { logSpan } from '@/lib/devTiming'
import { classifyCookie, resolveSessionDetailed, SESSION_COOKIE } from '@/lib/session'
import AdminLoading from './loading'
import 'leaflet/dist/leaflet.css'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const cookie = classifyCookie(token)
  if (!cookie.ok) {
    if (cookie.reason !== 'missing') console.info(`[session] logout reason=${cookie.reason}`)
    redirect('/login?expired=1')
  }
  if (cookie.payload.role === 'business_owner' || cookie.payload.role === 'client') redirect('/access-denied')
  const role = cookie.payload.role === 'moderator' ? 'moderator' : 'admin'
  return (
    <AdminShell actor={{ name: null, email: cookie.payload.email ?? '', role }}>
      <Suspense fallback={<AdminLoading />}>
        <AdminGate token={token!}>{children}</AdminGate>
      </Suspense>
    </AdminShell>
  )
}

async function AdminGate({ token, children }: { token: string; children: React.ReactNode }) {
  const started = Date.now()
  const verdict = await resolveSessionDetailed(token)
  if (!verdict.ok && verdict.kind === 'auth') {
    console.info(`[session] logout reason=${verdict.reason}`)
    redirect('/login?expired=1')
  }
  if (!verdict.ok) return <ServiceUnavailable />
  if (verdict.session.role !== 'admin' && verdict.session.role !== 'moderator') redirect('/access-denied')
  logSpan('page', '/admin layout', Date.now() - started)
  return <MotionFade>{children}</MotionFade>
}
