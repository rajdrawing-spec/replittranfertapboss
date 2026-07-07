import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Search, Plus, Truck, Package, MapPin, Pencil, Trash2, RefreshCw, Undo2 } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface Shipment {
  id: number; companyId: number; orderNumber: string | null; courier: string; trackingNumber: string | null
  status: string; customerName: string; destination: string | null; shippingCost: number | null
  returnReason: string | null; returnedAt: string | null; lastSyncedAt: string | null
}
const COURIERS = ["Shiprocket", "Delhivery", "Blue Dart", "DTDC", "India Post"]
const STATUSES = ["processing", "picked_up", "in_transit", "out_for_delivery", "delivered", "rto", "returned"]
const STATUS_COLORS: Record<string, string> = {
  processing: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  picked_up: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  in_transit: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  out_for_delivery: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  delivered: "bg-green-500/10 text-green-400 border-green-500/20",
  rto: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  returned: "bg-red-500/10 text-red-400 border-red-500/20",
}
const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString() : null)

interface Form { orderNumber: string; courier: string; trackingNumber: string; status: string; customerName: string; destination: string; shippingCost: string }
const emptyForm = (): Form => ({ orderNumber: "", courier: "Shiprocket", trackingNumber: "", status: "processing", customerName: "", destination: "", shippingCost: "" })

export default function Shipping() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Shipment[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [view, setView] = React.useState<"all" | "returns">("all")
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Shipment | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [syncingId, setSyncingId] = React.useState<number | null>(null)
  const [returnTarget, setReturnTarget] = React.useState<Shipment | null>(null)
  const [returnReason, setReturnReason] = React.useState("")
  const [returning, setReturning] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      if (view === "returns") p.set("view", "returns")
      else if (statusFilter !== "all") p.set("status", statusFilter)
      if (search.trim()) p.set("q", search.trim())
      const res = await fetch(`/api/shipments?${p}`, { credentials: "include" })
      setRows(await res.json())
    } catch { toast({ title: "Failed to load shipments", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, statusFilter, search, view, toast])

  React.useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  const stats = React.useMemo(() => ({
    total: rows.length,
    inTransit: rows.filter((r) => ["in_transit", "out_for_delivery", "picked_up"].includes(r.status)).length,
    delivered: rows.filter((r) => r.status === "delivered").length,
    issues: rows.filter((r) => ["rto", "returned"].includes(r.status)).length,
  }), [rows])

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(s: Shipment) {
    setEditing(s)
    setForm({ orderNumber: s.orderNumber ?? "", courier: s.courier, trackingNumber: s.trackingNumber ?? "", status: s.status, customerName: s.customerName, destination: s.destination ?? "", shippingCost: String(s.shippingCost ?? "") })
    setShowDialog(true)
  }
  async function save() {
    if (!form.customerName) { toast({ title: "Customer name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: any = { ...form, shippingCost: form.shippingCost ? parseFloat(form.shippingCost) : 0 }
      if (!editing) body.companyId = activeCompany!.id
      const res = await fetch(editing ? `/api/shipments/${editing.id}` : "/api/shipments", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Shipment updated" : "Shipment created" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Delete this shipment?")) return
    try { await fetch(`/api/shipments/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Deleted" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  function openReturn(s: Shipment) { setReturnTarget(s); setReturnReason(s.returnReason ?? ""); }
  async function submitReturn() {
    if (!returnTarget) return
    if (!returnReason.trim()) { toast({ title: "Return reason required", variant: "destructive" }); return }
    setReturning(true)
    try {
      const res = await fetch(`/api/shipments/${returnTarget.id}/return`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ reason: returnReason.trim() }),
      })
      if (!res.ok) throw new Error()
      toast({ title: "Marked as returned" }); setReturnTarget(null); setReturnReason(""); load()
    } catch { toast({ title: "Failed to mark returned", variant: "destructive" }) }
    finally { setReturning(false) }
  }

  async function syncTracking(s: Shipment) {
    setSyncingId(s.id)
    try {
      const res = await fetch(`/api/shipments/${s.id}/sync-tracking`, { method: "POST", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error()
      toast({
        title: data.connected ? "Tracking synced" : "Not connected",
        description: data.message,
        variant: data.ok ? undefined : "destructive",
      })
      load()
    } catch { toast({ title: "Sync failed", variant: "destructive" }) }
    finally { setSyncingId(null) }
  }

  const colSpan = view === "returns" ? 8 : 8

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="w-6 h-6 text-primary" /> Shipping</h1>
          <p className="text-sm text-muted-foreground mt-1">Track shipments across Shiprocket, Delhivery, Blue Dart, DTDC & India Post</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> New Shipment</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ l: "Total", v: stats.total, c: "text-foreground" }, { l: "In Transit", v: stats.inTransit, c: "text-indigo-400" }, { l: "Delivered", v: stats.delivered, c: "text-green-400" }, { l: "RTO / Returns", v: stats.issues, c: "text-orange-400" }].map((s) => (
          <Card key={s.l}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{s.l}</div><div className={`text-2xl font-bold mt-1 ${s.c}`}>{s.v}</div></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={view === "all" ? "default" : "outline"} size="sm" onClick={() => setView("all")}>All Shipments</Button>
        <Button variant={view === "returns" ? "default" : "outline"} size="sm" onClick={() => setView("returns")}><Undo2 className="w-4 h-4 mr-1.5" /> Returns / RTO</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracking, customer, order…" className="pl-9" />
        </div>
        {view === "all" && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tracking</TableHead><TableHead>Order</TableHead><TableHead>Customer</TableHead>
                <TableHead>Courier</TableHead>
                {view === "returns" ? <TableHead>Return Reason</TableHead> : <TableHead>Destination</TableHead>}
                <TableHead>Status</TableHead><TableHead>Last Synced</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={colSpan} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={colSpan} className="text-center py-10 text-muted-foreground">{view === "returns" ? "No returns or RTO shipments." : "No shipments found."}</TableCell></TableRow>
              ) : rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.trackingNumber || "—"}</TableCell>
                  <TableCell className="text-sm">{s.orderNumber || "—"}</TableCell>
                  <TableCell className="font-medium">{s.customerName}</TableCell>
                  <TableCell><span className="flex items-center gap-1.5 text-sm"><Package className="w-3.5 h-3.5 text-muted-foreground" />{s.courier}</span></TableCell>
                  {view === "returns" ? (
                    <TableCell className="text-sm text-muted-foreground max-w-[16rem] truncate" title={s.returnReason ?? undefined}>{s.returnReason || "—"}</TableCell>
                  ) : (
                    <TableCell><span className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="w-3.5 h-3.5" />{s.destination || "—"}</span></TableCell>
                  )}
                  <TableCell><Badge variant="outline" className={STATUS_COLORS[s.status]}>{label(s.status)}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(s.lastSyncedAt) ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" title="Sync tracking" disabled={syncingId === s.id} onClick={() => syncTracking(s)}>
                      <RefreshCw className={`w-4 h-4 ${syncingId === s.id ? "animate-spin" : ""}`} />
                    </Button>
                    {s.status !== "returned" && (
                      <Button variant="ghost" size="icon" title="Mark returned" className="text-orange-400" onClick={() => openReturn(s)}><Undo2 className="w-4 h-4" /></Button>
                    )}
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title="Delete" className="text-red-400" onClick={() => del(s.id)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Shipment" : "New Shipment"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div><Label>Customer *</Label><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></div>
            <div><Label>Order Number</Label><Input value={form.orderNumber} onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} /></div>
            <div><Label>Courier</Label>
              <Select value={form.courier} onValueChange={(v) => setForm({ ...form, courier: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COURIERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Tracking Number</Label><Input value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} /></div>
            <div><Label>Destination</Label><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></div>
            <div><Label>Shipping Cost (₹)</Label><Input type="number" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} /></div>
            <div className="col-span-2"><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnTarget} onOpenChange={(o) => { if (!o) { setReturnTarget(null); setReturnReason("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Shipment as Returned</DialogTitle>
            <DialogDescription>{returnTarget ? `${returnTarget.customerName}${returnTarget.trackingNumber ? ` · ${returnTarget.trackingNumber}` : ""}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label>Return Reason *</Label>
            <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="e.g. Customer refused delivery, damaged in transit, wrong address…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReturnTarget(null); setReturnReason("") }}>Cancel</Button>
            <Button variant="destructive" onClick={submitReturn} disabled={returning}>{returning ? "Saving…" : "Mark Returned"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
