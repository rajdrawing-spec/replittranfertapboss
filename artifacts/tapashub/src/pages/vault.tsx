import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Search, Plus, Eye, EyeOff, Copy, Pencil, Trash2, ShieldCheck, KeyRound, Phone, Mail, User } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface VaultEntry {
  id: number
  companyId: number | null
  platform: string
  username: string | null
  email: string | null
  phone: string | null
  password: string
  recoveryEmail: string | null
  recoveryPhone: string | null
  twoFactorEnabled: boolean
  owner: string | null
  notes: string | null
}

interface Form {
  platform: string; username: string; email: string; phone: string; password: string
  recoveryEmail: string; recoveryPhone: string; owner: string; notes: string; twoFactorEnabled: boolean
}
const emptyForm = (): Form => ({ platform: "", username: "", email: "", phone: "", password: "", recoveryEmail: "", recoveryPhone: "", owner: "", notes: "", twoFactorEnabled: false })

export default function Vault() {
  const { activeCompany, isParentView } = useCompany()
  const { toast } = useToast()
  const [entries, setEntries] = React.useState<VaultEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [revealed, setRevealed] = React.useState<Record<number, string>>({})
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<VaultEntry | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeCompany) params.set("companyId", String(activeCompany.id))
      if (search.trim()) params.set("q", search.trim())
      const res = await fetch(`/api/vault?${params}`, { credentials: "include" })
      setEntries(await res.json())
    } catch { toast({ title: "Failed to load vault", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [search, activeCompany, toast])

  React.useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  async function reveal(id: number) {
    if (revealed[id]) { setRevealed((r) => { const n = { ...r }; delete n[id]; return n }); return }
    try {
      const res = await fetch(`/api/vault/${id}/reveal`, { credentials: "include" })
      if (res.status === 403) { toast({ title: "Not authorized", description: "You cannot view passwords.", variant: "destructive" }); return }
      const data = await res.json()
      setRevealed((r) => ({ ...r, [id]: data.password }))
    } catch { toast({ title: "Failed to reveal", variant: "destructive" }) }
  }

  async function copyPw(id: number) {
    let pw = revealed[id]
    if (!pw) {
      const res = await fetch(`/api/vault/${id}/reveal`, { credentials: "include" })
      if (!res.ok) { toast({ title: "Not authorized", variant: "destructive" }); return }
      pw = (await res.json()).password
    }
    await navigator.clipboard.writeText(pw!)
    toast({ title: "Password copied" })
  }

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(e: VaultEntry) {
    setEditing(e)
    setForm({ platform: e.platform, username: e.username ?? "", email: e.email ?? "", phone: e.phone ?? "", password: "", recoveryEmail: e.recoveryEmail ?? "", recoveryPhone: e.recoveryPhone ?? "", owner: e.owner ?? "", notes: e.notes ?? "", twoFactorEnabled: e.twoFactorEnabled })
    setShowDialog(true)
  }

  async function save() {
    if (!form.platform || (!editing && !form.password)) { toast({ title: "Platform and password required", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: any = { ...form, companyId: activeCompany?.id ?? null }
      if (editing && !form.password) delete body.password
      const res = await fetch(editing ? `/api/vault/${editing.id}` : "/api/vault", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Entry updated" : "Entry added" })
      setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }

  async function del(id: number) {
    if (!confirm("Delete this vault entry?")) return
    try {
      await fetch(`/api/vault/${id}`, { method: "DELETE", credentials: "include" })
      toast({ title: "Entry deleted" }); load()
    } catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="w-6 h-6 text-primary" /> Password Vault</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isParentView ? "All accounts across TapasHub Group" : `${activeCompany?.name} accounts`} · passwords are masked and access-controlled
          </p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Entry</Button>
      </div>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by platform, email, phone (e.g. 9866369148), owner…" className="pl-9" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading vault…</div>
      ) : entries.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No vault entries found.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <Card key={e.id} className="group hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{e.platform}</div>
                    {e.owner && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><User className="w-3 h-3" /> {e.owner}</div>}
                  </div>
                  {e.twoFactorEnabled && <Badge variant="outline" className="text-green-400 border-green-500/30 bg-green-500/10 shrink-0"><ShieldCheck className="w-3 h-3 mr-1" /> 2FA</Badge>}
                </div>

                <div className="space-y-1.5 text-sm">
                  {e.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{e.email}</span></div>}
                  {e.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{e.phone}</span></div>}
                </div>

                <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <code className="text-sm flex-1 truncate font-mono">{revealed[e.id] ?? "••••••••••"}</code>
                  <button onClick={() => reveal(e.id)} className="text-muted-foreground hover:text-foreground" title="Show/Hide">
                    {revealed[e.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => copyPw(e.id)} className="text-muted-foreground hover:text-foreground" title="Copy"><Copy className="w-4 h-4" /></button>
                </div>

                {(e.recoveryEmail || e.recoveryPhone) && (
                  <div className="text-[11px] text-muted-foreground border-t pt-2">
                    Recovery: {[e.recoveryEmail, e.recoveryPhone].filter(Boolean).join(" · ")}
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
          <DialogHeader><DialogTitle>{editing ? "Edit Vault Entry" : "Add Vault Entry"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Platform *</Label><Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="Shopify Admin" /></div>
            <div><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><Label>Owner</Label><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="col-span-2"><Label>Password {editing && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>} {!editing && "*"}</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><Label>Recovery Email</Label><Input value={form.recoveryEmail} onChange={(e) => setForm({ ...form, recoveryEmail: e.target.value })} /></div>
            <div><Label>Recovery Phone</Label><Input value={form.recoveryPhone} onChange={(e) => setForm({ ...form, recoveryPhone: e.target.value })} /></div>
            <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="col-span-2 flex items-center gap-2"><Switch checked={form.twoFactorEnabled} onCheckedChange={(v) => setForm({ ...form, twoFactorEnabled: v })} /><Label>Two-Factor Authentication enabled</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Add Entry"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
