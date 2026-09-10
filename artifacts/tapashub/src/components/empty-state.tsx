import type { ReactNode } from "react"
import { Database, AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  message?: string
  hint?: string
  icon?: LucideIcon
  /** e.g. a "Add first product" button — rendered below the hint. */
  action?: ReactNode
  className?: string
}

/**
 * Consistent placeholder shown wherever a data source is empty or not connected.
 * Use instead of rendering zeros or fabricated numbers as if they were real.
 */
export function EmptyState({ message = "No data connected.", hint, icon: Icon = Database, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-8 px-4", className)}>
      <Icon className="w-8 h-8 mb-2 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground/60 mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
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

interface ErrorStateProps {
  message?: string
  hint?: string
  onRetry?: () => void
  className?: string
}

/**
 * Shown when a query fails, as the counterpart to EmptyState. Most pages
 * previously had no visual distinction between "no data" and "the request
 * failed" — an empty table either way — which leaves a user with a network
 * blip no way to tell a broken app from a genuinely empty one, and no way
 * to recover short of a full page reload.
 */
export function ErrorState({
  message = "Something went wrong loading this data.",
  hint = "Check your connection and try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-8 px-4", className)}>
      <AlertTriangle className="w-8 h-8 mb-2 text-destructive/60" />
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
