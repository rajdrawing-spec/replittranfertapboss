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
import { Separator } from "@/components/ui/separator"
import { ArrowRight, Ban, Landmark, Pencil, ShieldCheck, Wallet, AlertCircle } from "lucide-react"
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
  cancelled:        "bg-muted text-muted-foreground border-border",
}
const STATUS_LABELS: Record<string, string> = {
  executed:         "Executed",
  pending_approval: "Awaiting approval",
  rejected:         "Rejected",
  cancelled:        "Cancelled",
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
  const [showCancelDialog, setShowCancelDialog] = React.useState(false)
  const [cancelTarget, setCancelTarget] = React.useState<Allocation | null>(null)
  const [cancelReason, setCancelReason] = React.useState("")
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
  function openCancel(a: Allocation) { setCancelTarget(a); setCancelReason(""); setShowCancelDialog(true) }

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

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      adminApi.post(`/fund-allocations/${id}/cancel`, { reason }),
    onSuccess: (_data: Allocation, { id }) => {
      invalidateAll()
      setShowCancelDialog(false)
      setCancelTarget(null)
      setCancelReason("")
      toast({
        title: "Allocation cancelled",
        description: `Allocation #${id} has been cancelled and linked transactions reversed. All balances updated.`,
      })
    },
    onError: (e: Error) => toast({ title: "Couldn't cancel allocation", description: e.message, variant: "destructive" }),
  })

  const isPending = create.isPending || update.isPending

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

      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending_approval">Awaiting approval</SelectItem>
            <SelectItem value="executed">Executed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
                  <TableRow key={a.id} className={a.status === "cancelled" ? "opacity-50" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <span className={a.fromCompanyName === "Unknown" ? "text-amber-400" : ""}>{a.fromCompanyName}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={a.toCompanyName === "Unknown" ? "text-amber-400" : ""}>{a.toCompanyName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">{inr(a.amount)}</TableCell>
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
                          {/* Cancel: available for all non-cancelled allocations */}
                          {a.status !== "cancelled" && (
                            <Button
                              size="icon" variant="ghost"
                              className="h-7 w-7 text-amber-400 hover:text-amber-300"
                              title="Cancel allocation"
                              onClick={() => openCancel(a)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
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
                ? "Update the amount, purpose, or note. Source and recipient cannot be changed — cancel this allocation and create a new one if you need different companies."
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

      {/* ── Cancel confirmation dialog ────────────────────────────────── */}
      <Dialog open={showCancelDialog} onOpenChange={(open) => { if (!open) { setShowCancelDialog(false); setCancelTarget(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-400" />
              Cancel Fund Allocation
            </DialogTitle>
            <DialogDescription>
              This will soft-cancel the allocation and reverse any linked finance transactions.
              The original record is preserved in the audit trail for compliance purposes.
              All related balances update automatically.
            </DialogDescription>
          </DialogHeader>
          {cancelTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>{cancelTarget.fromCompanyName}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span>{cancelTarget.toCompanyName}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {inr(cancelTarget.amount)} · {cancelTarget.purpose} · {STATUS_LABELS[cancelTarget.status] ?? cancelTarget.status}
                </div>
              </div>

              {cancelTarget.status === "executed" && (
                <div className="rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-400">
                  This allocation has already been executed. Cancelling will reverse both the outgoing and incoming finance transactions, correcting subsidiary balances.
                </div>
              )}

              <Separator className="opacity-30" />

              <div className="space-y-1.5">
                <Label>Reason for cancellation *</Label>
                <Textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={2}
                  placeholder="Incorrect amount, wrong subsidiary, duplicate entry, etc."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCancelDialog(false); setCancelTarget(null) }}>
              Keep allocation
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelTarget && cancel.mutate({ id: cancelTarget.id, reason: cancelReason })}
              disabled={cancel.isPending || !cancelReason.trim()}
            >
              {cancel.isPending ? "Cancelling…" : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
