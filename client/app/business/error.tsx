'use client'

import { useEffect } from 'react'
import { ServiceUnavailable } from '@/components/ServiceUnavailable'

export default function BusinessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[session] business page error', error)
  }, [error])
  return <ServiceUnavailable onRetry={reset} />
}
