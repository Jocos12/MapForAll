'use client'

import { KigaliLiveMap } from '@/components/landing/KigaliLiveMap'

/** Same live map, framed as the in-product result the pitch walks through. */
export default function DistrictMap({ bubble }: { bubble: string }) {
  return (
    <div className="relative isolate mx-auto h-[460px] w-full max-w-[440px] overflow-hidden rounded-2xl border border-black/10 bg-[#E7E2DA] dark:border-white/10 dark:bg-[#1A1816]">
      <KigaliLiveMap zoom={16} />
      <p className="absolute bottom-8 left-3 right-3 z-[500] rounded-xl border border-black/[0.06] bg-white px-4 py-3 text-[13px] font-medium text-[#1A1614] shadow-[0_8px_24px_rgba(26,22,20,0.08)] dark:border-white/10 dark:bg-[#1C1916] dark:text-gray-100">
        {bubble}
      </p>
    </div>
  )
}
