import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { UserPlus, Trash2, ShieldCheck, Plus, Pencil, ChevronDown, ChevronUp, Crown } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import {
  adminApi, type AdminUser, type AdminInvitation, type AdminRole, type PermissionDef,
} from "@/lib/admin-api"

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="text-sm text-destructive mt-2">{(error as Error).message}</p>
}

/* ───────────────── Multi-role assignment dialog ───────────────── */

function RoleAssignDialog({
  user, roles, onClose, onSaved,
}: { user: AdminUser; roles: AdminRole[]; onClose: () => void; onSaved: () => void }) {
  const allKeys = [user.role, ...(user.extraRoles ?? [])]
  const [selected, setSelected] = React.useState<string[]>(allKeys)

  const save = useMutation({
    mutationFn: () => {
      const [primary, ...extra] = selected.length > 0 ? selected : [user.role]
      return adminApi.patch(`/users/${user.id}`, { role: primary, extraRoles: extra })
    },
    onSuccess: onSaved,
  })

  const toggle = (key: string) =>
    setSelected((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev // keep at least one
        return prev.filter((k) => k !== key)
      }
      // super_admin must always be primary — put it first
      if (key === "super_admin") return ["super_admin", ...prev]
      return [...prev, key]
    })

  const primaryKey = selected[0] ?? user.role
  const grantingSuperAdmin = selected.includes("super_admin")

  // super_admin first, then others
  const assignable = [
    ...roles.filter((r) => r.key === "super_admin"),
    ...roles.filter((r) => r.key !== "super_admin"),
  ]

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign roles — {user.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Select one or more roles. The first selected role is the primary. Permissions are the union of all assigned roles.
        </p>
        <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-md border p-3">
          {assignable.map((r) => {
            const isSA = r.key === "super_admin"
            return (
              <label
                key={r.key}
                className={`flex items-start gap-2.5 cursor-pointer rounded-md px-2 py-1.5 -mx-2 transition-colors ${isSA ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" : "hover:bg-muted/50"}`}
              >
                <Checkbox
                  checked={selected.includes(r.key)}
                  onCheckedChange={() => toggle(r.key)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isSA && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.key === primaryKey && selected.length > 1 && (
                      <Badge variant="outline" className="text-[10px] py-0">primary</Badge>
                    )}
                    {isSA && <Badge className="text-[10px] py-0 bg-amber-500/20 text-amber-700 border-amber-300 dark:text-amber-400">Full access</Badge>}
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted-foreground leading-tight">{r.description}</p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
        {grantingSuperAdmin && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
            ⚠️ Granting <strong>Super Admin</strong> gives this user unrestricted access to the entire platform.
          </p>
        )}
        <ErrorNote error={save.error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={selected.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save roles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────────── Users tab ───────────────── */

function UsersTab({ roles }: { roles: AdminRole[] }) {
  const qc = useQueryClient()
  const { companies } = useCompany()
  const { data: users = [] } = useQuery<AdminUser[]>({ queryKey: ["/api/users"], queryFn: () => adminApi.get("/users") })
  const [editingRoles, setEditingRoles] = React.useState<AdminUser | null>(null)

  const patchUser = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => adminApi.patch(`/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/users"] }),
  })
  const deleteUser = useMutation({
    mutationFn: (id: number) => adminApi.del(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/users"] }),
  })

  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key
  const companyName = (id: number) => companies.find((c) => c.id === id)?.name ?? `#${id}`
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/users"] })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Users</CardTitle>
        <InviteDialog roles={roles} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Companies</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const allRoles = [u.role, ...(u.extraRoles ?? [])]
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {allRoles.map((rk, i) => (
                        <Badge key={rk} variant={i === 0 ? "default" : "secondary"} className="text-xs">
                          {roleName(rk)}
                        </Badge>
                      ))}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 ml-0.5"
                        title="Edit roles"
                        onClick={() => setEditingRoles(u)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="text-xs text-muted-foreground">
                      {u.companyIds.length === 0 ? "All / none" : u.companyIds.map(companyName).join(", ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : u.status === "disabled" ? "destructive" : "secondary"}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchUser.mutate({ id: u.id, body: { status: u.status === "disabled" ? "active" : "disabled" } })
                      }
                    >
                      {u.status === "disabled" ? "Enable" : "Disable"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${u.email}?`)) deleteUser.mutate(u.id) }}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
            {users.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <ErrorNote error={patchUser.error || deleteUser.error} />
      </CardContent>
      {editingRoles && (
        <RoleAssignDialog
          user={editingRoles}
          roles={roles}
          onClose={() => setEditingRoles(null)}
          onSaved={() => { invalidate(); setEditingRoles(null) }}
        />
      )}
    </Card>
  )
}

function InviteDialog({ roles }: { roles: AdminRole[] }) {
  const qc = useQueryClient()
  const { companies } = useCompany()
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [name, setName] = React.useState("")
  const [role, setRole] = React.useState("")
  const [department, setDepartment] = React.useState("")
  const [companyIds, setCompanyIds] = React.useState<number[]>([])

  const invite = useMutation({
    mutationFn: () => adminApi.post("/users/invite", { email, name, role, department, companyIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users/invitations"] })
      setOpen(false); setEmail(""); setName(""); setRole(""); setDepartment(""); setCompanyIds([])
    },
  })

  const toggleCompany = (id: number) =>
    setCompanyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus className="w-4 h-4 mr-2" /> Invite user</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Invite a user</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" /></div>
          <div><Label>Name (optional)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {[
                  ...roles.filter((r) => r.key === "super_admin"),
                  ...roles.filter((r) => r.key !== "super_admin"),
                ].map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.key === "super_admin" ? `👑 ${r.name}` : r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role === "super_admin" && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 mt-1.5">
                ⚠️ This user will have unrestricted access to the entire platform.
              </p>
            )}
          </div>
          <div><Label>Department (optional)</Label><Input value={department} onChange={(e) => setDepartment(e.target.value)} /></div>
          <div>
            <Label>Companies</Label>
            <div className="mt-1 max-h-36 overflow-y-auto rounded-md border p-2 space-y-1.5">
              {companies.filter((c) => c.mode !== "parent").map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={companyIds.includes(c.id)} onCheckedChange={() => toggleCompany(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Leave empty for group-wide access.</p>
          </div>
          <ErrorNote error={invite.error} />
        </div>
        <DialogFooter>
          <Button disabled={!email || !role || invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────────── Invitations tab ───────────────── */

function InvitationsTab({ roles }: { roles: AdminRole[] }) {
  const qc = useQueryClient()
  const { data: invites = [] } = useQuery<AdminInvitation[]>({ queryKey: ["/api/users/invitations"], queryFn: () => adminApi.get("/users/invitations") })
  const revoke = useMutation({
    mutationFn: (id: number) => adminApi.post(`/users/invitations/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/users/invitations"] }),
  })
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key

  return (
    <Card>
      <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Sent</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.email}</TableCell>
                <TableCell>{roleName(i.role)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(i.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                </TableCell>
              </TableRow>
            ))}
            {invites.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No pending invitations.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <ErrorNote error={revoke.error} />
      </CardContent>
    </Card>
  )
}

/* ───────────────── Super Admin expanded card ───────────────── */

function SuperAdminCard({ role, permissions }: { role: AdminRole; permissions: PermissionDef[] }) {
  const [expanded, setExpanded] = React.useState(false)

  const groups = React.useMemo(() => {
    const g: Record<string, PermissionDef[]> = {}
    for (const p of permissions) (g[p.group] ??= []).push(p)
    return Object.entries(g)
  }, [permissions])

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <Crown className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold">
              {role.name}
              <Badge variant="secondary" className="text-[10px]">system</Badge>
              <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">Full access</Badge>
            </div>
            <div className="text-xs text-muted-foreground">{role.description}</div>
          </div>
        </div>
        <Button
          size="sm" variant="ghost"
          className="gap-1 text-xs text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Hide powers</> : <><ChevronDown className="w-3.5 h-3.5" /> View powers</>}
        </Button>
      </div>

      {/* Expanded permission breakdown */}
      {expanded && (
        <div className="border-t border-primary/20 px-4 py-3 space-y-3 bg-background/40">
          <p className="text-[11px] text-muted-foreground">
            Super Admin has unrestricted access to every permission on the platform. These powers cannot be edited.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {groups.map(([group, defs]) => (
              <div key={group}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {group}
                </div>
                <div className="flex flex-wrap gap-1">
                  {defs.map((p) => (
                    <span
                      key={p.key}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20"
                    >
                      <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────── Roles tab ───────────────── */

function RolesTab({ roles, permissions }: { roles: AdminRole[]; permissions: PermissionDef[] }) {
  const qc = useQueryClient()
  const [editing, setEditing] = React.useState<AdminRole | null>(null)
  const [creating, setCreating] = React.useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/roles"] })
  const deleteRole = useMutation({ mutationFn: (id: number) => adminApi.del(`/roles/${id}`), onSuccess: invalidate })

  const superAdmin = roles.find((r) => r.key === "super_admin")
  const otherRoles = roles.filter((r) => r.key !== "super_admin")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Roles & permissions</CardTitle>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" /> New role</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Super Admin always first with expanded power view */}
        {superAdmin && <SuperAdminCard role={superAdmin} permissions={permissions} />}

        {otherRoles.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="w-4 h-4 text-primary" /> {r.name}
                {r.isSystem && <Badge variant="secondary" className="text-[10px]">system</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{r.description}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {r.permissions.length} permissions
              </div>
            </div>
            <div className="space-x-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
              {!r.isSystem && (
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete role ${r.name}?`)) deleteRole.mutate(r.id) }}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
        <ErrorNote error={deleteRole.error} />
      </CardContent>
      {(editing || creating) && (
        <RoleDialog
          role={editing}
          permissions={permissions}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { invalidate(); setEditing(null); setCreating(false) }}
        />
      )}
    </Card>
  )
}

function RoleDialog({
  role, permissions, onClose, onSaved,
}: { role: AdminRole | null; permissions: PermissionDef[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(role?.name ?? "")
  const [description, setDescription] = React.useState(role?.description ?? "")
  const [perms, setPerms] = React.useState<string[]>(role?.permissions.filter((p) => p !== "*") ?? [])

  const save = useMutation({
    mutationFn: () =>
      role
        ? adminApi.patch(`/roles/${role.id}`, { name, description, permissions: perms })
        : adminApi.post("/roles", { name, description, permissions: perms }),
    onSuccess: onSaved,
  })

  const groups = React.useMemo(() => {
    const g: Record<string, PermissionDef[]> = {}
    for (const p of permissions) (g[p.group] ??= []).push(p)
    return g
  }, [permissions])

  const toggle = (key: string) => setPerms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{role ? `Edit ${role.name}` : "Create role"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} disabled={role?.isSystem} /></div>
          <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {Object.entries(groups).map(([group, defs]) => (
              <div key={group}>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{group}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {defs.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ErrorNote error={save.error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ───────────────── Page ───────────────── */

export default function AccessControlPage() {
  const { data: roles = [] } = useQuery<AdminRole[]>({ queryKey: ["/api/roles"], queryFn: () => adminApi.get("/roles") })
  const { data: permissions = [] } = useQuery<PermissionDef[]>({ queryKey: ["/api/permissions"], queryFn: () => adminApi.get("/permissions") })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team & Roles</h1>
        <p className="text-muted-foreground">Invite people, assign roles, and manage what each role can access.</p>
      </div>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersTab roles={roles} /></TabsContent>
        <TabsContent value="invitations" className="mt-4"><InvitationsTab roles={roles} /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RolesTab roles={roles} permissions={permissions} /></TabsContent>
      </Tabs>
    </div>
  )
}
