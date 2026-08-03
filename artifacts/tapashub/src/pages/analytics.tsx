import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart, Percent, Lightbulb } from "lucide-react"

interface Company { id: number; name: string }
interface SeriesRow { label: string; revenue: number; expenses: number; profit: number }
interface Summary {
  empty?: boolean
  period: string
  companyId: number | null
  current: {
    revenue: number; expenses: number; netProfit: number; netMargin: number | null
    cogs: number | null; grossMargin: number | null
    revenueGrowth: number | null; profitGrowth: number | null; marketShare: number | null
  }
  totals: { revenue: number; expenses: number; profit: number }
  equity: { valuation: number; capitalInvested: number; shareholderCount: number; uniqueShareholders: number }
  series: SeriesRow[]
  insights: string[]
}
interface ReportRow { label: string; revenue: number; expenses: number; profit: number; margin: number | null; growth: number | null }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`
function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  if (Math.abs(n) >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${Math.round(n)}`
}
const pctText = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`)

const PERIODS = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
]

function RevExpChart({ data }: { data: SeriesRow[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.revenue, d.expenses]))
  if (data.every((d) => d.revenue === 0 && d.expenses === 0)) return <EmptyState className="h-56" />
  return (
    <div className="h-56 flex items-end gap-2 px-1">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "190px" }}>
            <div className="w-1/2 rounded-t-sm bg-teal-500/70 hover:bg-teal-400 transition-colors"
              style={{ height: `${(d.revenue / max) * 180}px`, minHeight: d.revenue > 0 ? 3 : 0 }}
              title={`Revenue: ${inr(d.revenue)}`} />
            <div className="w-1/2 rounded-t-sm bg-rose-500/50 hover:bg-rose-400 transition-colors"
              style={{ height: `${(d.expenses / max) * 180}px`, minHeight: d.expenses > 0 ? 3 : 0 }}
              title={`Expenses: ${inr(d.expenses)}`} />
          </div>
          <span className="text-[10px] text-muted-foreground truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function ProfitTrend({ data }: { data: SeriesRow[] }) {
  const vals = data.map((d) => d.profit)
  if (vals.every((v) => v === 0)) return <EmptyState className="h-40" />
  const min = Math.min(...vals, 0)
  const max = Math.max(...vals, 0)
  const range = max - min || 1
  const w = 480, h = 150, pad = 16
  const pts = data.map((d, i) => ({
    x: pad + (i / Math.max(1, data.length - 1)) * (w - 2 * pad),
    y: h - pad - ((d.profit - min) / range) * (h - 2 * pad),
    ...d,
  }))
  const zeroY = h - pad - ((0 - min) / range) * (h - 2 * pad)
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ")
  const areaPath = `M${pts[0].x},${zeroY} ${pts.map((p) => `L${p.x},${p.y}`).join(" ")} L${pts[pts.length - 1].x},${zeroY} Z`
  const positive = (vals[vals.length - 1] ?? 0) >= 0
  const color = positive ? "#22C55E" : "#EF4444"
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="aProfitGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
      <path d={areaPath} fill="url(#aProfitGrad)" />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={color}><title>{p.label}: {inr(p.profit)}</title></circle>
      ))}
      {pts.map((p, i) => (
        <text key={i} x={p.x} y={h - 3} textAnchor="middle" fontSize="9" fill="#64748B">{p.label}</text>
      ))}
    </svg>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${tone ?? "bg-primary/10 text-primary"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="text-2xl font-bold mb-0.5">{value}</div>
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        {sub && <div className="text-[11px] mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function GrowthBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground/70">vs last period —</span>
  return v >= 0 ? (
    <span className="text-green-400 inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" />{pctText(v)}</span>
  ) : (
    <span className="text-red-400 inline-flex items-center gap-1"><TrendingDown className="w-3 h-3" />{pctText(v)}</span>
  )
}

export default function Analytics() {
  const [companyId, setCompanyId] = React.useState<string>("all")
  const [period, setPeriod] = React.useState<string>("month")

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    queryFn: () => adminApi.get("/companies"),
  })

  const qs = `?period=${period}${companyId !== "all" ? `&companyId=${companyId}` : ""}`
  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ["/api/analytics/summary", companyId, period],
    queryFn: () => adminApi.get(`/analytics/summary${qs}`),
  })
  const { data: report } = useQuery<{ rows: ReportRow[] }>({
    queryKey: ["/api/analytics/reports", companyId, period],
    queryFn: () => adminApi.get(`/analytics/reports${qs}`),
  })

  const periodWord = period === "year" ? "year" : period === "quarter" ? "quarter" : "month"
  const cur = summary?.current

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics & Reports</h1>
          <p className="text-muted-foreground">Financial performance, valuation and growth across your portfolio.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {(companies ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border border-border p-0.5">
            {PERIODS.map((p) => (
              <Button key={p.value} size="sm" variant={period === p.value ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setPeriod(p.value)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : summary?.empty ? (
        <EmptyState className="h-56" />
      ) : cur ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={BarChart3} label={`Revenue (this ${periodWord})`} value={fmtCompact(cur.revenue)} tone="bg-teal-500/10 text-teal-400"
              sub={<GrowthBadge v={cur.revenueGrowth} />} />
            <Kpi icon={TrendingUp} label={`Net Profit (this ${periodWord})`} value={fmtCompact(cur.netProfit)}
              tone={cur.netProfit >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}
              sub={<span className="text-muted-foreground">{cur.netMargin != null ? `${cur.netMargin.toFixed(1)}% margin` : "—"}</span>} />
            <Kpi icon={DollarSign} label="Company Valuation" value={summary!.equity.valuation > 0 ? fmtCompact(summary!.equity.valuation) : "—"}
              tone="bg-amber-500/10 text-amber-400"
              sub={<span className="text-muted-foreground">{summary!.equity.capitalInvested > 0 ? `${inr(summary!.equity.capitalInvested)} invested` : "No equity data"}</span>} />
            {companyId !== "all" ? (
              <Kpi icon={Percent} label={`Market Share (this ${periodWord})`} value={cur.marketShare != null ? `${cur.marketShare.toFixed(1)}%` : "—"}
                tone="bg-purple-500/10 text-purple-400" sub={<span className="text-muted-foreground">of group revenue</span>} />
            ) : (
              <Kpi icon={PieChart} label="Unique Shareholders" value={String(summary!.equity.uniqueShareholders)}
                tone="bg-purple-500/10 text-purple-400"
                sub={<span className="text-muted-foreground">{summary!.equity.shareholderCount} holding record{summary!.equity.shareholderCount !== 1 ? "s" : ""} across portfolio</span>} />
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Revenue vs Expenses</CardTitle>
                <CardDescription className="text-xs flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-teal-500/70 inline-block" />Revenue</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500/50 inline-block" />Expenses</span>
                </CardDescription>
              </CardHeader>
              <CardContent><RevExpChart data={summary!.series} /></CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">Profit Trend <GrowthBadge v={cur.profitGrowth} /></CardTitle>
                <CardDescription className="text-xs">Net profit per {periodWord}</CardDescription>
              </CardHeader>
              <CardContent><ProfitTrend data={summary!.series} /></CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-400" /> Insights</CardTitle>
                <CardDescription className="text-xs">Computed from your live data</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary!.insights.map((t, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span className="text-muted-foreground">{t}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{PERIODS.find((p) => p.value === period)?.label} Report</CardTitle>
                <CardDescription className="text-xs">Revenue, expenses, profit and margin per {periodWord}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Growth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(report?.rows ?? []).map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right">{inr(r.revenue)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{inr(r.expenses)}</TableCell>
                        <TableCell className={`text-right font-medium ${r.profit >= 0 ? "text-green-400" : "text-red-400"}`}>{inr(r.profit)}</TableCell>
                        <TableCell className="text-right">{r.margin != null ? `${r.margin.toFixed(1)}%` : "—"}</TableCell>
                        <TableCell className="text-right"><GrowthBadge v={r.growth} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {cur.grossMargin == null && (
            <p className="text-xs text-muted-foreground">
              Gross margin & COGS are not shown because expense categorisation (cost of goods) isn't tracked yet — add it in the Finance module to unlock those metrics.
            </p>
          )}
        </>
      ) : (
        <EmptyState className="h-56" />
      )}
    </div>
  )
}
