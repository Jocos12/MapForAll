import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { DM_Mono, Outfit, Playfair_Display } from 'next/font/google'
import { I18nProvider, type Lang } from '@/components/I18nProvider'
import './globals.css'

// Self-hosted by next/font at build time: no blocking request to Google on page load.
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['400', '600', '700'], style: ['normal', 'italic'], variable: '--font-playfair', display: 'swap' })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--font-dm-mono', display: 'swap' })
const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-outfit', display: 'swap' })

export const metadata: Metadata = {
  title: 'ConnectRwanda AI',
  description: 'Bus en temps réel, commerces locaux et lieux accessibles au Rwanda — une plateforme IA de mobilité inclusive.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0C0C0E',
  width: 'device-width',
  initialScale: 1,
  // Stops iOS Safari's zoom-on-input-focus (inputs also use >=16px font on
  // mobile). Pinch-zoom stays available on Android; iOS treats this as a
  // focus-zoom opt-out.
  maximumScale: 1,
  // Draw under the notch/home indicator; padding uses env(safe-area-inset-*).
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const saved = jar.get('hodari_lang')?.value
  const lang: Lang = saved === 'en' || saved === 'rw' || saved === 'fr' ? saved : 'fr'
  return (
    <html lang={lang} suppressHydrationWarning className={`${playfair.variable} ${dmMono.variable} ${outfit.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=document.documentElement.classList,p=location.pathname,t=localStorage.getItem('hodari_theme');if(t==='dark'&&p.indexOf('/business')!==0)c.add('dark');else c.remove('dark');if(p.indexOf('/business/dashboard')===0&&localStorage.getItem('hodari_biz_theme')==='dark')c.add('biz-dark');else c.remove('biz-dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans bg-bg text-text antialiased">
        <I18nProvider initialLang={lang}>{children}</I18nProvider>
      </body>
    </html>
  )
}
