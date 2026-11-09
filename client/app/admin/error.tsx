'use client'

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-white/5">
      <p className="text-[15px] font-medium">This page could not be loaded.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-xl bg-[#E8672A] px-4 py-2 text-[13px] font-medium text-white"
      >
        Retry
      </button>
    </div>
  )
}
