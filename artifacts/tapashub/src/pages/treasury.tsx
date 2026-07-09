/**
 * Treasury — TapasHub Main Treasury
 *
 * Central finance dashboard for the parent company showing:
 *   • Live balance: Total Raised − Allocated to Subsidiaries
 *   • All funding sources (shareholder investments, loans, grants, etc.)
 *   • Allocation breakdown by subsidiary
 *   • Monthly inflow chart
 *   • Full entry management (add / edit / reverse)
 */
import * as React from "react"
import * as XLSX from "xlsx"
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart,
} from "recharts"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import {
  Landmark, Plus, Pencil, RotateCcw, Download, TrendingUp,
  Wallet, ArrowRight, AlertCircle, CheckCircle2, Clock,
  ChevronLeft, ChevronRight, RefreshCw, Building2,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/auth-context"

/* ─────────────────────────────── Types ─────────────────────────────── */

interface TreasurySummary {
  totalRaised: number
  allocated: number      // capital deployed to sub-brands → reduces treasury
  totalExpenses: number  // actual expenses across all companies (reference)
  available: number      // totalRaised − allocated (undeployed treasury balance)
  groupRevenue: number
  netGroupPosition: number
  pendingCount: number
  pendingAmount: number
  utilizationPercent: number
  parentCompany: { id: number; name: string } | null
  bySource: { fundingSource: string; total: number; count: number }[]
  allocationsBySubsidiary: {
    companyId: number; companyName: string; color: string
    allocated: number; spent: number; income: number; netPosition: number
  }[]
  revenueBySubsidiary: { companyId: number; companyName: string; color: string; income: number }[]
  monthlyInflow: { label: string; amount: number }[]
  monthlyRevenue: { label: string; amount: number }[]
}

interface TreasuryEntry {
  id: number
  fundingSource: string
  investorName: string | null
  amount: number
  date: string
  currency: string
  paymentMethod: string | null
  referenceNumber: string | null
  description: string
  notes: string | null
  status: "pending" | "approved" | "rejected"
  isReversed: boolean
  reversedAt: string | null
  reversedByName: string | null
  reversalReason: string | null
  createdByName: string
  approvedByName: string | null
  approvedAt: string | null
  createdAt: string
}

interface EntryList {
  items: TreasuryEntry[]
  total: number
  page: number
  limit: number
}

/* ─────────────────────────────── Constants ─────────────────────────── */

export const FUNDING_SOURCES = [
  { value: "shareholder_investment", label: "Shareholder Investment" },
  { value: "founder_investment",     label: "Founder Investment" },
  { value: "director_investment",    label: "Director Investment" },
  { value: "angel_investor",         label: "Angel Investor" },
  { value: "venture_capital",        label: "Venture Capital" },
  { value: "bank_loan",              label: "Bank Loan" },
  { value: "grant",                  label: "Grant" },
  { value: "government",             label: "Government Funding" },
  { value: "donation",               label: "Donation" },
  { value: "revenue",                label: "Revenue from Subsidiaries" },
  { value: "product_sales",          label: "Product Sales" },
  { value: "service_revenue",        label: "Service Revenue" },
  { value: "interest_income",        label: "Interest Income" },
  { value: "other",                  label: "Other Income" },
]

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "neft",          label: "NEFT" },
  { value: "rtgs",          label: "RTGS" },
  { value: "cheque",        label: "Cheque" },
  { value: "upi",           label: "UPI" },
  { value: "cash",          label: "Cash" },
  { value: "other",         label: "Other" },
]

const SOURCE_COLORS = [
  "#6366f1","#8b5cf6","#a78bfa","#34d399","#10b981",
  "#f59e0b","#f97316","#ef4444","#06b6d4","#0ea5e9",
  "#ec4899","#84cc16","#64748b","#d97706",
]

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-green-500/10 text-green-400 border-green-500/20",
  pending:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
  rejected: "bg-red-500/10  text-red-400  border-red-500/20",
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
const sourceLabel = (v: string) => FUNDING_SOURCES.find(f => f.value === v)?.label ?? v

/* ─────────────────────────────── Empty form ────────────────────────── */

interface EntryForm {
  id: number | null
  fundingSource: string; investorName: string
  amount: string; date: string; currency: string
  paymentMethod: string; referenceNumber: string
  description: string; notes: string; status: string
}

const emptyForm = (): EntryForm => ({
  id: null,
  fundingSource: "shareholder_investment", investorName: "",
  amount: "", date: new Date().toISOString().slice(0, 10), currency: "INR",
  paymentMethod: "bank_transfer", referenceNumber: "",
  description: "", notes: "", status: "approved",
})

const entryToForm = (e: TreasuryEntry): EntryForm => ({
  id: e.id,
  fundingSource: e.fundingSource,
  investorName: e.investorName ?? "",
  amount: String(e.amount),
  date: e.date,
  currency: e.currency,
  paymentMethod: e.paymentMethod ?? "bank_transfer",
  referenceNumber: e.referenceNumber ?? "",
  description: e.description,
  notes: e.notes ?? "",
  status: e.status,
})

/* ─────────────────────────────── KPI Card ──────────────────────────── */

function KpiCard({
  label, value, sub, icon: Icon, color, bg, loading
}: {
  label: string; value: string; sub?: string
  icon: React.ElementType; color: string; bg: string; loading?: boolean
}) {
  if (loading) return <Card className="bg-card/60"><CardContent className="pt-4 pb-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
  return (
    <Card className="bg-card/60">
      <CardContent className="pt-4 pb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${bg}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className="text-xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

/* ─────────────────────────────── Main page ─────────────────────────── */

export default function Treasury() {
  const { toast } = useToast()
  const { isSuperAdmin } = useAuth()
  const qc = useQueryClient()

  const [page, setPage] = React.useState(1)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [sourceFilter, setSourceFilter] = React.useState("all")
  const [showDialog, setShowDialog] = React.useState(false)
  const [showReverseDialog, setShowReverseDialog] = React.useState(false)
  const [reverseTarget, setReverseTarget] = React.useState<TreasuryEntry | null>(null)
  const [reverseReason, setReverseReason] = React.useState("")
  const [form, setForm] = React.useState<EntryForm>(emptyForm())

  const isEditing = form.id !== null

  /* Queries */
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<TreasurySummary>({
    queryKey: ["/api/treasury/summary"],
    queryFn: () => adminApi.get("/treasury/summary"),
    refetchInterval: 30_000,
  })

  const listKey = ["/api/treasury/entries", page, statusFilter, sourceFilter]
  const { data: list, isLoading: listLoading, isError: listError } = useQuery<EntryList>({
    queryKey: listKey,
    queryFn: () => adminApi.get(
      `/treasury/entries?page=${page}&limit=25${statusFilter !== "all" ? `&status=${statusFilter}` : ""}${sourceFilter !== "all" ? `&fundingSource=${sourceFilter}` : ""}`
    ),
  })

  const invalidate = () => {
    // Use exact query key prefixes — ["/api/treasury"] alone does NOT match
    // ["/api/treasury/summary"] since react-query matches the first array element exactly.
    void qc.invalidateQueries({ queryKey: ["/api/treasury/summary"] })
    void qc.invalidateQueries({ queryKey: ["/api/treasury/entries"] })
    void qc.invalidateQueries({ queryKey: ["/api/treasury/working-capital"] })
  }

  /* Mutations */
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.post("/treasury/entries", body),
    onSuccess: () => { invalidate(); setShowDialog(false); toast({ title: "Entry recorded" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      adminApi.patch(`/treasury/entries/${id}`, body),
    onSuccess: () => { invalidate(); setShowDialog(false); toast({ title: "Entry updated" }) },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      adminApi.post(`/treasury/entries/${id}/reverse`, { reason }),
    onSuccess: () => {
      invalidate()
      setShowReverseDialog(false)
      setReverseTarget(null)
      setReverseReason("")
      toast({ title: "Entry reversed", description: "The entry has been reversed. The treasury balance is updated." })
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  })

  const isPending = create.isPending || update.isPending

  function openAdd() { setForm(emptyForm()); setShowDialog(true) }
  function openEdit(e: TreasuryEntry) { setForm(entryToForm(e)); setShowDialog(true) }
  function openReverse(e: TreasuryEntry) { setReverseTarget(e); setReverseReason(""); setShowReverseDialog(true) }

  function closeDialog() { setShowDialog(false); setForm(emptyForm()) }

  function submit() {
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return }
    if (!form.description.trim()) { toast({ title: "Description is required", variant: "destructive" }); return }

    const body: Record<string, unknown> = {
      fundingSource: form.fundingSource,
      investorName: form.investorName || null,
      amount: amt,
      date: form.date,
      currency: form.currency,
      paymentMethod: form.paymentMethod,
      referenceNumber: form.referenceNumber || null,
      description: form.description,
      notes: form.notes || null,
      status: form.status,
    }

    if (isEditing) {
      update.mutate({ id: form.id!, body })
    } else {
      create.mutate(body)
    }
  }

  /* Excel export */
  async function handleExport() {
    try {
      const data = await adminApi.get("/treasury/entries?limit=10000")
      const rows = (data.items as TreasuryEntry[]).map(e => ({
        "Date":            e.date,
        "Funding Source":  sourceLabel(e.fundingSource),
        "Investor/Lender": e.investorName ?? "",
        "Amount (₹)":      e.amount,
        "Currency":        e.currency,
        "Payment Method":  e.paymentMethod ?? "",
        "Reference #":     e.referenceNumber ?? "",
        "Description":     e.description,
        "Status":          e.status,
        "Created By":      e.createdByName,
        "Approved By":     e.approvedByName ?? "",
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      sheet["!cols"] = [
        { wch: 12 },{ wch: 26 },{ wch: 22 },{ wch: 14 },
        { wch: 10 },{ wch: 16 },{ wch: 14 },{ wch: 36 },
        { wch: 10 },{ wch: 18 },{ wch: 18 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, "Treasury Entries")
      XLSX.writeFile(wb, `TapasHub_Treasury_${new Date().toISOString().slice(0,10)}.xlsx`)
      toast({ title: "Exported", description: `${rows.length} entries saved to Excel.` })
    } catch {
      toast({ title: "Export failed", variant: "destructive" })
    }
  }

  const f = (k: keyof EntryForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))
  const totalPages = Math.ceil((list?.total ?? 0) / 25)

  /* ─────────── Access guard ────────── */
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <AlertCircle className="w-10 h-10 text-amber-400" />
        <h2 className="text-lg font-semibold">Super Admin Access Required</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          The TapasHub Treasury is only accessible to super administrators.
        </p>
      </div>
    )
  }

  if (summaryError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <h2 className="text-lg font-semibold">Failed to load Treasury</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Could not fetch treasury data. Please refresh the page or contact support.
        </p>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/treasury/summary"] })}>
          <RefreshCw className="w-4 h-4 mr-2" /> Retry
        </Button>
      </div>
    )
  }

  /* ─────────── Balance bar ────────── */
  const utilPct = Math.min(100, Math.round(summary?.utilizationPercent ?? 0))

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="w-5 h-5 text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight">TapasHub Treasury</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Main treasury · Shareholders → TapasHub → Subsidiaries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" />Export
          </Button>
          {isSuperAdmin && (
            <Button size="sm" className="gap-2" onClick={openAdd}>
              <Plus className="w-4 h-4" />Add Funding
            </Button>
          )}
        </div>
      </div>

      {/* KPI row
          Capital Raised | Deployed to Sub-brands | Treasury Available | Group Revenue | Total Expenses */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Capital Raised" value={summaryLoading ? "…" : inr(summary?.totalRaised ?? 0)}
          sub="Investor & grant funding"
          icon={Landmark} color="text-green-400" bg="bg-green-500/10" loading={summaryLoading} />
        <KpiCard
          label="Deployed to Sub-brands"
          value={summaryLoading ? "…" : inr(summary?.allocated ?? 0)}
          sub="Capital moved via Fund Allocations"
          icon={ArrowRight} color="text-indigo-400" bg="bg-indigo-500/10" loading={summaryLoading} />
        <KpiCard
          label="Treasury Available"
          value={summaryLoading ? "…" : inr(summary?.available ?? 0)}
          sub="Raised − deployed (unallocated)"
          icon={Wallet}
          color={!summaryLoading && (summary?.available ?? 0) < 0 ? "text-red-400" : "text-blue-400"}
          bg={!summaryLoading && (summary?.available ?? 0) < 0 ? "bg-red-500/10" : "bg-blue-500/10"}
          loading={summaryLoading} />
        <KpiCard
          label="Group Revenue"
          value={summaryLoading ? "…" : inr(summary?.groupRevenue ?? 0)}
          sub="Sales & income across all sub-brands"
          icon={TrendingUp} color="text-emerald-400" bg="bg-emerald-500/10" loading={summaryLoading} />
        <KpiCard
          label="Total Expenses"
          value={summaryLoading ? "…" : inr(summary?.totalExpenses ?? 0)}
          sub="Spend across all sub-brands"
          icon={CheckCircle2} color="text-amber-400" bg="bg-amber-500/10" loading={summaryLoading} />
      </div>

      {/* Capital deployment bar — allocated vs capital raised */}
      {!summaryLoading && summary && summary.totalRaised > 0 && (
        <Card className="bg-card/60">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-1">
              <div>
                <span className="text-sm font-medium">Capital Deployment Rate</span>
                <span className="ml-2 text-xs text-muted-foreground">(deployed to sub-brands vs total raised)</span>
              </div>
              <span className={`text-sm font-bold ${utilPct > 90 ? "text-red-400" : utilPct > 70 ? "text-amber-400" : "text-green-400"}`}>
                {utilPct}%
              </span>
            </div>
            <Progress value={utilPct} className="h-2.5" />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-3">
                <span>{inr(summary.totalRaised)} raised</span>
                <span className="text-indigo-400">{inr(summary.allocated)} deployed</span>
              </span>
              <span className="text-blue-400">{inr(summary.available)} available</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Monthly inflow */}
        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Inflow (Last 6 months)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {summaryLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={summary?.monthlyInflow ?? []} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="treasuryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1_00_000 ? `₹${(v/1_00_000).toFixed(0)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}K` : `₹${v}`} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    formatter={(v: number) => [inr(v), "Inflow"]} />
                  <Area type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2}
                    fill="url(#treasuryGrad)" dot={{ fill: "#6366f1", r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Budget vs Actual Spend by subsidiary */}
        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Budget vs Actual Spend</CardTitle>
            <CardDescription className="text-xs">Capital distributed vs expenses per sub-brand</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {summaryLoading ? <Skeleton className="h-48 w-full" /> : !summary?.allocationsBySubsidiary?.length ? (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No allocations yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={summary.allocationsBySubsidiary} margin={{ top: 5, right: 5, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="companyName" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                    angle={-25} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1_00_000 ? `₹${(v/1_00_000).toFixed(0)}L` : `₹${(v/1000).toFixed(0)}K`} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    formatter={(v: number, name: string) => [inr(v), name === "spent" ? "Actual Spent" : "Budget Distributed"]} />
                  <Legend formatter={(name: string) => name === "spent" ? "Actual Spent" : "Budget Distributed"} />
                  <Bar dataKey="allocated" name="allocated" radius={[4, 4, 0, 0]} opacity={0.5}>
                    {summary.allocationsBySubsidiary.map((entry, i) => (
                      <Cell key={i} fill={entry.color || SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                    ))}
                  </Bar>
                  <Bar dataKey="spent" name="spent" radius={[4, 4, 0, 0]}>
                    {summary.allocationsBySubsidiary.map((entry, i) => (
                      <Cell key={i} fill="#f59e0b" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Funding source breakdown */}
      {!summaryLoading && summary?.bySource && summary.bySource.length > 0 && (
        <Card className="bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Funding Source Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {summary.bySource.map((s, i) => (
                <div key={s.fundingSource} className="flex items-center gap-2.5 rounded-lg bg-white/4 border border-white/6 px-3 py-2.5">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{sourceLabel(s.fundingSource)}</div>
                    <div className="text-[11px] text-muted-foreground">{inr(s.total)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Group Revenue from Operations ─────────────────────────────── */}
      {/* Clearly distinct from capital — revenue is read-only from
          subsidiary Finance modules and is never mixed with Treasury entries */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm text-emerald-400">Group Revenue from Operations</CardTitle>
                  <span className="inline-flex items-center rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                    Separate from capital
                  </span>
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Operational income across all subsidiaries · auto-synced from their Finance modules
                </CardDescription>
              </div>
            </div>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-right">
                <div className="text-xl font-bold text-emerald-400">{inr(summary?.groupRevenue ?? 0)}</div>
                <div className="text-[11px] text-muted-foreground">Total group revenue</div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {!summaryLoading && (
            <>
              {/* Per-company revenue cards */}
              {(summary?.revenueBySubsidiary ?? []).length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {(summary!.revenueBySubsidiary).map(co => (
                    <div key={co.companyId} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/4 border border-emerald-500/10">
                      <div
                        className="w-7 h-7 rounded text-white text-[9px] flex items-center justify-center font-bold shrink-0"
                        style={{ background: co.color }}
                      >
                        {co.companyName.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium truncate">{co.companyName}</div>
                        <div className="text-[11px] text-emerald-400 font-semibold">{inr(co.income)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  No revenue recorded in subsidiary Finance modules yet.
                </div>
              )}

              {/* Monthly revenue sparkline */}
              {(summary?.monthlyRevenue ?? []).some(m => m.amount > 0) && (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-2">Monthly revenue trend (last 6 months)</div>
                  <ResponsiveContainer width="100%" height={110}>
                    <AreaChart data={summary!.monthlyRevenue} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                        tickFormatter={v => v >= 1_00_000 ? `₹${(v/1_00_000).toFixed(0)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}K` : `₹${v}`} />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                        formatter={(v: number) => [inr(v), "Revenue"]} />
                      <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2}
                        fill="url(#revenueGrad)" dot={{ fill: "#10b981", r: 3 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="text-[11px] text-muted-foreground/60 pt-1 border-t border-emerald-500/10">
                Revenue flows: Subsidiary operations → Subsidiary Finance → visible here. Capital flows: Treasury → Fund Allocation → Subsidiary Finance. These two are always tracked separately.
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Separator className="opacity-30" />

      {/* Entries table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Treasury Entries</CardTitle>
              <CardDescription className="text-xs">{list?.total ?? 0} records · all funding events</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1) }}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="All sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {FUNDING_SOURCES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Investor / Lender</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ref #</TableHead>
                  {isSuperAdmin && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={isSuperAdmin ? 8 : 7}><Skeleton className="h-7 w-full" /></TableCell></TableRow>
                  ))
                ) : !list?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 8 : 7} className="h-32 text-center text-muted-foreground">
                      <Landmark className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No treasury entries yet. Add your first funding source.
                    </TableCell>
                  </TableRow>
                ) : list.items.map(e => (
                  <TableRow key={e.id} className={`hover:bg-muted/30 ${e.isReversed ? "opacity-50" : ""}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{e.date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium">{sourceLabel(e.fundingSource)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.investorName ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium max-w-[220px] truncate">{e.description}</div>
                      {e.isReversed && (
                        <div className="text-[11px] text-red-400/80 mt-0.5">
                          Reversed · {e.reversalReason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-green-400 whitespace-nowrap">
                      {e.isReversed ? (
                        <span className="line-through text-muted-foreground">{inr(e.amount)}</span>
                      ) : (
                        <HoverCard openDelay={200}>
                          <HoverCardTrigger asChild>
                            <button type="button" className="font-semibold text-green-400 underline decoration-dotted decoration-green-400/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-green-400 rounded">{inr(e.amount)}</button>
                          </HoverCardTrigger>
                          <HoverCardContent align="start" className="w-64 text-sm">
                            <div className="space-y-2">
                              <div className="font-semibold">{sourceLabel(e.fundingSource)}</div>
                              <div className="text-xs text-muted-foreground space-y-1.5">
                                <div className="flex justify-between"><span>Date</span><span className="font-mono">{e.date}</span></div>
                                {e.investorName && <div className="flex justify-between"><span>Source</span><span>{e.investorName}</span></div>}
                                {e.paymentMethod && <div className="flex justify-between"><span>Method</span><span className="capitalize">{e.paymentMethod.replace(/_/g, " ")}</span></div>}
                                {e.referenceNumber && <div className="flex justify-between"><span>Ref #</span><span className="font-mono text-[11px]">{e.referenceNumber}</span></div>}
                                <div className="flex justify-between"><span>Recorded by</span><span>{e.createdByName}</span></div>
                                <div className="flex justify-between"><span>Status</span><span className="capitalize">{e.status}</span></div>
                              </div>
                              <div className="pt-1.5 border-t flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Amount</span>
                                <span className="font-bold text-green-400">{inr(e.amount)}</span>
                              </div>
                              {e.notes && (
                                <div className="text-[11px] text-muted-foreground border-t pt-1.5 line-clamp-2">{e.notes}</div>
                              )}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.isReversed
                        ? <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[11px]">Reversed</Badge>
                        : <Badge variant="outline" className={`${STATUS_STYLES[e.status] ?? ""} text-[11px]`}>{e.status}</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{e.referenceNumber ?? "—"}</TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        {!e.isReversed && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="w-7 h-7" title="Edit entry" onClick={() => openEdit(e)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-amber-400 hover:text-amber-300"
                              title="Reverse entry" onClick={() => openReverse(e)}>
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">Page {page} of {totalPages} · {list?.total} entries</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit dialog ─────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Treasury Entry" : "Add Funding Entry"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update this funding record. Every change is audit-logged."
                : "Record a new source of funds into the TapasHub treasury."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">

            <div className="col-span-2 space-y-1.5">
              <Label>Funding Source *</Label>
              <Select value={form.fundingSource} onValueChange={v => f("fundingSource", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUNDING_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Investor / Lender Name</Label>
              <Input value={form.investorName} onChange={e => f("investorName", e.target.value)}
                placeholder="e.g. Ratan Tata, HDFC Bank" />
            </div>

            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input type="number" min="0" step="1" value={form.amount}
                onChange={e => f("amount", e.target.value)} placeholder="0" />
            </div>

            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={e => f("date", e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={v => f("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["INR","USD","EUR","GBP","SGD","AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod} onValueChange={v => f("paymentMethod", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Reference Number</Label>
              <Input value={form.referenceNumber} onChange={e => f("referenceNumber", e.target.value)}
                placeholder="TXN-001, UTR number, etc." />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Description *</Label>
              <Input value={form.description} onChange={e => f("description", e.target.value)}
                placeholder="Brief description of this funding event" />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => f("notes", e.target.value)}
                rows={2} placeholder="Additional context or terms" />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={submit} disabled={isPending || !form.amount || !form.description}>
              {isPending ? "Saving…" : isEditing ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reverse dialog ────────────────────────────────────────── */}
      <Dialog open={showReverseDialog} onOpenChange={open => { if (!open) { setShowReverseDialog(false); setReverseTarget(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              Reverse Treasury Entry
            </DialogTitle>
            <DialogDescription>
              This will mark the entry as reversed and reduce the treasury balance by{" "}
              <strong>{reverseTarget ? inr(reverseTarget.amount) : ""}</strong>.
              The original record is preserved in the audit trail.
            </DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-4 py-3 space-y-1">
                <div className="text-sm font-medium">{reverseTarget.description}</div>
                <div className="text-xs text-muted-foreground">
                  {sourceLabel(reverseTarget.fundingSource)} · {inr(reverseTarget.amount)} · {reverseTarget.date}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Reason for reversal *</Label>
                <Textarea value={reverseReason} onChange={e => setReverseReason(e.target.value)}
                  rows={2} placeholder="Explain why this entry is being reversed" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowReverseDialog(false); setReverseTarget(null) }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => reverseTarget && reverse.mutate({ id: reverseTarget.id, reason: reverseReason })}
              disabled={reverse.isPending || !reverseReason.trim()}
            >
              {reverse.isPending ? "Reversing…" : "Confirm Reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
