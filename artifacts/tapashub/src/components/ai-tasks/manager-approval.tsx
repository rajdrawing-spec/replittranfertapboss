import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { CheckSquare, Check, X, RotateCcw } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface GeneratedTask {
  id: number
  title: string
  description: string
  priority: "low" | "medium" | "high"
  status: string
  employeeId: number
  generatedDate: string
  source: string
  assigneeName?: string
  department?: string
  aiCustomizations?: {
    confidence?: "high" | "medium" | "low" | "manual"
    originalAssigneeName?: string
    meetingTitle?: string
  } | null
}

function statusLabel(status: string): string {
  if (status === "draft") return "Pending"
  if (status === "approved" || status === "assigned") return "In Progress"
  if (status === "completed") return "Completed"
  if (status === "rejected") return "Rejected"
  return status
}

export function ManagerApproval({ companyId }: { companyId: number }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const runDate = new Date().toISOString().slice(0, 10)

  const { data, isLoading, refetch } = useQuery<GeneratedTask[]>({
    queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate],
    queryFn: async () => {
      const res = await fetch(
        `${basePath}/api/ai-tasks/pending-approval?companyId=${companyId}&runDate=${runDate}`,
        { credentials: "include" }
      )
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate] })
      toast({ title: "Tasks generated" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate] })
      toast({ title: "Tasks regenerated" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/approve-all`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, runDate }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate] })
      toast({ title: "All tasks approved" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const rejectAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/reject-all`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, runDate }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate] })
      toast({ title: "All tasks rejected" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const taskActionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "reject" }) => {
      const res = await fetch(`${basePath}/api/ai-tasks/${id}/${action}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId, runDate] })
      toast({ title: "Task updated" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          <CheckSquare className="mr-2 h-4 w-4" /> Generate Today
        </Button>
        <Button variant="outline" onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}>
          <RotateCcw className="mr-2 h-4 w-4" /> Regenerate
        </Button>
        <Button variant="secondary" onClick={() => approveAllMutation.mutate()} disabled={approveAllMutation.isPending}>
          <Check className="mr-2 h-4 w-4" /> Approve All
        </Button>
        <Button variant="outline" onClick={() => rejectAllMutation.mutate()} disabled={rejectAllMutation.isPending}>
          <X className="mr-2 h-4 w-4" /> Reject All
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Approval ({data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="py-8 text-center">Loading…</div>}
          {!isLoading && data?.length === 0 && (
            <EmptyState icon={CheckSquare} message="No pending tasks" hint="Generate tasks for today to see them here." />
          )}
          <div className="space-y-3">
            {data?.map((task) => (
              <div key={task.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{task.title}</div>
                    <p className="text-sm text-muted-foreground">{task.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={task.priority === "high" ? "destructive" : task.priority === "medium" ? "default" : "secondary"}>
                        {task.priority}
                      </Badge>
                      <Badge variant="outline">{task.source}</Badge>
                      {task.aiCustomizations?.confidence && (
                        <Badge variant="outline" className="capitalize">{task.aiCustomizations.confidence} match</Badge>
                      )}
                    </div>
                    {task.assigneeName && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Suggested: {task.assigneeName}
                        {task.department ? ` · ${task.department}` : ""}
                        {task.aiCustomizations?.meetingTitle ? ` · from "${task.aiCustomizations.meetingTitle}"` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => taskActionMutation.mutate({ id: task.id, action: "approve" })}>
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => taskActionMutation.mutate({ id: task.id, action: "reject" })}>
                      <X className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
