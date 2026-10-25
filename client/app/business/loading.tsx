import { Skeleton } from '@/components/ui/Skeleton'

export default function BusinessLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-48 rounded-xl" />
      <Skeleton className="h-4 w-72 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
    </div>
  )
}
