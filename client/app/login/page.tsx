import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import LoginView from '@/components/landing/LoginView'
import { isGoogleOAuthConfigured } from '@/lib/oauth'

export const dynamic = 'force-dynamic'

// Same typeface as the landing page (closest open font to Apple's SF Pro).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'Connexion — MapForAll',
  description: 'Connecte-toi pour chercher des lieux ou revendiquer ton commerce.',
}

export default function LoginPage() {
  return (
    <div className={inter.variable}>
      <LoginView googleEnabled={isGoogleOAuthConfigured()} />
    </div>
  )
}
