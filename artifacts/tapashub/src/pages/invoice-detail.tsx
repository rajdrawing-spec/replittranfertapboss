import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRoute, Link } from "wouter"
import { adminApi } from "@/lib/admin-api"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Printer, Pencil, CheckCircle2, Clock, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Company {
  id: number; name: string; logoUrl?: string | null; gstNumber?: string | null
  panNumber?: string | null; address?: string | null; city?: string | null
  state?: string | null; website?: string | null; brandColor?: string | null
}

interface Settings {
  bankName?: string | null; bankAccount?: string | null; bankIfsc?: string | null
  bankBranch?: string | null; upiId?: string | null; defaultTerms?: string | null
}

interface LineItem {
  id: number; description: string; hsnCode?: string | null; quantity: number
  rate: number; discountPercent: number; taxType: string; taxRate: number
  amount: number; taxAmount: number; lineTotal: number
}

interface InvoiceDetail {
  id: number; invoiceNumber: string; type: string; status: string
  customerName: string; customerEmail?: string | null; customerPhone?: string | null
  customerGstin?: string | null; customerPan?: string | null
  billingAddress?: string | null; shippingAddress?: string | null; placeOfSupply?: string | null
  currency: string; subtotal: number; discountTotal: number; taxTotal: number
  total: number; paidAmount: number
  issueDate: string; dueDate?: string | null; paymentTerms?: string | null
  reference?: string | null; notes?: string | null; terms?: string | null
  items: LineItem[]; company: Company | null; settings: Settings
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["draft","sent","viewed","partially_paid","paid","overdue","cancelled","refunded"]

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  sent: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  viewed: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  partially_paid: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  paid: "bg-green-500/15 text-green-400 border-green-500/30",
  overdue: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  refunded: "bg-orange-500/15 text-orange-400 border-orange-500/30",
}

const DOC_LABELS: Record<string, string> = {
  invoice: "TAX INVOICE", quotation: "QUOTATION", proforma: "PROFORMA INVOICE",
  purchase_order: "PURCHASE ORDER", sales_order: "SALES ORDER",
  delivery_challan: "DELIVERY CHALLAN", credit_note: "CREDIT NOTE",
  debit_note: "DEBIT NOTE", receipt: "RECEIPT",
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—"

const fmtINR = (n: number, currency = "INR") => {
  const sym = currency === "INR" ? "₹" : currency + " "
  return sym + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Invoice Print Template ────────────────────────────────────────────────────

function InvoicePrint({ inv }: { inv: InvoiceDetail }) {
  const co = inv.company
  const accentColor = co?.brandColor ?? "#2563EB"

  return (
    <div id="invoice-print" className="bg-white text-gray-900 min-h-[297mm] font-sans text-sm"
      style={{ padding: "20mm 18mm", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          {co?.logoUrl ? (
            <img
              src={co.logoUrl.startsWith("/objects") ? `/api/storage${co.logoUrl}` : co.logoUrl}
              alt={co.name} className="h-14 object-contain mb-2"
            />
          ) : (
            <div className="h-14 w-32 rounded-lg flex items-center justify-center text-white font-bold text-lg"
              style={{ background: accentColor }}>
              {co?.name?.charAt(0) ?? "C"}
            </div>
          )}
          <div className="font-bold text-base mt-1">{co?.name ?? "Company"}</div>
          {co?.address && <div className="text-xs text-gray-500 mt-0.5">{co.address}{co.city ? `, ${co.city}` : ""}{co.state ? `, ${co.state}` : ""}</div>}
          {co?.gstNumber && <div className="text-xs text-gray-500">GSTIN: {co.gstNumber}</div>}
          {co?.panNumber && <div className="text-xs text-gray-500">PAN: {co.panNumber}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide" style={{ color: accentColor }}>
            {DOC_LABELS[inv.type] ?? "INVOICE"}
          </div>
          <div className="text-base font-mono font-semibold mt-1">{inv.invoiceNumber}</div>
          {inv.status === "paid" && (
            <div className="mt-2 inline-block px-3 py-1 border-2 border-green-500 text-green-600 font-bold text-xs tracking-widest rounded rotate-[-10deg]">
              PAID
            </div>
          )}
          {inv.status === "cancelled" && (
            <div className="mt-2 inline-block px-3 py-1 border-2 border-red-400 text-red-500 font-bold text-xs tracking-widest rounded rotate-[-10deg]">
              CANCELLED
            </div>
          )}
          {inv.status === "draft" && (
            <div className="mt-2 inline-block px-3 py-1 border-2 border-gray-400 text-gray-500 font-bold text-xs tracking-widest rounded rotate-[-10deg]">
              DRAFT
            </div>
          )}
        </div>
      </div>

      {/* Bill To / Dates */}
      <div className="flex gap-8 mb-8">
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</div>
          <div className="font-semibold">{inv.customerName}</div>
          {inv.customerGstin && <div className="text-xs text-gray-500">GSTIN: {inv.customerGstin}</div>}
          {inv.customerPan && <div className="text-xs text-gray-500">PAN: {inv.customerPan}</div>}
          {inv.billingAddress && <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{inv.billingAddress}</div>}
          {inv.customerPhone && <div className="text-xs text-gray-500">{inv.customerPhone}</div>}
          {inv.customerEmail && <div className="text-xs text-gray-500">{inv.customerEmail}</div>}
        </div>
        <div className="shrink-0 text-right space-y-1">
          <div><span className="text-xs text-gray-400 uppercase">Date</span><div className="font-medium">{fmtDate(inv.issueDate)}</div></div>
          {inv.dueDate && <div><span className="text-xs text-gray-400 uppercase">Due</span><div className="font-medium">{fmtDate(inv.dueDate)}</div></div>}
          {inv.placeOfSupply && <div><span className="text-xs text-gray-400 uppercase">Place of Supply</span><div className="font-medium">{inv.placeOfSupply}</div></div>}
          {inv.reference && <div><span className="text-xs text-gray-400 uppercase">Ref</span><div className="font-medium text-xs">{inv.reference}</div></div>}
        </div>
      </div>

      {/* Line items table */}
      <table className="w-full border-collapse mb-6" style={{ borderTop: `2px solid ${accentColor}` }}>
        <thead>
          <tr style={{ background: accentColor + "15" }}>
            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">#</th>
            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">Description</th>
            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-600">HSN</th>
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Qty</th>
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Rate</th>
            {inv.discountTotal > 0 && <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Disc%</th>}
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Amount</th>
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Tax</th>
            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={it.id} className={i % 2 === 0 ? "" : "bg-gray-50"}>
              <td className="py-2 px-2 text-xs text-gray-500">{i + 1}</td>
              <td className="py-2 px-2 text-sm font-medium">{it.description}</td>
              <td className="py-2 px-2 text-xs text-gray-500 font-mono">{it.hsnCode ?? "—"}</td>
              <td className="py-2 px-2 text-right text-sm">{it.quantity}</td>
              <td className="py-2 px-2 text-right text-sm">{fmtINR(it.rate, inv.currency)}</td>
              {inv.discountTotal > 0 && <td className="py-2 px-2 text-right text-sm">{it.discountPercent > 0 ? `${it.discountPercent}%` : "—"}</td>}
              <td className="py-2 px-2 text-right text-sm">{fmtINR(it.amount, inv.currency)}</td>
              <td className="py-2 px-2 text-right text-xs text-gray-500">
                {it.taxAmount > 0 ? `${it.taxType.toUpperCase()} ${it.taxRate}%` : "—"}
              </td>
              <td className="py-2 px-2 text-right text-sm font-semibold">{fmtINR(it.lineTotal, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-8">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{fmtINR(inv.subtotal, inv.currency)}</span></div>
          {inv.discountTotal > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{fmtINR(inv.discountTotal, inv.currency)}</span></div>}
          {/* Tax breakdown */}
          {inv.items.filter((it) => it.taxAmount > 0).reduce((acc: any[], it) => {
            const key = `${it.taxType}-${it.taxRate}`
            const ex = acc.find((a) => a.key === key)
            if (ex) ex.amount += it.taxAmount
            else acc.push({ key, type: it.taxType, rate: it.taxRate, amount: it.taxAmount })
            return acc
          }, []).map((t: any) => {
            if (t.type === "gst") {
              const half = t.amount / 2
              return (
                <React.Fragment key={t.key}>
                  <div className="flex justify-between text-gray-500 text-xs">
                    <span>CGST {t.rate / 2}%</span><span>{fmtINR(half, inv.currency)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500 text-xs">
                    <span>SGST {t.rate / 2}%</span><span>{fmtINR(half, inv.currency)}</span>
                  </div>
                </React.Fragment>
              )
            }
            return <div key={t.key} className="flex justify-between text-gray-500 text-xs"><span>{t.type.toUpperCase()} {t.rate}%</span><span>{fmtINR(t.amount, inv.currency)}</span></div>
          })}
          <div className="flex justify-between font-bold text-base border-t border-gray-300 pt-1 mt-1">
            <span>Total</span><span style={{ color: accentColor }}>{fmtINR(inv.total, inv.currency)}</span>
          </div>
          {inv.paidAmount > 0 && inv.paidAmount < inv.total && (
            <div className="flex justify-between text-green-600"><span>Paid</span><span>{fmtINR(inv.paidAmount, inv.currency)}</span></div>
          )}
          {inv.paidAmount > 0 && inv.paidAmount < inv.total && (
            <div className="flex justify-between font-semibold text-red-600"><span>Balance Due</span><span>{fmtINR(inv.total - inv.paidAmount, inv.currency)}</span></div>
          )}
        </div>
      </div>

      {/* Bank Details */}
      {(inv.settings.bankName || inv.settings.upiId) && (
        <div className="border-t border-gray-200 pt-4 mb-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment Details</div>
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
            {inv.settings.bankName && (
              <div>
                <div>Bank: <span className="font-medium">{inv.settings.bankName}</span></div>
                {inv.settings.bankAccount && <div>Account: <span className="font-mono">{inv.settings.bankAccount}</span></div>}
                {inv.settings.bankIfsc && <div>IFSC: <span className="font-mono">{inv.settings.bankIfsc}</span></div>}
                {inv.settings.bankBranch && <div>Branch: {inv.settings.bankBranch}</div>}
              </div>
            )}
            {inv.settings.upiId && <div>UPI: <span className="font-mono">{inv.settings.upiId}</span></div>}
          </div>
        </div>
      )}

      {/* Notes / Terms */}
      {(inv.notes || inv.terms) && (
        <div className="grid grid-cols-2 gap-6 text-xs text-gray-600 border-t border-gray-200 pt-4">
          {inv.notes && <div><div className="font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</div><p className="whitespace-pre-wrap">{inv.notes}</p></div>}
          {inv.terms && <div><div className="font-semibold text-gray-400 uppercase tracking-wider mb-1">Terms & Conditions</div><p className="whitespace-pre-wrap">{inv.terms}</p></div>}
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-gray-200 flex justify-between items-end text-xs text-gray-400">
        <div>Generated by Tapashub Business OS</div>
        <div className="font-semibold text-gray-600">Thank you for your business!</div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const [, params] = useRoute("/invoices/:id")
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [showStatusModal, setShowStatusModal] = React.useState(false)
  const [newStatus, setNewStatus] = React.useState("")
  const [paidAmount, setPaidAmount] = React.useState("")

  const id = parseInt(params?.id ?? "0")
  const canManage = hasPermission("finance.manage")

  const { data: inv, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", id],
    queryFn: () => adminApi.get(`/invoices/${id}`),
    enabled: !!id,
  })

  const statusMut = useMutation({
    mutationFn: (data: { status: string; paidAmount?: number }) => adminApi.post(`/invoices/${id}/status`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/invoices", id] })
      qc.invalidateQueries({ queryKey: ["/api/invoices"] })
      qc.invalidateQueries({ queryKey: ["/api/invoices/dashboard"] })
      setShowStatusModal(false)
      toast({ title: "Status updated" })
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  function handlePrint() {
    const printContent = document.getElementById("invoice-print")
    if (!printContent) return
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>${inv?.invoiceNumber ?? "Invoice"}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 13px; color: #111; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 8px; }
        @page { margin: 10mm; size: A4; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style></head><body>`)
    win.document.write(printContent.outerHTML)
    win.document.write("</body></html>")
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 300)
  }

  if (isLoading) {
    return <div className="space-y-4 p-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
  }
  if (!inv) return <div className="text-center py-20 text-muted-foreground">Invoice not found</div>

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold">{inv.invoiceNumber}</span>
              <Badge className={cn("text-xs border", STATUS_COLORS[inv.status])} variant="outline">
                {inv.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{inv.customerName} · {fmtDate(inv.issueDate)}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canManage && (
            <Button variant="outline" onClick={() => { setNewStatus(inv.status); setPaidAmount(String(inv.paidAmount)); setShowStatusModal(true) }}>
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Update Status
            </Button>
          )}
          {canManage && inv.status === "draft" && (
            <Link href={`/invoices/${id}/edit`}>
              <Button variant="outline"><Pencil className="w-4 h-4 mr-1.5" /> Edit</Button>
            </Link>
          )}
          <Button onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1.5" /> Print / PDF
          </Button>
        </div>
      </div>

      {/* Invoice preview */}
      <div className="rounded-xl border border-border overflow-hidden shadow-sm">
        <InvoicePrint inv={inv} />
      </div>

      {/* Status modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Invoice Status</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newStatus === "partially_paid" && (
              <div className="space-y-1">
                <Label>Amount Paid (₹)</Label>
                <Input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} min={0} max={inv.total} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusModal(false)}>Cancel</Button>
            <Button onClick={() => statusMut.mutate({
              status: newStatus,
              paidAmount: newStatus === "partially_paid" ? Number(paidAmount) : undefined,
            })} disabled={statusMut.isPending}>
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
