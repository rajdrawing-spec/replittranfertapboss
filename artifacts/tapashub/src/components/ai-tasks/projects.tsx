import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { FolderKanban } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

type Priority = "critical" | "high" | "medium" | "low"

interface AiTaskProject {
  id: number
  companyId: number
  name: string
  priority: Priority
  isActive: boolean
}

const PRIORITY_VARIANT: Record<Priority, string> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
}

export function AiTaskProjects({ companyId, canManage }: { companyId: number; canManage: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: projects, isLoading } = useQuery<AiTaskProject[]>({
    queryKey: ["/api/ai-tasks/projects", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/projects?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const [name, setName] = React.useState("")
  const [priority, setPriority] = React.useState<Priority>("medium")

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, name, priority }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/projects", companyId] })
      setName("")
      setPriority("medium")
      toast({ title: "Project created" })
    },
    onError: (err) => toast({ title: "Failed to create project", description: String(err), variant: "destructive" }),
  })

  const updateMutation = useMutation({
    mutationFn: async (project: Partial<AiTaskProject> & { id: number }) => {
      const res = await fetch(`${basePath}/api/ai-tasks/projects/${project.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...project }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/projects", companyId] })
      toast({ title: "Project updated" })
    },
    onError: (err) => toast({ title: "Failed to update project", description: String(err), variant: "destructive" }),
  })

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading projects…</div>

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Project priorities influence AI task generation. Templates that mention a project name will be elevated to the project priority.
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add Project</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="projectName">Project Name</Label>
                <Input id="projectName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Audit" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectPriority">Priority</Label>
                <Select value={priority} onValueChange={(v: Priority) => setPriority(v)}>
                  <SelectTrigger id="projectPriority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending}>
                  Add Project
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          {projects?.length === 0 ? (
            <EmptyState icon={FolderKanban} message="No projects yet" hint="Add projects to prioritize related tasks." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects?.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_VARIANT[project.priority] as any}>{project.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={project.isActive ? "outline" : "secondary"}>{project.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateMutation.mutate({ id: project.id, isActive: !project.isActive })}
                          disabled={updateMutation.isPending}
                        >
                          {project.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
