import * as React from "react"
import * as XLSX from "xlsx"
import {
  useListTransactions, getListTransactionsQueryKey,
  useGetPnlSummary, getGetPnlSummaryQueryKey,
  useListCompanies,
} from "@workspace/api-client-react"
import { useQuery } from "@tanstack/react-query"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  Plus, TrendingUp, TrendingDown, Wallet, Pencil, Ban,
  Download, Scale, ArrowDownLeft, ArrowUpRight, Clock,
  Building2, PieChart,
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

const API_BASE = ""

const TYPE_COLORS: Record<string, string> = {
  income:            "bg-green-500/10  text-green-400  border-green-500/20",
  expense:           "bg-red-500/10    text-red-400    border-red-500/20",
  transfer:          "bg-blue-500/10   text-blue-400   border-blue-500/20",
  capital_injection: "bg-violet-500/10 text-violet-400 border-violet-500/20",
}
const CATEGORIES_INCOME  = ["Sales Revenue","Service Income","Consulting","Royalties","Investment Returns","Other Income"]
const CATEGORIES_EXPENSE = [
  "Salaries","Marketing","Technology","Office","Software","Operations",
  "Manufacturing","Shipping","Legal","Miscellaneous",
  "Rent","Utilities","Cost of Goods","Logistics","Travel","Tax","Other Expense",
]
const PAYMENT_METHODS    = ["bank_transfer","cash","upi","credit_card","cheque","razorpay"]

interface TxForm {
  companyId: string; type: string; category: string; amount: string
  description: string; referenceNumber: string; paymentMethod: string; status: string; date: string
}
const emptyForm = (): TxForm => ({
  companyId: "", type: "income", category: "Sales Revenue", amount: "",
  description: "", referenceNumber: "", paymentMethod: "bank_transfer",
  status: "completed", date: new Date().toISOString().slice(0, 10),
})

interface BalanceData {
  totalIncome: number; totalExpenses: number; netOperating: number
  pendingIncome: number; pendingExpenses: number
  fundAllocationsIn: number; fundAllocationsOut: number; netCashPosition: number
}

function fmt(n: number, signed = false) {
  const abs = `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
  if (!signed) return abs
  return n >= 0 ? `+${abs}` : `−${abs}`
}

/* ── Balance section ── */
function BalanceSection({ balance, loading }: { balance: BalanceData | undefined; loading: boolean }) {
  if (loading) return (
    <Card className="bg-card/60">
      <CardContent className="pt-5"><Skeleton className="h-32 w-full" /></CardContent>
    </Card>
  )
  if (!balance) return null

  const rows: { label: string; value: number; signed?: boolean; sub?: string; icon: React.ElementType; color: string; bg: string }[] = [
    {
      label: "Total Income",  value: balance.totalIncome,
      sub: balance.pendingIncome > 0 ? `+${fmt(balance.pendingIncome)} pending` : undefined,
      icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10",
    },
    {
      label: "Total Expenses", value: balance.totalExpenses,
      sub: balance.pendingExpenses > 0 ? `${fmt(balance.pendingExpenses)} pending` : undefined,
      icon: TrendingDown, color: "text-red-400", bg: "bg-red-500/10",
    },
    {
      label: "Net Operating", value: balance.netOperating, signed: true,
      icon: Wallet,
      color: balance.netOperating >= 0 ? "text-blue-400" : "text-orange-400",
      bg:    balance.netOperating >= 0 ? "bg-blue-500/10" : "bg-orange-500/10",
    },
    {
      label: "Fund Allocations In", value: balance.fundAllocationsIn,
      sub: "Approved transfers received",
      icon: ArrowDownLeft, color: "text-emerald-400", bg: "bg-emerald-500/10",
    },
    {
      label: "Fund Allocations Out", value: balance.fundAllocationsOut,
      sub: "Approved transfers sent",
      icon: ArrowUpRight, color: "text-amber-400", bg: "bg-amber-500/10",
    },
    {
      label: "Net Cash Position", value: balance.netCashPosition, signed: true,
      sub: "Operating + allocations",
      icon: Scale,
      color: balance.netCashPosition >= 0 ? "text-green-400" : "text-red-400",
      bg:    balance.netCashPosition >= 0 ? "bg-green-500/10" : "bg-red-500/10",
    },
  ]

  return (
    <Card className="bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">Balance Sheet</CardTitle>
        </div>
        <CardDescription className="text-xs">All-time totals · completed transactions only</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {rows.map(r => (
            <div key={r.label} className={`rounded-xl p-3 border border-white/5 ${r.bg}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 bg-black/20`}>
                <r.icon className={`w-3.5 h-3.5 ${r.color}`} />
              </div>
              <div className={`text-lg font-bold leading-tight ${r.color}`}>{fmt(r.value, r.signed)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{r.label}</div>
              {r.sub && <div className="text-[10px] text-muted-foreground/60 mt-1 leading-tight">{r.sub}</div>}
            </div>
          ))}
        </div>

        {/* Net bar */}
        <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
          balance.netCashPosition >= 0
            ? "bg-green-500/8 border-green-500/20"
            : "bg-red-500/8 border-red-500/20"
        }`}>
          <div className="text-sm font-semibold">
            Net Cash Position
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (Income − Expenses + Alloc. In − Alloc. Out)
            </span>
          </div>
          <div className={`text-xl font-bold ${balance.netCashPosition >= 0 ? "text-green-400" : "text-red-400"}`}>
            {balance.netCashPosition >= 0 ? "+" : "−"}{fmt(balance.netCashPosition)}
          </div>
        </div>

        {/* Pending note */}
        {(balance.pendingIncome > 0 || balance.pendingExpenses > 0) && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              {fmt(balance.pendingIncome)} income and {fmt(balance.pendingExpenses)} in expenses are pending — not included in the balance above.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Main page ── */
export default function Finance() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [typeFilter, setTypeFilter] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [form, setForm] = React.useState<TxForm>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const { data: companies } = useListCompanies({ query: { enabled: true, queryKey: ["/api/companies"] } })

  const params: Record<string, string | number> = { page, limit: 20 }
  if (activeCompany) params.companyId = activeCompany.id
  if (typeFilter !== "all") params.type = typeFilter

  const { data, isLoading, refetch } = useListTransactions(params, {
    query: { enabled: true, queryKey: getListTransactionsQueryKey(params) }
  })

  const pnlParams: Record<string, string> = {}
  if (activeCompany) pnlParams.companyId = String(activeCompany.id)
  const { data: pnl } = useGetPnlSummary(pnlParams, {
    query: { enabled: true, queryKey: getGetPnlSummaryQueryKey(pnlParams) }
  })

  // Balance
  const balanceKey = activeCompany ? `/api/finance/balance?companyId=${activeCompany.id}` : "/api/finance/balance"
  const { data: balance, isLoading: balanceLoading } = useQuery<BalanceData>({
    queryKey: [balanceKey],
    queryFn: () => fetch(API_BASE + balanceKey, { credentials: "include" }).then(r => r.json()),
  })

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm(), companyId: activeCompany ? String(activeCompany.id) : "" })
    setShowDialog(true)
  }
  function openEdit(t: any) {
    setEditing(t)
    setForm({
      companyId: String(t.companyId), type: t.type, category: t.category,
      amount: String(t.amount), description: t.description, referenceNumber: t.referenceNumber ?? "",
      paymentMethod: t.paymentMethod ?? "bank_transfer", status: t.status, date: t.date,
    })
    setShowDialog(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        companyId: parseInt(form.companyId), type: form.type, category: form.category,
        amount: parseFloat(form.amount), description: form.description,
        referenceNumber: form.referenceNumber || null, paymentMethod: form.paymentMethod,
        status: form.status, date: form.date,
      }
      const url = editing
        ? `${API_BASE}/api/finance/transactions/${editing.id}`
        : `${API_BASE}/api/finance/transactions`
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Transaction updated" : "Transaction recorded" })
      setShowDialog(false); refetch()
    } catch {
      toast({ title: "Error", description: "Could not save transaction", variant: "destructive" })
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm("Cancel this transaction? The record will be preserved with status 'cancelled'.")) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/finance/transactions/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error()
      toast({ title: "Transaction cancelled", description: "The record has been marked as cancelled." })
      refetch()
    } catch {
      toast({ title: "Error", description: "Could not cancel transaction", variant: "destructive" })
    } finally { setDeleting(null) }
  }

  /* ── Excel export ── */
  async function handleExport() {
    setExporting(true)
    try {
      // Fetch ALL transactions (up to 10 000 rows) without pagination
      const qs = activeCompany ? `?companyId=${activeCompany.id}&limit=10000` : "?limit=10000"
      const txRes = await fetch(`${API_BASE}/api/finance/transactions${qs}`, { credentials: "include" })
      if (!txRes.ok) throw new Error(`Failed to fetch transactions (${txRes.status})`)
      const txData = await txRes.json()
      const items: any[] = txData.items ?? []

      /* --- Sheet 1: Transactions --- */
      const txRows = items.map((t: any) => ({
        "Date":           t.date,
        "Description":    t.description,
        "Category":       t.category,
        "Company":        t.companyName,
        "Type":           t.type,
        "Amount (₹)":     t.type === "expense" ? -Math.abs(Number(t.amount)) : Number(t.amount),
        "Reference #":    t.referenceNumber ?? "",
        "Payment Method": (t.paymentMethod ?? "").replace(/_/g, " "),
        "Status":         t.status,
      }))
      const txSheet = XLSX.utils.json_to_sheet(txRows)
      // Column widths
      txSheet["!cols"] = [
        { wch: 12 }, { wch: 36 }, { wch: 22 }, { wch: 22 },
        { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 },
      ]

      /* --- Sheet 2: P&L Summary --- */
      const pnlRows = [
        { "Metric": "Revenue",              "Value (₹)": pnl?.revenue            ?? 0 },
        { "Metric": "Operating Expenses",   "Value (₹)": pnl?.operatingExpenses  ?? 0 },
        { "Metric": "Net Profit",           "Value (₹)": pnl?.netProfit          ?? 0 },
        { "Metric": "Net Margin %",         "Value (₹)": pnl?.netMargin          ?? 0 },
      ]
      const pnlSheet = XLSX.utils.json_to_sheet(pnlRows)
      pnlSheet["!cols"] = [{ wch: 24 }, { wch: 16 }]

      /* --- Sheet 3: Balance Sheet --- */
      const balRows = [
        { "Metric": "Total Income (Completed)",    "Value (₹)": balance?.totalIncome        ?? 0 },
        { "Metric": "Total Expenses (Completed)",  "Value (₹)": balance?.totalExpenses      ?? 0 },
        { "Metric": "Net Operating Balance",       "Value (₹)": balance?.netOperating       ?? 0 },
        { "Metric": "Pending Income",              "Value (₹)": balance?.pendingIncome      ?? 0 },
        { "Metric": "Pending Expenses",            "Value (₹)": balance?.pendingExpenses    ?? 0 },
        { "Metric": "Fund Allocations Received",   "Value (₹)": balance?.fundAllocationsIn  ?? 0 },
        { "Metric": "Fund Allocations Sent",       "Value (₹)": balance?.fundAllocationsOut ?? 0 },
        { "Metric": "Net Cash Position",           "Value (₹)": balance?.netCashPosition    ?? 0 },
      ]
      const balSheet = XLSX.utils.json_to_sheet(balRows)
      balSheet["!cols"] = [{ wch: 30 }, { wch: 16 }]

      /* --- Workbook --- */
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, txSheet,  "Transactions")
      XLSX.utils.book_append_sheet(wb, pnlSheet, "P&L Summary")
      XLSX.utils.book_append_sheet(wb, balSheet, "Balance Sheet")

      const fileName = `Finance_${activeCompany?.name ?? "AllCompanies"}_${new Date().toISOString().slice(0, 10)}.xlsx`
      XLSX.writeFile(wb, fileName)
      toast({ title: "Export complete", description: `${items.length} transactions exported to ${fileName}` })
    } catch {
      toast({ title: "Export failed", description: "Could not generate Excel file", variant: "destructive" })
    } finally { setExporting(false) }
  }

  const f = (k: keyof TxForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))
  const categories = form.type === "income" ? CATEGORIES_INCOME : CATEGORIES_EXPENSE

  const kpis = pnl ? [
    {
      label: "Revenue", value: fmt(Number(pnl.revenue)),
      icon: TrendingUp, color: "text-green-400 bg-green-500/10",
    },
    {
      label: "Gross Profit",
      value: pnl.grossProfit != null ? fmt(Number(pnl.grossProfit)) : "—",
      sub: pnl.grossMargin != null ? `Margin: ${Number(pnl.grossMargin).toFixed(1)}%` : "COGS not tracked",
      icon: Wallet, color: "text-blue-400 bg-blue-500/10",
    },
    {
      label: "Net Profit", value: fmt(Number(pnl.netProfit)),
      sub: pnl.netMargin != null ? `Margin: ${Number(pnl.netMargin).toFixed(1)}%` : undefined,
      icon: TrendingUp, color: "text-purple-400 bg-purple-500/10",
    },
    {
      label: "Expenses", value: fmt(Number(pnl.operatingExpenses)),
      icon: TrendingDown, color: "text-red-400 bg-red-500/10",
    },
  ] : []

  const isSubsidiary = activeCompany?.mode === "subsidiary"

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {activeCompany ? `${activeCompany.name} · ` : "All companies · "}
            {isSubsidiary ? "Subsidiary finance" : "P&L this month"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 h-9" onClick={handleExport} disabled={exporting}>
            <Download className="w-4 h-4" />
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
          <Button onClick={openAdd} className="gap-2 h-9">
            <Plus className="w-4 h-4" />Add Transaction
          </Button>
        </div>
      </div>

      {/* ── Subsidiary Finance Overview ───────────────────────────────
          Shown only when viewing a subsidiary company.
          Displays the funds received from TapasHub treasury, how much
          has been spent, and what's left in the budget.
         ─────────────────────────────────────────────────────────── */}
      {isSubsidiary && balance && !balanceLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Subsidiary Finance Overview
            </h2>
          </div>

          {/* Subsidiary KPI grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Funds received */}
            <Card className="bg-card/60">
              <CardContent className="pt-4 pb-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-indigo-500/10">
                  <ArrowDownLeft className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-xl font-bold">{fmt(balance.fundAllocationsIn)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Funds from TapasHub</div>
                <div className="text-[11px] text-muted-foreground/60">Executed allocations received</div>
              </CardContent>
            </Card>

            {/* Total expenses */}
            <Card className="bg-card/60">
              <CardContent className="pt-4 pb-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-red-500/10">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                </div>
                <div className="text-xl font-bold text-red-400">{fmt(balance.totalExpenses)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Total Expenses</div>
                <div className="text-[11px] text-muted-foreground/60">Completed expense transactions</div>
              </CardContent>
            </Card>

            {/* Available balance */}
            {(() => {
              const avail = balance.fundAllocationsIn - balance.totalExpenses
              return (
                <Card className="bg-card/60">
                  <CardContent className="pt-4 pb-4">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${avail >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      <Wallet className={`w-4 h-4 ${avail >= 0 ? "text-green-400" : "text-red-400"}`} />
                    </div>
                    <div className={`text-xl font-bold ${avail >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(avail, true)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Available Balance</div>
                    <div className="text-[11px] text-muted-foreground/60">Received minus expenses</div>
                  </CardContent>
                </Card>
              )
            })()}

            {/* Budget utilization */}
            {(() => {
              const utilPct = balance.fundAllocationsIn > 0
                ? Math.min(100, Math.round((balance.totalExpenses / balance.fundAllocationsIn) * 100))
                : 0
              return (
                <Card className="bg-card/60">
                  <CardContent className="pt-4 pb-4">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${utilPct > 90 ? "bg-red-500/10" : utilPct > 70 ? "bg-amber-500/10" : "bg-blue-500/10"}`}>
                      <PieChart className={`w-4 h-4 ${utilPct > 90 ? "text-red-400" : utilPct > 70 ? "text-amber-400" : "text-blue-400"}`} />
                    </div>
                    <div className={`text-xl font-bold ${utilPct > 90 ? "text-red-400" : utilPct > 70 ? "text-amber-400" : "text-blue-400"}`}>{utilPct}%</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Budget Utilization</div>
                    <Progress value={utilPct} className="h-1.5 mt-2" />
                  </CardContent>
                </Card>
              )
            })()}
          </div>

          {/* Allocation info note */}
          {balance.fundAllocationsIn === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-indigo-500/5 border border-indigo-500/15 px-4 py-3 text-xs text-muted-foreground">
              <ArrowDownLeft className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>
                No funds have been allocated to {activeCompany?.name} from TapasHub yet.
                Allocations are managed in{" "}
                <a href="/fund-allocation" className="text-indigo-400 hover:underline">Fund Allocation</a>.
              </span>
            </div>
          )}

          <Separator className="opacity-30" />
        </div>
      )}

      {/* P&L KPI cards */}
      {pnl && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <Card key={k.label} className="bg-card/60">
              <CardContent className="pt-4 pb-4">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${k.color.split(" ")[1]}`}>
                  <k.icon className={`w-4.5 h-4.5 ${k.color.split(" ")[0]}`} />
                </div>
                <div className="text-xl font-bold">{k.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
                {k.sub && <div className="text-[11px] text-muted-foreground/70">{k.sub}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Balance sheet */}
      <BalanceSection balance={balance} loading={balanceLoading} />

      <Separator className="opacity-30" />

      {/* Transactions table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Transactions</CardTitle>
              <CardDescription className="text-xs">{data?.total ?? 0} records</CardDescription>
            </div>
            <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1) }}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                    ))
                  : data?.items?.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                          No transactions found
                        </TableCell>
                      </TableRow>
                    )
                  : data?.items?.map((t: any) => (
                      <TableRow key={t.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs text-muted-foreground">{t.date}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{t.description}</div>
                          {t.referenceNumber && (
                            <div className="text-xs text-muted-foreground font-mono">{t.referenceNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{t.category}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.companyName}</TableCell>
                        <TableCell>
                          {t.category === "Capital Injection" ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${TYPE_COLORS.capital_injection}`}>
                              Capital Injection
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium capitalize ${TYPE_COLORS[t.type] ?? ""}`}>
                              {t.type}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={`font-semibold ${t.category === "Capital Injection" ? "text-violet-400" : t.type === "income" ? "text-green-400" : t.type === "expense" ? "text-red-400" : ""}`}>
                          {t.type === "expense" ? "−" : "+"}₹{Number(t.amount).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(t)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive"
                              disabled={deleting === t.id} onClick={() => handleDelete(t.id)}
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          {data && data.total > 20 && (
            <div className="flex justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {page} of {Math.ceil(data.total / 20)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit transaction dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Transaction" : "Record Transaction"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => f("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select
                value={form.type}
                onValueChange={v => {
                  f("type", v)
                  f("category", v === "income" ? CATEGORIES_INCOME[0] : CATEGORIES_EXPENSE[0])
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => f("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input value={form.amount} onChange={e => f("amount", e.target.value)} type="number" min="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input value={form.date} onChange={e => f("date", e.target.value)} type="date" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Description *</Label>
              <Input value={form.description} onChange={e => f("description", e.target.value)} placeholder="Brief description" />
            </div>
            <div className="space-y-1.5">
              <Label>Reference #</Label>
              <Input value={form.referenceNumber} onChange={e => f("referenceNumber", e.target.value)} placeholder="INV-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod} onValueChange={v => f("paymentMethod", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m} value={m} className="capitalize">{m.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.amount || !form.description || !form.companyId}
            >
              {saving ? "Saving…" : editing ? "Save Changes" : "Record Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
