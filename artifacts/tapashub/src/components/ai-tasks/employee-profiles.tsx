import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, RefreshCw, Users } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface EmployeeProfile {
  id: number
  companyId: number
  firstName: string
  lastName: string
  email: string
  department: string
  designation: string
  skillLevel: string | null
  workingHours: string | null
  currentProject: string | null
}

export function EmployeeProfiles({ companyId }: { companyId: number }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState<EmployeeProfile | null>(null)

  const { data, isLoading, refetch } = useQuery<EmployeeProfile[]>({
    queryKey: ["/api/ai-tasks/employees", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/employees?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/employees/sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/employees", companyId] })
      toast({ title: `Team synced`, description: `${result.created} added, ${result.updated} updated, ${result.unchanged} unchanged.` })
    },
    onError: (err) => toast({ title: "Failed to sync team", description: String(err), variant: "destructive" }),
  })

  React.useEffect(() => {
    if (!isLoading && (data?.length ?? 0) === 0 && !syncMutation.isPending && !syncMutation.isSuccess) {
      syncMutation.mutate()
    }
  }, [isLoading, data, syncMutation.isPending, syncMutation.isSuccess])

  const updateMutation = useMutation({
    mutationFn: async (payload: EmployeeProfile) => {
      const res = await fetch(`${basePath}/api/ai-tasks/employees/${payload.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          skillLevel: payload.skillLevel,
          workingHours: payload.workingHours,
          currentProject: payload.currentProject,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/employees", companyId] })
      setEditing(null)
      toast({ title: "Profile updated" })
    },
    onError: (err) => toast({ title: "Failed to update", description: String(err), variant: "destructive" }),
  })

  if (isLoading) return <div className="py-8 text-center">Loading employees…</div>

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Employee Profiles</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || isLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync team
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!isLoading && (data?.length ?? 0) === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No employee profiles yet</p>
              <p className="text-xs text-muted-foreground">Sync your workspace members to build the AI task roster.</p>
            </div>
          )}
          {data?.map((emp) => (
            <div key={emp.id} className="rounded-lg border p-4">
              {editing?.id === emp.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    updateMutation.mutate(editing)
                  }}
                  className="space-y-3"
                >
                  <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label>Skill Level</Label>
                      <Input
                        value={editing.skillLevel ?? ""}
                        onChange={(e) => setEditing({ ...editing, skillLevel: e.target.value })}
                        placeholder="e.g. senior"
                      />
                    </div>
                    <div>
                      <Label>Working Hours</Label>
                      <Input
                        value={editing.workingHours ?? ""}
                        onChange={(e) => setEditing({ ...editing, workingHours: e.target.value })}
                        placeholder="e.g. 9:00-18:00 IST"
                      />
                    </div>
                    <div>
                      <Label>Current Project</Label>
                      <Input
                        value={editing.currentProject ?? ""}
                        onChange={(e) => setEditing({ ...editing, currentProject: e.target.value })}
                        placeholder="e.g. Q3 Sales Push"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                    <div className="text-sm text-muted-foreground">{emp.department} · {emp.designation}</div>
                    <div className="mt-2 text-sm">
                      <span className="font-medium">Skill:</span> {emp.skillLevel || "—"} · {" "}
                      <span className="font-medium">Hours:</span> {emp.workingHours || "—"} · {" "}
                      <span className="font-medium">Project:</span> {emp.currentProject || "—"}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(emp)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
