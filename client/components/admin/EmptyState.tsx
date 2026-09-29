'use client'

import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/design/cn'

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 px-6 py-12 text-center dark:border-white/15',
        className,
      )}
    >
      <span className="mb-3 rounded-2xl bg-[#E8672A]/12 p-3 text-[#E8672A]">
        <Inbox size={22} />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-[#6E5B50] dark:text-white/55">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
