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
import { ArrowRight, Landmark, ShieldCheck, Wallet } from "lucide-react"
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
  executed: "bg-green-500/10 text-green-400 border-green-500/20",
  pending_approval: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
}
const STATUS_LABELS: Record<string, string> = {
  executed: "Executed",
  pending_approval: "Awaiting approval",
  rejected: "Rejected",
  cancelled: "Cancelled",
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`

interface Form { fromCompanyId: string; toCompanyId: string; amount: string; purpose: string; note: string; equityChangePercent: string }
const emptyForm = (): Form => ({ fromCompanyId: "", toCompanyId: "", amount: "", purpose: "Working capital", note: "", equityChangePercent: "" })

export default function FundAllocations() {
  const { toast } = useToast()
  const { isSuperAdmin } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [showDialog, setShowDialog] = React.useState(false)
  const [form, setForm] = React.useState<Form>(emptyForm())

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
    // Default the source to the parent company once companies load.
    if (parent && !form.fromCompanyId) setForm((f) => ({ ...f, fromCompanyId: String(parent.id) }))
  }, [parent, form.fromCompanyId])

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.post("/fund-allocations", body),
    onSuccess: (res: Allocation) => {
      qc.invalidateQueries({ queryKey: ["/api/fund-allocations"] })
      qc.invalidateQueries({ queryKey: ["/api/companies"] })
      setShowDialog(false)
      setForm(emptyForm())
      toast({
        title: res.status === "executed" ? "Funds allocated" : "Sent for approval",
        description: res.status === "executed"
          ? `${inr(res.amount)} moved from ${res.fromCompanyName} to ${res.toCompanyName}.`
          : `${inr(res.amount)} to ${res.toCompanyName} is awaiting director approval.`,
      })
    },
    onError: (e: Error) => toast({ title: "Couldn't allocate funds", description: e.message, variant: "destructive" }),
  })

  function submit() {
    const amt = Number(form.amount)
    if (!form.fromCompanyId || !form.toCompanyId) { toast({ title: "Pick both companies", variant: "destructive" }); return }
    if (form.fromCompanyId === form.toCompanyId) { toast({ title: "Source and recipient must differ", variant: "destructive" }); return }
    if (!Number.isFinite(amt) || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return }
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fund Allocation</h1>
          <p className="text-muted-foreground">Move capital from Tapas Hub into a sub-brand. Each allocation is recorded in finance on both sides.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setShowDialog(true)}>
            <Wallet className="mr-2 h-4 w-4" /> Allocate Funds
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <ShieldCheck className="h-5 w-5 text-amber-400" />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Landmark className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No fund allocations yet.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <span>{a.fromCompanyName}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{a.toCompanyName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">{inr(a.amount)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">{a.purpose}</TableCell>
                    <TableCell>{a.equityChangePercent ? <span className="text-blue-400">+{a.equityChangePercent}%</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_STYLES[a.status] ?? ""}>{STATUS_LABELS[a.status] ?? a.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{a.requestedByName}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(a.createdAt).toLocaleDateString("en-IN")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Allocate funds</DialogTitle>
            <DialogDescription>Records a transfer out of the source company and matching capital into the recipient.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From (source)</Label>
                <Select value={form.fromCompanyId} onValueChange={(v) => setForm({ ...form, fromCompanyId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To (sub-brand)</Label>
                <Select value={form.toCompanyId} onValueChange={(v) => setForm({ ...form, toCompanyId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {subsidiaries.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹)</Label>
              <Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Purpose</Label>
              <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Working capital" />
            </div>
            <div className="space-y-1.5">
              <Label>Equity change for source (optional %)</Label>
              <Input type="number" min="0" max="100" step="0.1" value={form.equityChangePercent} onChange={(e) => setForm({ ...form, equityChangePercent: e.target.value })} placeholder="e.g. 5" />
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
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Submitting…" : "Allocate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
