import * as React from "react"
import { useListOrders, getListOrdersQueryKey, useListCompanies } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Search, Plus, Pencil, Trash2, ShoppingBag, X } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

const API_BASE = ""
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  confirmed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  processing: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  shipped: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  delivered: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  returned: "bg-orange-500/10 text-orange-400 border-orange-500/20",
}
const STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]
const CHANNELS = ["direct", "shopify", "shopdeck", "amazon", "flipkart", "whatsapp", "website"]

interface OrderForm {
  companyId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  totalAmount: string
  itemCount: string
  status: string
  channel: string
  shippingAddress: string
  notes: string
}

const emptyForm = (): OrderForm => ({
  companyId: "", customerName: "", customerEmail: "", customerPhone: "",
  totalAmount: "", itemCount: "1", status: "pending", channel: "direct",
  shippingAddress: "", notes: "",
})

export default function Orders() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [form, setForm] = React.useState<OrderForm>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<number | null>(null)

  const { data: companies } = useListCompanies({ query: { enabled: true, queryKey: ["/api/companies"] } })

  const params: Record<string, string | number> = { page, limit: 20 }
  if (activeCompany) params.companyId = activeCompany.id
  if (statusFilter !== "all") params.status = statusFilter
  if (search) params.search = search

  const { data, isLoading, refetch } = useListOrders(params, {
    query: { enabled: true, queryKey: getListOrdersQueryKey(params) }
  })

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm(), companyId: activeCompany ? String(activeCompany.id) : "" })
    setShowDialog(true)
  }

  function openEdit(order: any) {
    setEditing(order)
    setForm({
      companyId: String(order.companyId), customerName: order.customerName,
      customerEmail: order.customerEmail ?? "", customerPhone: order.customerPhone ?? "",
      totalAmount: String(order.totalAmount), itemCount: String(order.itemCount),
      status: order.status, channel: order.channel, shippingAddress: order.shippingAddress ?? "",
      notes: order.notes ?? "",
    })
    setShowDialog(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        companyId: parseInt(form.companyId),
        customerName: form.customerName,
        customerEmail: form.customerEmail || null,
        customerPhone: form.customerPhone || null,
        totalAmount: parseFloat(form.totalAmount),
        itemCount: parseInt(form.itemCount),
        status: form.status,
        channel: form.channel,
        shippingAddress: form.shippingAddress || null,
        notes: form.notes || null,
      }
      const url = editing
        ? `${API_BASE}/api/orders/${editing.id}`
        : `${API_BASE}/api/orders`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast({ title: editing ? "Order updated" : "Order created" })
      setShowDialog(false)
      refetch()
    } catch {
      toast({ title: "Error", description: "Could not save order", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this order? This cannot be undone.")) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/orders/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error()
      toast({ title: "Order deleted" })
      refetch()
    } catch {
      toast({ title: "Error", description: "Could not delete order", variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  const field = (k: keyof OrderForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {activeCompany ? `${activeCompany.name} · ` : "All companies · "}
            {data?.total ?? 0} orders
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />New Order</Button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by customer name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  ))
                ) : data?.items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <ShoppingBag className="mx-auto h-8 w-8 opacity-20 mb-2" />
                      <p className="text-muted-foreground">No orders found</p>
                    </TableCell>
                  </TableRow>
                ) : data?.items?.map((o: any) => (
                  <TableRow key={o.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{o.customerName}</div>
                      <div className="text-xs text-muted-foreground">{o.customerEmail}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.companyName}</TableCell>
                    <TableCell className="text-sm capitalize">{o.channel}</TableCell>
                    <TableCell className="font-semibold">₹{Number(o.totalAmount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium capitalize ${STATUS_COLORS[o.status] ?? ""}`}>
                        {o.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(o)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" disabled={deleting === o.id} onClick={() => handleDelete(o.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.total > 20 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {page} of {Math.ceil(data.total / 20)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Order" : "New Order"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => field("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Customer Name *</Label>
              <Input value={form.customerName} onChange={e => field("customerName", e.target.value)} placeholder="Customer name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.customerEmail} onChange={e => field("customerEmail", e.target.value)} placeholder="email@example.com" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.customerPhone} onChange={e => field("customerPhone", e.target.value)} placeholder="+91 99999 99999" />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input value={form.totalAmount} onChange={e => field("totalAmount", e.target.value)} placeholder="0.00" type="number" min="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Item Count</Label>
              <Input value={form.itemCount} onChange={e => field("itemCount", e.target.value)} placeholder="1" type="number" min="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => field("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={form.channel} onValueChange={v => field("channel", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHANNELS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Shipping Address</Label>
              <Input value={form.shippingAddress} onChange={e => field("shippingAddress", e.target.value)} placeholder="Full address" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => field("notes", e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.customerName || !form.totalAmount || !form.companyId}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
