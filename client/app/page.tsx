import type { Metadata } from 'next'
import MapForAllLanding from '@/components/landing/MapForAllLanding'

export const metadata: Metadata = {
  title: 'MapForAll — Ikarita ya Bose',
  description: 'La carte qui rend visible ce que la ville oublie.',
}

export default function HomePage() {
  return <MapForAllLanding />
}
