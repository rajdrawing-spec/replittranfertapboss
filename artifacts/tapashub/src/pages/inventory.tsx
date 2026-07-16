import * as React from "react"
import { useListProducts, getListProductsQueryKey, useListCompanies } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Search, Plus, Pencil, Trash2, PackageSearch, AlertTriangle, Sparkles, Upload, Download } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"
import AiProductPanel from "@/components/ai-products/ai-product-panel"

const API_BASE = ""

interface ProductForm {
  companyId: string; name: string; sku: string; category: string
  description: string; price: string; costPrice: string
  stockQuantity: string; reorderLevel: string; warehouseLocation: string; status: string
}
const emptyForm = (): ProductForm => ({
  companyId: "", name: "", sku: "", category: "", description: "",
  price: "", costPrice: "", stockQuantity: "0", reorderLevel: "10",
  warehouseLocation: "", status: "active",
})

export default function Inventory() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [aiProduct, setAiProduct] = React.useState<any>(null)
  const [form, setForm] = React.useState<ProductForm>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [importPath, setImportPath] = React.useState("")
  const [importingJob, setImportingJob] = React.useState(false)

  const { data: companies } = useListCompanies({ query: { enabled: true, queryKey: ["/api/companies"] } })

  const params: Record<string, string | number> = { page, limit: 20 }
  if (activeCompany) params.companyId = activeCompany.id
  if (search) params.search = search

  const { data, isLoading, refetch } = useListProducts(params, {
    query: { enabled: true, queryKey: getListProductsQueryKey(params) }
  })

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm(), companyId: activeCompany ? String(activeCompany.id) : "" })
    setShowDialog(true)
  }
  function openEdit(p: any) {
    setEditing(p)
    setForm({
      companyId: String(p.companyId), name: p.name, sku: p.sku ?? "", category: p.category ?? "",
      description: p.description ?? "", price: String(p.price), costPrice: String(p.costPrice ?? ""),
      stockQuantity: String(p.stockQuantity), reorderLevel: String(p.reorderLevel),
      warehouseLocation: p.warehouseLocation ?? "", status: p.status,
    })
    setShowDialog(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        companyId: parseInt(form.companyId), name: form.name, sku: form.sku || undefined,
        category: form.category || undefined, description: form.description || undefined,
        price: parseFloat(form.price), costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
        stockQuantity: parseInt(form.stockQuantity), reorderLevel: parseInt(form.reorderLevel),
        warehouseLocation: form.warehouseLocation || undefined, status: form.status,
      }
      const url = editing ? `${API_BASE}/api/products/${editing.id}` : `${API_BASE}/api/products`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Product updated" : "Product added" })
      setShowDialog(false); refetch()
    } catch {
      toast({ title: "Error", description: "Could not save product", variant: "destructive" })
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this product?")) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error()
      toast({ title: "Product deleted" }); refetch()
    } catch {
      toast({ title: "Error", description: "Could not delete", variant: "destructive" })
    } finally { setDeleting(null) }
  }

  async function exportCsv() {
    if (!activeCompany) { toast({ title: "Select a company" }); return }
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/export-csv`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompany.id }),
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `products-${activeCompany.id}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: "Error", description: "Export failed", variant: "destructive" })
    }
  }

  async function requestUpload(name: string, size: number, contentType: string) {
    const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, size, contentType }),
    })
    if (!res.ok) throw new Error()
    return res.json()
  }

  async function importCsv(file: File) {
    if (!activeCompany) { toast({ title: "Select a company" }); return }
    setImportingJob(true)
    try {
      const { uploadURL, objectPath } = await requestUpload(file.name, file.size, file.type)
      const up = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      if (!up.ok) throw new Error("Upload failed")
      const res = await fetch(`${API_BASE}/api/ai-products/import-csv`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompany.id, objectPath }),
      })
      if (!res.ok) throw new Error()
      const { jobId } = await res.json()
      const process = await fetch(`${API_BASE}/api/ai-products/import-jobs/${jobId}/process`, { method: "POST", credentials: "include" })
      if (!process.ok) throw new Error()
      const stats = await process.json()
      toast({ title: "Import complete", description: `${stats.success} added, ${stats.failed} failed` })
      refetch(); setImporting(false)
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Import failed", variant: "destructive" })
    } finally { setImportingJob(false) }
  }

  const f = (k: keyof ProductForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products & Inventory</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{activeCompany ? `${activeCompany.name} · ` : "All companies · "}{data?.total ?? 0} products</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)} className="gap-2"><Upload className="w-4 h-4" />Import CSV</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" />Export</Button>
          <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Product</Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search products…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Category</TableHead>
                  <TableHead>Price</TableHead><TableHead>Stock</TableHead><TableHead>Status</TableHead><TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                )) : data?.items?.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center">
                    <PackageSearch className="mx-auto h-8 w-8 opacity-20 mb-2" />
                    <p className="text-muted-foreground">No products found</p>
                  </TableCell></TableRow>
                ) : data?.items?.map((p: any) => {
                  const lowStock = p.stockQuantity <= p.reorderLevel
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.companyName}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.category ?? "—"}</TableCell>
                      <TableCell className="font-semibold">₹{Number(p.price).toLocaleString("en-IN")}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {lowStock && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
                          <span className={lowStock ? "text-yellow-400 font-medium" : ""}>{p.stockQuantity}</span>
                          <span className="text-xs text-muted-foreground">/ min {p.reorderLevel}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs capitalize">{p.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setAiProduct(p)}><Sparkles className="w-3.5 h-3.5 text-purple-500" /></Button>
                          <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" disabled={deleting === p.id} onClick={() => handleDelete(p.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
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

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="col-span-2 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => f("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5"><Label>Product Name *</Label><Input value={form.name} onChange={e => f("name", e.target.value)} placeholder="Product name" /></div>
            <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={e => f("sku", e.target.value)} placeholder="SKU-001" /></div>
            <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={e => f("category", e.target.value)} placeholder="e.g. Apparel" /></div>
            <div className="space-y-1.5"><Label>Sale Price (₹) *</Label><Input value={form.price} onChange={e => f("price", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Cost Price (₹)</Label><Input value={form.costPrice} onChange={e => f("costPrice", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Stock Qty</Label><Input value={form.stockQuantity} onChange={e => f("stockQuantity", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Reorder Level</Label><Input value={form.reorderLevel} onChange={e => f("reorderLevel", e.target.value)} type="number" min="0" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Warehouse Location</Label><Input value={form.warehouseLocation} onChange={e => f("warehouseLocation", e.target.value)} placeholder="e.g. Warehouse A, Rack 3" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Description</Label><Input value={form.description} onChange={e => f("description", e.target.value)} placeholder="Product description" /></div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.price || !form.companyId}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!aiProduct} onOpenChange={() => setAiProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>AI Assistant — {aiProduct?.name}</DialogTitle></DialogHeader>
          {aiProduct && <AiProductPanel product={aiProduct} onChange={() => { refetch() }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import Products CSV</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input type="file" accept=".csv" onChange={e => setImportPath(e.target.files?.[0]?.name || "")} />
            <p className="text-xs text-muted-foreground">Columns: name, sku, category, description, price, costPrice, stockQuantity, reorderLevel, warehouseLocation, status</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>Cancel</Button>
            <Button
              onClick={() => { const f = (document.querySelector('input[type="file"]') as HTMLInputElement)?.files?.[0]; if (f) importCsv(f); }}
              disabled={importingJob || !importPath}
            >{importingJob ? "Importing…" : "Import"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
