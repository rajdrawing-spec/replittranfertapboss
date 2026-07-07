import * as React from "react"
import { useListEmployees, getListEmployeesQueryKey, useListCompanies } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Search, Plus, Pencil, Trash2, Users, Mail, Building2 } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

const API_BASE = ""
const DEPTS = ["Engineering", "Sales", "Marketing", "Finance", "Operations", "HR", "Design", "Customer Support", "Logistics", "Management"]
const STATUS_OPTS = ["active", "on_leave", "inactive", "terminated"]

interface EmpForm {
  companyId: string; firstName: string; lastName: string; email: string; phone: string
  department: string; designation: string; status: string; joinDate: string; salary: string
}
const emptyForm = (): EmpForm => ({
  companyId: "", firstName: "", lastName: "", email: "", phone: "",
  department: "Engineering", designation: "", status: "active",
  joinDate: new Date().toISOString().slice(0, 10), salary: "0",
})

export default function HR() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [form, setForm] = React.useState<EmpForm>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<number | null>(null)

  const { data: companies } = useListCompanies({ query: { enabled: true, queryKey: ["/api/companies"] } })
  const params: Record<string, string | number> = { page, limit: 20 }
  if (activeCompany) params.companyId = activeCompany.id
  if (search) params.search = search

  const { data, isLoading, refetch } = useListEmployees(params, {
    query: { enabled: true, queryKey: getListEmployeesQueryKey(params) }
  })

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm(), companyId: activeCompany ? String(activeCompany.id) : "" })
    setShowDialog(true)
  }
  function openEdit(e: any) {
    setEditing(e)
    setForm({
      companyId: String(e.companyId), firstName: e.firstName, lastName: e.lastName,
      email: e.email, phone: e.phone ?? "", department: e.department, designation: e.designation,
      status: e.status, joinDate: e.joinDate, salary: String(e.salary ?? 0),
    })
    setShowDialog(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        companyId: parseInt(form.companyId), firstName: form.firstName, lastName: form.lastName,
        email: form.email, phone: form.phone || null, department: form.department,
        designation: form.designation, status: form.status, joinDate: form.joinDate,
        salary: parseFloat(form.salary),
      }
      const url = editing ? `${API_BASE}/api/employees/${editing.id}` : `${API_BASE}/api/employees`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Employee updated" : "Employee added" })
      setShowDialog(false); refetch()
    } catch {
      toast({ title: "Error", description: "Could not save employee", variant: "destructive" })
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this employee record?")) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/employees/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error()
      toast({ title: "Employee removed" }); refetch()
    } catch {
      toast({ title: "Error", description: "Could not delete", variant: "destructive" })
    } finally { setDeleting(null) }
  }

  const f = (k: keyof EmpForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))
  const statusColor: Record<string, string> = {
    active: "bg-green-500/10 text-green-400 border-green-500/20",
    on_leave: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    inactive: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    terminated: "bg-red-500/10 text-red-400 border-red-500/20",
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">HR & People</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{activeCompany ? `${activeCompany.name} · ` : "All companies · "}{data?.total ?? 0} employees</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Employee</Button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search employees…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9 max-w-sm" />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Designation</TableHead>
                  <TableHead>Company</TableHead><TableHead>Department</TableHead>
                  <TableHead>Salary</TableHead><TableHead>Status</TableHead><TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                )) : data?.items?.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center">
                    <Users className="mx-auto h-8 w-8 opacity-20 mb-2" />
                    <p className="text-muted-foreground">No employees found</p>
                  </TableCell></TableRow>
                ) : data?.items?.map((e: any) => (
                  <TableRow key={e.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {e.firstName[0]}{e.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{e.firstName} {e.lastName}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="w-3 h-3" />{e.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{e.designation}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">
                        <Building2 className="w-3 h-3 mr-1 opacity-50" />{e.companyName}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.department}</TableCell>
                    <TableCell className="font-semibold text-sm">₹{Number(e.salary).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${statusColor[e.status] ?? ""}`}>
                        {e.status.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" disabled={deleting === e.id} onClick={() => handleDelete(e.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data && data.total > 20 && (
            <div className="flex justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {page} of {Math.ceil(data.total / 20)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="col-span-2 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => f("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>First Name *</Label><Input value={form.firstName} onChange={e => f("firstName", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Last Name *</Label><Input value={form.lastName} onChange={e => f("lastName", e.target.value)} /></div>
            <div className="col-span-2 space-y-1.5"><Label>Email *</Label><Input value={form.email} onChange={e => f("email", e.target.value)} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={e => f("phone", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Join Date</Label><Input value={form.joinDate} onChange={e => f("joinDate", e.target.value)} type="date" /></div>
            <div className="space-y-1.5">
              <Label>Department *</Label>
              <Select value={form.department} onValueChange={v => f("department", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Designation *</Label><Input value={form.designation} onChange={e => f("designation", e.target.value)} placeholder="e.g. Software Engineer" /></div>
            <div className="space-y-1.5"><Label>Salary (₹)</Label><Input value={form.salary} onChange={e => f("salary", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.firstName || !form.email || !form.companyId || !form.designation}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
