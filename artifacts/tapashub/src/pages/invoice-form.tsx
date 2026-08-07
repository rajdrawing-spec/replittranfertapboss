import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useLocation, useRoute, Link } from "wouter"
import { adminApi } from "@/lib/admin-api"
import { useCompany } from "@/contexts/company-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Plus, Trash2, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LineItem {
  _id: string
  productId?: number
  description: string
  hsnCode: string
  quantity: number
  rate: number
  discountPercent: number
  taxType: string
  taxRate: number
  amount: number
  taxAmount: number
  lineTotal: number
}

interface InvoiceCustomer {
  id: number; name: string; email?: string; phone?: string
  gstin?: string; pan?: string; billingAddress?: string; shippingAddress?: string; state?: string
}

interface Product {
  id: number; name: string; sku?: string; price?: number; gst?: number; hsn?: string; description?: string
}

interface Invoice {
  id: number; invoiceNumber: string; type: string; status: string
  customerName: string; customerEmail?: string; customerPhone?: string
  customerGstin?: string; customerPan?: string; billingAddress?: string
  shippingAddress?: string; placeOfSupply?: string; currency: string
  issueDate: string; dueDate?: string; paymentTerms?: string; reference?: string
  notes?: string; terms?: string
  items: LineItem[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { key: "invoice", label: "Invoice" },
  { key: "quotation", label: "Quotation" },
  { key: "proforma", label: "Proforma Invoice" },
  { key: "purchase_order", label: "Purchase Order" },
  { key: "sales_order", label: "Sales Order" },
  { key: "delivery_challan", label: "Delivery Challan" },
  { key: "credit_note", label: "Credit Note" },
  { key: "debit_note", label: "Debit Note" },
  { key: "receipt", label: "Receipt" },
]

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"]
const TAX_TYPES = [
  { key: "gst", label: "GST (CGST+SGST)" },
  { key: "igst", label: "IGST" },
  { key: "vat", label: "VAT" },
  { key: "none", label: "None" },
]
const GST_RATES = [0, 5, 12, 18, 28]
const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan",
  "Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
  "Delhi","Jammu & Kashmir","Ladakh","Puducherry","Chandigarh",
]
const PAYMENT_TERMS = ["Immediate","7 days","15 days","30 days","45 days","60 days","90 days"]

// ── Line item helpers ─────────────────────────────────────────────────────────

export function calcItem(it: LineItem): LineItem {
  const base = it.quantity * it.rate
  const disc = base * it.discountPercent / 100
  const amt = base - disc
  const taxAmt = it.taxType === "none" ? 0 : amt * it.taxRate / 100
  return { ...it, amount: round2(amt), taxAmount: round2(taxAmt), lineTotal: round2(amt + taxAmt) }
}

function newItem(): LineItem {
  return {
    _id: Math.random().toString(36).slice(2),
    description: "", hsnCode: "", quantity: 1, rate: 0,
    discountPercent: 0, taxType: "gst", taxRate: 18,
    amount: 0, taxAmount: 0, lineTotal: 0,
  }
}

export function round2(n: number) { return Math.round(n * 100) / 100 }

const fmtINR = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceForm() {
  const [, navigate] = useLocation()
  const [matchNew] = useRoute("/invoices/new")
  const [matchEdit, editParams] = useRoute("/invoices/:id/edit")
  const [matchDup, dupParams] = useRoute("/invoices/:id/duplicate")
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const qc = useQueryClient()

  const editId = matchEdit ? parseInt(editParams?.id ?? "0") : null
  const dupId = matchDup ? parseInt(dupParams?.id ?? "0") : null
  const isEdit = !!editId
  const isDup = !!dupId
  const sourceId = editId ?? dupId

  // Doc type from URL ?type=
  const urlType = new URLSearchParams(window.location.search).get("type") ?? "invoice"

  // ── Form state ────────────────────────────────────────────────────────────
  const [docType, setDocType] = React.useState(urlType)
  const [currency, setCurrency] = React.useState("INR")
  const [issueDate, setIssueDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = React.useState("")
  const [paymentTerms, setPaymentTerms] = React.useState("30 days")
  const [reference, setReference] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [terms, setTerms] = React.useState("")
  const [placeOfSupply, setPlaceOfSupply] = React.useState("")

  // Customer fields
  const [customerId, setCustomerId] = React.useState<number | undefined>()
  const [customerName, setCustomerName] = React.useState("")
  const [customerEmail, setCustomerEmail] = React.useState("")
  const [customerPhone, setCustomerPhone] = React.useState("")
  const [customerGstin, setCustomerGstin] = React.useState("")
  const [customerPan, setCustomerPan] = React.useState("")
  const [billingAddress, setBillingAddress] = React.useState("")
  const [shippingAddress, setShippingAddress] = React.useState("")

  const [items, setItems] = React.useState<LineItem[]>([newItem()])
  const [customerSearch, setCustomerSearch] = React.useState("")
  const [showCustDropdown, setShowCustDropdown] = React.useState(false)
  const [productSearch, setProductSearch] = React.useState("")
  const [activeItemIdx, setActiveItemIdx] = React.useState<number | null>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────
  const companyQs = activeCompany ? `?companyId=${activeCompany.id}` : ""

  const { data: customers = [] } = useQuery<InvoiceCustomer[]>({
    queryKey: ["/api/invoice-customers", activeCompany?.id],
    queryFn: () => adminApi.get(`/invoice-customers${companyQs}`),
    enabled: !!activeCompany,
  })

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products", activeCompany?.id],
    queryFn: async () => {
      const resp = await adminApi.get(`/products?companyId=${activeCompany!.id}&limit=200`)
      return resp?.items ?? []
    },
    enabled: !!activeCompany,
  })

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/invoice-settings", activeCompany?.id],
    queryFn: () => adminApi.get(`/invoice-settings${companyQs}`),
    enabled: !!activeCompany,
  })

  const { data: sourceInv, isLoading: loadingEdit } = useQuery<Invoice & Record<string, any>>({
    queryKey: ["/api/invoices", activeCompany?.id, sourceId],
    queryFn: () => adminApi.get(`/invoices/${sourceId}`),
    enabled: !!sourceId && !!activeCompany,
  })

  // Prefill the form from the loaded invoice (edit) or source invoice (duplicate).
  // Keyed by company + source id so switching company re-applies fresh data.
  const prefilledRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const key = `${activeCompany?.id ?? ""}:${sourceId ?? ""}`
    if (!sourceInv || !sourceId || prefilledRef.current === key) return
    prefilledRef.current = key
    const inv = sourceInv as any
    setDocType(inv.type)
    setCurrency(inv.currency)
    if (isEdit) {
      // Duplicates get fresh dates (today, defaults) and a new number on save.
      setIssueDate(inv.issueDate)
      setDueDate(inv.dueDate ?? "")
    }
    setPaymentTerms(inv.paymentTerms ?? "30 days")
    setReference(inv.reference ?? "")
    setNotes(inv.notes ?? "")
    setTerms(inv.terms ?? "")
    setPlaceOfSupply(inv.placeOfSupply ?? "")
    setCustomerId(inv.customerId ?? undefined)
    setCustomerName(inv.customerName)
    setCustomerEmail(inv.customerEmail ?? "")
    setCustomerPhone(inv.customerPhone ?? "")
    setCustomerGstin(inv.customerGstin ?? "")
    setCustomerPan(inv.customerPan ?? "")
    setBillingAddress(inv.billingAddress ?? "")
    setShippingAddress(inv.shippingAddress ?? "")
    setItems((inv.items ?? []).map((it: any) => calcItem({ ...it, id: undefined, _id: Math.random().toString(36).slice(2) })))
  }, [sourceInv, sourceId, isEdit, activeCompany?.id])

  // Pre-fill defaults from settings
  React.useEffect(() => {
    // Only apply company defaults on a genuinely new document — duplicates
    // must keep the copied terms/notes from the source invoice.
    if (settings && matchNew) {
      if (settings.defaultTerms) setTerms(settings.defaultTerms)
      if (settings.defaultNotes) setNotes(settings.defaultNotes)
      if (settings.defaultPaymentTerms) setPaymentTerms(settings.defaultPaymentTerms + " days")
    }
  }, [settings, matchNew])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminApi.post("/invoices", data),
    onSuccess: (inv: any) => {
      qc.invalidateQueries({ queryKey: ["/api/invoices"] })
      toast({ title: "Created", description: `${inv.invoiceNumber} created` })
      navigate(`/invoices/${inv.id}`)
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const updateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminApi.patch(`/invoices/${editId}`, data),
    onSuccess: (inv: any) => {
      qc.invalidateQueries({ queryKey: ["/api/invoices"] })
      toast({ title: "Updated" })
      navigate(`/invoices/${inv.id}`)
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  // ── Customer picker ───────────────────────────────────────────────────────
  function selectCustomer(c: InvoiceCustomer) {
    setCustomerId(c.id)
    setCustomerName(c.name)
    setCustomerEmail(c.email ?? "")
    setCustomerPhone(c.phone ?? "")
    setCustomerGstin(c.gstin ?? "")
    setCustomerPan(c.pan ?? "")
    setBillingAddress(c.billingAddress ?? "")
    setShippingAddress(c.shippingAddress ?? "")
    if (c.state) setPlaceOfSupply(c.state)
    setShowCustDropdown(false)
    setCustomerSearch("")
  }

  const filteredCustomers = customers.filter((c) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase())
  )

  // ── Product picker ────────────────────────────────────────────────────────
  function selectProduct(idx: number, p: Product) {
    setItems((prev) => {
      const next = [...prev]
      next[idx] = calcItem({
        ...next[idx],
        productId: p.id,
        description: p.name,
        hsnCode: p.hsn ?? next[idx].hsnCode,
        rate: p.price ?? next[idx].rate,
        taxRate: p.gst ?? next[idx].taxRate,
      })
      return next
    })
    setActiveItemIdx(null)
    setProductSearch("")
  }

  const filteredProducts = products.filter((p) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(productSearch.toLowerCase())
  )

  // ── Item helpers ──────────────────────────────────────────────────────────
  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => {
      const next = [...prev]
      next[idx] = calcItem({ ...next[idx], ...patch })
      return next
    })
  }

  function addItem() { setItems((p) => [...p, newItem()]) }
  function removeItem(idx: number) { setItems((p) => p.filter((_, i) => i !== idx)) }

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, it) => s + it.amount + (it.discountPercent > 0 ? it.quantity * it.rate - it.amount : 0), 0)
  const discountTotal = items.reduce((s, it) => s + (it.quantity * it.rate - it.amount), 0)
  const taxTotal = items.reduce((s, it) => s + it.taxAmount, 0)
  const grandTotal = items.reduce((s, it) => s + it.lineTotal, 0)

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSave(status: "draft" | "sent") {
    if (!customerName.trim()) { toast({ title: "Customer name is required", variant: "destructive" }); return }
    if (items.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return }

    const payload = {
      companyId: activeCompany?.id,
      type: docType,
      status,
      customerId,
      customerName: customerName.trim(),
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      customerGstin: customerGstin || undefined,
      customerPan: customerPan || undefined,
      billingAddress: billingAddress || undefined,
      shippingAddress: shippingAddress || undefined,
      placeOfSupply: placeOfSupply || undefined,
      currency,
      issueDate,
      dueDate: dueDate || undefined,
      paymentTerms: paymentTerms || undefined,
      reference: reference || undefined,
      notes: notes || undefined,
      terms: terms || undefined,
      items: items.map((it) => ({
        productId: it.productId,
        description: it.description,
        hsnCode: it.hsnCode || undefined,
        quantity: it.quantity,
        rate: it.rate,
        discountPercent: it.discountPercent,
        taxType: it.taxType,
        taxRate: it.taxRate,
      })),
    }

    if (isEdit) updateMut.mutate(payload)
    else createMut.mutate(payload)
  }

  const isSaving = createMut.isPending || updateMut.isPending

  if (!!sourceId && loadingEdit) {
    return <div className="space-y-4 p-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">{isEdit ? "Edit Document" : isDup ? "Duplicate Document" : "New Document"}</h1>
            <p className="text-xs text-muted-foreground">{activeCompany?.name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleSave("draft")} disabled={isSaving}>Save Draft</Button>
          <Button onClick={() => handleSave("sent")} disabled={isSaving}>
            {docType === "invoice" ? "Finalize & Send" : "Finalize"}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left / Main */}
        <div className="lg:col-span-2 space-y-6">
          {/* Document type + meta */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Document Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Document Type</Label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOC_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Issue Date *</Label>
                  <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Payment Terms</Label>
                  <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Reference / PO No.</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Bill To (Customer)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Customer picker */}
              <div className="relative">
                <Label>Customer *</Label>
                <div className="flex gap-2 mt-1">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search saved customers…"
                      value={customerSearch}
                      onFocus={() => setShowCustDropdown(true)}
                      onChange={(e) => { setCustomerSearch(e.target.value); setShowCustDropdown(true) }}
                      className="pl-8"
                    />
                    {showCustDropdown && filteredCustomers.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {filteredCustomers.slice(0, 8).map((c) => (
                          <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                            onMouseDown={() => selectCustomer(c)}>
                            <div className="font-medium">{c.name}</div>
                            {c.gstin && <div className="text-xs text-muted-foreground">{c.gstin}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {showCustDropdown && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setShowCustDropdown(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Name *</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer / Company name" />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="customer@email.com" />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+91 98765 43210" />
                </div>
                <div className="space-y-1">
                  <Label>GSTIN</Label>
                  <Input value={customerGstin} onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>PAN</Label>
                  <Input value={customerPan} onChange={(e) => setCustomerPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>Place of Supply</Label>
                  <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Billing Address</Label>
                  <Textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Full billing address" rows={2} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label>Shipping Address</Label>
                  <Textarea value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} placeholder="Same as billing or different" rows={2} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Line Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {/* Table header */}
              <div className="hidden md:grid gap-1 text-xs text-muted-foreground font-medium"
                style={{ gridTemplateColumns: "1fr 80px 90px 80px 100px 60px 90px 80px" }}>
                <span>Description</span><span>HSN</span><span>Qty</span><span>Rate</span>
                <span>Disc%</span><span>Tax</span><span>Rate%</span><span className="text-right">Total</span>
              </div>

              {items.map((it, idx) => (
                <div key={it._id} className="border border-border rounded-lg p-3 space-y-3 md:space-y-0 relative">
                  {/* Mobile product picker button */}
                  <div className="md:hidden mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => { setActiveItemIdx(activeItemIdx === idx ? null : idx); setProductSearch("") }}
                      className="h-7 px-2.5 flex items-center gap-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Search className="w-3 h-3" /> Pick from inventory
                    </button>
                    {activeItemIdx === idx && (
                      <div className="absolute top-12 right-3 left-3 z-50 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        <div className="p-1.5 border-b border-border">
                          <Input autoFocus placeholder="Search inventory…" value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)} className="h-7 text-xs" />
                        </div>
                        {filteredProducts.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-3 py-3 text-center">No products in inventory</p>
                        ) : filteredProducts.slice(0, 8).map((p) => (
                          <button key={p.id} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                            onMouseDown={() => selectProduct(idx, p)}>
                            <div className="font-medium">{p.name}</div>
                            {p.sku && <span className="text-muted-foreground">SKU: {p.sku}</span>}
                            {p.price && <span className="ml-2 text-muted-foreground">₹{p.price}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Desktop row */}
                  <div className="hidden md:grid items-start gap-1"
                    style={{ gridTemplateColumns: "1fr 80px 90px 80px 100px 60px 90px 80px" }}>
                    <div className="relative flex gap-1">
                      <Input
                        value={it.description}
                        onChange={(e) => updateItem(idx, { description: e.target.value })}
                        placeholder="Type item description…"
                        className="h-8 text-sm flex-1"
                      />
                      {/* Product picker — only opens on explicit icon click */}
                      <button
                        type="button"
                        title="Pick from inventory"
                        onClick={() => { setActiveItemIdx(activeItemIdx === idx ? null : idx); setProductSearch("") }}
                        className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      {activeItemIdx === idx && (
                        <div className="absolute top-full right-0 z-50 w-64 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          <div className="p-1.5 border-b border-border">
                            <Input autoFocus placeholder="Search inventory…" value={productSearch}
                              onChange={(e) => setProductSearch(e.target.value)} className="h-7 text-xs" />
                          </div>
                          {filteredProducts.length === 0 ? (
                            <p className="text-xs text-muted-foreground px-3 py-3 text-center">No products in inventory</p>
                          ) : filteredProducts.slice(0, 10).map((p) => (
                            <button key={p.id} className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                              onMouseDown={() => selectProduct(idx, p)}>
                              <div className="font-medium">{p.name}</div>
                              <div className="flex gap-2 text-muted-foreground mt-0.5">
                                {p.sku && <span>SKU: {p.sku}</span>}
                                {p.price && <span>₹{p.price}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Input value={it.hsnCode} onChange={(e) => updateItem(idx, { hsnCode: e.target.value })} placeholder="HSN" className="h-8 text-sm font-mono" />
                    <Input type="number" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} min={0} step="0.01" className="h-8 text-sm" />
                    <Input type="number" value={it.rate} onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })} min={0} step="0.01" className="h-8 text-sm" />
                    <Input type="number" value={it.discountPercent} onChange={(e) => updateItem(idx, { discountPercent: Number(e.target.value) })} min={0} max={100} step="0.1" className="h-8 text-sm" />
                    <Select value={it.taxType} onValueChange={(v) => updateItem(idx, { taxType: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TAX_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(it.taxRate)} onValueChange={(v) => updateItem(idx, { taxRate: Number(v) })} disabled={it.taxType === "none"}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="text-right text-sm font-medium pt-1.5">₹{fmtINR(it.lineTotal)}</div>
                  </div>

                  {/* Mobile fields */}
                  <div className="md:hidden space-y-2">
                    <Input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} placeholder="Description" className="text-sm" />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs">Qty</Label><Input type="number" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} className="h-8 text-sm mt-0.5" /></div>
                      <div><Label className="text-xs">Rate (₹)</Label><Input type="number" value={it.rate} onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })} className="h-8 text-sm mt-0.5" /></div>
                      <div><Label className="text-xs">Disc%</Label><Input type="number" value={it.discountPercent} onChange={(e) => updateItem(idx, { discountPercent: Number(e.target.value) })} className="h-8 text-sm mt-0.5" /></div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Select value={it.taxType} onValueChange={(v) => updateItem(idx, { taxType: v })}>
                          <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>{TAX_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={String(it.taxRate)} onValueChange={(v) => updateItem(idx, { taxRate: Number(v) })} disabled={it.taxType === "none"}>
                          <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>{GST_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <span className="font-medium">₹{fmtINR(it.lineTotal)}</span>
                    </div>
                  </div>

                  {/* Remove */}
                  {items.length > 1 && (
                    <button className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                      onClick={() => removeItem(idx)}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addItem} className="gap-1.5 w-full">
                <Plus className="w-3.5 h-3.5" /> Add Line Item
              </Button>
            </CardContent>
          </Card>

          {/* Notes / Terms */}
          <Card>
            <CardContent className="p-4 grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes or payment instructions…" rows={3} />
              </div>
              <div className="space-y-1">
                <Label>Terms & Conditions</Label>
                <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Standard terms…" rows={3} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right / Summary */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{fmtINR(subtotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-green-400">
                  <span>Discount</span>
                  <span>-₹{fmtINR(discountTotal)}</span>
                </div>
              )}
              {taxTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>₹{fmtINR(taxTotal)}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{currency === "INR" ? "₹" : currency}{fmtINR(grandTotal)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Tax breakdown */}
          {taxTotal > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Tax Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                {items.filter((it) => it.taxAmount > 0).reduce((acc, it) => {
                  const key = `${it.taxType}-${it.taxRate}`
                  const existing = acc.find((a: any) => a.key === key)
                  if (existing) existing.amount += it.taxAmount
                  else acc.push({ key, type: it.taxType, rate: it.taxRate, amount: it.taxAmount })
                  return acc
                }, [] as any[]).map((t: any) => {
                  if (t.type === "gst") {
                    const half = t.amount / 2
                    return (
                      <React.Fragment key={t.key}>
                        <div className="flex justify-between"><span className="text-muted-foreground">CGST {t.rate / 2}%</span><span>₹{fmtINR(half)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">SGST {t.rate / 2}%</span><span>₹{fmtINR(half)}</span></div>
                      </React.Fragment>
                    )
                  }
                  return <div key={t.key} className="flex justify-between"><span className="text-muted-foreground">{t.type.toUpperCase()} {t.rate}%</span><span>₹{fmtINR(t.amount)}</span></div>
                })}
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => handleSave("sent")} disabled={isSaving}>
              {docType === "invoice" ? "Finalize" : "Save"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => handleSave("draft")} disabled={isSaving}>
              Draft
            </Button>
          </div>
        </div>
      </div>

      {/* Close dropdown on outside click */}
      {(showCustDropdown || activeItemIdx !== null) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowCustDropdown(false); setActiveItemIdx(null) }} />
      )}
    </div>
  )
}
