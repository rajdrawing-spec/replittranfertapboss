import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Sparkles, Image as ImageIcon, Download, Printer, TrendingUp, TrendingDown } from "lucide-react"
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts"

/* ------------------------------ shared ------------------------------ */

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(`Failed (${r.status})`)
  return r.json()
}

const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN")
const fmtNum = (n: number) => n.toLocaleString("en-IN")
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const toYMD = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "custom"

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
]

function rangeToDates(key: RangeKey, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date()
  const today = toYMD(now)
  switch (key) {
    case "today": return { from: today, to: today }
    case "yesterday": {
      const y = new Date(now.getTime() - 86400000)
      return { from: toYMD(y), to: toYMD(y) }
    }
    case "7d": return { from: toYMD(new Date(now.getTime() - 6 * 86400000)), to: today }
    case "30d": return { from: toYMD(new Date(now.getTime() - 29 * 86400000)), to: today }
    case "this_month": return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toYMD(first), to: toYMD(last) }
    }
    case "custom": return custom
  }
}

function useDateRange() {
  const [key, setKey] = React.useState<RangeKey>("30d")
  const [custom, setCustom] = React.useState({ from: toYMD(new Date(Date.now() - 29 * 86400000)), to: toYMD(new Date()) })
  const dates = rangeToDates(key, custom)
  return { key, setKey, custom, setCustom, dates }
}

function DateRangePicker({ range }: { range: ReturnType<typeof useDateRange> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={range.key} onValueChange={(v) => range.setKey(v as RangeKey)}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {range.key === "custom" && (
        <>
          <Input type="date" className="w-38" value={range.custom.from}
            onChange={(e) => range.setCustom({ ...range.custom, from: e.target.value })} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="w-38" value={range.custom.to}
            onChange={(e) => range.setCustom({ ...range.custom, to: e.target.value })} />
        </>
      )}
    </div>
  )
}

function Loading() {
  return <div className="flex h-40 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
}
function ErrorState() {
  return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Couldn't load this data. Try refreshing.</div>
}
function Empty({ text }: { text: string }) {
  return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{text}</div>
}

function Pager({ p, onPage }: { p: { page: number; totalPages: number; total: number } | undefined; onPage: (n: number) => void }) {
  if (!p || p.totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-3 text-sm">
      <span className="text-muted-foreground">{p.total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}>Previous</Button>
        <span className="text-muted-foreground">Page {p.page} / {p.totalPages}</span>
        <Button variant="outline" size="sm" disabled={p.page >= p.totalPages} onClick={() => onPage(p.page + 1)}>Next</Button>
      </div>
    </div>
  )
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return null
  const up = value >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? "text-green-500" : "text-red-500"}`}>
      <Icon className="h-3 w-3" /> {Math.abs(value).toFixed(0)}%
    </span>
  )
}

/* ------------------------------ overview ------------------------------ */

// KPI fields are OPTIONAL — the server removes any metric the super admin
// has hidden for this project, so render only what's present.
interface Overview {
  kpis: { revenue?: number; orders?: number; leads?: number; conversionRate?: number | null; aov?: number }
  campaignLifetime: { adSpend?: number; roas?: number | null; cpl?: number | null; cpa?: number | null }
  comparison: { revenue?: number | null; orders?: number | null; leads?: number | null }
  timeseries: { period: string; revenue?: number; orders?: number; leads?: number }[]
}

export function OverviewSection({ projectId }: { projectId: number }) {
  const range = useDateRange()
  const [group, setGroup] = React.useState("day")
  const { from, to } = range.dates
  const { data, isLoading, isError } = useQuery<Overview>({
    queryKey: ["/api/client/marketing/projects", projectId, "overview", from, to, group],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/overview?from=${from}&to=${to}&group=${group}`),
  })

  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState />

  const k = data.kpis
  const cl = data.campaignLifetime
  // Range-scoped cards (orders & leads are dated rows); campaign metrics below
  // are lifetime running totals since campaigns store no dated snapshots.
  const cards = [
    k.revenue !== undefined && { label: "Net Revenue", help: "Orders in period, minus cancellations & returns", value: fmtINR(k.revenue), delta: data.comparison.revenue ?? null },
    k.orders !== undefined && { label: "Net Orders", help: "Orders in period excluding cancellations & returns", value: fmtNum(k.orders), delta: data.comparison.orders ?? null },
    k.leads !== undefined && { label: "Leads", help: "New enquiries in this period", value: fmtNum(k.leads), delta: data.comparison.leads ?? null },
    k.conversionRate !== undefined && { label: "Conversion Rate", help: "Share of period leads that converted", value: k.conversionRate != null ? `${k.conversionRate.toFixed(1)}%` : "—", delta: null },
    k.aov !== undefined && { label: "Avg Order Value", help: "Average net revenue per order in period", value: fmtINR(k.aov), delta: null },
    cl.adSpend !== undefined && { label: "Ad Spend (lifetime)", help: "Total ever spent across your campaigns", value: fmtINR(cl.adSpend), delta: null },
    cl.roas !== undefined && { label: "ROAS (lifetime)", help: "Campaign revenue per ₹1 of ad spend, all time", value: cl.roas != null ? `${cl.roas.toFixed(2)}x` : "—", delta: null },
    cl.cpl !== undefined && { label: "Cost / Lead (lifetime)", help: "Lifetime ad spend ÷ lifetime campaign leads", value: cl.cpl != null ? fmtINR(cl.cpl) : "—", delta: null },
  ].filter(Boolean) as { label: string; help: string; value: string; delta: number | null }[]

  const hasRevenue = data.timeseries.some((t) => t.revenue !== undefined) || k.revenue !== undefined
  const hasOrders = k.orders !== undefined
  const hasLeads = k.leads !== undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker range={range} />
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Daily</SelectItem>
            <SelectItem value="week">Weekly</SelectItem>
            <SelectItem value="month">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <Delta value={c.delta} />
            </div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.help}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="mb-4 font-semibold">Revenue, orders & leads over time</h3>
        {data.timeseries.length === 0 ? (
          <Empty text="No activity in this period yet." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.timeseries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" fontSize={11} />
                <YAxis yAxisId="rev" fontSize={11} tickFormatter={(v: number) => `₹${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                <YAxis yAxisId="count" orientation="right" fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v: number, name: string) => name === "revenue" ? fmtINR(v) : fmtNum(v)} />
                <Legend />
                {hasRevenue && <Bar yAxisId="rev" dataKey="revenue" name="Revenue" fill="#22c55e" radius={[3, 3, 0, 0]} />}
                {hasOrders && <Line yAxisId="count" dataKey="orders" name="Orders" stroke="#3b82f6" strokeWidth={2} dot={false} />}
                {hasLeads && <Line yAxisId="count" dataKey="leads" name="Leads" stroke="#a855f7" strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------ campaigns ------------------------------ */

interface ClientCampaign {
  id: number; name: string; channel: string; status: string
  spend: number; impressions: number; clicks: number; ctr: number | null
  leads: number; conversions: number; revenue: number; roas: number | null
}

export function CampaignsSection({ projectId }: { projectId: number }) {
  const [page, setPage] = React.useState(1)
  const { data, isLoading, isError } = useQuery<{ campaigns: ClientCampaign[]; pagination: any }>({
    queryKey: ["/api/client/marketing/projects", projectId, "campaigns", page],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/campaigns?page=${page}`),
  })

  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState />
  if (data.campaigns.length === 0 && page === 1) return <Empty text="No campaigns have been shared with you yet." />

  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-xs text-muted-foreground">Campaign performance shows lifetime totals since launch.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Impressions</th>
              <th className="px-3 py-2 text-right font-medium">Clicks</th>
              <th className="px-3 py-2 text-right font-medium">CTR</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">Conv.</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              <th className="py-2 pl-3 text-right font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {data.campaigns.map((c) => (
              <tr key={c.id} className="border-b border-border/50">
                <td className="py-2 pr-4">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs uppercase text-muted-foreground">{c.channel}</div>
                </td>
                <td className="px-3 py-2"><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{c.status}</span></td>
                <td className="px-3 py-2 text-right">{fmtINR(c.spend)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(c.impressions)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(c.clicks)}</td>
                <td className="px-3 py-2 text-right">{c.ctr != null ? `${c.ctr.toFixed(1)}%` : "—"}</td>
                <td className="px-3 py-2 text-right">{fmtNum(c.leads)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(c.conversions)}</td>
                <td className="px-3 py-2 text-right text-green-500">{fmtINR(c.revenue)}</td>
                <td className={`py-2 pl-3 text-right font-semibold ${c.roas == null ? "text-muted-foreground" : c.roas >= 1 ? "text-green-500" : "text-red-500"}`}>
                  {c.roas != null ? `${c.roas.toFixed(2)}x` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager p={data.pagination} onPage={setPage} />
    </div>
  )
}

/* ------------------------------ sales ------------------------------ */

interface SalesData {
  stats: { totalOrders: number; netOrders: number; cancelledOrders: number; returnedOrders: number; revenue: number; aov: number }
  orders: { id: number; orderNumber: string; date: string; itemCount: number; totalAmount: number; status: string; channel: string }[]
  pagination: any
}

export function SalesSection({ projectId }: { projectId: number }) {
  const range = useDateRange()
  const [page, setPage] = React.useState(1)
  const { from, to } = range.dates
  const { data, isLoading, isError } = useQuery<SalesData>({
    queryKey: ["/api/client/marketing/projects", projectId, "sales", from, to, page],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/sales?from=${from}&to=${to}&page=${page}`),
  })

  const stats = data?.stats
  const cards = stats ? [
    { label: "Orders", value: fmtNum(stats.totalOrders) },
    { label: "Net Orders", value: fmtNum(stats.netOrders) },
    { label: "Cancelled", value: fmtNum(stats.cancelledOrders) },
    { label: "Returned / Refunded", value: fmtNum(stats.returnedOrders) },
    { label: "Net Revenue", value: fmtINR(stats.revenue) },
    { label: "Avg Order Value", value: fmtINR(stats.aov) },
  ] : []

  return (
    <div className="space-y-6">
      <DateRangePicker range={range} />
      {isLoading ? <Loading /> : isError || !data ? <ErrorState /> : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {cards.map((c) => (
              <div key={c.label} className="rounded-lg border p-4">
                <div className="text-xl font-bold">{c.value}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
          {data.orders.length === 0 ? <Empty text="No orders in this period." /> : (
            <div className="rounded-lg border p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Order</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Items</th>
                      <th className="px-3 py-2 text-right font-medium">Value</th>
                      <th className="px-3 py-2 font-medium">Channel</th>
                      <th className="py-2 pl-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-mono text-xs">{o.orderNumber}</td>
                        <td className="px-3 py-2">{new Date(o.date).toLocaleDateString("en-IN")}</td>
                        <td className="px-3 py-2 text-right">{o.itemCount}</td>
                        <td className="px-3 py-2 text-right">{fmtINR(o.totalAmount)}</td>
                        <td className="px-3 py-2 capitalize">{o.channel}</td>
                        <td className="py-2 pl-3"><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager p={data.pagination} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------ leads ------------------------------ */

interface ClientLead { id: number; name: string; source: string | null; status: string; value: number; createdAt: string; campaign: string | null }

export function LeadsSection({ projectId }: { projectId: number }) {
  const [page, setPage] = React.useState(1)
  const { data, isLoading, isError } = useQuery<{ leads: ClientLead[]; pagination: any }>({
    queryKey: ["/api/client/marketing/projects", projectId, "leads", page],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/leads?page=${page}`),
  })

  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState />
  if (data.leads.length === 0 && page === 1) return <Empty text="No leads have been shared with you yet." />

  return (
    <div className="rounded-lg border p-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Campaign</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="py-2 pl-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((l) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-2 pr-4 font-medium">{l.name}</td>
                <td className="px-3 py-2 capitalize">{l.source ?? "—"}</td>
                <td className="px-3 py-2">{l.campaign ?? "—"}</td>
                <td className="px-3 py-2">{new Date(l.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="py-2 pl-3"><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{l.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager p={data.pagination} onPage={setPage} />
    </div>
  )
}

/* ------------------------------ creatives ------------------------------ */

interface ClientCreative { id: number; name: string; type: string; format: string | null; url: string | null; thumbnailUrl: string | null; status: string; createdAt: string }

export function CreativesSection({ projectId }: { projectId: number }) {
  const [page, setPage] = React.useState(1)
  const { data, isLoading, isError } = useQuery<{ creatives: ClientCreative[]; pagination: any }>({
    queryKey: ["/api/client/marketing/projects", projectId, "creatives", page],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/creatives?page=${page}`),
  })

  if (isLoading) return <Loading />
  if (isError || !data) return <ErrorState />
  if (data.creatives.length === 0 && page === 1) return <Empty text="No approved creatives yet." />

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.creatives.map((c) => {
          // Client users can't reach internal /storage routes — assets are
          // served through the project-authorized creative asset endpoint.
          const hasPreview = !!(c.thumbnailUrl || (c.type === "image" && c.url))
          const preview = hasPreview ? `/api/client/marketing/projects/${projectId}/creatives/${c.id}/asset?thumb=1` : undefined
          return (
            <div key={c.id} className="overflow-hidden rounded-lg border">
              <div className="flex h-36 items-center justify-center bg-muted">
                {preview ? <img src={preview} alt={c.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-8 w-8 text-muted-foreground/40" />}
              </div>
              <div className="space-y-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{cap(c.type)}{c.format ? ` · ${cap(c.format)}` : ""}</div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{c.status}</span>
                </div>
                {c.url && (
                  <a href={`/api/client/marketing/projects/${projectId}/creatives/${c.id}/asset?download=1`}
                    target="_blank" rel="noopener noreferrer" download
                    className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <Pager p={data.pagination} onPage={setPage} />
    </div>
  )
}

/* ------------------------------ reports ------------------------------ */

// KPI/comparison fields are optional — the server strips hidden metrics.
interface Report {
  project: { id: number; name: string; brandName: string }
  range: { from: string; to: string }
  kpis: { revenue?: number; orders?: number; aov?: number; leads?: number }
  campaignLifetime: { adSpend?: number; roas?: number | null; impressions?: number; clicks?: number; ctr?: number | null }
  bestCampaign: { name: string; channel: string; spend: number; revenue: number; roas: number | null } | null
  worstCampaign: { name: string; channel: string; spend: number; revenue: number; roas: number | null } | null
  comparison: { revenue?: { current: number; previous: number; change: number | null }; orders?: { current: number; previous: number; change: number | null } }
  generatedAt: string
}

export function ReportsSection({ projectId }: { projectId: number }) {
  const range = useDateRange()
  const { from, to } = range.dates
  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ["/api/client/marketing/projects", projectId, "report", from, to],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/report?from=${from}&to=${to}`),
  })

  function printReport() {
    const el = document.getElementById("client-report")
    if (!el) return
    const win = window.open("", "_blank")
    if (!win) return
    const styleTags = Array.from(document.querySelectorAll("style")).map((s) => s.outerHTML).join("")
    const linkTags = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => (l as HTMLLinkElement).outerHTML).join("")
    win.document.write(`<html><head><title>Marketing Report</title>${linkTags}${styleTags}
      <style>html,body{background:#fff!important;color:#111}@page{margin:12mm;size:A4}</style></head><body>`)
    win.document.write(el.outerHTML)
    win.document.write("</body></html>")
    win.document.close()
    setTimeout(() => { win.focus(); win.print(); win.close() }, 600)
  }

  if (isLoading) return <div className="space-y-4"><DateRangePicker range={range} /><Loading /></div>
  if (isError || !data) return <div className="space-y-4"><DateRangePicker range={range} /><ErrorState /></div>

  const k = data.kpis
  const cl = data.campaignLifetime
  const fmtPeriod = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  const kpiRows = [
    k.revenue !== undefined && { label: "Net Revenue", value: fmtINR(k.revenue) },
    k.orders !== undefined && { label: "Net Orders", value: fmtNum(k.orders) },
    k.aov !== undefined && { label: "Avg Order Value", value: fmtINR(k.aov) },
    k.leads !== undefined && { label: "Leads", value: fmtNum(k.leads) },
    cl.adSpend !== undefined && { label: "Ad Spend (lifetime)", value: fmtINR(cl.adSpend) },
    cl.roas !== undefined && { label: "ROAS (lifetime)", value: cl.roas != null ? `${cl.roas.toFixed(2)}x` : "—" },
    cl.impressions !== undefined && { label: "Impressions (lifetime)", value: fmtNum(cl.impressions) },
    cl.clicks !== undefined && { label: "Clicks (lifetime)", value: fmtNum(cl.clicks) },
    cl.ctr !== undefined && { label: "CTR (lifetime)", value: cl.ctr != null ? `${cl.ctr.toFixed(1)}%` : "—" },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker range={range} />
        <Button variant="outline" onClick={printReport}><Printer className="mr-2 h-4 w-4" /> Print / Save PDF</Button>
      </div>

      <div id="client-report" className="rounded-lg border bg-background p-6">
        <div className="mb-6 border-b pb-4">
          <h2 className="text-xl font-bold">{data.project.brandName} — Marketing Report</h2>
          <p className="text-sm text-muted-foreground">{fmtPeriod(data.range.from)} → {fmtPeriod(data.range.to)}</p>
        </div>

        <h3 className="mb-3 font-semibold">Key metrics</h3>
        <div className="mb-6 grid grid-cols-3 gap-3">
          {kpiRows.map((r) => (
            <div key={r.label} className="rounded border p-3">
              <div className="text-lg font-bold">{r.value}</div>
              <div className="text-xs text-muted-foreground">{r.label}</div>
            </div>
          ))}
        </div>

        <h3 className="mb-3 font-semibold">Period comparison</h3>
        <table className="mb-6 w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Metric</th><th className="py-2 text-right font-medium">This period</th>
            <th className="py-2 text-right font-medium">Previous period</th><th className="py-2 text-right font-medium">Change</th>
          </tr></thead>
          <tbody>
            {data.comparison.revenue && (
              <tr className="border-b border-border/50">
                <td className="py-2">Revenue</td>
                <td className="py-2 text-right">{fmtINR(data.comparison.revenue.current)}</td>
                <td className="py-2 text-right">{fmtINR(data.comparison.revenue.previous)}</td>
                <td className="py-2 text-right">{data.comparison.revenue.change != null ? `${data.comparison.revenue.change.toFixed(0)}%` : "—"}</td>
              </tr>
            )}
            {data.comparison.orders && (
              <tr>
                <td className="py-2">Orders</td>
                <td className="py-2 text-right">{fmtNum(data.comparison.orders.current)}</td>
                <td className="py-2 text-right">{fmtNum(data.comparison.orders.previous)}</td>
                <td className="py-2 text-right">{data.comparison.orders.change != null ? `${data.comparison.orders.change.toFixed(0)}%` : "—"}</td>
              </tr>
            )}
          </tbody>
        </table>

        <h3 className="mb-3 font-semibold">Campaign highlights <span className="text-xs font-normal text-muted-foreground">(lifetime totals)</span></h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[{ label: "Best performing", c: data.bestCampaign }, { label: "Needs attention", c: data.worstCampaign }].map(({ label, c }) => (
            <div key={label} className="rounded border p-4">
              <div className="text-xs uppercase text-muted-foreground">{label}</div>
              {c ? (
                <>
                  <div className="mt-1 font-medium">{c.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Spend {fmtINR(c.spend)} · Revenue {fmtINR(c.revenue)} · ROAS {c.roas != null ? `${c.roas.toFixed(2)}x` : "—"}
                  </div>
                </>
              ) : <div className="mt-1 text-sm text-muted-foreground">Not enough campaign data yet.</div>}
            </div>
          ))}
        </div>

        <div className="mt-6 border-t pt-3 text-xs text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString("en-IN")} · TapasHub Client Portal
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ AI plan ------------------------------ */

interface AiPlanInsights {
  observed?: { working?: string[]; underperforming?: string[] }
  likelyReasons?: string[]
  recommendations?: { campaigns?: string[]; creatives?: string[]; budget?: string[]; lead_gen?: string[] }
}
interface AiPlanEntry7 { day: string; focus: string; actions: string[] }
interface AiPlanEntry30 { week: string; focus: string; actions: string[] }
interface AiPlan {
  id: number
  status: string
  insights: AiPlanInsights | null
  plan7: AiPlanEntry7[] | null
  plan30: AiPlanEntry30[] | null
  summary: string | null
  createdAt: string
  updatedAt: string
}

export function AiPlanSection({ projectId }: { projectId: number }) {
  const [generating, setGenerating] = React.useState(false)
  const [genError, setGenError] = React.useState<string | null>(null)
  const query = useQuery<{ plan: AiPlan | null; pendingReview: boolean }>({
    queryKey: ["/api/client/marketing/projects", projectId, "ai-plan"],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/ai-plan`),
  })

  async function generate() {
    setGenerating(true); setGenError(null)
    try {
      const r = await fetch(`/api/client/marketing/projects/${projectId}/ai-plan/generate`, {
        method: "POST", credentials: "include",
      })
      if (!r.ok) {
        const body = await r.json().catch(() => null)
        throw new Error(body?.error ?? `Failed (${r.status})`)
      }
      await query.refetch()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed")
    } finally { setGenerating(false) }
  }

  if (query.isLoading) return <Loading />
  if (query.isError || !query.data) return <ErrorState />
  const { plan, pendingReview } = query.data
  const ins = plan?.insights ?? null

  const List = ({ title, items, tone }: { title: string; items?: string[]; tone?: "good" | "bad" | "muted" }) =>
    !items || items.length === 0 ? null : (
      <div className="rounded-lg border p-4">
        <h4 className={`mb-2 text-sm font-semibold ${tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-600" : ""}`}>{title}</h4>
        <ul className="space-y-1.5 text-sm">
          {items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{it}</span></li>)}
        </ul>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          AI analysis based only on your brand's shared marketing data.
          {plan && <> Last updated {new Date(plan.updatedAt).toLocaleString("en-IN")}.</>}
        </p>
        <Button onClick={generate} disabled={generating}>
          <Sparkles className="mr-2 h-4 w-4" />{generating ? "Analysing…" : plan ? "Regenerate plan" : "Generate plan"}
        </Button>
      </div>
      {genError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{genError}</div>}
      {pendingReview && (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
          A new plan is being reviewed by your team and will appear here once approved.
        </div>
      )}

      {!plan ? (
        !pendingReview && (
          <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No AI plan yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">Generate an analysis of what's working, what isn't, and a 7-day & 30-day action plan.</p>
          </div>
        )
      ) : (
        <>
          {plan.summary && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">{plan.summary}</div>
          )}

          <div>
            <h3 className="mb-3 font-semibold">What the data shows</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              <List title="Working well" items={ins?.observed?.working} tone="good" />
              <List title="Underperforming" items={ins?.observed?.underperforming} tone="bad" />
            </div>
          </div>

          <List title="Possible reasons (AI hypotheses — not verified)" items={ins?.likelyReasons} tone="muted" />

          <div>
            <h3 className="mb-3 font-semibold">Recommendations</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              <List title="Campaigns" items={ins?.recommendations?.campaigns} />
              <List title="Creatives" items={ins?.recommendations?.creatives} />
              <List title="Budget" items={ins?.recommendations?.budget} />
              <List title="Lead generation" items={ins?.recommendations?.lead_gen} />
            </div>
          </div>

          {plan.plan7 && plan.plan7.length > 0 && (
            <div>
              <h3 className="mb-3 font-semibold">Next 7 days</h3>
              <div className="space-y-2">
                {plan.plan7.map((d, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="text-sm font-medium">{d.day} — {d.focus}</div>
                    <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                      {(d.actions ?? []).map((a, j) => <li key={j}>• {a}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.plan30 && plan.plan30.length > 0 && (
            <div>
              <h3 className="mb-3 font-semibold">30-day roadmap</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {plan.plan30.map((w, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="text-sm font-medium">{w.week} — {w.focus}</div>
                    <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                      {(w.actions ?? []).map((a, j) => <li key={j}>• {a}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            AI-generated recommendations are suggestions based on your shared data — discuss with your account team before major changes.
          </p>
        </>
      )}
    </div>
  )
}

/* ------------------------------ placeholder ------------------------------ */

export function ComingSoon() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
      <Sparkles className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">Coming soon</p>
      <p className="max-w-sm text-sm text-muted-foreground">This dashboard is being prepared by the team.</p>
    </div>
  )
}
