export default function PlacesLoading() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 pb-8" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/10" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-black/[0.06] dark:bg-white/10" />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/5">
        <div className="space-y-2 p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/10" />
          ))}
        </div>
      </div>
    </div>
  )
}
