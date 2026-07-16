import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { BarChart3 } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface AnalyticsData {
  analytics: {
    generatedToday: number
    completedToday: number
    approvalRate: number
    regenerationCount: number
    aiUsage: number
    templateUsage: number
    averageCompletionTimeMs: number | null
    pendingApproval: number
    rejectedToday: number
  }
  trend: Array<{
    date: string
    total: number
    completed: number
    aiUsage: number
  }>
}

export function AiTasksAnalytics({ companyId }: { companyId: number }) {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/ai-tasks/analytics", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/analytics?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading analytics…</div>
  if (!data) return <EmptyState icon={BarChart3} message="No analytics available" hint="Generate tasks to see analytics." />

  const a = data.analytics

  const Stat = ({ label, value, unit }: { label: string; value: string | number; unit?: string }) => (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Generated Today" value={a.generatedToday} />
        <Stat label="Completed Today" value={a.completedToday} />
        <Stat label="Approval Rate" value={`${a.approvalRate}%`} />
        <Stat label="Regenerations" value={a.regenerationCount} />
        <Stat label="AI Usage" value={a.aiUsage} />
        <Stat label="Template Usage" value={a.templateUsage} />
        <Stat label="Avg Completion Time" value={a.averageCompletionTimeMs ? (a.averageCompletionTimeMs / 60000).toFixed(1) : "—"} unit="min" />
        <Stat label="Pending Approval" value={a.pendingApproval} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>7-Day Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend.length === 0 ? (
            <div className="text-sm text-muted-foreground">No data yet.</div>
          ) : (
            <div className="space-y-2">
              {data.trend.map((row) => (
                <div key={row.date} className="flex items-center justify-between rounded-md border p-2">
                  <div className="font-medium">{row.date}</div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{row.total} generated</Badge>
                    <Badge variant="secondary">{row.completed} completed</Badge>
                    <Badge variant="outline">{row.aiUsage} AI</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
