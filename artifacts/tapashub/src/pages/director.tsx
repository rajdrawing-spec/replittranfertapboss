import * as React from "react"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, TrendingDown, Building2, DollarSign, BarChart3, PieChart, Activity } from "lucide-react"

const API_BASE = ""

interface PortfolioData {
  summary: { totalPortfolioValue: number; totalRevenue: number; totalNetProfit: number; totalDirectorShare: number }
  companies: Array<{
    id: number; name: string; slug: string; type: string; industry: string | null
    ownershipPercent: number; revenue: number; netProfit: number; directorShare: number; portfolioValue: number
  }>
  monthlyPnl: Array<{ month: string; revenue: number; expenses: number; profit: number }>
}

function fmtINR(n: number) {
  if (Math.abs(n) >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toFixed(0)}`
}

function MiniBarChart({ data }: { data: { month: string; revenue: number; expenses: number; profit: number }[] }) {
  const max = Math.max(...data.flatMap(d => [d.revenue, d.expenses]))
  if (max === 0) return <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
  return (
    <div className="h-44 flex items-end gap-1.5 px-2">
      {data.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex flex-col items-center gap-0.5" style={{ height: "140px", justifyContent: "flex-end" }}>
            <div
              className="w-full rounded-t-sm bg-blue-500/70"
              style={{ height: `${(d.revenue / max) * 120}px`, minHeight: d.revenue > 0 ? 4 : 0 }}
              title={`Revenue: ${fmtINR(d.revenue)}`}
            />
            <div
              className="w-full rounded-t-sm bg-red-500/50"
              style={{ height: `${(d.expenses / max) * 120}px`, minHeight: d.expenses > 0 ? 4 : 0 }}
              title={`Expenses: ${fmtINR(d.expenses)}`}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{d.month}</span>
        </div>
      ))}
    </div>
  )
}

function DonutChart({ companies }: { companies: PortfolioData["companies"] }) {
  const total = companies.reduce((s, c) => s + c.portfolioValue, 0)
  const colors = ["#2563EB", "#EC4899", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6"]
  if (total === 0) return <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>

  let cumAngle = -90
  const cx = 80, cy = 80, r = 64, innerR = 44
  const slices = companies.map((c, i) => {
    const pct = c.portfolioValue / total
    const angle = pct * 360
    const startAngle = cumAngle
    cumAngle += angle
    return { ...c, pct, startAngle, endAngle: cumAngle, color: colors[i % colors.length] }
  })

  function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    const rad = ((angle - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
    if (endAngle - startAngle >= 360) endAngle -= 0.001
    const start = polarToCartesian(cx, cy, r, endAngle)
    const end = polarToCartesian(cx, cy, r, startAngle)
    const largeArc = endAngle - startAngle > 180 ? 1 : 0
    const inner1 = polarToCartesian(cx, cy, innerR, endAngle)
    const inner2 = polarToCartesian(cx, cy, innerR, startAngle)
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} L ${inner2.x} ${inner2.y} A ${innerR} ${innerR} 0 ${largeArc} 1 ${inner1.x} ${inner1.y} Z`
  }

  return (
    <div className="flex items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {slices.map((s) => (
          <path key={s.id} d={describeArc(cx, cy, r, s.startAngle + 90, s.endAngle + 90)} fill={s.color} opacity={0.85} className="hover:opacity-100 transition-opacity cursor-pointer">
            <title>{s.name}: {(s.pct * 100).toFixed(1)}% · {fmtINR(s.portfolioValue)}</title>
          </path>
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="#94A3B8">Portfolio</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="12" fill="#F1F5F9" fontWeight="600">{fmtINR(total)}</text>
      </svg>
      <div className="flex flex-col gap-1.5 text-xs">
        {slices.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-muted-foreground truncate max-w-[90px]">{s.name}</span>
            <span className="text-foreground font-medium ml-auto pl-2">{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfitLine({ data }: { data: { month: string; profit: number }[] }) {
  const vals = data.map(d => d.profit)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const w = 300, h = 80, pad = 12
  const pts = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (w - 2 * pad),
    y: h - pad - ((d.profit - min) / range) * (h - 2 * pad),
    ...d
  }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ")
  const areaPath = `M${pts[0].x},${h - pad} ${pts.map(p => `L${p.x},${p.y}`).join(" ")} L${pts[pts.length - 1].x},${h - pad} Z`
  const isPositive = (vals[vals.length - 1] ?? 0) >= (vals[0] ?? 0)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isPositive ? "#22C55E" : "#EF4444"} stopOpacity="0.3" />
          <stop offset="100%" stopColor={isPositive ? "#22C55E" : "#EF4444"} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#profitGrad)" />
      <polyline points={polyline} fill="none" stroke={isPositive ? "#22C55E" : "#EF4444"} strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={isPositive ? "#22C55E" : "#EF4444"}>
          <title>{p.month}: {fmtINR(p.profit)}</title>
        </circle>
      ))}
      {pts.map((p, i) => (
        <text key={i} x={p.x} y={h - 2} textAnchor="middle" fontSize="8" fill="#64748B">{p.month}</text>
      ))}
    </svg>
  )
}

export default function DirectorPortal() {
  const { user } = useAuth()
  const [data, setData] = React.useState<PortfolioData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    fetch(`${API_BASE}/api/director/portfolio`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError("Failed to load portfolio data"); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}</div>
    </div>
  )

  if (error || !data) return <div className="text-destructive">{error || "No data"}</div>

  const { summary, companies, monthlyPnl } = data
  const lastProfit = monthlyPnl[monthlyPnl.length - 1]?.profit ?? 0
  const prevProfit = monthlyPnl[monthlyPnl.length - 2]?.profit ?? 0
  const profitTrend = prevProfit !== 0 ? ((lastProfit - prevProfit) / Math.abs(prevProfit)) * 100 : 0

  const kpis = [
    { label: "Portfolio Value", value: fmtINR(summary.totalPortfolioValue), icon: PieChart, color: "text-blue-400", bg: "bg-blue-500/10", sub: "Market valuation" },
    { label: "Group Revenue", value: fmtINR(summary.totalRevenue), icon: BarChart3, color: "text-teal-400", bg: "bg-teal-500/10", sub: "All subsidiaries" },
    { label: "Net Profit", value: fmtINR(summary.totalNetProfit), icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10", sub: `${profitTrend >= 0 ? "+" : ""}${profitTrend.toFixed(1)}% this month` },
    { label: "Director Earnings", value: fmtINR(summary.totalDirectorShare), icon: DollarSign, color: "text-purple-400", bg: "bg-purple-500/10", sub: "Your profit share" },
  ]

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold tracking-tight">Director Portal</h1>
          <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-500/10 capitalize">{user?.role?.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-muted-foreground">Personal portfolio overview — {user?.name}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-card/60 border-muted/50">
            <CardContent className="pt-5 pb-4">
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center mb-3`}>
                <k.icon className={`w-5 h-5 ${k.color}`} />
              </div>
              <div className="text-2xl font-bold mb-0.5">{k.value}</div>
              <div className="text-xs text-muted-foreground font-medium">{k.label}</div>
              <div className="text-[11px] text-muted-foreground/70 mt-0.5">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Portfolio Donut */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Portfolio Allocation</CardTitle>
            <CardDescription className="text-xs">Value by subsidiary</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart companies={companies.filter(c => c.type !== "parent")} />
          </CardContent>
        </Card>

        {/* Monthly Revenue/Expense Bar */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">6-Month Revenue vs Expenses</CardTitle>
            <CardDescription className="text-xs flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/70 inline-block" />Revenue</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/50 inline-block" />Expenses</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBarChart data={monthlyPnl} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profit trend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Profit Trend
              {profitTrend >= 0
                ? <span className="text-xs text-green-400 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" />+{profitTrend.toFixed(1)}%</span>
                : <span className="text-xs text-red-400 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" />{profitTrend.toFixed(1)}%</span>
              }
            </CardTitle>
            <CardDescription className="text-xs">Net profit over last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfitLine data={monthlyPnl} />
          </CardContent>
        </Card>

        {/* Company breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Shareholding Breakdown</CardTitle>
            <CardDescription className="text-xs">Your stake & earnings per company</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {companies.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{c.ownershipPercent}% stake</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, c.ownershipPercent)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">Revenue: {fmtINR(c.revenue)}</span>
                    <span className={`text-[10px] font-medium ${c.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      Your share: {fmtINR(c.directorShare)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Company Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company Performance</CardTitle>
          <CardDescription className="text-xs">Full financial breakdown across portfolio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted/50">
                  {["Company", "Industry", "Your Stake", "Revenue", "Net Profit", "Your Share", "Portfolio Value"].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs text-muted-foreground font-semibold uppercase tracking-wider first:pl-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map(c => (
                  <tr key={c.id} className="border-b border-muted/20 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 first:pl-0 font-medium">{c.name}</td>
                    <td className="py-3 px-3 text-muted-foreground">{c.industry ?? "—"}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" className="text-xs">{c.ownershipPercent}%</Badge>
                    </td>
                    <td className="py-3 px-3">{fmtINR(c.revenue)}</td>
                    <td className={`py-3 px-3 font-medium ${c.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtINR(c.netProfit)}</td>
                    <td className="py-3 px-3 font-semibold text-purple-400">{fmtINR(c.directorShare)}</td>
                    <td className="py-3 px-3 font-bold">{fmtINR(c.portfolioValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
