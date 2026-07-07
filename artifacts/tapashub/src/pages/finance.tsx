import * as React from "react"
import { useListTransactions, getListTransactionsQueryKey, useGetPnlSummary, getGetPnlSummaryQueryKey, useListCompanies } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, Pencil } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

const API_BASE = ""

const TYPE_COLORS: Record<string, string> = {
  income: "bg-green-500/10 text-green-400 border-green-500/20",
  expense: "bg-red-500/10 text-red-400 border-red-500/20",
  transfer: "bg-blue-500/10 text-blue-400 border-blue-500/20",
}
const CATEGORIES_INCOME = ["Sales Revenue", "Service Income", "Consulting", "Royalties", "Investment Returns", "Other Income"]
const CATEGORIES_EXPENSE = ["Salaries", "Rent", "Utilities", "Marketing", "Cost of Goods", "Logistics", "Software", "Travel", "Tax", "Other Expense"]
const PAYMENT_METHODS = ["bank_transfer", "cash", "upi", "credit_card", "cheque", "razorpay"]

interface TxForm {
  companyId: string; type: string; category: string; amount: string
  description: string; referenceNumber: string; paymentMethod: string; status: string; date: string
}
const emptyForm = (): TxForm => ({
  companyId: "", type: "income", category: "Sales Revenue", amount: "",
  description: "", referenceNumber: "", paymentMethod: "bank_transfer",
  status: "completed", date: new Date().toISOString().slice(0, 10),
})

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
      const url = editing ? `${API_BASE}/api/finance/transactions/${editing.id}` : `${API_BASE}/api/finance/transactions`
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
    if (!confirm("Delete this transaction?")) return
    setDeleting(id)
    try {
      const res = await fetch(`${API_BASE}/api/finance/transactions/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error()
      toast({ title: "Transaction deleted" }); refetch()
    } catch {
      toast({ title: "Error", description: "Could not delete", variant: "destructive" })
    } finally { setDeleting(null) }
  }

  const f = (k: keyof TxForm, v: string) => setForm(frm => ({ ...frm, [k]: v }))
  const categories = form.type === "income" ? CATEGORIES_INCOME : CATEGORIES_EXPENSE

  // P&L KPIs
  const kpis = pnl ? [
    { label: "Revenue", value: `₹${Number(pnl.revenue).toLocaleString("en-IN")}`, icon: TrendingUp, color: "text-green-400 bg-green-500/10" },
    { label: "Gross Profit", value: `₹${Number(pnl.grossProfit).toLocaleString("en-IN")}`, sub: `Margin: ${Number(pnl.grossMargin).toFixed(1)}%`, icon: Wallet, color: "text-blue-400 bg-blue-500/10" },
    { label: "Net Profit", value: `₹${Number(pnl.netProfit).toLocaleString("en-IN")}`, sub: `Margin: ${Number(pnl.netMargin).toFixed(1)}%`, icon: TrendingUp, color: "text-purple-400 bg-purple-500/10" },
    { label: "Expenses", value: `₹${Number(pnl.operatingExpenses).toLocaleString("en-IN")}`, icon: TrendingDown, color: "text-red-400 bg-red-500/10" },
  ] : []

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{activeCompany ? `${activeCompany.name} · ` : "All companies · "}P&L this month</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Transaction</Button>
      </div>

      {/* P&L Summary */}
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
                  <TableHead>Date</TableHead><TableHead>Description</TableHead>
                  <TableHead>Category</TableHead><TableHead>Company</TableHead>
                  <TableHead>Type</TableHead><TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead><TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                )) : data?.items?.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">No transactions found</TableCell></TableRow>
                ) : data?.items?.map((t: any) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground">{t.date}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{t.description}</div>
                      {t.referenceNumber && <div className="text-xs text-muted-foreground font-mono">{t.referenceNumber}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{t.category}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.companyName}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium capitalize ${TYPE_COLORS[t.type] ?? ""}`}>{t.type}</span>
                    </TableCell>
                    <TableCell className={`font-semibold ${t.type === "income" ? "text-green-400" : t.type === "expense" ? "text-red-400" : ""}`}>
                      {t.type === "expense" ? "-" : "+"}₹{Number(t.amount).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">{t.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" disabled={deleting === t.id} onClick={() => handleDelete(t.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
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
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Transaction" : "Record Transaction"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.companyId} onValueChange={v => f("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={v => { f("type", v); f("category", v === "income" ? CATEGORIES_INCOME[0] : CATEGORIES_EXPENSE[0]) }}>
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
                <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Amount (₹) *</Label><Input value={form.amount} onChange={e => f("amount", e.target.value)} type="number" min="0" /></div>
            <div className="space-y-1.5"><Label>Date *</Label><Input value={form.date} onChange={e => f("date", e.target.value)} type="date" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Description *</Label><Input value={form.description} onChange={e => f("description", e.target.value)} placeholder="Brief description" /></div>
            <div className="space-y-1.5"><Label>Reference #</Label><Input value={form.referenceNumber} onChange={e => f("referenceNumber", e.target.value)} placeholder="INV-001" /></div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod} onValueChange={v => f("paymentMethod", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="capitalize">{m.replace("_", " ")}</SelectItem>)}</SelectContent>
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
            <Button onClick={handleSave} disabled={saving || !form.amount || !form.description || !form.companyId}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Record Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
