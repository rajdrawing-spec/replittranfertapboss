import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/empty-state"
import { CheckSquare, Clock } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface GeneratedTask {
  id: number
  title: string
  description: string
  priority: "low" | "medium" | "high"
  status: "draft" | "approved" | "rejected" | "assigned" | "completed"
  dueDate: string | null
  estimatedMinutes: number | null
}

interface TaskStats {
  total: number
  pending: number
  approved: number
  completed: number
  rejected: number
  overdue: number
  dueToday: number
  highPriority: number
}

interface DashboardResponse {
  tasks: GeneratedTask[]
  stats: TaskStats
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

export function EmployeeDashboard({ companyId, employeeId }: { companyId: number; employeeId: number }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const runDate = new Date().toISOString().slice(0, 10)

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/ai-tasks/my-tasks", companyId, employeeId, runDate],
    queryFn: async () => {
      const res = await fetch(
        `${basePath}/api/ai-tasks/my-tasks?companyId=${companyId}&employeeId=${employeeId}&runDate=${runDate}`,
        { credentials: "include" }
      )
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const completeMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetch(`${basePath}/api/ai-tasks/${taskId}/complete`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, employeeId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/my-tasks", companyId, employeeId, runDate] })
      toast({ title: "Task completed" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const stats = data?.stats

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats?.total ?? 0} />
        <StatCard label="Pending" value={stats?.pending ?? 0} />
        <StatCard label="Completed" value={stats?.completed ?? 0} />
        <StatCard label="High Priority" value={stats?.highPriority ?? 0} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Due Today" value={stats?.dueToday ?? 0} />
        <StatCard label="Overdue" value={stats?.overdue ?? 0} />
        <StatCard label="Approved" value={stats?.approved ?? 0} />
        <StatCard label="Rejected" value={stats?.rejected ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Today's Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="py-8 text-center">Loading tasks…</div>}
          {!isLoading && data?.tasks.length === 0 && (
            <EmptyState icon={CheckSquare} message="No tasks for today" hint="Tasks will appear once your manager generates them." />
          )}
          <div className="space-y-3">
            {data?.tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  checked={task.status === "completed"}
                  onCheckedChange={() => completeMutation.mutate(task.id)}
                  disabled={task.status === "completed" || completeMutation.isPending}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={task.status === "completed" ? "line-through text-muted-foreground" : "font-medium"}>
                      {task.title}
                    </span>
                    <Badge variant={task.priority === "high" ? "destructive" : task.priority === "medium" ? "default" : "secondary"}>
                      {task.priority}
                    </Badge>
                    <Badge variant="outline">{task.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                  {task.estimatedMinutes && <p className="text-xs text-muted-foreground">Est. {task.estimatedMinutes} min</p>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {stats && stats.total > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium">Progress</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {Math.round((stats.completed / stats.total) * 100)}% completed
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
