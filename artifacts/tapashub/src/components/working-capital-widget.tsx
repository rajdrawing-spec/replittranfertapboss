/**
 * WorkingCapitalWidget — sidebar panel (parent view only).
 *
 * Shows a real-time snapshot of the treasury's working capital position:
 *   • Total capital raised (treasury entries)
 *   • Allocated to subsidiaries (executed fund allocations)
 *   • Available (unallocated)
 *   • Group revenue (operational income from all subsidiaries)
 *   • Per-company allocation mini-bars
 *
 * Refreshes every 60 s so the sidebar stays up-to-date without hammering the API.
 */
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { ChevronDown, Landmark } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

interface WorkingCapital {
  totalCapital: number
  allocated: number    // capital deployed to sub-brands via Fund Allocations
  totalSpent: number   // actual expenses (reference)
  available: number    // totalCapital − allocated (undeployed treasury balance)
  utilizationPercent: number
  groupRevenue: number
  byCompany: { id: number; name: string; color: string; allocated: number; spent: number; income: number }[]
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
const compact = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`
  return `₹${Math.round(n)}`
}

export function WorkingCapitalWidget() {
  const [expanded, setExpanded] = React.useState(true)

  const { data, isLoading } = useQuery<WorkingCapital>({
    queryKey: ["/api/treasury/working-capital"],
    queryFn: () => adminApi.get("/treasury/working-capital"),
    refetchInterval: 60_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="mx-3 mb-3 rounded-xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/20 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Landmark className="w-3 h-3 text-indigo-400" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Working Capital
          </span>
        </div>
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">
          {isLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ) : !data ? null : (
            <>
              {/* KPI rows */}
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Capital</span>
                  <span className="font-semibold text-foreground tabular-nums">{compact(data.totalCapital)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Deployed</span>
                  <span className="text-indigo-400 tabular-nums">{compact(data.allocated)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Available</span>
                  <span className={cn("font-semibold tabular-nums", data.available < 0 ? "text-red-400" : "text-green-400")}>
                    {compact(data.available)}
                  </span>
                </div>
              </div>

              {/* Capital deployment bar */}
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", data.utilizationPercent > 90 ? "bg-red-500" : data.utilizationPercent > 70 ? "bg-amber-500" : "bg-indigo-500")}
                    style={{ width: `${Math.min(100, data.utilizationPercent)}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  {data.utilizationPercent}% deployed
                </div>
              </div>

              {/* Per-company allocation bars */}
              {data.byCompany.length > 0 && (
                <div className="space-y-1.5 border-t border-border/40 pt-2">
                  {data.byCompany.map(co => {
                    // bar shows this sub-brand's allocation as % of total capital
                    const pct = data.totalCapital > 0 ? Math.min(100, (co.allocated / data.totalCapital) * 100) : 0
                    return (
                      <div key={co.id} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div
                              className="w-3.5 h-3.5 rounded text-white text-[8px] flex items-center justify-center font-bold shrink-0"
                              style={{ background: co.color }}
                            >
                              {co.name[0]}
                            </div>
                            <span className="text-muted-foreground truncate">{co.name}</span>
                          </div>
                          <span className="text-indigo-400 tabular-nums shrink-0 ml-1">{compact(co.allocated)}</span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width: `${pct}%`, opacity: 0.8 }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
