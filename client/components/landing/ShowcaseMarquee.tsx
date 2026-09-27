'use client'

export type ShowcaseSlide = {
  src: string
  tag: string
  title: string
}

/** A touch-scroll row. It does not autoplay. */
export default function ShowcaseMarquee({ slides }: { slides: ShowcaseSlide[] }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:gap-5 sm:px-8 lg:px-12">
      {slides.map((slide) => (
        <figure key={slide.src} className="w-[78vw] max-w-[320px] shrink-0 snap-start overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#1C1916] sm:w-[280px]">
          <img src={slide.src} alt="" draggable={false} loading="lazy" className="aspect-[4/5] w-full object-cover" />
          <figcaption className="px-4 py-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#E8672A]">{slide.tag}</span>
            <span className="mt-1 block text-[15px] font-semibold text-[#1A1614] dark:text-gray-100">{slide.title}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
