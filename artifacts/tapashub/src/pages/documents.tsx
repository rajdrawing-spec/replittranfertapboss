import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Search, Plus, FileText, Pencil, Trash2, Calendar, Building2 } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface Doc {
  id: number; companyId: number | null; name: string; category: string; issuer: string | null
  referenceNumber: string | null; expiresAt: string | null; owner: string | null; notes: string | null
}
const CATEGORIES = [
  { v: "gst", l: "GST" }, { v: "trademark", l: "Trademark" }, { v: "invoice", l: "Invoice" },
  { v: "vendor_agreement", l: "Vendor Agreement" }, { v: "brand_asset", l: "Brand Asset" },
  { v: "certificate", l: "Certificate" }, { v: "other", l: "Other" },
]
const CAT_COLORS: Record<string, string> = {
  gst: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  trademark: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  invoice: "bg-green-500/10 text-green-400 border-green-500/20",
  vendor_agreement: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  brand_asset: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  certificate: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  other: "bg-muted text-muted-foreground",
}
const catLabel = (v: string) => CATEGORIES.find((c) => c.v === v)?.l ?? v

interface Form { name: string; category: string; issuer: string; referenceNumber: string; expiresAt: string; owner: string; notes: string }
const emptyForm = (): Form => ({ name: "", category: "gst", issuer: "", referenceNumber: "", expiresAt: "", owner: "", notes: "" })

export default function Documents() {
  const { activeCompany, isParentView } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Doc[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [catFilter, setCatFilter] = React.useState("all")
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Doc | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      if (catFilter !== "all") p.set("category", catFilter)
      if (search.trim()) p.set("q", search.trim())
      const res = await fetch(`/api/documents?${p}`, { credentials: "include" })
      setRows(await res.json())
    } catch { toast({ title: "Failed to load documents", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, catFilter, search, toast])

  React.useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(d: Doc) {
    setEditing(d)
    setForm({ name: d.name, category: d.category, issuer: d.issuer ?? "", referenceNumber: d.referenceNumber ?? "", expiresAt: d.expiresAt ? d.expiresAt.slice(0, 10) : "", owner: d.owner ?? "", notes: d.notes ?? "" })
    setShowDialog(true)
  }
  async function save() {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: any = { ...form, companyId: activeCompany?.id ?? null, expiresAt: form.expiresAt || null }
      const res = await fetch(editing ? `/api/documents/${editing.id}` : "/api/documents", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Document updated" : "Document added" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Delete this document?")) return
    try { await fetch(`/api/documents/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Deleted" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  const isExpiringSoon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 60

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6 text-primary" /> Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">{isParentView ? "GST, trademarks, invoices & certificates across the group" : `${activeCompany?.name} legal & compliance vault`}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Document</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, reference…" className="pl-9" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading documents…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No documents found.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.id} className="group hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-muted-foreground" /></div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{d.name}</div>
                      {d.referenceNumber && <div className="text-xs text-muted-foreground truncate">{d.referenceNumber}</div>}
                    </div>
                  </div>
                  <Badge variant="outline" className={CAT_COLORS[d.category]}>{catLabel(d.category)}</Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {d.issuer && <div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {d.issuer}</div>}
                  {d.expiresAt && (
                    <div className={`flex items-center gap-1.5 ${isExpiringSoon(d.expiresAt) ? "text-orange-400" : ""}`}>
                      <Calendar className="w-3.5 h-3.5" /> Expires {new Date(d.expiresAt).toLocaleDateString()} {isExpiringSoon(d.expiresAt) && "· soon"}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(d)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button variant="outline" size="sm" className="text-red-400" onClick={() => del(d.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Document" : "Add Document"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Issuer</Label><Input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} /></div>
            <div><Label>Reference Number</Label><Input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} /></div>
            <div><Label>Expires At</Label><Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
            <div><Label>Owner</Label><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></div>
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
