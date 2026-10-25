import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { MotionFade } from '@/components/MotionFade'
import { ServiceUnavailable } from '@/components/ServiceUnavailable'
import { logSpan } from '@/lib/devTiming'
import { classifyCookie, resolveSessionDetailed, SESSION_COOKIE } from '@/lib/session'
import BusinessLoading from './loading'

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const cookie = classifyCookie(token)
  if (!cookie.ok) {
    if (cookie.reason !== 'missing') console.info(`[session] logout reason=${cookie.reason}`)
    redirect('/login?expired=1')
  }
  if (cookie.payload.role && cookie.payload.role !== 'business_owner') redirect('/access-denied?area=business')
  return (
    <Suspense fallback={<BusinessLoading />}>
      <BusinessGate token={token!}>{children}</BusinessGate>
    </Suspense>
  )
}

async function BusinessGate({ token, children }: { token: string; children: React.ReactNode }) {
  const started = Date.now()
  const verdict = await resolveSessionDetailed(token)
  if (!verdict.ok && verdict.kind === 'auth') {
    console.info(`[session] logout reason=${verdict.reason}`)
    redirect('/login?expired=1')
  }
  if (!verdict.ok) return <ServiceUnavailable />
  if (verdict.session.role && verdict.session.role !== 'business_owner') redirect('/access-denied?area=business')
  logSpan('page', '/business layout', Date.now() - started)
  return <MotionFade>{children}</MotionFade>
}
