import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi, type AdminUser } from "@/lib/admin-api"
import { useCompany } from "@/contexts/company-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2, UserPlus, X, Briefcase } from "lucide-react"

interface ProjectMember {
  id: number
  userId: number
  memberType: "internal" | "client"
  name: string
  email: string
  role: string
}

interface MarketingProject {
  id: number
  companyId: number
  name: string
  brandName: string | null
  brandColor: string | null
  logoUrl: string | null
  status: string
  members: ProjectMember[]
}

/** Super-admin management of Client Marketing Portal projects. */
export default function MarketingProjects() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { companies } = useCompany()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", brandName: "", brandColor: "#1d90e8", companyId: "" })

  const { data: projects = [], isLoading } = useQuery<MarketingProject[]>({
    queryKey: ["/api/marketing-projects"],
    queryFn: () => adminApi.get("/marketing-projects"),
  })
  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/users"],
    queryFn: () => adminApi.get("/users"),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/marketing-projects"] })

  const createMut = useMutation({
    mutationFn: () => adminApi.post("/marketing-projects", {
      name: form.name,
      brandName: form.brandName || form.name,
      brandColor: form.brandColor,
      companyId: parseInt(form.companyId),
    }),
    onSuccess: () => {
      invalidate(); setCreateOpen(false)
      setForm({ name: "", brandName: "", brandColor: "#1d90e8", companyId: "" })
      toast({ title: "Project created" })
    },
    onError: (e: Error) => toast({ title: "Failed to create project", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.del(`/marketing-projects/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Project deleted" }) },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  })

  const addMemberMut = useMutation({
    mutationFn: (v: { projectId: number; userId: number; memberType: string }) =>
      adminApi.post(`/marketing-projects/${v.projectId}/members`, { userId: v.userId, memberType: v.memberType }),
    onSuccess: () => { invalidate(); toast({ title: "Member added" }) },
    onError: (e: Error) => toast({ title: "Failed to add member", description: e.message, variant: "destructive" }),
  })

  const removeMemberMut = useMutation({
    mutationFn: (v: { projectId: number; userId: number }) =>
      adminApi.del(`/marketing-projects/${v.projectId}/members/${v.userId}`),
    onSuccess: () => { invalidate(); toast({ title: "Member removed" }) },
    onError: (e: Error) => toast({ title: "Failed to remove member", description: e.message, variant: "destructive" }),
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Client Marketing Projects</h1>
          <p className="text-muted-foreground">Create projects, assign team & client users, and control portal access.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create marketing project</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Q3 Growth" />
              </div>
              <div className="space-y-2">
                <Label>Brand name (shown to the client)</Label>
                <Input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} placeholder="Acme Inc." />
              </div>
              <div className="space-y-2">
                <Label>Brand color</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} className="h-9 w-14 cursor-pointer rounded border bg-background" />
                  <Input value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} className="w-32" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMut.mutate()}
                disabled={!form.name || !form.companyId || createMut.isPending}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
          <Briefcase className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">Create a project to onboard a client into the marketing portal.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              users={users}
              companyName={companies.find((c) => c.id === p.companyId)?.name ?? `Company #${p.companyId}`}
              onDelete={() => deleteMut.mutate(p.id)}
              onAddMember={(userId, memberType) => addMemberMut.mutate({ projectId: p.id, userId, memberType })}
              onRemoveMember={(userId) => removeMemberMut.mutate({ projectId: p.id, userId })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project, users, companyName, onDelete, onAddMember, onRemoveMember }: {
  project: MarketingProject
  users: AdminUser[]
  companyName: string
  onDelete: () => void
  onAddMember: (userId: number, memberType: string) => void
  onRemoveMember: (userId: number) => void
}) {
  const [userId, setUserId] = React.useState("")
  const [memberType, setMemberType] = React.useState("client")
  const memberIds = new Set(project.members.map((m) => m.userId))
  const candidates = users.filter((u) => !memberIds.has(u.id) && u.status !== "disabled")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded font-bold text-white" style={{ backgroundColor: project.brandColor || "#1d90e8" }}>
            {(project.brandName || project.name).charAt(0).toUpperCase()}
          </div>
          <div>
            <CardTitle className="text-base">{project.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{companyName} · {project.status}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete project">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {project.members.length === 0 && (
            <p className="text-sm text-muted-foreground">No members assigned.</p>
          )}
          {project.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{m.name}</span>
                <span className="ml-2 text-muted-foreground">{m.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.memberType === "client" ? "default" : "secondary"}>{m.memberType}</Badge>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemoveMember(m.userId)} aria-label={`Remove ${m.name}`}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Add user…" /></SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={memberType} onValueChange={setMemberType}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="icon"
            disabled={!userId}
            onClick={() => { onAddMember(parseInt(userId), memberType); setUserId("") }}
            aria-label="Add member"
          >
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
