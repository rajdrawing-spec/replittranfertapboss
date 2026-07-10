import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  BarChart3, TrendingUp, TrendingDown, FileText, Printer,
  RefreshCw, AlertTriangle, Lightbulb, Target, CheckSquare,
  ChevronRight, Bot, Wallet, DollarSign, ArrowRight,
} from "lucide-react"
import { useListCompanies } from "@workspace/api-client-react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LineChart, Line, Legend,
} from "recharts"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────
interface AiReportHistory {
  id: number; companyId: number | null; scheduleId: number | null
  type: string; periodLabel: string | null; status: string; subject: string
  aiSummary: string | null; errorMessage: string | null
  sentAt: string | null; createdAt: string
  contentJson: ReportContent | null
}

interface ReportContent {
  kpis:            Array<{ label: string; value: string; raw: number; delta?: string; color: string }>
  chart_data:      Array<{ label: string; revenue: number; expenses: number; profit: number }>
  risks:           Array<{ title: string; severity: string }>
  opportunities:   Array<{ title: string; impact: string }>
  recommendations: Array<{ title: string; description: string; priority: string; effort: string }>
  action_plan:     Array<{ item: string; priority: string }>
  ai_narrative:    string
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const inr = (n: number) => {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`
  return `₹${Math.round(n).toLocaleString("en-IN")}`
}

const TYPE_LABELS: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly",
  quarterly: "Quarterly", annual: "Annual", manual: "One-off",
}
const TYPE_COLORS: Record<string, string> = {
  daily:     "bg-sky-500/10 text-sky-400 border-sky-500/20",
  weekly:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  monthly:   "bg-violet-500/10 text-violet-400 border-violet-500/20",
  quarterly: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  annual:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  manual:    "bg-slate-500/10 text-slate-400 border-slate-500/20",
}
const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high:     "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium:   "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  low:      "text-blue-400 bg-blue-500/10 border-blue-500/20",
}
const PRIORITY_ORDER = ["critical", "high", "medium", "low"]

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, delta, color }: { label: string; value: string; delta?: string; color: string }) {
  const isGreen  = color === "green"
  const isRed    = color === "red"
  const isPurple = color === "purple"
  const isAmber  = color === "amber"
  return (
    <div className={cn(
      "rounded-xl border p-4",
      isGreen  && "bg-green-500/8 border-green-500/15",
      isRed    && "bg-red-500/8 border-red-500/15",
      isPurple && "bg-purple-500/8 border-purple-500/15",
      isAmber  && "bg-amber-500/8 border-amber-500/15",
      !isGreen && !isRed && !isPurple && !isAmber && "bg-card border-border",
    )}>
      <div className={cn(
        "text-2xl font-bold mb-1",
        isGreen  && "text-green-400",
        isRed    && "text-red-400",
        isPurple && "text-purple-400",
        isAmber  && "text-amber-400",
      )}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {delta && (
        <div className={cn("text-xs mt-1 font-medium", delta.startsWith("+") ? "text-green-400" : "text-red-400")}>
          {delta}
        </div>
      )}
    </div>
  )
}

// ── Recharts custom tooltip ───────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{inr(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Full Report Viewer ────────────────────────────────────────────────────────
function ReportViewer({ report, onClose }: { report: AiReportHistory; onClose: () => void }) {
  const content = report.contentJson
  if (!content) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
              <ChevronRight className="w-4 h-4 rotate-180" /> Back
            </Button>
          </div>
          <div className="text-center py-16 text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <div className="text-lg font-medium mb-2">Report preview not available</div>
            {report.aiSummary && <p className="text-sm max-w-lg mx-auto">{report.aiSummary}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6" id="report-print-root">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 print:hidden">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <ChevronRight className="w-4 h-4 rotate-180" /> Back
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => window.print()}
            className="gap-2"
          >
            <Printer className="w-4 h-4" /> Export / Print PDF
          </Button>
        </div>

        {/* Title block */}
        <div className="border rounded-xl p-6 bg-card">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className={cn("text-xs", TYPE_COLORS[report.type] ?? "")}>
              {TYPE_LABELS[report.type] ?? report.type}
            </Badge>
            {report.periodLabel && (
              <span className="text-sm text-muted-foreground">{report.periodLabel}</span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Generated {new Date(report.createdAt).toLocaleString("en-IN", {
                day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
              })}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{report.subject}</h1>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-primary/70">
            <Bot className="w-3 h-3" />
            <span>Generated by AI · not official financial statements</span>
          </div>
        </div>

        {/* KPIs */}
        {content.kpis.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Key Performance Indicators
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {content.kpis.map((kpi, i) => (
                <KpiCard key={i} {...kpi} />
              ))}
            </div>
          </section>
        )}

        {/* Revenue / Expense Chart */}
        {content.chart_data.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Revenue vs Expenses
            </h2>
            <Card>
              <CardContent className="pt-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={content.chart_data} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tickFormatter={(v) => inr(v)} tick={{ fontSize: 10, fill: "#6b7280" }} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue"  name="Revenue"  fill="#34d399" radius={[3,3,0,0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Profit Trend */}
        {content.chart_data.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Profit Trend
            </h2>
            <Card>
              <CardContent className="pt-4">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={content.chart_data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2a" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <YAxis tickFormatter={(v) => inr(v)} tick={{ fontSize: 10, fill: "#6b7280" }} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line dataKey="profit" name="Profit" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>
        )}

        {/* AI Narrative */}
        {content.ai_narrative && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> Executive AI Analysis
              <span className="text-[10px] font-normal text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">Generated by AI</span>
            </h2>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{content.ai_narrative}</p>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Risks & Opportunities */}
        {(content.risks.length > 0 || content.opportunities.length > 0) && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Risks & Opportunities
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {content.risks.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                      <AlertTriangle className="w-4 h-4" /> Risks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {content.risks.map((r, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Badge variant="outline" className={cn("text-[9px] shrink-0 mt-0.5", SEVERITY_COLORS[r.severity] ?? "")}>
                          {r.severity}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{r.title}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {content.opportunities.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-green-400">
                      <Lightbulb className="w-4 h-4" /> Opportunities
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {content.opportunities.map((o, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Badge variant="outline" className={cn("text-[9px] shrink-0 mt-0.5",
                          o.impact === "high" ? "text-green-400 bg-green-500/10 border-green-500/20" :
                          o.impact === "medium" ? "text-blue-400 bg-blue-500/10 border-blue-500/20" :
                          "text-slate-400 bg-slate-500/10 border-slate-500/20"
                        )}>
                          {o.impact}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{o.title}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        )}

        {/* Recommendations */}
        {content.recommendations.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> AI Recommendations
              <span className="text-[10px] font-normal text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">Generated by AI</span>
            </h2>
            <div className="space-y-3">
              {[...content.recommendations]
                .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
                .map((rec, i) => (
                  <Card key={i}>
                    <CardContent className="pt-4">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                          <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[rec.priority] ?? "")}>
                            {rec.priority}
                          </Badge>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{rec.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">{rec.description}</div>
                          <div className="text-[10px] text-muted-foreground/60 mt-1.5">Effort: {rec.effort}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              }
            </div>
          </section>
        )}

        {/* Action Plan */}
        {content.action_plan.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-primary" /> Action Plan
              <span className="text-[10px] font-normal text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">Generated by AI</span>
            </h2>
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {[...content.action_plan]
                    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
                    .map((action, i) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                        <div className="w-5 h-5 rounded border border-border flex items-center justify-center text-xs text-muted-foreground shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-sm flex-1">{action.item}</span>
                        <Badge variant="outline" className={cn("text-[9px] shrink-0", SEVERITY_COLORS[action.priority] ?? "")}>
                          {action.priority}
                        </Badge>
                      </div>
                    ))
                  }
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Footer disclaimer */}
        <div className="rounded-lg bg-muted/30 border p-4 text-xs text-muted-foreground">
          ⚠️ All AI-generated content (narrative, recommendations, action plan) is based on data entered into TapasHub and is provided for informational purposes only. It is not official financial advice or a certified financial statement.
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          #report-print-root { padding: 0; max-width: 100%; }
        }
      `}</style>
    </div>
  )
}

// ── Report List ────────────────────────────────────────────────────────────────
function ReportListItem({ report, onView }: { report: AiReportHistory; onView: () => void }) {
  const isReady = report.status === "ready" || report.status === "sent"
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/20 transition-colors">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <FileText className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{report.subject || "Executive Report"}</div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge variant="outline" className={cn("text-[9px] py-0 px-1", TYPE_COLORS[report.type] ?? "")}>
            {TYPE_LABELS[report.type] ?? report.type}
          </Badge>
          {report.periodLabel && (
            <span className="text-xs text-muted-foreground">{report.periodLabel}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(report.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={cn("text-[10px]",
          isReady ? "bg-green-500/10 text-green-400 border-green-500/20" :
          report.status === "generating" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
          "bg-red-500/10 text-red-400 border-red-500/20"
        )}>
          {report.status === "generating" ? "⏳" : isReady ? "✓" : "✗"} {report.status}
        </Badge>
        {isReady && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onView}>
            View <ArrowRight className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AiReports() {
  const { activeCompany } = useCompany()
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission("super_admin")
  const qc = useQueryClient()
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all")
  const [filterType, setFilterType] = useState<string>("all")
  const [viewingReport, setViewingReport] = useState<AiReportHistory | null>(null)
  const [generating, setGenerating] = useState(false)

  const { data: companies } = useListCompanies({ query: { queryKey: ["/api/companies"] } })

  const histKey = ["/api/reports/history", filterCompanyId, filterType]
  const { data: rawHistory, isLoading } = useQuery<AiReportHistory[]>({
    queryKey: histKey,
    queryFn: () => {
      const qs = new URLSearchParams()
      if (filterCompanyId !== "all") qs.set("companyId", filterCompanyId)
      return adminApi.get(`/reports/history${qs.toString() ? "?" + qs : ""}`)
    },
    refetchInterval: (q) =>
      q.state.data?.some?.((r: AiReportHistory) => r.status === "generating") ? 3000 : false,
  })

  const generateNow = useMutation<{ id: number; status: string }, Error, void>({
    mutationFn: () => adminApi.post("/reports/generate", {
      companyId: activeCompany?.id ?? null,
      type:      "manual",
      recipientEmails: [],
    }),
    onSuccess: () => {
      setGenerating(true)
      setTimeout(() => {
        setGenerating(false)
        qc.invalidateQueries({ queryKey: ["/api/reports/history"] })
      }, 2000)
    },
  })

  const history = (rawHistory ?? []).filter(r => {
    if (filterType !== "all" && r.type !== filterType) return false
    return true
  })

  // Group by type
  const grouped = history.reduce<Record<string, AiReportHistory[]>>((acc, r) => {
    const group = r.type in TYPE_LABELS ? r.type : "manual"
    acc[group] = acc[group] ?? []
    acc[group].push(r)
    return acc
  }, {})

  const typeOrder = ["daily", "weekly", "monthly", "quarterly", "annual", "manual"]

  if (viewingReport) {
    return <ReportViewer report={viewingReport} onClose={() => setViewingReport(null)} />
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" /> AI Executive Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            AI-generated business reports with KPIs, trend charts, risks, recommendations, and action plans.
          </p>
        </div>
        <Button
          onClick={() => generateNow.mutate()}
          disabled={generateNow.isPending || generating}
          className="gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", (generateNow.isPending || generating) && "animate-spin")} />
          {generateNow.isPending || generating ? "Generating…" : "Generate Report Now"}
        </Button>
      </div>

      {generateNow.isSuccess && (
        <div className="text-xs text-green-400 flex items-center gap-2 bg-green-500/5 border border-green-500/15 rounded-lg px-4 py-2">
          ✓ Report queued — it will appear in the list below momentarily.
        </div>
      )}
      {generateNow.isError && (
        <div className="text-xs text-red-400 flex items-center gap-2 bg-red-500/5 border border-red-500/15 rounded-lg px-4 py-2">
          ✗ {generateNow.error?.message ?? "Failed to generate report. Please try again."}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            <SelectItem value="null">Portfolio</SelectItem>
            {(companies ?? []).map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Report list */}
      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : history.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Bot className="w-12 h-12 mx-auto mb-3 text-primary/30" />
            <div className="text-base font-medium mb-1">No reports yet</div>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Generate Report Now" to create your first executive report.
              Reports are also generated automatically on a schedule.
            </p>
            <Button onClick={() => generateNow.mutate()} disabled={generateNow.isPending} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Generate First Report
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {typeOrder
            .filter(type => grouped[type]?.length)
            .map(type => (
              <section key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {TYPE_LABELS[type]} Reports
                  </h2>
                  <Badge variant="outline" className="text-[9px]">{grouped[type].length}</Badge>
                </div>
                <Card>
                  <CardContent className="p-3 space-y-1">
                    {grouped[type].map(r => (
                      <ReportListItem
                        key={r.id}
                        report={r}
                        onView={() => setViewingReport(r)}
                      />
                    ))}
                  </CardContent>
                </Card>
              </section>
            ))
          }
        </div>
      )}

      {/* Info panel */}
      <Card className="border-primary/10 bg-primary/3">
        <CardContent className="py-4 px-5">
          <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-primary" /> Automated Report Schedule
          </h3>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground">
            {[
              ["Daily", "Every day at 8:00 AM"],
              ["Weekly", "Every Monday at 8:00 AM"],
              ["Monthly", "1st of each month at 8:00 AM"],
              ["Quarterly", "1st of Jan, Apr, Jul, Oct at 8:00 AM"],
              ["Annual", "1st of January at 8:00 AM"],
            ].map(([type, schedule]) => (
              <div key={type} className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-primary/50" />
                <span className="font-medium text-foreground/80">{type}:</span>
                <span>{schedule}</span>
              </div>
            ))}
          </div>
          {isSuperAdmin && (
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
              To configure email delivery of automated reports, go to{" "}
              <a href="/ai-assistant" className="text-primary hover:underline">AI Assistant → Executive Reports</a>.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
