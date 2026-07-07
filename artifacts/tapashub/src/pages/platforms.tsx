import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Globe, Pencil, Trash2, ExternalLink, RefreshCw, User, Layers } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface Platform {
  id: number; companyId: number; name: string; category: string; status: string
  accountOwner: string | null; accountHandle: string | null; lastSyncAt: string | null; notes: string | null
}
const CATEGORIES = [
  { v: "storefront", l: "Storefront" }, { v: "marketplace", l: "Marketplace" }, { v: "social", l: "Social" },
  { v: "ads", l: "Ads" }, { v: "payments", l: "Payments" }, { v: "shipping", l: "Shipping" }, { v: "productivity", l: "Productivity" },
]
const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-500/10 text-green-400 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  disconnected: "bg-muted text-muted-foreground",
}
const CAT_COLORS: Record<string, string> = {
  storefront: "text-blue-400", marketplace: "text-purple-400", social: "text-pink-400",
  ads: "text-red-400", payments: "text-green-400", shipping: "text-indigo-400", productivity: "text-amber-400",
}
const catLabel = (v: string) => CATEGORIES.find((c) => c.v === v)?.l ?? v
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const timeAgo = (d: string | null) => {
  if (!d) return "never"
  const diff = Date.now() - new Date(d).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return "just now"
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface Form { name: string; category: string; status: string; accountOwner: string; accountHandle: string; notes: string }
const emptyForm = (): Form => ({ name: "", category: "marketplace", status: "connected", accountOwner: "", accountHandle: "", notes: "" })

export default function Platforms() {
  const { activeCompany, isParentView } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Platform[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Platform | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      const res = await fetch(`/api/platforms?${p}`, { credentials: "include" })
      setRows(await res.json())
    } catch { toast({ title: "Failed to load platforms", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, toast])

  React.useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(p: Platform) {
    setEditing(p)
    setForm({ name: p.name, category: p.category, status: p.status, accountOwner: p.accountOwner ?? "", accountHandle: p.accountHandle ?? "", notes: p.notes ?? "" })
    setShowDialog(true)
  }
  async function save() {
    if (!form.name) { toast({ title: "Platform name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: any = { ...form }
      if (!editing) body.companyId = activeCompany!.id
      const res = await fetch(editing ? `/api/platforms/${editing.id}` : "/api/platforms", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Platform updated" : "Platform added" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Remove this platform?")) return
    try { await fetch(`/api/platforms/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Removed" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }
  async function sync(p: Platform) {
    try {
      await fetch(`/api/platforms/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ lastSyncAt: new Date().toISOString(), status: "connected" }) })
      toast({ title: `${p.name} synced` }); load()
    } catch { toast({ title: "Sync failed", variant: "destructive" }) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6 text-primary" /> Platform Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">{isParentView ? "Connected platforms across all brands" : `${activeCompany?.name} sales channels, social & tools`}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Platform</Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading platforms…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No platforms connected. {isParentView && "Switch to a brand workspace to manage its platforms."}</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <Card key={p.id} className="group hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0"><Globe className={`w-5 h-5 ${CAT_COLORS[p.category] || "text-muted-foreground"}`} /></div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{catLabel(p.category)}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={STATUS_COLORS[p.status]}>{cap(p.status)}</Badge>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {p.accountOwner && <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {p.accountOwner}</div>}
                  <div className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Last sync {timeAgo(p.lastSyncAt)}</div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => sync(p)}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Sync</Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="outline" size="sm" className="text-red-400" onClick={() => del(p.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Platform" : "Add Platform"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Platform Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shopify, Amazon, Meta Business…" /></div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["connected", "pending", "error", "disconnected"].map((s) => <SelectItem key={s} value={s}>{cap(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Account Owner</Label><Input value={form.accountOwner} onChange={(e) => setForm({ ...form, accountOwner: e.target.value })} /></div>
            <div><Label>Handle / Store</Label><Input value={form.accountHandle} onChange={(e) => setForm({ ...form, accountHandle: e.target.value })} /></div>
            <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
