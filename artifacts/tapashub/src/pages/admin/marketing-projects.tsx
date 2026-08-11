import * as React from "react"
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2, UserPlus, X, Briefcase, Eye, Sparkles, ScrollText, Share2 } from "lucide-react"

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
        <div className="flex flex-wrap gap-2 pt-1">
          <ShareRecordsDialog projectId={project.id} companyId={project.companyId} />
          <VisibilityDialog projectId={project.id} />
          <AiPlansDialog projectId={project.id} />
          <AuditDialog projectId={project.id} />
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------- Share marketing records with client ------------------- */

interface LinkableRecord {
  id: number
  name?: string
  title?: string
  channel?: string | null
  status?: string | null
  projectId: number | null
  clientVisible: boolean
}

const SHARE_KINDS: { kind: "campaigns" | "creatives" | "leads"; label: string; path: string }[] = [
  { kind: "campaigns", label: "Campaigns", path: "/campaigns?status=all" },
  { kind: "creatives", label: "Creatives", path: "/marketing/creatives?status=all" },
  { kind: "leads", label: "Leads", path: "/marketing/leads?status=all" },
]

function ShareRecordsDialog({ projectId, companyId }: { projectId: number; companyId: number }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)

  const results = useQueries({
    queries: SHARE_KINDS.map((k) => ({
      queryKey: ["/api/marketing-share", k.kind, companyId],
      queryFn: () => adminApi.get(`${k.path}&companyId=${companyId}`) as Promise<LinkableRecord[]>,
      enabled: open,
    })),
  })
  const queries = SHARE_KINDS.map((k, i) => ({ ...k, query: results[i] }))

  const linkMut = useMutation({
    mutationFn: (v: { kind: string; recordId: number; share: boolean }) =>
      adminApi.patch(`/marketing-projects/link/${v.kind}/${v.recordId}`,
        v.share ? { projectId, clientVisible: true } : { projectId: null }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-share", v.kind, companyId] })
      toast({ title: v.share ? "Shared with client portal" : "Removed from client portal" })
    },
    onError: (e: Error) => toast({ title: "Failed to update sharing", description: e.message, variant: "destructive" }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Share2 className="mr-1.5 h-3.5 w-3.5" />Share with client</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Share with client portal</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Only records you turn on here appear in the client portal for this project.
        </p>
        {queries.map(({ kind, label, query }) => (
          <div key={kind} className="space-y-1.5">
            <p className="text-sm font-medium">{label}</p>
            {query.isLoading ? (
              <div className="flex h-16 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
            ) : query.isError ? (
              <div className="flex items-center justify-between rounded-md border border-destructive/40 px-3 py-2">
                <p className="text-xs text-destructive">Failed to load {label.toLowerCase()}.</p>
                <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
              </div>
            ) : !query.data || query.data.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">No {label.toLowerCase()} for this company yet.</p>
            ) : (
              query.data.map((r) => {
                const linkedElsewhere = r.projectId !== null && r.projectId !== projectId
                const shared = r.projectId === projectId && r.clientVisible
                return (
                  <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0 text-sm">
                      <span className="font-medium">{r.name ?? r.title ?? `#${r.id}`}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[r.channel, r.status].filter(Boolean).join(" · ")}
                        {linkedElsewhere ? " · linked to another project" : ""}
                      </span>
                    </div>
                    <Switch
                      checked={shared}
                      disabled={linkMut.isPending || linkedElsewhere}
                      onCheckedChange={(v) => linkMut.mutate({ kind, recordId: r.id, share: v })}
                      aria-label={`Share ${r.name ?? r.title ?? r.id} with client`}
                    />
                  </div>
                )
              })
            )}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------- Client visibility settings dialog -------------------- */

type Visibility = Record<string, boolean>

const VISIBILITY_FIELDS: { key: string; label: string }[] = [
  { key: "revenue", label: "Revenue & AOV" },
  { key: "orders", label: "Orders & Sales" },
  { key: "adSpend", label: "Ad Spend" },
  { key: "roas", label: "ROAS" },
  { key: "leads", label: "Leads" },
  { key: "cpa", label: "CPA" },
  { key: "conversion", label: "Conversion Rate" },
  { key: "campaigns", label: "Campaigns" },
  { key: "creatives", label: "Creative Library" },
  { key: "reports", label: "Reports" },
  { key: "ai", label: "AI Plan" },
  { key: "aiRequiresReview", label: "AI plans need internal approval" },
]

function VisibilityDialog({ projectId }: { projectId: number }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Visibility | null>(null)

  const { data } = useQuery<Visibility>({
    queryKey: ["/api/marketing-projects", projectId, "visibility"],
    queryFn: () => adminApi.get(`/marketing-projects/${projectId}/visibility`),
    enabled: open,
  })
  React.useEffect(() => { if (data && open) setDraft(data) }, [data, open])

  const saveMut = useMutation({
    mutationFn: (v: Visibility) => adminApi.put(`/marketing-projects/${projectId}/visibility`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-projects", projectId, "visibility"] })
      toast({ title: "Visibility settings saved" }); setOpen(false)
    },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Eye className="mr-1.5 h-3.5 w-3.5" />Visibility</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Client visibility settings</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Hidden sections and KPIs are removed server-side — the client never receives that data.
        </p>
        {!draft ? (
          <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
        ) : (
          <div className="space-y-2">
            {VISIBILITY_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">{f.label}</span>
                <Switch checked={draft[f.key] ?? false} onCheckedChange={(v) => setDraft({ ...draft, [f.key]: v })} />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => draft && saveMut.mutate(draft)} disabled={!draft || saveMut.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------- AI plan review dialog ------------------------- */

interface AdminAiPlan {
  id: number
  status: string
  summary: string | null
  insights: { observed?: { working?: string[]; underperforming?: string[] } } | null
  reviewNote: string | null
  createdAt: string
}

function AiPlansDialog({ projectId }: { projectId: number }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState("")

  const { data: plans = [], isLoading } = useQuery<AdminAiPlan[]>({
    queryKey: ["/api/marketing-projects", projectId, "ai-plans"],
    queryFn: () => adminApi.get(`/marketing-projects/${projectId}/ai-plans`),
    enabled: open,
  })

  const reviewMut = useMutation({
    mutationFn: (v: { planId: number; action: string }) =>
      adminApi.patch(`/marketing-projects/${projectId}/ai-plans/${v.planId}`, { action: v.action, reviewNote: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/marketing-projects", projectId, "ai-plans"] })
      setNote(""); toast({ title: "Plan updated" })
    },
    onError: (e: Error) => toast({ title: "Failed to update plan", description: e.message, variant: "destructive" }),
  })

  const badge = (s: string) =>
    s === "published" ? "default" : s === "pending_review" ? "secondary" : "outline"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Sparkles className="mr-1.5 h-3.5 w-3.5" />AI Plans</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>AI plan review</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
        ) : plans.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No AI plans generated for this project yet.</p>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Plan #{p.id} · {new Date(p.createdAt).toLocaleString("en-IN")}</div>
                  <Badge variant={badge(p.status)}>{p.status.replace("_", " ")}</Badge>
                </div>
                {p.summary && <p className="mt-1 text-sm text-muted-foreground">{p.summary}</p>}
                {p.reviewNote && <p className="mt-1 text-xs text-muted-foreground">Review note: {p.reviewNote}</p>}
                {p.status === "pending_review" && (
                  <div className="mt-2 space-y-2">
                    <Textarea placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => reviewMut.mutate({ planId: p.id, action: "approve" })} disabled={reviewMut.isPending}>Approve & publish</Button>
                      <Button size="sm" variant="outline" onClick={() => reviewMut.mutate({ planId: p.id, action: "reject" })} disabled={reviewMut.isPending}>Reject</Button>
                    </div>
                  </div>
                )}
                {p.status === "published" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => reviewMut.mutate({ planId: p.id, action: "archive" })} disabled={reviewMut.isPending}>Unpublish</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------- Audit log dialog --------------------------- */

interface AuditRow {
  id: number
  userEmail: string | null
  action: string
  detail: Record<string, unknown> | null
  createdAt: string
}

const AUDIT_LABELS: Record<string, string> = {
  "portal.overview_viewed": "Viewed dashboard",
  "portal.report_viewed": "Viewed report",
  "portal.creative_downloaded": "Downloaded creative",
  "portal.ai_plan_generated": "Generated AI plan",
  "portal.ai_plan_reviewed": "AI plan reviewed",
  "portal.visibility_changed": "Visibility settings changed",
}

function AuditDialog({ projectId }: { projectId: number }) {
  const [open, setOpen] = React.useState(false)
  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ["/api/marketing-projects", projectId, "audit"],
    queryFn: () => adminApi.get(`/marketing-projects/${projectId}/audit`),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><ScrollText className="mr-1.5 h-3.5 w-3.5" />Audit</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Client access audit log</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No client activity recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{AUDIT_LABELS[r.action] ?? r.action}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.userEmail ?? "system"}
                    {r.detail && "name" in r.detail ? ` · ${String(r.detail.name)}` : ""}
                    {r.detail && "changed" in r.detail && Array.isArray(r.detail.changed) && r.detail.changed.length > 0 ? ` · ${(r.detail.changed as string[]).join(", ")}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
