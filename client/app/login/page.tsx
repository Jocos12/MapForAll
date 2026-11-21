import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import AuthView from '@/components/landing/AuthView'
import { isGoogleOAuthConfigured } from '@/lib/oauth'
import { warmMailer } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'Connexion · ConnectRwanda AI',
  description: 'Connectez-vous ou créez votre compte ConnectRwanda AI.',
}

export default function LoginPage() {
  warmMailer()
  return (
    <div className={`${inter.variable} ${display.variable}`}>
      <AuthView googleEnabled={isGoogleOAuthConfigured()} />
    </div>
  )
}
