/**
 * Back-office palette. Orange #E8672A is for fills, icons and the active item;
 * as text on white it misses WCAG AA, so orange text uses #C2410C instead.
 */
export const BIZ = {
  bg: 'bg-[#F7F7F8]',
  card: 'rounded-2xl border border-[#E4E4E7] bg-white',
  cardTitle: 'flex items-center gap-2 font-display text-[16px] font-semibold text-[#18181B]',
  muted: 'text-[#52525B]',
  focus: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8672A]',
  primary:
    'biz-primary inline-flex items-center justify-center gap-2 rounded-lg bg-[#1A1614] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#33291F] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8672A]',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-[#D4D4D8] bg-white px-3.5 text-[13px] font-medium text-[#18181B] transition-colors hover:border-[#E8672A] hover:text-[#C2410C] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8672A]',
  accentText: 'text-[#C2410C]',
  field:
    'w-full rounded-lg border border-[#D4D4D8] bg-white px-3.5 py-2.5 text-[14px] text-[#18181B] outline-none transition-colors placeholder:text-[#A1A1AA] focus:border-[#E8672A] focus:ring-2 focus:ring-[#E8672A]/20',
  label: 'mb-1.5 block text-[12.5px] font-medium text-[#3F3F46]',
} as const

export const GREEN = '#2E8B57'
export const ORANGE = '#E8672A'

/** Scroll container of the back-office pages (the global body never scrolls). */
export const BIZ_SCROLL_ID = 'biz-scroll'
export const BIZ_SCROLL = 'h-dvh overflow-y-auto'

export function scrollBizTop() {
  document.getElementById(BIZ_SCROLL_ID)?.scrollTo({ top: 0, behavior: 'smooth' })
}
