import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import LoginView from '@/components/landing/LoginView'
import { isGoogleOAuthConfigured } from '@/lib/oauth'
import './path-paper.css'

export const dynamic = 'force-dynamic'

const fraunces = Fraunces({ subsets: ['latin'], axes: ['SOFT', 'opsz'], variable: '--font-fraunces', display: 'swap' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'Connexion — MapForAll',
  description: 'Connecte-toi pour chercher des lieux ou revendiquer ton commerce.',
}

export default function LoginPage() {
  return (
    <div className={`${fraunces.variable} ${inter.variable}`}>
      <LoginView googleEnabled={isGoogleOAuthConfigured()} />
    </div>
  )
}
