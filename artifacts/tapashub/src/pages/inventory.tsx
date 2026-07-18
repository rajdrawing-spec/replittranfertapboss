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
import { Search, Plus, Pencil, Trash2, PackageSearch, AlertTriangle, Sparkles, Upload, Download, Wand2, ScanBarcode, ImagePlus, Loader2, FileSpreadsheet, Check } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"
import { useUpload } from "@workspace/object-storage-web"
import AiProductPanel from "@/components/ai-products/ai-product-panel"

const API_BASE = ""

interface ProductForm {
  companyId: string
  name: string
  sku: string
  brand: string
  category: string
  subcategory: string
  description: string
  shortDescription: string
  price: string
  mrp: string
  costPrice: string
  gst: string
  stockQuantity: string
  reorderLevel: string
  warehouseLocation: string
  weight: string
  dimensions: string
  hsn: string
  status: string
  imageUrl: string
}

interface ProductVariant {
  id?: number
  sku: string
  name: string
  price: string
  stockQuantity: string
  barcode?: string
  attributes?: Record<string, string>
}

interface AutoFillData {
  name?: string
  category?: string
  subcategory?: string
  brand?: string
  color?: string
  size?: string
  weight?: string
  dimensions?: string
  material?: string
  sleeveType?: string
  neckType?: string
  pattern?: string
  occasion?: string
  season?: string
  fit?: string
  length?: string
  style?: string
  gender?: string
  ageGroup?: string
  keywords?: string[]
  seoTags?: string[]
  attributes?: Record<string, string>
}

const emptyForm = (): ProductForm => ({
  companyId: "", name: "", sku: "", brand: "", category: "", subcategory: "",
  description: "", shortDescription: "", price: "", mrp: "", costPrice: "", gst: "",
  stockQuantity: "0", reorderLevel: "10", warehouseLocation: "", weight: "", dimensions: "", hsn: "",
  status: "active", imageUrl: "",
})

export default function Inventory() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const { uploadFile, isUploading: uploadingImage } = useUpload({
    onError: (e) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  })
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [aiProduct, setAiProduct] = React.useState<any>(null)
  const [form, setForm] = React.useState<ProductForm>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [importFile, setImportFile] = React.useState<File | null>(null)
  const [importingJob, setImportingJob] = React.useState(false)
  const [generatingSku, setGeneratingSku] = React.useState(false)
  const [analyzingImages, setAnalyzingImages] = React.useState(false)
  const [pendingImages, setPendingImages] = React.useState<string[]>([])
  const [autoFill, setAutoFill] = React.useState<AutoFillData | null>(null)
  const [variants, setVariants] = React.useState<ProductVariant[]>([])
  const [barcodeImage, setBarcodeImage] = React.useState<string | null>(null)
  const [generatingBarcode, setGeneratingBarcode] = React.useState(false)
  const [generatingMarketplace, setGeneratingMarketplace] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const { data: companies } = useListCompanies({ query: { enabled: true, queryKey: ["/api/companies"] } })

  const params: Record<string, string | number> = { page, limit: 20 }
  if (activeCompany) params.companyId = activeCompany.id
  if (search) params.search = search

  const { data, isLoading, refetch } = useListProducts(params, {
    query: { enabled: true, queryKey: getListProductsQueryKey(params) }
  })

  // ── Quick Add with AI — employee-friendly image-only flow ──────────────────
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [quickImages, setQuickImages] = React.useState<string[]>([])
  const [quickCompanyId, setQuickCompanyId] = React.useState("")
  const [quickCreating, setQuickCreating] = React.useState(false)

  function openQuickAdd() {
    setQuickImages([])
    setQuickCompanyId(activeCompany ? String(activeCompany.id) : "")
    setQuickOpen(true)
  }

  async function handleQuickImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 10)
    if (!files.length) return
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        toast({ title: "Photo too large", description: `${file.name} is over 8 MB`, variant: "destructive" })
        continue
      }
      // Quick-create sends inline image data — read the file directly as a
      // data URL (the backend only accepts data:image/* for security).
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error("Could not read file"))
        reader.readAsDataURL(file)
      }).catch(() => null)
      if (dataUrl?.startsWith("data:image/")) {
        setQuickImages(prev => prev.length < 10 ? [...prev, dataUrl] : prev)
      }
    }
    e.target.value = ""
  }

  async function handleQuickCreate() {
    const companyId = parseInt(quickCompanyId)
    if (!companyId) { toast({ title: "Select a company", variant: "destructive" }); return }
    if (!quickImages.length) { toast({ title: "Upload at least one photo", variant: "destructive" }); return }
    setQuickCreating(true)
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/quick-create`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, images: quickImages }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "AI could not create the product")
      }
      const { product, healthScore } = await res.json()
      toast({ title: "Product created by AI", description: `${product.name} · ${product.category} · health ${healthScore}/100` })
      setQuickOpen(false)
      setQuickImages([])
      refetch()
    } catch (e: any) {
      toast({ title: "Could not create product", description: e?.message, variant: "destructive" })
    } finally { setQuickCreating(false) }
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm(), companyId: activeCompany ? String(activeCompany.id) : "" })
    setPendingImages([])
    setAutoFill(null)
    setVariants([])
    setBarcodeImage(null)
    setShowDialog(true)
  }
  function openEdit(p: any) {
    setEditing(p)
    setForm({
      companyId: String(p.companyId), name: p.name, sku: p.sku ?? "", brand: p.brand ?? "",
      category: p.category ?? "", subcategory: p.subcategory ?? "",
      description: p.description ?? "", shortDescription: p.shortDescription ?? "",
      price: String(p.price), mrp: String(p.mrp ?? ""), costPrice: String(p.costPrice ?? ""),
      gst: String(p.gst ?? ""), stockQuantity: String(p.stockQuantity), reorderLevel: String(p.reorderLevel),
      warehouseLocation: p.warehouseLocation ?? "", weight: p.weight ?? "", dimensions: p.dimensions ?? "", hsn: p.hsn ?? "",
      status: p.status, imageUrl: p.imageUrl ?? "",
    })
    setPendingImages([])
    setAutoFill(null)
    setVariants([])
    setBarcodeImage(p.barcodeImage ?? null)
    setShowDialog(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      let sku = form.sku.trim()
      if (!sku) sku = await generateSkuInternal(parseInt(form.companyId), form.name, form.category)
      const body = {
        companyId: parseInt(form.companyId), name: form.name, sku,
        brand: form.brand || undefined, category: form.category || undefined, subcategory: form.subcategory || undefined,
        description: form.description || undefined, shortDescription: form.shortDescription || undefined,
        price: parseFloat(form.price), mrp: form.mrp ? parseFloat(form.mrp) : undefined,
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
        gst: form.gst ? parseFloat(form.gst) : undefined,
        stockQuantity: parseInt(form.stockQuantity), reorderLevel: parseInt(form.reorderLevel),
        warehouseLocation: form.warehouseLocation || undefined, weight: form.weight || undefined,
        dimensions: form.dimensions || undefined, hsn: form.hsn || undefined, status: form.status,
        imageUrl: form.imageUrl || undefined,
      }
      const url = editing ? `${API_BASE}/api/products/${editing.id}` : `${API_BASE}/api/products`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()

      const saved = await res.json()
      const productId = saved.id || editing?.id

      if (pendingImages.length > 0 && productId) {
        await Promise.all(pendingImages.map((objectPath, i) =>
          fetch(`${API_BASE}/api/products/${productId}/images`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ objectPath, isPrimary: i === 0, altText: `${form.name} ${i === 0 ? "front" : "angle " + i}` }),
          })
        ))
      }

      if (variants.length > 0 && productId) {
        await Promise.all(variants.map(v =>
          fetch(`${API_BASE}/api/products/${productId}/variants`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sku: v.sku, name: v.name, price: parseFloat(v.price), stockQuantity: parseInt(v.stockQuantity),
              barcode: v.barcode || undefined, attributes: v.attributes || {},
            }),
          })
        ))
      }

      if (pendingImages.length > 0 && productId) {
        analyzeImagesInternal(productId, pendingImages)
      }

      toast({ title: editing ? "Product updated" : "Product added" })
      setShowDialog(false); refetch()
    } catch {
      toast({ title: "Error", description: "Could not save product", variant: "destructive" })
    } finally { setSaving(false) }
  }

  async function generateSkuInternal(companyId: number, name: string, category: string): Promise<string> {
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/0/generate-sku`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, name, category }),
      })
      if (!res.ok) throw new Error()
      const { sku } = await res.json()
      return sku
    } catch {
      return `${category.slice(0, 3).toUpperCase() || "PRD"}-${Date.now().toString().slice(-6)}`
    }
  }

  async function generateSku() {
    if (!form.name || !form.category) {
      toast({ title: "Enter name and category first", variant: "destructive" })
      return
    }
    setGeneratingSku(true)
    try {
      const sku = await generateSkuInternal(parseInt(form.companyId || "0") || activeCompany?.id || 0, form.name, form.category)
      setForm(f => ({ ...f, sku }))
    } catch {
      toast({ title: "SKU generation failed", variant: "destructive" })
    } finally { setGeneratingSku(false) }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const uploaded: string[] = []
    for (const file of files) {
      const res = await uploadFile(file)
      if (res?.objectPath) uploaded.push(res.objectPath)
    }
    if (uploaded.length) {
      setPendingImages(prev => [...prev, ...uploaded])
      if (!form.imageUrl) setForm(f => ({ ...f, imageUrl: uploaded[0] }))
    }
    e.target.value = ""
  }

  async function analyzeImagesInternal(productId: number, objectPaths: string[]) {
    if (!objectPaths.length) return
    setAnalyzingImages(true)
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/${productId}/analyze-images`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPaths }),
      })
      if (!res.ok) throw new Error()
      const result = await res.json()
      setAutoFill(result.autoFill || null)
      toast({ title: "AI analysis complete", description: `Detected ${result.category || "product"} · health ${result.healthScore}/100` })
    } catch {
      toast({ title: "Image analysis failed", variant: "destructive" })
    } finally { setAnalyzingImages(false) }
  }

  function applyAutoFill() {
    if (!autoFill) return
    setForm(f => ({
      ...f,
      name: autoFill.name || f.name,
      category: autoFill.category || f.category,
      subcategory: autoFill.subcategory || f.subcategory,
      brand: autoFill.brand || f.brand,
      weight: autoFill.weight || f.weight,
      dimensions: autoFill.dimensions || f.dimensions,
      description: f.description || [autoFill.material, autoFill.sleeveType, autoFill.neckType, autoFill.pattern, autoFill.occasion, autoFill.fit].filter(Boolean).join(". ") || f.description,
    }))
    if (autoFill.keywords?.length) {
      toast({ title: "Auto-fill applied", description: `${autoFill.keywords?.length ?? 0} keywords detected` })
    }
    setAutoFill(null)
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

  async function importCsv(file: File) {
    if (!activeCompany) { toast({ title: "Select a company" }); return }
    setImportingJob(true)
    try {
      const csv = await file.text()
      if (!csv.trim()) throw new Error("CSV file is empty")
      const res = await fetch(`${API_BASE}/api/ai-products/import-csv`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompany.id, csv }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Import failed" }))
        throw new Error(body.error || "Import failed")
      }
      const stats = await res.json()
      toast({ title: "Import complete", description: `${stats.success} added, ${stats.failed} failed` })
      refetch(); setImporting(false)
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Import failed", variant: "destructive" })
    } finally { setImportingJob(false) }
  }

  async function exportXlsx() {
    if (!activeCompany) { toast({ title: "Select a company" }); return }
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/export-xlsx`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompany.id }),
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `products-${activeCompany.id}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: "Error", description: "Excel export failed", variant: "destructive" })
    }
  }

  async function importXlsx(file: File) {
    if (!activeCompany) { toast({ title: "Select a company" }); return }
    setImportingJob(true)
    try {
      const buffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      const res = await fetch(`${API_BASE}/api/ai-products/import-xlsx`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompany.id, base64 }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Import failed" }))
        throw new Error(body.error || "Import failed")
      }
      const stats = await res.json()
      toast({ title: "Excel import complete", description: `${stats.success} added, ${stats.failed} failed` })
      refetch(); setImporting(false)
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Excel import failed", variant: "destructive" })
    } finally { setImportingJob(false) }
  }

  async function generateBarcodeImage() {
    if (!editing?.id) { toast({ title: "Save the product first" }); return }
    setGeneratingBarcode(true)
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/${editing.id}/barcode-image`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error()
      const { objectPath } = await res.json()
      setBarcodeImage(objectPath)
      toast({ title: "Barcode generated" })
    } catch {
      toast({ title: "Barcode generation failed", variant: "destructive" })
    } finally { setGeneratingBarcode(false) }
  }

  async function generateMarketplaceImages() {
    if (!editing?.id) { toast({ title: "Save the product first" }); return }
    setGeneratingMarketplace(true)
    try {
      const res = await fetch(`${API_BASE}/api/ai-products/${editing.id}/generate-marketplace-images`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIndex: 0 }),
      })
      if (!res.ok) throw new Error()
      const { results } = await res.json()
      toast({ title: "Marketplace images ready", description: `${results.length} variants generated` })
    } catch {
      toast({ title: "Marketplace image generation failed", variant: "destructive" })
    } finally { setGeneratingMarketplace(false) }
  }

  function addVariant() {
    setVariants(prev => [...prev, { sku: "", name: "", price: form.price || "0", stockQuantity: "0" }])
  }

  function updateVariant(i: number, key: keyof ProductVariant, value: string) {
    setVariants(prev => prev.map((v, idx) => idx === i ? { ...v, [key]: value } : v))
  }

  function removeVariant(i: number) {
    setVariants(prev => prev.filter((_, idx) => idx !== i))
  }

  const f = (k: keyof ProductForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products & Inventory</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{activeCompany ? `${activeCompany.name} · ` : "All companies · "}{data?.total ?? 0} products</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" onClick={() => setImporting(true)} className="gap-2"><Upload className="w-4 h-4" />Import CSV</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" />Export CSV</Button>
          <Button variant="outline" onClick={exportXlsx} className="gap-2"><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
          <Button onClick={openQuickAdd} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"><Sparkles className="w-4 h-4" />Quick Add with AI</Button>
          <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Product</Button>
        </div>
      </div>

      {/* Quick Add with AI — upload photos only, AI builds the catalog entry */}
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-500" />Quick Add with AI</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Just upload product photos — AI will detect the name, category, brand, colors, materials and create the full catalog entry automatically.
          </p>
          {!activeCompany && (
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Select value={quickCompanyId} onValueChange={setQuickCompanyId}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {(Array.isArray(companies) ? companies : []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><ImagePlus className="w-4 h-4" />Product Photos (1–10)</Label>
            <Input type="file" accept="image/*" multiple onChange={handleQuickImageUpload} disabled={uploadingImage || quickCreating} />
            {quickImages.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {quickImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img} alt={`Photo ${i + 1}`} className="w-14 h-14 rounded-md object-cover border" />
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
                      onClick={() => setQuickImages(prev => prev.filter((_, j) => j !== i))}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickOpen(false)} disabled={quickCreating}>Cancel</Button>
            <Button
              onClick={handleQuickCreate}
              disabled={quickCreating || uploadingImage || !quickImages.length}
              className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
            >
              {quickCreating ? <><Loader2 className="w-4 h-4 animate-spin" />AI is creating…</> : <><Wand2 className="w-4 h-4" />Create Product</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                      <TableCell className="text-sm">{p.category ?? "—"}{p.subcategory ? ` · ${p.subcategory}` : ""}</TableCell>
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
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="col-span-3 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => f("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5"><Label>Product Name *</Label><Input value={form.name} onChange={e => f("name", e.target.value)} placeholder="Product name" /></div>
            <div className="space-y-1.5">
              <Label>SKU</Label>
              <div className="flex gap-2">
                <Input value={form.sku} onChange={e => f("sku", e.target.value)} placeholder="Auto-generated if empty" />
                <Button variant="outline" size="icon" onClick={generateSku} disabled={generatingSku} title="Generate SKU"><ScanBarcode className="w-4 h-4" /></Button>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Brand</Label><Input value={form.brand} onChange={e => f("brand", e.target.value)} placeholder="Brand" /></div>
            <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={e => f("category", e.target.value)} placeholder="e.g. Apparel" /></div>
            <div className="space-y-1.5"><Label>Subcategory</Label><Input value={form.subcategory} onChange={e => f("subcategory", e.target.value)} placeholder="e.g. Women's Tops" /></div>
            <div className="space-y-1.5"><Label>Sale Price (₹) *</Label><Input value={form.price} onChange={e => f("price", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>MRP (₹)</Label><Input value={form.mrp} onChange={e => f("mrp", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Cost Price (₹)</Label><Input value={form.costPrice} onChange={e => f("costPrice", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>GST (%)</Label><Input value={form.gst} onChange={e => f("gst", e.target.value)} type="number" min="0" placeholder="e.g. 5, 12, 18" /></div>
            <div className="space-y-1.5"><Label>Stock Qty</Label><Input value={form.stockQuantity} onChange={e => f("stockQuantity", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Reorder Level</Label><Input value={form.reorderLevel} onChange={e => f("reorderLevel", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Weight</Label><Input value={form.weight} onChange={e => f("weight", e.target.value)} placeholder="e.g. 250g" /></div>
            <div className="space-y-1.5"><Label>Dimensions</Label><Input value={form.dimensions} onChange={e => f("dimensions", e.target.value)} placeholder="L x W x H cm" /></div>
            <div className="space-y-1.5"><Label>HSN Code</Label><Input value={form.hsn} onChange={e => f("hsn", e.target.value)} placeholder="HSN" /></div>
            <div className="col-span-3 space-y-1.5"><Label>Warehouse Location</Label><Input value={form.warehouseLocation} onChange={e => f("warehouseLocation", e.target.value)} placeholder="e.g. Warehouse A, Rack 3" /></div>
            <div className="col-span-3 space-y-1.5"><Label>Short Description</Label><Input value={form.shortDescription} onChange={e => f("shortDescription", e.target.value)} placeholder="30-50 word description" /></div>
            <div className="col-span-3 space-y-1.5"><Label>Description</Label><Input value={form.description} onChange={e => f("description", e.target.value)} placeholder="Full product description" /></div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>

            <div className="col-span-3 space-y-2">
              <Label className="flex items-center gap-2"><ImagePlus className="w-4 h-4" /> Product Images</Label>
              <div className="flex items-center gap-3">
                <Input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={uploadingImage} />
                {uploadingImage && <Loader2 className="w-4 h-4 animate-spin" />}
              </div>
              {pendingImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingImages.map((path, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{path.split("/").pop()}</Badge>
                  ))}
                </div>
              )}
              {analyzingImages && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> AI analyzing images…</p>}
              {autoFill && (
                <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2"><Wand2 className="w-4 h-4 text-purple-500" /> AI detected {autoFill.category}{autoFill.brand ? ` · ${autoFill.brand}` : ""}</p>
                  <div className="flex flex-wrap gap-1">
                    {autoFill.keywords?.slice(0, 8).map(k => <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>)}
                  </div>
                  <Button size="sm" onClick={applyAutoFill} className="gap-2"><Check className="w-3.5 h-3.5" /> Apply auto-fill</Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Upload 1–10 images. AI will auto-detect category, color, material, and more on save.</p>
            </div>

            <div className="col-span-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variants</Label>
                <Button size="sm" variant="outline" onClick={addVariant} type="button">Add variant</Button>
              </div>
              {variants.length === 0 && <p className="text-xs text-muted-foreground">No variants yet</p>}
              {variants.map((v, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-end">
                  <Input placeholder="Variant name" value={v.name} onChange={e => updateVariant(i, "name", e.target.value)} />
                  <Input placeholder="SKU" value={v.sku} onChange={e => updateVariant(i, "sku", e.target.value)} />
                  <Input placeholder="Price" type="number" value={v.price} onChange={e => updateVariant(i, "price", e.target.value)} />
                  <div className="flex gap-2">
                    <Input placeholder="Stock" type="number" value={v.stockQuantity} onChange={e => updateVariant(i, "stockQuantity", e.target.value)} />
                    <Button size="icon" variant="ghost" onClick={() => removeVariant(i)} type="button"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>

            {editing && (
              <div className="col-span-3 flex gap-2">
                <Button variant="outline" onClick={generateBarcodeImage} disabled={generatingBarcode} className="gap-2"><ScanBarcode className="w-4 h-4" /> {barcodeImage ? "Regenerate barcode" : "Generate barcode"}</Button>
                <Button variant="outline" onClick={generateMarketplaceImages} disabled={generatingMarketplace} className="gap-2"><ImagePlus className="w-4 h-4" /> Marketplace images</Button>
              </div>
            )}
            {barcodeImage && (
              <div className="col-span-3">
                <img src={barcodeImage} alt="Barcode" className="h-16 object-contain border rounded-md p-1" />
              </div>
            )}
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
          <DialogHeader><DialogTitle>Import Products</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={e => setImportFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-muted-foreground">Upload CSV or Excel. Columns: name, sku, brand, category, subcategory, description, shortDescription, price, mrp, costPrice, gst, stockQuantity, reorderLevel, weight, dimensions, hsn, warehouseLocation, status</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>Cancel</Button>
            <Button
              onClick={() => { if (importFile) { importFile.name.endsWith(".xlsx") ? importXlsx(importFile) : importCsv(importFile); } }}
              disabled={importingJob || !importFile}
            >{importingJob ? "Importing…" : "Import"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
