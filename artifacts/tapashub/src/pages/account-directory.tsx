import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  Search, Plus, Pencil, Trash2, Contact, Phone, Mail, User, Building2,
  ExternalLink, CalendarClock, ShieldCheck,
} from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface AccountEntry {
  id: number
  companyId: number | null
  platform: string
  platformUrl: string | null
  loginEmail: string | null
  recoveryEmail: string | null
  phone: string | null
  recoveryPhone: string | null
  googleLinked: boolean
  microsoftLinked: boolean
  accountOwner: string | null
  department: string | null
  notes: string | null
  lastLoginDate: string | null
  isActive: boolean
}

interface Form {
  platform: string; platformUrl: string; loginEmail: string; recoveryEmail: string
  phone: string; recoveryPhone: string; accountOwner: string; department: string
  notes: string; lastLoginDate: string; googleLinked: boolean; microsoftLinked: boolean; isActive: boolean
}

const emptyForm = (): Form => ({
  platform: "", platformUrl: "", loginEmail: "", recoveryEmail: "", phone: "", recoveryPhone: "",
  accountOwner: "", department: "", notes: "", lastLoginDate: "", googleLinked: false, microsoftLinked: false, isActive: true,
})

export default function AccountDirectory() {
  const { activeCompany, isParentView } = useCompany()
  const { toast } = useToast()
  const [entries, setEntries] = React.useState<AccountEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<AccountEntry | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeCompany) params.set("companyId", String(activeCompany.id))
      if (search.trim()) params.set("q", search.trim())
      const res = await fetch(`/api/account-directory?${params}`, { credentials: "include" })
      setEntries(await res.json())
    } catch { toast({ title: "Failed to load accounts", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [search, activeCompany, toast])

  React.useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(e: AccountEntry) {
    setEditing(e)
    setForm({
      platform: e.platform, platformUrl: e.platformUrl ?? "", loginEmail: e.loginEmail ?? "",
      recoveryEmail: e.recoveryEmail ?? "", phone: e.phone ?? "", recoveryPhone: e.recoveryPhone ?? "",
      accountOwner: e.accountOwner ?? "", department: e.department ?? "", notes: e.notes ?? "",
      lastLoginDate: e.lastLoginDate ?? "", googleLinked: e.googleLinked, microsoftLinked: e.microsoftLinked,
      isActive: e.isActive,
    })
    setShowDialog(true)
  }

  async function save() {
    if (!form.platform.trim()) { toast({ title: "Platform is required", variant: "destructive" }); return }
    setSaving(true)
    try {
      // Normalize empty strings to null (keeps DB clean; date must be null when blank).
      const clean = (v: string) => (v.trim() ? v.trim() : null)
      const body = {
        companyId: activeCompany?.id ?? null,
        platform: form.platform.trim(),
        platformUrl: clean(form.platformUrl),
        loginEmail: clean(form.loginEmail),
        recoveryEmail: clean(form.recoveryEmail),
        phone: clean(form.phone),
        recoveryPhone: clean(form.recoveryPhone),
        accountOwner: clean(form.accountOwner),
        department: clean(form.department),
        notes: clean(form.notes),
        lastLoginDate: clean(form.lastLoginDate),
        googleLinked: form.googleLinked,
        microsoftLinked: form.microsoftLinked,
        isActive: form.isActive,
      }
      const res = await fetch(editing ? `/api/account-directory/${editing.id}` : "/api/account-directory", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Account updated" : "Account added" })
      setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }

  async function del(id: number) {
    if (!confirm("Delete this account entry?")) return
    try {
      await fetch(`/api/account-directory/${id}`, { method: "DELETE", credentials: "include" })
      toast({ title: "Account deleted" }); load()
    } catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Contact className="w-6 h-6 text-primary" /> Account Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isParentView ? "All platform accounts across TapasHub Group" : `${activeCompany?.name} platform accounts`} · metadata only, never passwords
          </p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Account</Button>
      </div>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by platform, email, phone (e.g. 9866369148), owner…" className="pl-9" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading accounts…</div>
      ) : entries.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Contact className="w-10 h-10 mx-auto mb-3 opacity-20" />
          No account entries found.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <Card key={e.id} className="group hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{e.platform}</div>
                    {e.accountOwner && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><User className="w-3 h-3" /> {e.accountOwner}{e.department ? ` · ${e.department}` : ""}</div>}
                  </div>
                  <Badge variant={e.isActive ? "success" : "outline"} className="uppercase text-[10px] shrink-0">
                    {e.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm">
                  {e.loginEmail && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{e.loginEmail}</span></div>}
                  {e.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{e.phone}</span></div>}
                  {e.platformUrl && (
                    <a href={e.platformUrl.startsWith("http") ? e.platformUrl : `https://${e.platformUrl}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors">
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{e.platformUrl.replace(/^https?:\/\//, "")}</span>
                    </a>
                  )}
                </div>

                {(e.googleLinked || e.microsoftLinked) && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.googleLinked && <Badge variant="outline" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Google linked</Badge>}
                    {e.microsoftLinked && <Badge variant="outline" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Microsoft linked</Badge>}
                  </div>
                )}

                {(e.recoveryEmail || e.recoveryPhone || e.lastLoginDate) && (
                  <div className="text-[11px] text-muted-foreground border-t pt-2 space-y-1">
                    {(e.recoveryEmail || e.recoveryPhone) && (
                      <div>Recovery: {[e.recoveryEmail, e.recoveryPhone].filter(Boolean).join(" · ")}</div>
                    )}
                    {e.lastLoginDate && <div className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Last login {e.lastLoginDate}</div>}
                  </div>
                )}

                <div className="flex gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300" onClick={() => del(e.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Account" : "Add Account"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Platform *</Label><Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Shopify, Google, Meta Business…" /></div>
            <div className="col-span-2"><Label>Platform URL</Label><Input value={form.platformUrl} onChange={(e) => setForm({ ...form, platformUrl: e.target.value })} placeholder="https://admin.shopify.com" /></div>
            <div><Label>Login Email</Label><Input value={form.loginEmail} onChange={(e) => setForm({ ...form, loginEmail: e.target.value })} /></div>
            <div><Label>Recovery Email</Label><Input value={form.recoveryEmail} onChange={(e) => setForm({ ...form, recoveryEmail: e.target.value })} /></div>
            <div><Label>Phone Number</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Recovery Phone</Label><Input value={form.recoveryPhone} onChange={(e) => setForm({ ...form, recoveryPhone: e.target.value })} /></div>
            <div><Label>Account Owner</Label><Input value={form.accountOwner} onChange={(e) => setForm({ ...form, accountOwner: e.target.value })} /></div>
            <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
            <div><Label>Last Login Date</Label><Input type="date" value={form.lastLoginDate} onChange={(e) => setForm({ ...form, lastLoginDate: e.target.value })} /></div>
            <div className="flex items-end pb-2 gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} /><Label>Active</Label></div>
            <div className="col-span-2 flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2"><Switch checked={form.googleLinked} onCheckedChange={(v) => setForm({ ...form, googleLinked: v })} /><Label>Google linked</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.microsoftLinked} onCheckedChange={(v) => setForm({ ...form, microsoftLinked: v })} /><Label>Microsoft linked</Label></div>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Add Account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
