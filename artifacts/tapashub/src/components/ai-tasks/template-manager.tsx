import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { useToast } from "@/hooks/use-toast"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface TaskTemplate {
  id: number
  companyId: number
  department: string
  roleKey: string
  titleTemplate: string
  descriptionTemplate: string
  priority: "low" | "medium" | "high"
  estimatedMinutes: number | null
  recurrence: "daily" | "weekly" | "once"
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface TemplateListResponse {
  items: TaskTemplate[]
  total: number
  page: number
  limit: number
}

type TaskTemplateForm = {
  department: string
  roleKey: string
  titleTemplate: string
  descriptionTemplate: string
  priority: "low" | "medium" | "high"
  estimatedMinutes: number | null
  recurrence: "daily" | "weekly" | "once"
  isActive: boolean
}

const emptyTemplate: TaskTemplateForm = {
  department: "",
  roleKey: "*",
  titleTemplate: "",
  descriptionTemplate: "",
  priority: "medium",
  estimatedMinutes: null,
  recurrence: "daily",
  isActive: true,
}

export function TemplateManager({ companyId, canManage }: { companyId: number; canManage: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TaskTemplate | null>(null)
  const [form, setForm] = React.useState(emptyTemplate)

  const { data, isLoading, error } = useQuery<TemplateListResponse>({
    queryKey: ["/api/ai-tasks/templates", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/templates?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const createMutation = useMutation({
    mutationFn: async (payload: TaskTemplateForm) => {
      const res = await fetch(`${basePath}/api/ai-tasks/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/templates", companyId] })
      setDialogOpen(false)
      setForm(emptyTemplate)
      toast({ title: "Template created" })
    },
    onError: (err) => toast({ title: "Failed to create template", description: String(err), variant: "destructive" }),
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; data: Partial<TaskTemplateForm> }) => {
      const res = await fetch(`${basePath}/api/ai-tasks/templates/${payload.id}?companyId=${companyId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload.data, companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/templates", companyId] })
      setDialogOpen(false)
      setEditing(null)
      setForm(emptyTemplate)
      toast({ title: "Template updated" })
    },
    onError: (err) => toast({ title: "Failed to update template", description: String(err), variant: "destructive" }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${basePath}/api/ai-tasks/templates/${id}?companyId=${companyId}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/templates", companyId] })
      toast({ title: "Template deleted" })
    },
    onError: (err) => toast({ title: "Failed to delete template", description: String(err), variant: "destructive" }),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyTemplate)
    setDialogOpen(true)
  }

  function openEdit(template: TaskTemplate) {
    setEditing(template)
    setForm({
      department: template.department,
      roleKey: template.roleKey,
      titleTemplate: template.titleTemplate,
      descriptionTemplate: template.descriptionTemplate,
      priority: template.priority,
      estimatedMinutes: template.estimatedMinutes,
      recurrence: template.recurrence,
      isActive: template.isActive,
    })
    setDialogOpen(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Reusable templates. AI customizes them into daily tasks for each employee.
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New template
          </Button>
        )}
      </div>

      {isLoading && <div className="py-8 text-center text-muted-foreground">Loading templates…</div>}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          Failed to load templates: {String(error)}
        </div>
      )}

      {!isLoading && !error && (
        <Card>
          <CardHeader>
            <CardTitle>Task Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.items.length === 0 ? (
              <EmptyState
                icon={Plus}
                message="No templates yet"
                hint={canManage ? "Create a template to start AI-powered daily task generation." : "Templates will appear here once a manager creates them."}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Recurrence</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.items.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">{template.department}</TableCell>
                        <TableCell>
                          <div className="max-w-[240px] truncate" title={template.titleTemplate}>
                            {template.titleTemplate}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={template.priority === "high" ? "destructive" : template.priority === "medium" ? "default" : "secondary"}>
                            {template.priority}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">{template.recurrence}</TableCell>
                        <TableCell>
                          <Badge variant={template.isActive ? "outline" : "secondary"}>
                            {template.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => openEdit(template)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(template.id)} disabled={deleteMutation.isPending}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit template" : "New task template"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="e.g. Sales"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roleKey">Role key</Label>
                <Input
                  id="roleKey"
                  value={form.roleKey}
                  onChange={(e) => setForm({ ...form, roleKey: e.target.value })}
                  placeholder="* for all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title template</Label>
              <Input
                id="title"
                value={form.titleTemplate}
                onChange={(e) => setForm({ ...form, titleTemplate: e.target.value })}
                placeholder="e.g. Follow up with {{department}} leads"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description template</Label>
              <Textarea
                id="description"
                value={form.descriptionTemplate}
                onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })}
                placeholder="What should the employee do?"
                rows={4}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v: "low" | "medium" | "high") => setForm({ ...form, priority: v })}
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurrence">Recurrence</Label>
                <Select
                  value={form.recurrence}
                  onValueChange={(v: "daily" | "weekly" | "once") => setForm({ ...form, recurrence: v })}
                >
                  <SelectTrigger id="recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="once">Once</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimated">Est. minutes</Label>
                <Input
                  id="estimated"
                  type="number"
                  value={form.estimatedMinutes ?? ""}
                  onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="30"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="active"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="active" className="font-normal">Active</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
