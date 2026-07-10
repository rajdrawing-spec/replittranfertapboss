import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { ArrowRight, Trash2, Landmark, Pencil, ShieldCheck, Wallet, TrendingUp, Building2 } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/auth-context"

interface Company { id: number; name: string; type: string; ownershipPercent: number }
interface Allocation {
  id: number
  fromCompanyId: number; fromCompanyName: string
  toCompanyId: number; toCompanyName: string
  amount: number; purpose: string; note: string | null
  equityChangePercent: number | null
  status: string; approvalId: number | null
  requestedByName: string
  executedAt: string | null; createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  executed:         "bg-green-500/10 text-green-400 border-green-500/20",
  pending_approval: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  rejected:         "bg-red-500/10  text-red-400  border-red-500/20",
}
const STATUS_LABELS: Record<string, string> = {
  executed:         "Executed",
  pending_approval: "Awaiting approval",
  rejected:         "Rejected",
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`

interface Form {
  id: number | null
  fromCompanyId: string; fromCompanyName: string
  toCompanyId: string; toCompanyName: string
  amount: string; purpose: string; note: string; equityChangePercent: string
}

const emptyForm = (parentId = ""): Form => ({
  id: null,
  fromCompanyId: parentId, fromCompanyName: "",
  toCompanyId: "", toCompanyName: "",
  amount: "", purpose: "Working capital", note: "", equityChangePercent: "",
})

const allocToForm = (a: Allocation): Form => ({
  id: a.id,
  fromCompanyId: String(a.fromCompanyId), fromCompanyName: a.fromCompanyName,
  toCompanyId: String(a.toCompanyId), toCompanyName: a.toCompanyName,
  amount: String(a.amount),
  purpose: a.purpose,
  note: a.note ?? "",
  equityChangePercent: a.equityChangePercent !== null ? String(a.equityChangePercent) : "",
})

export default function FundAllocations() {
  const { toast } = useToast()
  const { isSuperAdmin } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [showDialog, setShowDialog] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<Allocation | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())

  const isEditing = form.id !== null

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    queryFn: () => adminApi.get("/companies"),
  })
  const { data: thresholdData } = useQuery<{ threshold: number }>({
    queryKey: ["/api/fund-allocations/threshold"],
    queryFn: () => adminApi.get("/fund-allocations/threshold"),
  })

  // Working capital snapshot — feeds the "Capital by Company" section
  // byCompany.spent = Finance expenses recorded for that company (Finance is source of truth)
  interface WorkingCapital {
    totalCapital: number; allocated: number; totalSpent: number; available: number
    utilizationPercent: number; groupRevenue: number
    byCompany: { id: number; name: string; color: string; allocated: number; spent: number; income: number }[]
  }
  const { data: wcData } = useQuery<WorkingCapital>({
    queryKey: ["/api/treasury/working-capital"],
    queryFn: () => adminApi.get("/treasury/working-capital"),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: isSuperAdmin,
  })
  const threshold = thresholdData?.threshold ?? 100000

  const listKey = ["/api/fund-allocations", statusFilter]
  const { data, isLoading } = useQuery<{ items: Allocation[]; total: number }>({
    queryKey: listKey,
    queryFn: () => adminApi.get(`/fund-allocations${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`),
  })
  const items = data?.items ?? []

  const parent = companies?.find((c) => c.type === "parent")
  const subsidiaries = (companies ?? []).filter((c) => c.type !== "parent")

  React.useEffect(() => {
    if (parent && !form.fromCompanyId && !isEditing) {
      setForm((f) => ({ ...f, fromCompanyId: String(parent.id), fromCompanyName: parent.name }))
    }
  }, [parent, form.fromCompanyId, isEditing])

  function openCreate() {
    setForm(emptyForm(parent ? String(parent.id) : ""))
    setShowDialog(true)
  }
  function openEdit(a: Allocation) { setForm(allocToForm(a)); setShowDialog(true) }
  function closeDialog() { setShowDialog(false); setForm(emptyForm(parent ? String(parent.id) : "")) }
  function openDelete(a: Allocation) { setDeleteTarget(a); setShowDeleteDialog(true) }

  /**
   * Invalidate every query that depends on fund-allocation data so all finance
   * modules update automatically: treasury balance, subsidiary balances, the
   * Finance P&L, cash-flow chart, and the allocation list itself.
   */
  function invalidateAll() {
    void qc.invalidateQueries({ queryKey: ["/api/fund-allocations"] })
    void qc.invalidateQueries({ queryKey: ["/api/companies"] })
    void qc.invalidateQueries({ queryKey: ["/api/finance/balance"] })
    void qc.invalidateQueries({ queryKey: ["/api/finance/transactions"] })
    void qc.invalidateQueries({ queryKey: ["/api/finance/cash-flow"] })
    void qc.invalidateQueries({ queryKey: ["/api/finance/pnl-summary"] })
    void qc.invalidateQueries({ queryKey: ["/api/treasury/summary"] })
    void qc.invalidateQueries({ queryKey: ["/api/treasury/entries"] })
    void qc.invalidateQueries({ queryKey: ["/api/treasury/working-capital"] })
    void qc.invalidateQueries({ queryKey: ["/api/dashboard/executive-summary"] })
    void qc.invalidateQueries({ queryKey: ["/api/analytics"] })
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.post("/fund-allocations", body),
    onSuccess: (res: Allocation) => {
      invalidateAll()
      closeDialog()
      toast({
        title: res.status === "executed" ? "Funds allocated" : "Sent for approval",
        description: res.status === "executed"
          ? `${inr(res.amount)} moved from ${res.fromCompanyName} to ${res.toCompanyName}.`
          : `${inr(res.amount)} to ${res.toCompanyName} is awaiting director approval.`,
      })
    },
    onError: (e: Error) => toast({ title: "Couldn't allocate funds", description: e.message, variant: "destructive" }),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      adminApi.patch(`/fund-allocations/${id}`, body),
    onSuccess: () => { invalidateAll(); closeDialog(); toast({ title: "Allocation updated" }) },
    onError: (e: Error) => toast({ title: "Couldn't update allocation", description: e.message, variant: "destructive" }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.del(`/fund-allocations/${id}`),
    onSuccess: (_data, id) => {
      invalidateAll()
      setShowDeleteDialog(false)
      setDeleteTarget(null)
      toast({
        title: "Allocation deleted",
        description: `Allocation #${id} and its linked transactions have been permanently removed.`,
      })
    },
    onError: (e: Error) => toast({ title: "Couldn't delete allocation", description: e.message, variant: "destructive" }),
  })

  const isPending = create.isPending || update.isPending

  // Running cumulative total allocated (executed allocations sorted by execution date).
  // Used in the tooltip to show "balance after this allocation".
  const runningTotal = React.useMemo(() => {
    const executed = items.filter(a => a.status === "executed")
    executed.sort((a, b) =>
      new Date(a.executedAt ?? a.createdAt).getTime() - new Date(b.executedAt ?? b.createdAt).getTime()
    )
    const map: Record<number, number> = {}
    let cum = 0
    for (const a of executed) { cum += a.amount; map[a.id] = cum }
    return map
  }, [items])

  function submit() {
    const amt = Number(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return }
    if (isEditing) {
      update.mutate({
        id: form.id!,
        body: {
          amount: amt,
          purpose: form.purpose,
          note: form.note,
          equityChangePercent: form.equityChangePercent === "" ? null : Number(form.equityChangePercent),
        },
      })
      return
    }
    if (!form.fromCompanyId || !form.toCompanyId) { toast({ title: "Pick both companies", variant: "destructive" }); return }
    if (form.fromCompanyId === form.toCompanyId) { toast({ title: "Source and recipient must differ", variant: "destructive" }); return }
    create.mutate({
      fromCompanyId: Number(form.fromCompanyId),
      toCompanyId: Number(form.toCompanyId),
      amount: amt,
      purpose: form.purpose,
      note: form.note,
      equityChangePercent: form.equityChangePercent === "" ? null : Number(form.equityChangePercent),
    })
  }

  const willNeedApproval = (() => {
    const amt = Number(form.amount)
    const eq = form.equityChangePercent === "" ? 0 : Number(form.equityChangePercent)
    return (Number.isFinite(amt) && amt >= threshold) || eq > 0
  })()

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fund Allocation</h1>
          <p className="text-muted-foreground text-sm">Move capital from Tapas Hub into a sub-brand. Each allocation is recorded in finance on both sides.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={openCreate}>
            <Wallet className="mr-2 h-4 w-4" /> Allocate Funds
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <ShieldCheck className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <CardTitle className="text-base">Approval threshold</CardTitle>
            <CardDescription>
              Allocations of {inr(threshold)} or more — and any allocation that changes equity — require director approval before the money moves.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Capital Distribution by Company ─────────────────────────── */}
      {isSuperAdmin && wcData && wcData.byCompany.length > 0 && (
        <Card className="bg-card/60">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Capital Distribution</CardTitle>
                <CardDescription className="text-xs">
                  Working capital allocated from the Main Treasury to each sub-brand
                </CardDescription>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold">{inr(wcData.totalCapital)}</div>
                <div className="text-[11px] text-muted-foreground">Total treasury capital</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {wcData.byCompany.map(co => {
                const allocPct = wcData.totalCapital > 0
                  ? Math.min(100, (co.allocated / wcData.totalCapital) * 100)
                  : 0
                const spentPct = co.allocated > 0
                  ? Math.min(100, ((co.spent ?? 0) / co.allocated) * 100)
                  : 0
                const remaining = co.allocated - (co.spent ?? 0)
                return (
                  <div key={co.id} className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: co.color }}
                      >
                        {co.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{co.name}</div>
                        <div className="text-[11px] text-muted-foreground">{allocPct.toFixed(1)}% of treasury</div>
                      </div>
                    </div>
                    {/* Allocated capital bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Allocated</span>
                        <span className="font-semibold text-indigo-400">{inr(co.allocated)}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${allocPct}%`, background: co.color }} />
                      </div>
                    </div>
                    {/* Finance spend (auto-synced from Finance module) */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Spent (Finance)</span>
                        <span className={`font-semibold ${spentPct > 90 ? "text-red-400" : "text-amber-400"}`}>{inr(co.spent ?? 0)}</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${spentPct > 90 ? "bg-red-500" : "bg-amber-500"}`}
                          style={{ width: `${spentPct}%`, opacity: 0.85 }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between text-[11px] pt-0.5">
                      <span className="text-muted-foreground">Remaining budget</span>
                      <span className={remaining < 0 ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>{inr(remaining)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground pt-2 border-t">
              <span>Available: <span className="text-green-400 font-medium">{inr(wcData.available)}</span></span>
              <span>Total spent: <span className="text-amber-400 font-medium">{inr(wcData.totalSpent ?? 0)}</span></span>
              <span>Utilisation: <span className="text-amber-400 font-medium">{wcData.utilizationPercent}%</span></span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending_approval">Awaiting approval</SelectItem>
            <SelectItem value="executed">Executed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Allocation</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Equity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Date</TableHead>
                {isSuperAdmin && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={isSuperAdmin ? 8 : 7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 8 : 7} className="py-12 text-center text-muted-foreground">
                    <Landmark className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No fund allocations yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <span className={a.fromCompanyName === "Unknown" ? "text-amber-400" : ""}>{a.fromCompanyName}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={a.toCompanyName === "Unknown" ? "text-amber-400" : ""}>{a.toCompanyName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <HoverCard openDelay={200}>
                        <HoverCardTrigger asChild>
                          <button
                            type="button"
                            className="font-semibold underline decoration-dotted decoration-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                          >
                            {inr(a.amount)}
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent align="start" className="w-72 text-sm">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 font-semibold">
                              <span>{a.fromCompanyName}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{a.toCompanyName}</span>
                            </div>
                            <div className="text-xs text-muted-foreground space-y-1.5">
                              <div className="flex justify-between">
                                <span>Date</span>
                                <span>{new Date(a.createdAt).toLocaleDateString("en-IN")}</span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="shrink-0">Purpose</span>
                                <span className="text-right">{a.purpose}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Requested by</span>
                                <span>{a.requestedByName}</span>
                              </div>
                              {a.equityChangePercent && (
                                <div className="flex justify-between">
                                  <span>Equity change</span>
                                  <span className="text-blue-400">+{a.equityChangePercent}%</span>
                                </div>
                              )}
                              {a.executedAt && (
                                <div className="flex justify-between">
                                  <span>Executed</span>
                                  <span>{new Date(a.executedAt).toLocaleDateString("en-IN")}</span>
                                </div>
                              )}
                              {a.note && (
                                <div className="text-[11px] text-muted-foreground/80 border-t pt-1 line-clamp-2">{a.note}</div>
                              )}
                            </div>
                            <div className="pt-1.5 border-t flex items-center justify-between font-semibold">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <span className="text-amber-400">{inr(a.amount)}</span>
                            </div>
                            {runningTotal[a.id] !== undefined && (
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Running total allocated</span>
                                <span className="text-foreground font-medium">{inr(runningTotal[a.id])}</span>
                              </div>
                            )}
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">{a.purpose}</TableCell>
                    <TableCell>
                      {a.equityChangePercent
                        ? <span className="text-blue-400">+{a.equityChangePercent}%</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[a.status] ?? ""}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.requestedByName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(a.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {/* Edit: only for pending allocations */}
                          {a.status === "pending_approval" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit allocation" onClick={() => openEdit(a)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {/* Delete: available for all allocations */}
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-red-400 hover:text-red-300"
                            title="Delete allocation"
                            onClick={() => openDelete(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Create / Edit dialog ──────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit allocation" : "Allocate funds"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the amount, purpose, or note. Source and recipient cannot be changed — delete this allocation and create a new one if you need different companies."
                : "Records a transfer out of the source company and matching capital into the recipient."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From (source)</Label>
                {isEditing ? (
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
                    {form.fromCompanyName || "—"}
                  </div>
                ) : (
                  <Select value={form.fromCompanyId} onValueChange={(v) => setForm({ ...form, fromCompanyId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {(companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>To (sub-brand)</Label>
                {isEditing ? (
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
                    {form.toCompanyName || "—"}
                  </div>
                ) : (
                  <Select value={form.toCompanyId} onValueChange={(v) => setForm({ ...form, toCompanyId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {subsidiaries.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input type="number" min="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Purpose</Label>
              <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Working capital" />
            </div>
            <div className="space-y-1.5">
              <Label>Equity change for source (optional %)</Label>
              <Input type="number" min="0" max="100" step="0.1"
                value={form.equityChangePercent}
                onChange={(e) => setForm({ ...form, equityChangePercent: e.target.value })}
                placeholder="e.g. 5" />
              <p className="text-xs text-muted-foreground">Increases the source company's recorded stake in the recipient. Always requires approval.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
            </div>
            {willNeedApproval && form.amount && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
                This allocation requires director approval before the funds move.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending ? (isEditing ? "Saving…" : "Submitting…") : (isEditing ? "Save changes" : "Allocate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ────────────────────────────────── */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!open) { setShowDeleteDialog(false); setDeleteTarget(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-400" />
              Delete Fund Allocation
            </DialogTitle>
            <DialogDescription>
              This will permanently remove the allocation and its linked finance transactions.
              All related balances will update automatically. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>{deleteTarget.fromCompanyName}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span>{deleteTarget.toCompanyName}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {inr(deleteTarget.amount)} · {deleteTarget.purpose} · {STATUS_LABELS[deleteTarget.status] ?? deleteTarget.status}
                </div>
              </div>

              {deleteTarget.status === "executed" && (
                <div className="rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-400">
                  This allocation has already been executed. Deleting it will also remove the outgoing and incoming finance transactions, correcting subsidiary balances.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteTarget(null) }}>
              Keep allocation
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
