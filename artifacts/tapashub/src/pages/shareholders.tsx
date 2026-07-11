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
import { Users, PieChart, Wallet, TrendingUp, Plus, Pencil, Trash2, History, Send, Sparkles, Brain, RefreshCw, ChevronDown, ChevronRight, TrendingDown, Activity, FileDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"
import { ShareCertificateModal, type ShareCertificateData } from "@/components/share-certificate"

interface Company { id: number; name: string; type: string }
interface Shareholder {
  id: number; companyId: number; companyName: string
  name: string; email: string | null; type: string; role: string
  shares: number; sharePrice: number; investmentAmount: number
  ownershipPercent: number; status: string; joinedDate: string | null
  notes: string | null; invitedAt: string | null; createdAt: string
}
interface ShareTx {
  id: number; type: string; shares: number; pricePerShare: number
  amount: number; date: string; note: string | null; createdAt: string
}
interface CapTable {
  companyId: number; companyName: string; totalShares: number
  pricePerShare: number; valuation: number; totalInvested: number
  shareholderCount: number
  holders: { id: number; name: string; role: string; type: string; shares: number; ownershipPercent: number; investmentAmount: number; equityValue: number; status: string }[]
}
interface AiValuation {
  id: number; companyId: number; provider: string
  estimatedValue: number | null; enterpriseValue: number | null
  shareholderEquity: number | null; nav: number | null
  growthScore: number | null; healthTrend: string | null
  revenueGrowthRate: number | null; profitGrowthRate: number | null
  explanation: string | null
  // Multi-method valuation engine
  investorScore: number | null; investorRating: string | null
  assetValuation: number | null; revenueMultipleVal: number | null
  ebitdaValuation: number | null; dcfValuation: number | null
  scorecardValuation: number | null; vcValuation: number | null
  bookValuePerShare: number | null; estimatedSharePrice: number | null
  recommendations: string[]
  createdAt: string
}
interface AiShareholderValuation {
  valuation: AiValuation | null
  shareholders: {
    id: number; name: string; role: string; ownershipPercent: number; shares: number
    capitalInvested: number; estimatedShareValue: number; estimatedGrowth: number
    roiEstimate: number | null; roiExplanation: string
  }[]
}

const inr = (n: number | null | undefined) => n != null ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—"
const num = (n: number) => Math.round(n).toLocaleString("en-IN")
const pct = (n: number | null | undefined) => n != null ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "—"

const ROLE_LABELS: Record<string, string> = {
  founder: "Founder", investor: "Investor", employee: "Employee (ESOP)", advisor: "Advisor", institutional: "Institutional",
}
// Maps shareholder role → share type label printed on the certificate
const SHARE_TYPE_LABELS: Record<string, string> = {
  founder: "FOUNDER SHARES",
  investor: "EQUITY SHARES",
  employee: "EMPLOYEE ESOP",
  advisor: "ADVISOR SHARES",
  institutional: "INSTITUTIONAL SHARES",
}
const ROLE_STYLES: Record<string, string> = {
  founder: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  investor: "bg-green-500/10 text-green-400 border-green-500/20",
  employee: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  advisor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  institutional: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
}
const TX_LABELS: Record<string, string> = {
  purchase: "Purchase", sale: "Sale", grant: "Grant", dividend: "Dividend", transfer: "Transfer",
}

interface Form {
  id?: number; companyId: string; name: string; email: string; type: string; role: string
  shares: string; sharePrice: string; investmentAmount: string; status: string; joinedDate: string; notes: string
}
const emptyForm = (companyId = ""): Form => ({
  companyId, name: "", email: "", type: "individual", role: "investor",
  shares: "", sharePrice: "", investmentAmount: "", status: "active", joinedDate: "", notes: "",
})

interface TxForm { type: string; shares: string; pricePerShare: string; amount: string; date: string; note: string }
const emptyTxForm = (): TxForm => ({ type: "purchase", shares: "", pricePerShare: "", amount: "", date: new Date().toISOString().slice(0, 10), note: "" })

/** Self-service view for users who can only view their own holdings (no manage permission). */
function MyHoldingsView() {
  const { data: holdings, isLoading } = useQuery<Shareholder[]>({
    queryKey: ["/api/shareholders", "self"],
    queryFn: () => adminApi.get("/shareholders"),
  })
  const [certData, setCertData] = React.useState<ShareCertificateData | null>(null)

  const totalInvested = (holdings ?? []).reduce((s, h) => s + (h.investmentAmount ?? 0), 0)
  const totalShares   = (holdings ?? []).reduce((s, h) => s + (h.shares ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Shareholdings</h1>
        <p className="text-muted-foreground">Your equity holdings across all group companies.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Users}     label="Companies" value={String(new Set((holdings ?? []).map((h) => h.companyId)).size)} loading={isLoading} accent="text-purple-400" />
        <SummaryCard icon={PieChart}  label="Total Shares" value={isLoading ? "—" : num(totalShares)}     loading={isLoading} accent="text-blue-400" />
        <SummaryCard icon={Wallet}    label="Total Invested" value={isLoading ? "—" : inr(totalInvested)} loading={isLoading} accent="text-amber-400" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Holdings</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Ownership</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Certificate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : !holdings || holdings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <PieChart className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No shareholdings recorded for your email address yet.
                  </TableCell>
                </TableRow>
              ) : (
                holdings.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div className="font-medium">{h.companyName}</div>
                      <div className="text-xs text-muted-foreground">{h.name}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={ROLE_STYLES[h.role] ?? ""}>{ROLE_LABELS[h.role] ?? h.role}</Badge></TableCell>
                    <TableCell className="text-right">{num(h.shares)}</TableCell>
                    <TableCell className="text-right font-semibold">{h.ownershipPercent.toFixed(2)}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">{inr(h.investmentAmount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={h.status === "active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted text-muted-foreground"}>
                        {h.status === "active" ? "Active" : "Exited"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost" size="icon"
                        title="Download your share certificate PDF"
                        onClick={() => setCertData({
                          id: h.id,
                          holderName: h.name,
                          companyName: h.companyName,
                          shares: h.shares,
                          sharePrice: h.sharePrice,
                          investmentAmount: h.investmentAmount,
                          shareType: SHARE_TYPE_LABELS[h.role] ?? "EQUITY SHARES",
                          ownershipPercent: h.ownershipPercent,
                          joinedDate: h.joinedDate,
                        })}
                      >
                        <FileDown className="h-4 w-4 text-blue-400" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ShareCertificateModal
        data={certData}
        open={certData != null}
        onClose={() => setCertData(null)}
      />
    </div>
  )
}

// ── AI Valuation Panel ────────────────────────────────────────────────────────
const VALUATION_METHODS = [
  { key: "assetValuation",      label: "Asset-Based",       weight: "20%", color: "text-amber-400" },
  { key: "revenueMultipleVal",  label: "Revenue Multiple",  weight: "30%", color: "text-blue-400" },
  { key: "ebitdaValuation",     label: "EBITDA Multiple",   weight: "20%", color: "text-purple-400" },
  { key: "dcfValuation",        label: "DCF",               weight: "15%", color: "text-cyan-400" },
  { key: "scorecardValuation",  label: "Scorecard",         weight: "10%", color: "text-green-400" },
  { key: "vcValuation",         label: "VC Method",         weight: "5%",  color: "text-rose-400" },
] as const

const RATING_CONFIG: Record<string, { label: string; color: string; bar: string }> = {
  excellent:         { label: "Excellent Investment Opportunity",  color: "text-green-400",  bar: "bg-green-500" },
  strong:            { label: "Strong Investment Opportunity",     color: "text-blue-400",   bar: "bg-blue-500" },
  moderate:          { label: "Moderate Risk",                     color: "text-amber-400",  bar: "bg-amber-500" },
  needs_improvement: { label: "Needs Improvement",                 color: "text-red-400",    bar: "bg-red-500" },
}

function AiValuationPanel({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [expanded, setExpanded] = React.useState(false)
  const cid = companyId ? parseInt(companyId) : null

  const valuationKey   = ["/api/ai/valuation", companyId]
  const shareholderKey = ["/api/ai/valuation", companyId, "shareholders"]

  const { data: cached, isLoading: cacheLoading } = useQuery<AiValuation | null>({
    queryKey: valuationKey,
    queryFn: () => adminApi.get(`/ai/valuation/${companyId}`),
    enabled: !!cid,
  })

  const { data: shareholderData, isLoading: shLoading } = useQuery<AiShareholderValuation>({
    queryKey: shareholderKey,
    queryFn: () => adminApi.get(`/ai/valuation/${companyId}/shareholders`),
    enabled: !!cid && expanded,
  })

  const runValuation = useMutation<AiValuation, Error, boolean>({
    mutationFn: (force: boolean) =>
      adminApi.post(`/ai/valuation/${companyId}${force ? "?force=true" : ""}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: valuationKey })
      qc.invalidateQueries({ queryKey: shareholderKey })
    },
    onError: (e: Error) => toast({ title: "Valuation failed", description: e.message, variant: "destructive" }),
  })

  const valuation   = runValuation.data ?? cached
  const rating      = valuation?.investorRating ? RATING_CONFIG[valuation.investorRating] : null
  const healthColor = valuation?.healthTrend === "growing"
    ? "text-green-400 bg-green-500/10 border-green-500/20"
    : valuation?.healthTrend === "declining"
    ? "text-red-400 bg-red-500/10 border-red-500/20"
    : "text-amber-400 bg-amber-500/10 border-amber-500/20"

  if (!cid) return null

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">AI Investor Valuation Engine</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1">
              <Sparkles className="w-2.5 h-2.5" /> 6-method AI estimate
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {valuation && (
              <Button size="sm" variant="outline" onClick={() => runValuation.mutate(true)} disabled={runValuation.isPending} className="gap-1.5 h-7 text-xs">
                <RefreshCw className={cn("w-3 h-3", runValuation.isPending && "animate-spin")} /> Refresh
              </Button>
            )}
            {!valuation && (
              <Button size="sm" onClick={() => runValuation.mutate(false)} disabled={runValuation.isPending || cacheLoading} className="gap-1.5 h-7 text-xs">
                {runValuation.isPending ? <Sparkles className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                {cacheLoading ? "Loading…" : "Run AI Valuation"}
              </Button>
            )}
          </div>
        </div>
        <CardDescription className="text-xs">
          Weighted average of 6 investor-grade methods. <span className="text-amber-400">Estimate only — not official financial advice.</span>
        </CardDescription>
      </CardHeader>

      {(cacheLoading || runValuation.isPending) && (
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </CardContent>
      )}

      {valuation && !runValuation.isPending && (
        <CardContent className="space-y-5">

          {/* ── Investor Readiness Score ── */}
          {valuation.investorScore != null && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Investor Readiness Score</span>
                <span className={cn("text-2xl font-extrabold", rating?.color ?? "text-foreground")}>
                  {valuation.investorScore}<span className="text-sm font-normal text-muted-foreground">/100</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", rating?.bar ?? "bg-primary")}
                  style={{ width: `${valuation.investorScore}%` }}
                />
              </div>
              {rating && (
                <div className={cn("text-xs font-medium mt-1.5", rating.color)}>{rating.label}</div>
              )}
            </div>
          )}

          {/* ── Final estimate + core KPIs ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ValKpi label="Est. Company Value"  value={inr(valuation.estimatedValue)}    accent="text-green-400" />
            <ValKpi label="Enterprise Value"     value={inr(valuation.enterpriseValue)}   accent="text-blue-400" />
            <ValKpi label="Shareholder Equity"   value={inr(valuation.shareholderEquity)} accent="text-purple-400" />
            <ValKpi label="Net Asset Value"      value={inr(valuation.nav)}               accent="text-amber-400" />
            <ValKpi label="Revenue Growth"       value={pct(valuation.revenueGrowthRate)} accent={valuation.revenueGrowthRate != null && valuation.revenueGrowthRate >= 0 ? "text-green-400" : "text-red-400"} />
            <ValKpi label="Profit Growth"        value={pct(valuation.profitGrowthRate)}  accent={valuation.profitGrowthRate != null && valuation.profitGrowthRate >= 0 ? "text-green-400" : "text-red-400"} />
            <ValKpi label="Business Growth Score" value={valuation.growthScore != null ? `${valuation.growthScore}/100` : "—"} accent={valuation.growthScore != null && valuation.growthScore >= 70 ? "text-green-400" : valuation.growthScore != null && valuation.growthScore >= 40 ? "text-amber-400" : "text-red-400"} />
            <div className="rounded-lg border p-3 bg-card">
              <div className="text-xs text-muted-foreground mb-1.5">Health Trend</div>
              {valuation.healthTrend ? (
                <Badge variant="outline" className={healthColor}>
                  {valuation.healthTrend === "growing" ? <TrendingUp className="w-3 h-3 mr-1" /> : valuation.healthTrend === "declining" ? <TrendingDown className="w-3 h-3 mr-1" /> : <Activity className="w-3 h-3 mr-1" />}
                  {valuation.healthTrend.charAt(0).toUpperCase() + valuation.healthTrend.slice(1)}
                </Badge>
              ) : "—"}
            </div>
          </div>

          {/* ── 6-Method Valuation Breakdown ── */}
          {VALUATION_METHODS.some(m => valuation[m.key] != null) && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/30">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valuation Method Breakdown</span>
              </div>
              <div className="divide-y">
                {VALUATION_METHODS.map(m => (
                  <div key={m.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.label}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 h-4">{m.weight}</Badge>
                    </div>
                    <span className={cn("font-semibold tabular-nums", m.color)}>
                      {valuation[m.key] != null ? inr(valuation[m.key]) : "—"}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 text-sm bg-muted/20">
                  <span className="font-bold">Weighted Average (Final)</span>
                  <span className="font-extrabold text-green-400 text-base">{inr(valuation.estimatedValue)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Share Price Breakdown ── */}
          {(valuation.bookValuePerShare != null || valuation.estimatedSharePrice != null) && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/30">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Share Price Analysis</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0">
                <div className="p-3 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Book Value / Share</div>
                  <div className="font-bold text-purple-400">{valuation.bookValuePerShare != null && valuation.bookValuePerShare > 0 ? inr(valuation.bookValuePerShare) : "—"}</div>
                </div>
                <div className="p-3 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Est. Fair Value / Share</div>
                  <div className="font-bold text-green-400">{valuation.estimatedSharePrice != null && valuation.estimatedSharePrice > 0 ? inr(valuation.estimatedSharePrice) : "—"}</div>
                </div>
                <div className="p-3 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Equity / Share</div>
                  <div className="font-bold text-blue-400">{valuation.shareholderEquity != null && valuation.estimatedSharePrice != null && valuation.estimatedSharePrice > 0 ? inr(valuation.shareholderEquity / (valuation.estimatedValue! / valuation.estimatedSharePrice!)) : "—"}</div>
                </div>
                <div className="p-3 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Growth Score</div>
                  <div className={cn("font-bold", valuation.growthScore != null && valuation.growthScore >= 70 ? "text-green-400" : "text-amber-400")}>
                    {valuation.growthScore != null ? `${valuation.growthScore}/100` : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── AI Explanation ── */}
          {valuation.explanation && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm text-muted-foreground">
              <span className="text-xs font-semibold text-primary uppercase tracking-wide block mb-1">AI Explanation</span>
              {valuation.explanation}
            </div>
          )}

          {/* ── Recommendations ── */}
          {valuation.recommendations && valuation.recommendations.length > 0 && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/30">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Recommendations</span>
              </div>
              <ul className="divide-y">
                {valuation.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                    <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                    <span className="text-muted-foreground">{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Per-Shareholder AI Enrichment ── */}
          <div>
            <button
              className="flex w-full items-center gap-2 text-sm font-medium py-1"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Per-Shareholder AI Estimates
              <span className="text-xs text-muted-foreground">(ownership % × estimated value)</span>
            </button>
            {expanded && (
              <div className="mt-3 space-y-2">
                {shLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : (shareholderData?.shareholders.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No active shareholders recorded for this company.</p>
                ) : (
                  shareholderData!.shareholders.map((sh) => (
                    <div key={sh.id} className="rounded-lg border p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="font-medium">{sh.name}</div>
                        <div className="text-xs text-muted-foreground">{ROLE_LABELS[sh.role] ?? sh.role} · {sh.ownershipPercent.toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Est. Share Value</div>
                        <div className="font-semibold text-green-400">{inr(sh.estimatedShareValue)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Capital Invested</div>
                        <div>{inr(sh.capitalInvested)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">ROI Estimate</div>
                        <div className={cn("font-semibold", sh.roiEstimate != null && sh.roiEstimate >= 0 ? "text-green-400" : "text-red-400")}>
                          {sh.roiEstimate != null ? pct(sh.roiEstimate) : "—"}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={sh.roiExplanation}>{sh.roiExplanation}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground border-t pt-2">
            AI estimate generated {new Date(valuation.createdAt).toLocaleString("en-IN")} via {valuation.provider} · Not official financial advice
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function ValKpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-base font-bold", accent)}>{value}</div>
    </div>
  )
}

/** Admin / manager view — all hooks declared unconditionally. */
function AdminShareholdersView() {
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const qc = useQueryClient()
  const canManage = hasPermission("shareholders.manage")

  const [companyId, setCompanyId] = React.useState<string>("")
  const [showForm, setShowForm] = React.useState(false)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [detailId, setDetailId] = React.useState<number | null>(null)
  const [txForm, setTxForm] = React.useState<TxForm>(emptyTxForm())
  const [certData, setCertData] = React.useState<ShareCertificateData | null>(null)

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    queryFn: () => adminApi.get("/companies"),
  })

  React.useEffect(() => {
    if (!companyId && companies && companies.length > 0) setCompanyId(String(companies[0].id))
  }, [companies, companyId])

  const capKey = ["/api/shareholders/cap-table", companyId]
  const { data: cap, isLoading: capLoading } = useQuery<CapTable>({
    queryKey: capKey,
    queryFn: () => adminApi.get(`/shareholders/cap-table?companyId=${companyId}`),
    enabled: !!companyId,
  })

  const listKey = ["/api/shareholders", companyId]
  const { data: holders, isLoading } = useQuery<Shareholder[]>({
    queryKey: listKey,
    queryFn: () => adminApi.get(`/shareholders?companyId=${companyId}`),
    enabled: !!companyId,
  })

  const { data: aiValuation } = useQuery<AiValuation | null>({
    queryKey: ["/api/ai/valuation", companyId],
    queryFn: () => companyId ? adminApi.get(`/ai/valuation/${companyId}`).catch(() => null) : Promise.resolve(null),
    enabled: !!companyId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/shareholders"] })
    qc.invalidateQueries({ queryKey: ["/api/shareholders/cap-table"] })
  }

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      form.id ? adminApi.patch(`/shareholders/${form.id}`, body) : adminApi.post("/shareholders", body),
    onSuccess: () => {
      invalidate(); setShowForm(false); setForm(emptyForm(companyId))
      toast({ title: form.id ? "Shareholder updated" : "Shareholder added" })
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  })

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.del(`/shareholders/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Shareholder removed" }) },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  })

  const invite = useMutation({
    mutationFn: (id: number) => adminApi.post(`/shareholders/${id}/invite`, {}),
    onSuccess: (data: { emailSent?: boolean }) => {
      invalidate();
      if (data?.emailSent === false) {
        toast({
          title: "Invite recorded — email not delivered",
          description: "The shareholder has been marked as invited, but the email could not be sent. Ask your admin to set a verified EMAIL_FROM address in deployment secrets.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Invite email sent" });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't send invite", description: e.message, variant: "destructive" }),
  })

  function openCreate() { setForm(emptyForm(companyId)); setShowForm(true) }
  function openEdit(h: Shareholder) {
    setForm({
      id: h.id, companyId: String(h.companyId), name: h.name, email: h.email ?? "", type: h.type, role: h.role,
      shares: String(h.shares), sharePrice: String(h.sharePrice), investmentAmount: String(h.investmentAmount),
      status: h.status, joinedDate: h.joinedDate ?? "", notes: h.notes ?? "",
    })
    setShowForm(true)
  }

  function submit() {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return }
    if (!form.companyId) { toast({ title: "Pick a company", variant: "destructive" }); return }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      type: form.type,
      role: form.role,
      shares: Number(form.shares) || 0,
      sharePrice: Number(form.sharePrice) || 0,
      investmentAmount: Number(form.investmentAmount) || 0,
      status: form.status,
      joinedDate: form.joinedDate || null,
      notes: form.notes.trim() || null,
    }
    if (!form.id) body.companyId = Number(form.companyId)
    save.mutate(body)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shareholders & Cap Table</h1>
          <p className="text-muted-foreground">Ownership, equity allocation and investment history for each company.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Select company" /></SelectTrigger>
            <SelectContent>
              {(companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {canManage && (
            <Button onClick={openCreate} disabled={!companyId}><Plus className="mr-2 h-4 w-4" /> Add Shareholder</Button>
          )}
        </div>
      </div>

      {/* Cap table summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={TrendingUp} label="Company Valuation" value={cap ? inr(cap.valuation) : "—"} loading={capLoading} accent="text-green-400" />
        <SummaryCard icon={PieChart} label="Total Shares Issued" value={cap ? num(cap.totalShares) : "—"} loading={capLoading} accent="text-blue-400" />
        <SummaryCard icon={Wallet} label="Total Invested" value={cap ? inr(cap.totalInvested) : "—"} loading={capLoading} accent="text-amber-400" />
        <SummaryCard icon={Users} label="Shareholders" value={cap ? num(cap.shareholderCount) : "—"} loading={capLoading} accent="text-purple-400" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cap Table</CardTitle>
          <CardDescription>Ownership breakdown{cap ? ` — share price ${inr(cap.pricePerShare)}` : ""}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shareholder</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Ownership</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead className="text-right">Equity Value</TableHead>
                <TableHead className="text-right">Share Premium</TableHead>
                {aiValuation && <TableHead className="text-right">Book Value</TableHead>}
                {aiValuation && <TableHead className="text-right">Est. Mkt Val</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Certificate</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={canManage ? 9 : 8}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : !holders || holders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 9 : 8} className="py-12 text-center text-muted-foreground">
                    <PieChart className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No shareholders recorded for this company yet.
                  </TableCell>
                </TableRow>
              ) : (
                holders.map((h) => (
                  <TableRow key={h.id} className="cursor-pointer" onClick={() => { setDetailId(h.id); setTxForm(emptyTxForm()) }}>
                    <TableCell>
                      <div className="font-medium">{h.name}</div>
                      {h.email && <div className="text-xs text-muted-foreground">{h.email}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={ROLE_STYLES[h.role] ?? ""}>{ROLE_LABELS[h.role] ?? h.role}</Badge></TableCell>
                    <TableCell className="text-right">{num(h.shares)}</TableCell>
                    <TableCell className="text-right font-semibold">{h.ownershipPercent.toFixed(2)}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">{inr(h.investmentAmount)}</TableCell>
                    <TableCell className="text-right">{cap && cap.totalShares > 0 ? inr((h.shares / cap.totalShares) * cap.valuation) : "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {h.investmentAmount > 0 && h.sharePrice > 0 ? inr(h.investmentAmount - h.shares * h.sharePrice) : "—"}
                    </TableCell>
                    {aiValuation && <TableCell className="text-right">{aiValuation.bookValuePerShare ? inr(h.shares * aiValuation.bookValuePerShare) : "—"}</TableCell>}
                    {aiValuation && <TableCell className={`text-right ${aiValuation.estimatedSharePrice && h.investmentAmount > 0 ? (h.shares * aiValuation.estimatedSharePrice > h.investmentAmount ? "text-green-400" : "text-red-400") : ""}`}>{aiValuation.estimatedSharePrice ? inr(h.shares * aiValuation.estimatedSharePrice) : "—"}</TableCell>}
                    <TableCell>
                      <Badge variant="outline" className={h.status === "active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted text-muted-foreground"}>
                        {h.status === "active" ? "Active" : "Exited"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost" size="icon"
                        title="Download share certificate PDF"
                        onClick={() => setCertData({
                          id: h.id,
                          holderName: h.name,
                          companyName: h.companyName,
                          shares: h.shares,
                          sharePrice: h.sharePrice,
                          investmentAmount: h.investmentAmount,
                          // AI estimated price preferred; fall back to cap-table derived price
                          estimatedSharePrice: aiValuation?.estimatedSharePrice ?? (cap && cap.totalShares > 0 ? cap.valuation / cap.totalShares : undefined),
                          bookValuePerShare: aiValuation?.bookValuePerShare ?? undefined,
                          shareType: SHARE_TYPE_LABELS[h.role] ?? "EQUITY SHARES",
                          ownershipPercent: h.ownershipPercent,
                          joinedDate: h.joinedDate,
                        })}
                      >
                        <FileDown className="h-4 w-4 text-blue-400" />
                      </Button>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost" size="icon"
                          title={h.email ? (h.invitedAt ? `Invited ${new Date(h.invitedAt).toLocaleDateString("en-IN")} — resend` : "Send invite email") : "Add an email address to invite"}
                          disabled={!h.email || (invite.isPending && invite.variables === h.id)}
                          onClick={() => invite.mutate(h.id)}
                        >
                          <Send className={`h-4 w-4 ${h.invitedAt ? "text-green-400" : ""}`} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(h)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Remove ${h.name}?`)) remove.mutate(h.id) }}><Trash2 className="h-4 w-4 text-red-400" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* AI Valuation Intelligence */}
      {companyId && <AiValuationPanel companyId={companyId} />}

      {/* Create / edit dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit shareholder" : "Add shareholder"}</DialogTitle>
            <DialogDescription>Ownership percentage is calculated automatically from total issued shares.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!form.id && (
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Select value={form.companyId} onValueChange={(v) => setForm({ ...form, companyId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{(companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Holder type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="entity">Entity / Company</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Shares</Label>
                <Input type="number" min="0" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Price / share (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.sharePrice} onChange={(e) => setForm({ ...form, sharePrice: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Invested (₹)</Label>
                <Input type="number" min="0" value={form.investmentAmount} onChange={(e) => setForm({ ...form, investmentAmount: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Joined date</Label>
                <Input type="date" value={form.joinedDate} onChange={(e) => setForm({ ...form, joinedDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="exited">Exited</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : form.id ? "Save changes" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareholderDetail
        id={detailId}
        onClose={() => setDetailId(null)}
        canManage={canManage}
        txForm={txForm}
        setTxForm={setTxForm}
        onChanged={invalidate}
      />

      {/* Share certificate download modal */}
      <ShareCertificateModal
        data={certData}
        open={certData != null}
        onClose={() => setCertData(null)}
      />
    </div>
  )
}

/** Route-level component: delegates to the right view based on permissions.
 *  Each child component owns all its own hooks, avoiding conditional-hook violations. */
export default function Shareholders() {
  const { hasPermission } = useAuth()
  return hasPermission("shareholders.manage") ? <AdminShareholdersView /> : <MyHoldingsView />
}

function SummaryCard({ icon: Icon, label, value, loading, accent }: { icon: React.ElementType; label: string; value: string; loading: boolean; accent: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg bg-muted p-2 ${accent}`}><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {loading ? <Skeleton className="mt-1 h-6 w-20" /> : <div className="text-lg font-bold">{value}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function ShareholderDetail({ id, onClose, canManage, txForm, setTxForm, onChanged }: {
  id: number | null; onClose: () => void; canManage: boolean
  txForm: TxForm; setTxForm: (f: TxForm) => void; onChanged: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<Shareholder & { history: ShareTx[] }>({
    queryKey: ["/api/shareholders", "detail", id],
    queryFn: () => adminApi.get(`/shareholders/${id}`),
    enabled: id != null,
  })

  const addTx = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi.post(`/shareholders/${id}/transactions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/shareholders", "detail", id] })
      onChanged()
      setTxForm(emptyTxForm())
      toast({ title: "Transaction recorded" })
    },
    onError: (e: Error) => toast({ title: "Couldn't record", description: e.message, variant: "destructive" }),
  })

  function submitTx() {
    const shares = Number(txForm.shares) || 0
    const amount = Number(txForm.amount) || 0
    if (txForm.type !== "dividend" && shares === 0 && amount === 0) {
      toast({ title: "Enter shares or an amount", variant: "destructive" }); return
    }
    addTx.mutate({
      type: txForm.type,
      shares: txForm.type === "sale" ? -Math.abs(shares) : shares,
      pricePerShare: Number(txForm.pricePerShare) || 0,
      amount,
      date: txForm.date,
      note: txForm.note.trim() || null,
    })
  }

  return (
    <Dialog open={id != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data?.name ?? "Shareholder"}</DialogTitle>
          <DialogDescription>
            {data ? `${ROLE_LABELS[data.role] ?? data.role} · ${data.companyName} · ${data.ownershipPercent.toFixed(2)}% ownership` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Shares" value={num(data.shares)} />
              <Stat label="Price / share" value={inr(data.sharePrice)} />
              <Stat label="Total invested" value={inr(data.investmentAmount)} />
            </div>

            {canManage && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4" /> Record transaction</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Select value={txForm.type} onValueChange={(v) => setTxForm({ ...txForm, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TX_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" placeholder="Shares" value={txForm.shares} onChange={(e) => setTxForm({ ...txForm, shares: e.target.value })} />
                  <Input type="number" placeholder="₹/share" value={txForm.pricePerShare} onChange={(e) => setTxForm({ ...txForm, pricePerShare: e.target.value })} />
                  <Input type="number" placeholder="Amount ₹" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} />
                  <Input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input placeholder="Note (optional)" value={txForm.note} onChange={(e) => setTxForm({ ...txForm, note: e.target.value })} />
                  <Button size="sm" onClick={submitTx} disabled={addTx.isPending}>{addTx.isPending ? "Saving…" : "Add"}</Button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4" /> Investment history</div>
              {data.history.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No transactions recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Type</TableHead>
                      <TableHead className="text-right">Shares</TableHead>
                      <TableHead className="text-right">₹/share</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.history.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-muted-foreground">{new Date(t.date).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell>{TX_LABELS[t.type] ?? t.type}</TableCell>
                        <TableCell className={`text-right ${t.shares < 0 ? "text-red-400" : ""}`}>{t.shares > 0 ? "+" : ""}{num(t.shares)}</TableCell>
                        <TableCell className="text-right">{inr(t.pricePerShare)}</TableCell>
                        <TableCell className="text-right">{inr(t.amount)}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">{t.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  )
}
