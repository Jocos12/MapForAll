import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Billing — MapForAll',
  description: 'Manage your MapForAll credits and subscription.',
}

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return children
}
