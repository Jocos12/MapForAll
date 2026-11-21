import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import ConnectRwandaLanding from '@/components/landing/ConnectRwandaLanding'

// Inter for body text, Space Grotesk for headlines (ConnectRwanda AI identity).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'ConnectRwanda AI · Mobilité intelligente et accessible',
  description: 'Navigation intelligente, bus en temps réel, assistant vocal et cartes accessibles au Rwanda : une plateforme IA de mobilité inclusive.',
}

export default function HomePage() {
  return (
    <div className={`${inter.variable} ${display.variable}`}>
      <ConnectRwandaLanding />
    </div>
  )
}
