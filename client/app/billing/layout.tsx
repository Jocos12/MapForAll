import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Billing — ConnectRwanda AI',
  description: 'Manage your ConnectRwanda AI credits and subscription.',
}

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return children
}
