import { Database } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  message?: string
  hint?: string
  icon?: LucideIcon
  className?: string
}

/**
 * Consistent placeholder shown wherever a data source is empty or not connected.
 * Use instead of rendering zeros or fabricated numbers as if they were real.
 */
export function EmptyState({ message = "No data connected.", hint, icon: Icon = Database, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-8 px-4", className)}>
      <Icon className="w-8 h-8 mb-2 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground/60 mt-1">{hint}</p>}
    </div>
  )
}

/**
 * Inline "No data connected." for compact spots like KPI values, where a full
 * block would be too large.
 */
export function NoData({ className }: { className?: string }) {
  return <span className={cn("text-sm font-normal text-muted-foreground", className)}>No data connected.</span>
}
