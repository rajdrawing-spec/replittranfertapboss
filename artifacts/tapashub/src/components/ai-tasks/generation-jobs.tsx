import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { Clock } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface GenerationJob {
  id: number
  runDate: string
  status: "running" | "completed" | "failed"
  startedAt: string
  completedAt: string | null
  triggeredBy: string
  providerUsed: string | null
  tokensUsed: number | null
  executionTimeMs: number | null
  tasksGenerated: number
  error: string | null
}

export function GenerationJobs({ companyId }: { companyId: number }) {
  const { data, isLoading } = useQuery<GenerationJob[]>({
    queryKey: ["/api/ai-tasks/jobs", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/jobs?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Generation Jobs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="py-8 text-center">Loading jobs…</div>}
        {!isLoading && data?.length === 0 && (
          <EmptyState icon={Clock} message="No generation jobs yet" hint="Jobs will appear after the scheduler runs or a manager clicks Generate." />
        )}
        <div className="space-y-3">
          {data?.map((job) => (
            <div key={job.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Run {job.runDate}</div>
                <Badge variant={job.status === "completed" ? "outline" : job.status === "failed" ? "destructive" : "default"}>
                  {job.status}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Triggered by {job.triggeredBy} · Provider {job.providerUsed || "—"} · {job.tasksGenerated} tasks
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Started {new Date(job.startedAt).toLocaleString()}
                {job.completedAt && ` · Completed ${new Date(job.completedAt).toLocaleString()}`}
                {job.executionTimeMs && ` · ${job.executionTimeMs}ms`}
                {job.tokensUsed && ` · ${job.tokensUsed} tokens`}
              </div>
              {job.error && <div className="mt-2 text-xs text-red-600">{job.error}</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
