import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { useAuth } from "@/contexts/auth-context"
import { useCompany } from "@/contexts/company-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { Plus, Search, Pencil, Trash2, Users, Phone, Mail } from "lucide-react"
import { ResponsiveTable, type ResponsiveTableColumn, type ResponsiveTableAction } from "@/components/responsive-table"
import { QueryState } from "@/components/query-state"

interface InvoiceCustomer {
  id: number; companyId: number; name: string; email?: string; phone?: string
  gstin?: string; pan?: string; billingAddress?: string; shippingAddress?: string
  state?: string; creditLimit: number; outstanding: number; createdAt: string
}

interface FormState {
  name: string; email: string; phone: string; gstin: string; pan: string
  billingAddress: string; shippingAddress: string; state: string; creditLimit: string
}

const EMPTY: FormState = { name: "", email: "", phone: "", gstin: "", pan: "", billingAddress: "", shippingAddress: "", state: "", creditLimit: "0" }

function toForm(c: InvoiceCustomer): FormState {
  return {
    name: c.name, email: c.email ?? "", phone: c.phone ?? "", gstin: c.gstin ?? "",
    pan: c.pan ?? "", billingAddress: c.billingAddress ?? "", shippingAddress: c.shippingAddress ?? "",
    state: c.state ?? "", creditLimit: String(c.creditLimit ?? 0),
  }
}

export default function InvoiceCustomersPage() {
  const { hasPermission } = useAuth()
  const { activeCompany } = useCompany()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = React.useState("")
  const [showForm, setShowForm] = React.useState(false)
  const [editing, setEditing] = React.useState<InvoiceCustomer | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<InvoiceCustomer | null>(null)
  const [form, setForm] = React.useState<FormState>(EMPTY)

  const canManage = hasPermission("finance.manage")
  const qs = activeCompany ? `?companyId=${activeCompany.id}` : ""

  const { data: customers = [], isLoading, isError, refetch } = useQuery<InvoiceCustomer[]>({
    queryKey: ["/api/invoice-customers", activeCompany?.id],
    queryFn: () => adminApi.get(`/invoice-customers${qs}`),
    enabled: !!activeCompany,
  })

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminApi.post("/invoice-customers", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/invoice-customers"] }); setShowForm(false); toast({ title: "Customer added" }) },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => adminApi.patch(`/invoice-customers/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/invoice-customers"] }); setEditing(null); toast({ title: "Updated" }) },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.del(`/invoice-customers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/invoice-customers"] }); setDeleteTarget(null); toast({ title: "Deleted" }) },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  function openCreate() { setForm(EMPTY); setShowForm(true) }
  function openEdit(c: InvoiceCustomer) { setForm(toForm(c)); setEditing(c) }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    const payload = {
      companyId: activeCompany?.id,
      name: form.name.trim(),
      email: form.email || undefined,
      phone: form.phone || undefined,
      gstin: form.gstin || undefined,
      pan: form.pan || undefined,
      billingAddress: form.billingAddress || undefined,
      shippingAddress: form.shippingAddress || undefined,
      state: form.state || undefined,
      creditLimit: Number(form.creditLimit) || 0,
    }
    if (editing) updateMut.mutate({ id: editing.id, data: payload })
    else createMut.mutate(payload)
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.gstin ?? "").toLowerCase().includes(q)
  })

  const isOpen = showForm || !!editing

  const columns: ResponsiveTableColumn<InvoiceCustomer>[] = [
    {
      key: "name", header: "Name", card: "title",
      cell: (c) => (
        <div>
          <div className="font-medium text-sm">{c.name}</div>
          {c.billingAddress && <div className="text-xs text-muted-foreground truncate max-w-48">{c.billingAddress}</div>}
        </div>
      ),
      cardCell: (c) => c.name,
    },
    {
      key: "contact", header: "Contact", card: "subtitle",
      cell: (c) => (
        <>
          {c.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="w-3 h-3" />{c.email}</div>}
          {c.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="w-3 h-3" />{c.phone}</div>}
        </>
      ),
      cardCell: (c) => c.email || c.phone || "—",
    },
    { key: "gstin", header: "GSTIN", cell: (c) => <span className="font-mono text-xs">{c.gstin ?? "—"}</span> },
    { key: "state", header: "State", cell: (c) => <span className="text-sm">{c.state ?? "—"}</span> },
    {
      key: "outstanding", header: "Outstanding", card: "badge", headClassName: "text-right", cellClassName: "text-right",
      cell: (c) => (
        <span className="text-sm font-medium">
          {c.outstanding > 0 ? <span className="text-amber-400">₹{Math.round(c.outstanding).toLocaleString("en-IN")}</span> : "₹0"}
        </span>
      ),
    },
  ]

  const rowActions: ResponsiveTableAction<InvoiceCustomer>[] = canManage ? [
    { label: "Edit", icon: Pencil, onClick: openEdit },
    { label: "Delete", icon: Trash2, onClick: setDeleteTarget, destructive: true },
  ] : []

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Billing contacts for {activeCompany?.name ?? "all companies"}</p>
        </div>
        {canManage && <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Add Customer</Button>}
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 max-w-sm" />
      </div>

      <Card>
        <CardContent className="p-3 md:p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={filtered.length === 0}
            onRetry={refetch}
            errorMessage="Could not load customers."
            emptyIcon={Users}
            emptyMessage="No customers yet"
            emptyAction={canManage ? (
              <Button size="sm" variant="outline" onClick={openCreate}><Plus className="w-3 h-3 mr-1" /> Add first customer</Button>
            ) : undefined}
            loading={<ResponsiveTable columns={columns} data={[]} rowKey={(c) => c.id} isLoading skeletonCount={5} actions={rowActions} />}
          >
            <ResponsiveTable columns={columns} data={filtered} rowKey={(c) => c.id} actions={rowActions} />
          </QueryState>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label>Name *</Label>
                <Input value={form.name} onChange={set("name")} placeholder="Customer / Company name" required />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={set("email")} placeholder="email@example.com" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1">
                <Label>GSTIN</Label>
                <Input value={form.gstin} onChange={set("gstin")} placeholder="22AAAAA0000A1Z5" className="font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label>PAN</Label>
                <Input value={form.pan} onChange={set("pan")} placeholder="ABCDE1234F" className="font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label>State</Label>
                <Input value={form.state} onChange={set("state")} placeholder="Maharashtra" />
              </div>
              <div className="space-y-1">
                <Label>Credit Limit (₹)</Label>
                <Input type="number" value={form.creditLimit} onChange={set("creditLimit")} min={0} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Billing Address</Label>
                <Input value={form.billingAddress} onChange={set("billingAddress")} placeholder="Full billing address" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Shipping Address</Label>
                <Input value={form.shippingAddress} onChange={set("shippingAddress")} placeholder="Same as billing or different" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {editing ? "Update" : "Add Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This customer will be removed. Existing invoices won't be affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
