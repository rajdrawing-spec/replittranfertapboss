import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useListApprovals,
  getListApprovalsQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Check, X, CheckSquare, Clock, AlertCircle, ChevronDown,
  Users, CheckCircle2, XCircle, Loader2, Building2,
} from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"
import { adminApi } from "@/lib/admin-api"

/* ── types ── */

interface Vote {
  id: number
  voterName: string
  voterEmail: string
  voterRole: string
  decision: "pending" | "approved" | "rejected"
  note: string | null
  votedAt: string | null
}

interface Approval {
  id: number
  companyId: number
  companyName: string
  type: string
  title: string
  description: string
  requestedBy: string
  currentStep: number
  totalSteps: number
  status: "pending" | "approved" | "rejected" | "cancelled"
  amount: number | null
  approverNote: string | null
  dueDate: string | null
  requiredApprovers: { name: string; email: string; role: string }[]
  votes: Vote[]
  approvedCount: number
  rejectedCount: number
  pendingCount: number
  createdAt: string
  updatedAt: string
}

/* ── helpers ── */

function fmtCurrency(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Director",
  company_admin: "Company Admin",
  shareholder: "Shareholder",
  director: "Director",
  approver: "Approver",
  staff: "Staff",
}

function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ")
}

/* ── Approver progress strip ── */

function ApproverStrip({ approval }: { approval: Approval }) {
  const { votes, requiredApprovers, approvedCount, rejectedCount, pendingCount } = approval

  // Merge required-approver list with actual votes
  const rows: { name: string; email: string; role: string; vote?: Vote }[] =
    requiredApprovers.length > 0
      ? requiredApprovers.map((ra) => ({
          ...ra,
          vote: votes.find((v) => v.voterEmail === ra.email),
        }))
      : votes.map((v) => ({ name: v.voterName, email: v.voterEmail, role: v.voterRole, vote: v }))

  if (rows.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-white/8">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          <Users className="w-3 h-3" /> Approvers
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          {approvedCount > 0 && (
            <span className="flex items-center gap-0.5 text-green-400">
              <CheckCircle2 className="w-3 h-3" /> {approvedCount} approved
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Clock className="w-3 h-3" /> {pendingCount} pending
            </span>
          )}
          {rejectedCount > 0 && (
            <span className="flex items-center gap-0.5 text-red-400">
              <XCircle className="w-3 h-3" /> {rejectedCount} rejected
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((row, i) => {
          const decision = row.vote?.decision ?? "pending"
          return (
            <div
              key={row.email ?? i}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs border ${
                decision === "approved"
                  ? "bg-green-500/5 border-green-500/15"
                  : decision === "rejected"
                  ? "bg-red-500/5 border-red-500/15"
                  : "bg-muted/20 border-white/5"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Avatar initial */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    decision === "approved"
                      ? "bg-green-500/20 text-green-300"
                      : decision === "rejected"
                      ? "bg-red-500/20 text-red-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{row.name}</div>
                  <div className="text-muted-foreground text-[10px]">{roleLabel(row.role)}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {row.vote?.note && (
                  <span className="text-[10px] text-muted-foreground italic max-w-[120px] truncate hidden sm:block">
                    "{row.vote.note}"
                  </span>
                )}
                {row.vote?.votedAt && (
                  <span className="text-[10px] text-muted-foreground hidden md:block">
                    {new Date(row.vote.votedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                )}
                {decision === "approved" ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                  </span>
                ) : decision === "rejected" ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400">
                    <XCircle className="w-3.5 h-3.5" /> Rejected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
                    <Clock className="w-3 h-3" /> Pending
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Individual approval card ── */

function ApprovalCard({
  approval,
  onAction,
}: {
  approval: Approval
  onAction: (id: number, action: "approve" | "reject", note?: string) => Promise<void>
}) {
  const [loading, setLoading] = React.useState<"approve" | "reject" | null>(null)
  const [showNote, setShowNote] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [showVotes, setShowVotes] = React.useState(false)

  const hasVoters = (approval.votes?.length ?? 0) > 0 || (approval.requiredApprovers?.length ?? 0) > 0
  const isPending = approval.status === "pending"

  async function act(action: "approve" | "reject") {
    setLoading(action)
    try {
      await onAction(approval.id, action, note.trim() || undefined)
      setNote("")
      setShowNote(false)
    } finally {
      setLoading(null)
    }
  }

  const statusColor =
    approval.status === "approved"
      ? "bg-green-500/10 text-green-400 border-green-500/20"
      : approval.status === "rejected"
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : "bg-amber-500/10 text-amber-400 border-amber-500/20"

  return (
    <Card
      className={`bg-card/60 border transition-all hover:shadow-lg ${
        isPending ? "border-white/10 hover:border-white/20" : "border-white/5 opacity-80"
      }`}
    >
      <CardContent className="p-5 space-y-0">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          {/* Left — info */}
          <div className="space-y-2 flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="uppercase text-[10px] tracking-wider font-mono border-white/15"
              >
                {approval.type.replace(/_/g, " ")}
              </Badge>

              {isPending && (
                <Badge className="uppercase text-[10px] gap-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                  <Clock className="w-2.5 h-2.5" /> Pending
                </Badge>
              )}
              {approval.status === "approved" && (
                <Badge className="uppercase text-[10px] gap-1 bg-green-500/15 text-green-300 border border-green-500/30 font-semibold">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Approved
                </Badge>
              )}
              {approval.status === "rejected" && (
                <Badge className="uppercase text-[10px] gap-1 bg-red-500/15 text-red-300 border border-red-500/30 font-semibold">
                  <XCircle className="w-2.5 h-2.5" /> Rejected
                </Badge>
              )}

              {/* Step progress pill */}
              {approval.totalSteps > 1 && (
                <span className="text-[10px] text-muted-foreground border border-white/10 rounded-full px-2 py-0.5">
                  Step {approval.currentStep}/{approval.totalSteps}
                </span>
              )}
            </div>

            <h3 className="text-base font-semibold leading-tight">{approval.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{approval.description}</p>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground mr-1">Requester:</span>
                <span className="text-primary/80 font-semibold uppercase tracking-wide">{approval.requestedBy}</span>
              </span>
              <span>
                <span className="font-medium text-foreground mr-1">Company:</span>
                <span className="text-primary/80 font-semibold">{approval.companyName}</span>
              </span>
              {approval.amount != null && (
                <span>
                  <span className="font-medium text-foreground mr-1">Amount:</span>
                  <span className="font-bold text-foreground">{fmtCurrency(approval.amount)}</span>
                </span>
              )}
              {approval.dueDate && (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertCircle className="w-3 h-3" />
                  Due {approval.dueDate}
                </span>
              )}
            </div>

            {/* Approver note (resolved) */}
            {!isPending && approval.approverNote && (
              <div className="mt-1 text-xs text-muted-foreground italic">
                Note: "{approval.approverNote}"
              </div>
            )}
          </div>

          {/* Right — action buttons (only for pending) */}
          {isPending && (
            <div className="flex flex-col gap-2 w-full md:w-auto shrink-0">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 md:flex-none border-destructive/50 text-destructive hover:bg-destructive/10 hover:border-destructive h-9"
                  disabled={!!loading}
                  onClick={() => act("reject")}
                >
                  {loading === "reject" ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <X className="w-4 h-4 mr-1.5" />
                  )}
                  Reject
                </Button>
                <Button
                  className="flex-1 md:flex-none bg-green-600 hover:bg-green-500 text-white h-9"
                  disabled={!!loading}
                  onClick={() => act("approve")}
                >
                  {loading === "approve" ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-1.5" />
                  )}
                  Approve
                </Button>
              </div>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center justify-end gap-1 transition-colors"
                onClick={() => setShowNote(!showNote)}
              >
                {showNote ? "Hide note" : "Add a note (optional)"}
                <ChevronDown className={`w-3 h-3 transition-transform ${showNote ? "rotate-180" : ""}`} />
              </button>
              {showNote && (
                <Textarea
                  placeholder="Add a note to your decision…"
                  className="h-16 text-xs resize-none"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </div>
          )}
        </div>

        {/* Approver strip */}
        {hasVoters && (
          <>
            {/* Toggle on small screens */}
            <button
              className="mt-3 w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground md:hidden"
              onClick={() => setShowVotes(!showVotes)}
            >
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {approval.votes.length + (approval.requiredApprovers.length - approval.votes.length > 0 ? approval.requiredApprovers.length - approval.votes.length : 0)} approvers · {approval.approvedCount} approved · {approval.pendingCount} pending
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showVotes ? "rotate-180" : ""}`} />
            </button>
            <div className={`md:block ${showVotes ? "block" : "hidden"}`}>
              <ApproverStrip approval={approval} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Main page ── */

export default function Approvals() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const qc = useQueryClient()

  const params: Record<string, string | number> = { limit: 50 }
  if (activeCompany) params.companyId = activeCompany.id

  const { data, isLoading } = useListApprovals(params, {
    query: { enabled: true, queryKey: getListApprovalsQueryKey(params) },
  })

  const approvals = (data?.items ?? []) as Approval[]
  const pending = approvals.filter((a) => a.status === "pending")
  const resolved = approvals.filter((a) => a.status !== "pending")

  async function handleAction(id: number, action: "approve" | "reject", note?: string) {
    try {
      await adminApi.patch(`/approvals/${id}/action`, { action, note })
      await qc.invalidateQueries({ queryKey: getListApprovalsQueryKey(params) })
      toast({
        title: action === "approve" ? "Approved" : "Rejected",
        description: action === "approve" ? "Approval has been granted." : "Request has been rejected.",
      })
    } catch (e: any) {
      toast({
        title: "Action failed",
        description: e?.message ?? "Could not process this approval.",
        variant: "destructive",
      })
      throw e
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Approvals Queue</h1>
          <p className="text-muted-foreground mt-1 text-sm">Pending requests requiring your authorization</p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-4 text-sm shrink-0">
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">{pending.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {approvals.filter((a) => a.status === "approved").length}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Approved</div>
            </div>
          </div>
        )}
      </div>

      {/* Company context reminder */}
      {!activeCompany && (
        <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <Building2 className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-blue-300">Showing all companies. </span>
            Select a company to filter.
          </div>
        </div>
      )}

      {/* Skeletons */}
      {isLoading &&
        Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-card/50">
            <CardContent className="p-6">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-3 flex-1">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Skeleton className="h-9 w-24" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Empty state */}
      {!isLoading && pending.length === 0 && resolved.length === 0 && (
        <Card className="bg-card/50 border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-52 text-muted-foreground">
            <CheckSquare className="w-10 h-10 mb-3 opacity-20" />
            <p className="font-medium">You're all caught up!</p>
            <p className="text-sm mt-1">No pending approvals.</p>
          </CardContent>
        </Card>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-4">
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Resolved (collapsible) */}
      {resolved.length > 0 && (
        <details className="group" open={pending.length === 0}>
          <summary className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground select-none py-2 list-none">
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
            Resolved ({resolved.length})
          </summary>
          <div className="space-y-3 mt-3">
            {resolved.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onAction={handleAction} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
