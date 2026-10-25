import { Skeleton } from '@/components/ui/Skeleton'

export default function AdminUsersLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-40 rounded-xl" />
      <Skeleton className="h-12 w-full rounded-2xl" />
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
    </div>
  )
}
