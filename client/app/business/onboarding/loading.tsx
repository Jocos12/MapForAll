import { Skeleton } from '@/components/ui/Skeleton'

export default function OnboardingLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8" aria-busy="true">
      <Skeleton className="h-4 w-28 rounded-full" />
      <Skeleton className="mt-3 h-9 w-64 rounded-xl" />
      <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
      <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
    </div>
  )
}
