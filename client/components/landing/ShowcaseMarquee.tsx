'use client'

export type ShowcaseSlide = {
  src: string
  tag: string
  title: string
}

/** A touch-scroll row. It does not autoplay. */
export default function ShowcaseMarquee({ slides }: { slides: ShowcaseSlide[] }) {
  return (
    <div className="scrollbar-hide flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:gap-5 sm:px-8 lg:px-12">
      {slides.map((slide) => (
        <figure key={slide.src} className="group relative w-[78vw] max-w-[340px] shrink-0 snap-start overflow-hidden rounded-[28px] bg-[#1A1614] shadow-[0_18px_48px_-24px_rgba(90,40,10,0.4)] sm:w-[300px]">
          <img src={slide.src} alt="" draggable={false} loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(0.28,0.11,0.32,1)] group-hover:scale-105" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <figcaption className="absolute inset-x-0 bottom-0 p-5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#FFB285]">{slide.tag}</span>
            <span className="mt-1 block text-[19px] font-semibold leading-tight tracking-[-0.02em] text-white">{slide.title}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
