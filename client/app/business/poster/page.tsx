'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, MapPin, Printer } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { CategoryIcon } from '@/components/CategoryIcon'
import { shareUrlFor } from '@/components/business/RecommendSection'
import { withPlace } from '@/components/business/types'

interface Loaded {
  place: { place_id: string; name: string; categories: string[]; address?: string } | null
  form?: { address: string; hours: string }
}

export default function BusinessPoster() {
  const { t } = useI18n()
  const [data, setData] = useState<Loaded | null>(null)
  const [qr, setQr] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    const placeId = new URLSearchParams(window.location.search).get('place')
    void fetch(withPlace('/api/business', placeId), { cache: 'no-store' })
      .then((res) => res.json())
      .then((json: Loaded) => {
        setData(json)
        if (!json.place) return
        const link = shareUrlFor(json.place.place_id)
        setUrl(link)
        return QRCode.toDataURL(link, { width: 900, margin: 1, color: { dark: '#1A1614', light: '#FFFFFF' } }).then(setQr)
      })
      .catch(() => setData({ place: null }))
  }, [])

  const place = data?.place

  return (
    <main className="h-dvh overflow-y-auto bg-[#EDE6DA] py-8 print:h-auto print:overflow-visible print:bg-white print:py-0">
      <style>{'@page { size: A4; margin: 0 } @media print { html, body { background: #fff } }'}</style>
      <div className="mx-auto mb-6 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <a href={withPlace('/business/dashboard', data?.place?.place_id)} className="inline-flex items-center gap-1.5 text-[13px] text-[#6E5B50] hover:text-[#E8672A]">
          <ArrowLeft size={15} />
          {t('biz.poster.back')}
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!qr}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#E8672A] px-5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Printer size={15} />
          {t('biz.poster.print')}
        </button>
      </div>

      <article className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] flex-col items-center justify-between bg-[#FBF3E7] px-[14mm] py-[16mm] text-center text-[#1A1614] shadow-xl print:shadow-none">
        <header className="flex flex-col items-center">
          <div className="flex items-center gap-2 text-[#E8672A]">
            <MapPin size={34} strokeWidth={2.2} />
            <span className="font-display text-[34px] font-semibold tracking-tight">MapForAll</span>
          </div>
          <p className="mt-1 text-[15px] tracking-wide text-[#6E5B50]">Ikarita ya Bose</p>
        </header>

        <div className="flex flex-col items-center">
          <h1 className="font-display text-[44px] font-semibold leading-[1.05] tracking-tight">{t('biz.poster.headline')}</h1>
          {place && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[20px] font-medium">
              <CategoryIcon categories={place.categories} className="h-5 w-5 text-[#E8672A]" />
              {place.name}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={t('biz.share.qrAlt')} className="h-[92mm] w-[92mm] rounded-2xl bg-white p-3" />
          ) : (
            <div className="h-[92mm] w-[92mm] rounded-2xl bg-white" />
          )}
          <p className="mt-4 text-[18px] font-medium">{t('biz.poster.scan')}</p>
          {url && <p className="mt-1 break-all font-mono text-[12px] text-[#6E5B50]">{url}</p>}
        </div>

        <footer className="text-[13px] leading-relaxed text-[#6E5B50]">
          {data?.form?.address && <p>{data.form.address}</p>}
          {data?.form?.hours && <p>{data.form.hours}</p>}
          <p className="mt-2 text-[#E8672A]">{t('biz.poster.footer')}</p>
        </footer>
      </article>
      {data && !place && <p className="mt-6 text-center text-[14px] text-[#6E5B50]">{t('business.empty')}</p>}
    </main>
  )
}
