import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation } from "wouter"
import { adminApi } from "@/lib/admin-api"
import { useAuth } from "@/contexts/auth-context"
import { useCompany } from "@/contexts/company-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import {
  FileText, Plus, Search, Clock, CheckCircle, AlertCircle,
  Eye, Pencil, Trash2, IndianRupee,
} from "lucide-react"
import { ResponsiveTable, type ResponsiveTableColumn, type ResponsiveTableAction } from "@/components/responsive-table"
import { QueryState } from "@/components/query-state"

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceDashboard {
  totalRevenue: number; collectedAmount: number; pendingAmount: number
  paidCount: number; overdueCount: number; draftCount: number
  recentInvoices: Invoice[]
}

interface Invoice {
  id: number; companyId: number; invoiceNumber: string; type: string; status: string
  customerName: string; customerEmail?: string; currency: string
  subtotal: number; taxTotal: number; total: number; paidAmount: number
  issueDate: string; dueDate?: string; reference?: string
  createdAt: string; updatedAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { key: "invoice", label: "Invoices" },
  { key: "quotation", label: "Quotations" },
  { key: "proforma", label: "Proforma" },
  { key: "purchase_order", label: "Purchase Orders" },
  { key: "sales_order", label: "Sales Orders" },
  { key: "delivery_challan", label: "Delivery Challan" },
  { key: "credit_note", label: "Credit Notes" },
  { key: "debit_note", label: "Debit Notes" },
  { key: "receipt", label: "Receipts" },
]

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30",
  sent: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  viewed: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  partially_paid: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  paid: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  overdue: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30",
  refunded: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
}

const fmtCurrency = (n: number, currency = "INR") => {
  if (currency === "INR") {
    if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`
    if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`
    return `₹${Math.round(n).toLocaleString("en-IN")}`
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(n)
}

const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"

function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string; tone: string
}) {
  return (
    <Card className="bg-card/50">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { hasPermission } = useAuth()
  const { activeCompany } = useCompany()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [, setLocation] = useLocation()

  const [activeType, setActiveType] = React.useState("invoice")
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [deleteTarget, setDeleteTarget] = React.useState<Invoice | null>(null)

  const companyQs = activeCompany ? `?companyId=${activeCompany.id}` : ""

  const { data: dashboard, isLoading: loadingDash } = useQuery<InvoiceDashboard>({
    queryKey: ["/api/invoices/dashboard", activeCompany?.id],
    queryFn: () => adminApi.get(`/invoices/dashboard${companyQs}`),
    enabled: !!activeCompany,
  })

  const { data: invoices = [], isLoading: loadingList, isError: listError, refetch: refetchList } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", activeCompany?.id, activeType, statusFilter],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (activeCompany) qs.set("companyId", String(activeCompany.id))
      qs.set("type", activeType)
      if (statusFilter !== "all") qs.set("status", statusFilter)
      return adminApi.get(`/invoices?${qs}`)
    },
    enabled: !!activeCompany,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.del(`/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/invoices"] })
      qc.invalidateQueries({ queryKey: ["/api/invoices/dashboard"] })
      toast({ title: "Deleted", description: "Invoice removed." })
      setDeleteTarget(null)
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const filtered = invoices.filter((inv) => {
    const q = search.toLowerCase()
    return !q || inv.invoiceNumber.toLowerCase().includes(q) || inv.customerName.toLowerCase().includes(q)
  })

  const canManage = hasPermission("finance.manage")

  const columns: ResponsiveTableColumn<Invoice>[] = [
    {
      key: "invoiceNumber", header: "Number", card: "title",
      cell: (inv) => (
        <>
          <Link href={`/invoices/${inv.id}`} className="font-mono text-sm font-medium text-primary hover:underline">
            {inv.invoiceNumber}
          </Link>
          {inv.reference && <div className="text-xs text-muted-foreground">Ref: {inv.reference}</div>}
        </>
      ),
      cardCell: (inv) => inv.invoiceNumber,
    },
    {
      key: "customer", header: "Customer", card: "subtitle",
      cell: (inv) => (
        <>
          <div className="font-medium text-sm">{inv.customerName}</div>
          {inv.customerEmail && <div className="text-xs text-muted-foreground">{inv.customerEmail}</div>}
        </>
      ),
      cardCell: (inv) => inv.customerName,
    },
    { key: "issueDate", header: "Date", cell: (inv) => <span className="text-sm">{fmtDate(inv.issueDate)}</span> },
    {
      key: "dueDate", header: "Due",
      cell: (inv) => inv.dueDate ? (
        <span className={`text-sm ${new Date(inv.dueDate) < new Date() && inv.status !== "paid" ? "text-red-700 dark:text-red-400" : ""}`}>
          {fmtDate(inv.dueDate)}
        </span>
      ) : <span className="text-sm">—</span>,
    },
    {
      key: "status", header: "Status", card: "badge",
      cell: (inv) => <Badge className={`text-xs border ${STATUS_COLORS[inv.status] ?? ""}`} variant="outline">{inv.status.replace("_", " ")}</Badge>,
    },
    {
      key: "total", header: "Amount", headClassName: "text-right", cellClassName: "text-right",
      cell: (inv) => (
        <span className="font-medium text-sm">
          {fmtCurrency(inv.total, inv.currency)}
          {inv.paidAmount > 0 && inv.paidAmount < inv.total && (
            <div className="text-xs text-green-700 dark:text-green-400">{fmtCurrency(inv.paidAmount)} paid</div>
          )}
        </span>
      ),
    },
  ]

  const rowActions: ResponsiveTableAction<Invoice>[] = [
    { label: "View", icon: Eye, onClick: (inv) => setLocation(`/invoices/${inv.id}`) },
    ...(canManage ? [
      { label: "Edit", icon: Pencil, onClick: (inv: Invoice) => setLocation(`/invoices/${inv.id}/edit`), hidden: (inv: Invoice) => inv.status !== "draft" },
      { label: "Delete", icon: Trash2, onClick: (inv: Invoice) => setDeleteTarget(inv), destructive: true },
    ] : []),
  ]

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoice & Billing</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCompany?.name ?? "All companies"} · Financial documents
          </p>
        </div>
        {canManage && (
          <Link href={`/invoices/new?type=${activeType}`}>
            <Button className="gap-2"><Plus className="w-4 h-4" /> New {DOC_TYPES.find(t => t.key === activeType)?.label.replace(/s$/, "") ?? "Document"}</Button>
          </Link>
        )}
      </div>

      {/* KPI Cards — only for invoice type */}
      {activeType === "invoice" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loadingDash ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <KpiCard icon={IndianRupee} label="Total Revenue" value={fmtCurrency(dashboard?.totalRevenue ?? 0)} tone="bg-teal-500/10 text-teal-700 dark:text-teal-400" />
              <KpiCard icon={Clock} label="Outstanding" value={fmtCurrency(dashboard?.pendingAmount ?? 0)} tone="bg-amber-500/10 text-amber-700 dark:text-amber-400" sub={`${dashboard?.draftCount ?? 0} drafts`} />
              <KpiCard icon={CheckCircle} label="Paid Invoices" value={String(dashboard?.paidCount ?? 0)} tone="bg-green-500/10 text-green-700 dark:text-green-400" sub={fmtCurrency(dashboard?.collectedAmount ?? 0) + " collected"} />
              <KpiCard icon={AlertCircle} label="Overdue" value={String(dashboard?.overdueCount ?? 0)} tone="bg-red-500/10 text-red-700 dark:text-red-400" />
            </>
          )}
        </div>
      )}

      {/* Document type tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border">
        {DOC_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveType(t.key); setStatusFilter("all"); setSearch("") }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeType === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by number or customer…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-3 md:p-0">
          <QueryState
            isLoading={loadingList}
            isError={listError}
            isEmpty={filtered.length === 0}
            onRetry={refetchList}
            errorMessage="Could not load documents."
            emptyIcon={FileText}
            emptyMessage={`No ${DOC_TYPES.find(t => t.key === activeType)?.label.toLowerCase() ?? "documents"} found`}
            emptyAction={canManage ? (
              <Link href={`/invoices/new?type=${activeType}`}>
                <Button size="sm" variant="outline"><Plus className="w-3 h-3 mr-1" /> Create one</Button>
              </Link>
            ) : undefined}
            loading={<ResponsiveTable columns={columns} data={[]} rowKey={(inv) => inv.id} isLoading skeletonCount={5} actions={rowActions} />}
          >
            <ResponsiveTable columns={columns} data={filtered} rowKey={(inv) => inv.id} actions={rowActions} />
          </QueryState>
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
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
