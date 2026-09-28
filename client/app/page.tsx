import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import MapForAllLanding from '@/components/landing/MapForAllLanding'

// Inter is the closest open font to Apple's SF Pro; the landing uses it for
// both headlines and body so the page reads like an iOS product page.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'MapForAll — Ikarita ya Bose',
  description: 'La carte qui rend visible ce que la ville oublie.',
}

export default function HomePage() {
  return (
    <div className={inter.variable}>
      <MapForAllLanding />
    </div>
  )
}
