import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUpload } from "@workspace/object-storage-web"
import {
  Plus, Megaphone, TrendingUp, Target, Users, Pencil, Trash2, IndianRupee,
  BarChart3, Image as ImageIcon, CalendarDays, GitBranch, Upload, ExternalLink,
  ChevronLeft, ChevronRight, Film, FileText, LayoutGrid,
} from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface Campaign {
  id: number; companyId: number; name: string; channel: string; objective: string | null; status: string
  budget: number; spent: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number
  startDate: string | null; endDate: string | null
}
interface Creative {
  id: number; companyId: number; campaignId: number | null; name: string; type: string
  format: string | null; url: string | null; thumbnailUrl: string | null; status: string; notes: string | null
}
interface Lead {
  id: number; companyId: number; campaignId: number | null; name: string; email: string | null; phone: string | null
  source: string | null; status: string; value: number; notes: string | null
}
interface PerfCampaign { id: number; name: string; channel: string; status: string; budget: number; spent: number; revenue: number; conversions: number; leads: number; roi: number | null }
interface PerfChannel { channel: string; budget: number; spent: number; revenue: number; conversions: number; leads: number; count: number; roi: number | null }
interface Performance {
  totals: { budget: number; spent: number; revenue: number; conversions: number; leads: number; campaignCount: number; roi: number | null }
  channels: PerfChannel[]
  campaigns: PerfCampaign[]
}

const CHANNELS = ["meta", "google", "instagram", "facebook", "whatsapp", "email"]
const OBJECTIVES = ["awareness", "traffic", "leads", "conversions", "sales"]
const STATUSES = ["draft", "active", "paused", "completed"]
const CREATIVE_TYPES = ["image", "video", "copy", "carousel"]
const CREATIVE_FORMATS = ["story", "reel", "post", "banner", "email"]
const CREATIVE_STATUSES = ["draft", "approved", "live", "archived"]
const LEAD_SOURCES = ["meta", "google", "instagram", "facebook", "whatsapp", "email", "referral"]
const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"]

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  approved: "bg-green-500/10 text-green-400 border-green-500/20",
  live: "bg-primary/10 text-primary border-primary/20",
  archived: "bg-muted text-muted-foreground",
  new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  contacted: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  qualified: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  converted: "bg-green-500/10 text-green-400 border-green-500/20",
  lost: "bg-red-500/10 text-red-400 border-red-500/20",
}
const CHANNEL_COLORS: Record<string, string> = {
  meta: "bg-blue-600/10 text-blue-400", google: "bg-red-500/10 text-red-400",
  instagram: "bg-pink-500/10 text-pink-400", facebook: "bg-indigo-500/10 text-indigo-400",
  whatsapp: "bg-green-500/10 text-green-400", email: "bg-amber-500/10 text-amber-400",
  referral: "bg-teal-500/10 text-teal-400", other: "bg-muted text-muted-foreground",
}
const CREATIVE_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon, video: Film, copy: FileText, carousel: LayoutGrid,
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN")
const fmtROI = (roi: number | null) => (roi == null ? "—" : `${(roi * 100).toFixed(0)}%`)

// Assets stored via object storage return an /objects path served by the storage API.
function assetSrc(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith("/objects")) return `/api/storage${url}`
  return url
}

export default function Marketing() {
  const { activeCompany, isParentView } = useCompany()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="w-6 h-6 text-primary" /> Marketing Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">{isParentView ? "Campaign performance across all brands" : `${activeCompany?.name ?? "Your brand"} campaigns, creatives, leads & ROI`}</p>
      </div>

      <Tabs defaultValue="performance" className="space-y-6">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="performance"><BarChart3 className="w-4 h-4 mr-1.5" /> Performance</TabsTrigger>
          <TabsTrigger value="campaigns"><Target className="w-4 h-4 mr-1.5" /> Campaigns</TabsTrigger>
          <TabsTrigger value="creatives"><ImageIcon className="w-4 h-4 mr-1.5" /> Creative Library</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="w-4 h-4 mr-1.5" /> Calendar</TabsTrigger>
          <TabsTrigger value="leads"><GitBranch className="w-4 h-4 mr-1.5" /> Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="performance"><PerformanceTab /></TabsContent>
        <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
        <TabsContent value="creatives"><CreativesTab /></TabsContent>
        <TabsContent value="calendar"><CalendarTab /></TabsContent>
        <TabsContent value="leads"><LeadsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

/* ============================ Performance ============================ */

function PerformanceTab() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [perf, setPerf] = React.useState<Performance | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    const p = new URLSearchParams()
    if (activeCompany) p.set("companyId", String(activeCompany.id))
    fetch(`/api/marketing/performance?${p}`, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => { if (active) setPerf(d) })
      .catch(() => toast({ title: "Failed to load performance", variant: "destructive" }))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeCompany, toast])

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading analytics…</div>
  if (!perf || perf.totals.campaignCount === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No campaign data yet. Create campaigns to see performance.</CardContent></Card>
  }

  const t = perf.totals
  const stats = [
    { l: "Budget", v: fmtINR(t.budget), sub: `${t.campaignCount} campaigns`, icon: IndianRupee, c: "text-blue-400" },
    { l: "Ad Spend", v: fmtINR(t.spent), sub: t.budget > 0 ? `${Math.round((t.spent / t.budget) * 100)}% of budget` : "—", icon: TrendingUp, c: "text-orange-400" },
    { l: "Revenue", v: fmtINR(t.revenue), sub: `ROI ${fmtROI(t.roi)}`, icon: IndianRupee, c: "text-green-400" },
    { l: "Conversions", v: t.conversions.toLocaleString("en-IN"), sub: `${t.leads.toLocaleString("en-IN")} leads`, icon: Users, c: "text-purple-400" },
  ]
  const maxSpent = Math.max(...perf.channels.map((c) => c.spent), 1)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.l}><CardContent className="p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{s.l}</span><s.icon className={`w-4 h-4 ${s.c}`} /></div>
            <div className="text-2xl font-bold mt-1">{s.v}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> Channel Breakdown</h3>
        {perf.channels.length === 0 ? (
          <div className="text-sm text-muted-foreground">No channel data.</div>
        ) : (
          <div className="space-y-4">
            {perf.channels.map((ch) => (
              <div key={ch.channel}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${CHANNEL_COLORS[ch.channel] || "bg-muted"}`}>{ch.channel}</span>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Spend {fmtINR(ch.spent)}</span>
                    <span>Rev {fmtINR(ch.revenue)}</span>
                    <span className={ch.roi == null ? "" : ch.roi >= 0 ? "text-green-400" : "text-red-400"}>ROI {fmtROI(ch.roi)}</span>
                  </div>
                </div>
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${(ch.spent / maxSpent) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Campaign ROI</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 pr-4 font-medium">Campaign</th>
              <th className="py-2 px-4 font-medium">Channel</th>
              <th className="py-2 px-4 font-medium text-right">Spent</th>
              <th className="py-2 px-4 font-medium text-right">Revenue</th>
              <th className="py-2 pl-4 font-medium text-right">ROI</th>
            </tr></thead>
            <tbody>
              {perf.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium">{c.name}</td>
                  <td className="py-2 px-4"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${CHANNEL_COLORS[c.channel] || "bg-muted"}`}>{c.channel}</span></td>
                  <td className="py-2 px-4 text-right">{fmtINR(c.spent)}</td>
                  <td className="py-2 px-4 text-right text-green-400">{fmtINR(c.revenue)}</td>
                  <td className={`py-2 pl-4 text-right font-semibold ${c.roi == null ? "text-muted-foreground" : c.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtROI(c.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  )
}

/* ============================ Campaigns ============================ */

interface CampForm { name: string; channel: string; objective: string; status: string; budget: string; spent: string; leads: string; conversions: string; revenue: string; impressions: string; clicks: string; startDate: string; endDate: string }
const emptyCampForm = (): CampForm => ({ name: "", channel: "meta", objective: "conversions", status: "active", budget: "", spent: "0", leads: "0", conversions: "0", revenue: "0", impressions: "0", clicks: "0", startDate: "", endDate: "" })
const toDateInput = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "")

function CampaignsTab() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Campaign[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Campaign | null>(null)
  const [form, setForm] = React.useState<CampForm>(emptyCampForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      const c = await fetch(`/api/campaigns?${p}`, { credentials: "include" }).then((r) => r.json())
      setRows(c)
    } catch { toast({ title: "Failed to load campaigns", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, toast])

  React.useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm(emptyCampForm()); setShowDialog(true) }
  function openEdit(c: Campaign) {
    setEditing(c)
    setForm({ name: c.name, channel: c.channel, objective: c.objective ?? "conversions", status: c.status, budget: String(c.budget), spent: String(c.spent), leads: String(c.leads), conversions: String(c.conversions), revenue: String(c.revenue), impressions: String(c.impressions), clicks: String(c.clicks), startDate: toDateInput(c.startDate), endDate: toDateInput(c.endDate) })
    setShowDialog(true)
  }
  async function save() {
    if (!form.name) { toast({ title: "Campaign name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const num = (v: string) => (v ? parseFloat(v) : 0)
      const body: Record<string, unknown> = {
        name: form.name, channel: form.channel, objective: form.objective, status: form.status,
        budget: num(form.budget), spent: num(form.spent), leads: num(form.leads), conversions: num(form.conversions),
        revenue: num(form.revenue), impressions: num(form.impressions), clicks: num(form.clicks),
        startDate: form.startDate || null, endDate: form.endDate || null,
      }
      if (!editing) body.companyId = activeCompany!.id
      const res = await fetch(editing ? `/api/campaigns/${editing.id}` : "/api/campaigns", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Campaign updated" : "Campaign created" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Delete this campaign?")) return
    try { await fetch(`/api/campaigns/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Deleted" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> New Campaign</Button></div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading campaigns…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No campaigns yet.</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((c) => {
            const roas = c.spent > 0 ? c.revenue / c.spent : 0
            const pct = c.budget > 0 ? Math.min(100, (c.spent / c.budget) * 100) : 0
            return (
              <Card key={c.id} className="group hover:border-primary/40 transition-colors">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${CHANNEL_COLORS[c.channel] || "bg-muted"}`}>{c.channel}</span>
                        {c.objective && <span className="text-xs text-muted-foreground">{cap(c.objective)}</span>}
                      </div>
                    </div>
                    <Badge variant="outline" className={STATUS_COLORS[c.status]}>{cap(c.status)}</Badge>
                  </div>

                  {(c.startDate || c.endDate) && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {c.startDate ? new Date(c.startDate).toLocaleDateString("en-IN") : "—"} → {c.endDate ? new Date(c.endDate).toLocaleDateString("en-IN") : "—"}
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{fmtINR(c.spent)} spent</span><span className="text-muted-foreground">{fmtINR(c.budget)}</span></div>
                    <Progress value={pct} className="h-1.5" />
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><div className="text-sm font-bold">{c.leads}</div><div className="text-[10px] text-muted-foreground">Leads</div></div>
                    <div><div className="text-sm font-bold">{c.conversions}</div><div className="text-[10px] text-muted-foreground">Conv.</div></div>
                    <div><div className="text-sm font-bold text-green-400">{fmtINR(c.revenue)}</div><div className="text-[10px] text-muted-foreground">Revenue</div></div>
                    <div><div className={`text-sm font-bold ${roas >= 1 ? "text-green-400" : "text-red-400"}`}>{c.spent > 0 ? `${roas.toFixed(1)}x` : "—"}</div><div className="text-[10px] text-muted-foreground">ROAS</div></div>
                  </div>

                  <div className="flex gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                    <Button variant="outline" size="sm" className="text-red-400" onClick={() => del(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Campaign" : "New Campaign"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Channel</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{cap(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Objective</Label>
              <Select value={form.objective} onValueChange={(v) => setForm({ ...form, objective: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OBJECTIVES.map((o) => <SelectItem key={o} value={o}>{cap(o)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><Label>End Date</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            <div><Label>Budget (₹)</Label><Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
            <div><Label>Spent (₹)</Label><Input type="number" value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} /></div>
            <div><Label>Leads</Label><Input type="number" value={form.leads} onChange={(e) => setForm({ ...form, leads: e.target.value })} /></div>
            <div><Label>Conversions</Label><Input type="number" value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} /></div>
            <div><Label>Revenue (₹)</Label><Input type="number" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} /></div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{cap(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================ Creative Library ============================ */

interface CreativeForm { name: string; type: string; format: string; status: string; url: string; thumbnailUrl: string; notes: string; campaignId: string }
const emptyCreativeForm = (): CreativeForm => ({ name: "", type: "image", format: "post", status: "draft", url: "", thumbnailUrl: "", notes: "", campaignId: "none" })

function CreativesTab() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Creative[]>([])
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Creative | null>(null)
  const [form, setForm] = React.useState<CreativeForm>(emptyCreativeForm())
  const [saving, setSaving] = React.useState(false)

  const { uploadFile, isUploading } = useUpload({
    onError: (e) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      const [cr, cs] = await Promise.all([
        fetch(`/api/marketing/creatives?${p}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/campaigns?${p}`, { credentials: "include" }).then((r) => r.json()),
      ])
      setRows(cr); setCampaigns(cs)
    } catch { toast({ title: "Failed to load creatives", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, toast])

  React.useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm(emptyCreativeForm()); setShowDialog(true) }
  function openEdit(c: Creative) {
    setEditing(c)
    setForm({ name: c.name, type: c.type, format: c.format ?? "post", status: c.status, url: c.url ?? "", thumbnailUrl: c.thumbnailUrl ?? "", notes: c.notes ?? "", campaignId: c.campaignId ? String(c.campaignId) : "none" })
    setShowDialog(true)
  }
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const res = await uploadFile(file)
    if (res) setForm((f) => ({ ...f, url: res.objectPath }))
    e.target.value = ""
  }
  async function save() {
    if (!form.name) { toast({ title: "Creative name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name, type: form.type, format: form.format, status: form.status,
        url: form.url || null, thumbnailUrl: form.thumbnailUrl || null, notes: form.notes || null,
        campaignId: form.campaignId === "none" ? null : parseInt(form.campaignId),
      }
      if (!editing) body.companyId = activeCompany!.id
      const res = await fetch(editing ? `/api/marketing/creatives/${editing.id}` : "/api/marketing/creatives", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Creative updated" : "Creative added" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Delete this creative?")) return
    try { await fetch(`/api/marketing/creatives/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Deleted" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Creative</Button></div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading creatives…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No creatives yet. Add an asset or reference a URL.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const Icon = CREATIVE_TYPE_ICON[c.type] || ImageIcon
            const preview = assetSrc(c.thumbnailUrl || (c.type === "image" ? c.url : null))
            const linked = c.campaignId ? campaigns.find((x) => x.id === c.campaignId) : null
            return (
              <Card key={c.id} className="group overflow-hidden hover:border-primary/40 transition-colors">
                <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
                  {preview ? <img src={preview} alt={c.name} className="w-full h-full object-cover" /> : <Icon className="w-8 h-8 text-muted-foreground/40" />}
                </div>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{cap(c.type)}{c.format ? ` · ${cap(c.format)}` : ""}</div>
                    </div>
                    <Badge variant="outline" className={STATUS_COLORS[c.status]}>{cap(c.status)}</Badge>
                  </div>
                  {linked && <div className="text-[11px] text-muted-foreground truncate">Campaign: {linked.name}</div>}
                  {c.notes && <div className="text-xs text-muted-foreground line-clamp-2">{c.notes}</div>}
                  <div className="flex items-center gap-2 pt-1">
                    {c.url && <a href={assetSrc(c.url)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View</a>}
                    <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => del(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Creative" : "Add Creative"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CREATIVE_TYPES.map((t) => <SelectItem key={t} value={t}>{cap(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Format</Label>
              <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CREATIVE_FORMATS.map((t) => <SelectItem key={t} value={t}>{cap(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CREATIVE_STATUSES.map((t) => <SelectItem key={t} value={t}>{cap(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Campaign</Label>
              <Select value={form.campaignId} onValueChange={(v) => setForm({ ...form, campaignId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {campaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Asset</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button type="button" variant="outline" size="sm" asChild disabled={isUploading}>
                  <label className="cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />{isUploading ? "Uploading…" : "Upload File"}
                    <input type="file" className="hidden" onChange={handleFile} />
                  </label>
                </Button>
                {form.url && <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, url: "" })}>Clear</Button>}
              </div>
            </div>
            <div className="col-span-2"><Label>…or Asset URL</Label><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://… or /objects/…" /></div>
            <div className="col-span-2"><Label>Thumbnail URL</Label><Input value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} placeholder="Optional" /></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || isUploading}>{saving ? "Saving…" : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ============================ Calendar ============================ */

function CalendarTab() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Campaign[]>([])
  const [loading, setLoading] = React.useState(true)
  const [cursor, setCursor] = React.useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })

  React.useEffect(() => {
    let active = true
    setLoading(true)
    const p = new URLSearchParams()
    if (activeCompany) p.set("companyId", String(activeCompany.id))
    fetch(`/api/campaigns?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (active) setRows(d) })
      .catch(() => toast({ title: "Failed to load calendar", variant: "destructive" }))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeCompany, toast])

  const year = cursor.getFullYear(), month = cursor.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month, daysInMonth, 23, 59, 59)

  const dated = rows.filter((c) => c.startDate || c.endDate)
  function campaignsForDay(day: number): Campaign[] {
    const dayStart = new Date(year, month, day)
    const dayEnd = new Date(year, month, day, 23, 59, 59)
    return dated.filter((c) => {
      const s = c.startDate ? new Date(c.startDate) : (c.endDate ? new Date(c.endDate) : null)
      const e = c.endDate ? new Date(c.endDate) : (c.startDate ? new Date(c.startDate) : null)
      if (!s || !e) return false
      return s <= dayEnd && e >= dayStart
    })
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const inMonth = dated.filter((c) => {
    const s = c.startDate ? new Date(c.startDate) : (c.endDate ? new Date(c.endDate) : null)
    const e = c.endDate ? new Date(c.endDate) : (c.startDate ? new Date(c.startDate) : null)
    return s && e && s <= monthEnd && e >= monthStart
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{cursor.toLocaleString("en-IN", { month: "long", year: "numeric" })}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading calendar…</div>
      ) : dated.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No campaigns have start/end dates yet. Add dates in the Campaigns tab.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground mb-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1 font-medium">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => (
              <div key={i} className={`min-h-[72px] rounded border border-border/50 p-1 text-left ${day == null ? "bg-transparent border-transparent" : "bg-card/40"}`}>
                {day != null && (
                  <>
                    <div className="text-[11px] text-muted-foreground mb-0.5">{day}</div>
                    <div className="space-y-0.5">
                      {campaignsForDay(day).slice(0, 3).map((c) => (
                        <div key={c.id} className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${CHANNEL_COLORS[c.channel] || "bg-muted"}`} title={c.name}>{c.name}</div>
                      ))}
                      {campaignsForDay(day).length > 3 && <div className="text-[9px] text-muted-foreground px-1">+{campaignsForDay(day).length - 3}</div>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {!loading && inMonth.length > 0 && (
        <Card><CardContent className="p-4">
          <h4 className="text-sm font-medium mb-2">Running this month</h4>
          <div className="flex flex-wrap gap-2">
            {inMonth.map((c) => (
              <span key={c.id} className={`text-xs px-2 py-1 rounded ${CHANNEL_COLORS[c.channel] || "bg-muted"}`}>{c.name}</span>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  )
}

/* ============================ Leads ============================ */

interface LeadForm { name: string; email: string; phone: string; source: string; status: string; value: string; notes: string; campaignId: string }
const emptyLeadForm = (): LeadForm => ({ name: "", email: "", phone: "", source: "meta", status: "new", value: "0", notes: "", campaignId: "none" })

function LeadsTab() {
  const { activeCompany } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Lead[]>([])
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Lead | null>(null)
  const [form, setForm] = React.useState<LeadForm>(emptyLeadForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      const [ls, cs] = await Promise.all([
        fetch(`/api/marketing/leads?${p}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/campaigns?${p}`, { credentials: "include" }).then((r) => r.json()),
      ])
      setRows(ls); setCampaigns(cs)
    } catch { toast({ title: "Failed to load leads", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, toast])

  React.useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm(emptyLeadForm()); setShowDialog(true) }
  function openEdit(l: Lead) {
    setEditing(l)
    setForm({ name: l.name, email: l.email ?? "", phone: l.phone ?? "", source: l.source ?? "meta", status: l.status, value: String(l.value), notes: l.notes ?? "", campaignId: l.campaignId ? String(l.campaignId) : "none" })
    setShowDialog(true)
  }
  async function save() {
    if (!form.name) { toast({ title: "Lead name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name, email: form.email || null, phone: form.phone || null, source: form.source,
        status: form.status, value: form.value ? parseFloat(form.value) : 0, notes: form.notes || null,
        campaignId: form.campaignId === "none" ? null : parseInt(form.campaignId),
      }
      if (!editing) body.companyId = activeCompany!.id
      const res = await fetch(editing ? `/api/marketing/leads/${editing.id}` : "/api/marketing/leads", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? "Lead updated" : "Lead added" }); setShowDialog(false); load()
    } catch { toast({ title: "Save failed", variant: "destructive" }) }
    finally { setSaving(false) }
  }
  async function del(id: number) {
    if (!confirm("Delete this lead?")) return
    try { await fetch(`/api/marketing/leads/${id}`, { method: "DELETE", credentials: "include" }); toast({ title: "Deleted" }); load() }
    catch { toast({ title: "Delete failed", variant: "destructive" }) }
  }

  const totalValue = rows.reduce((s, l) => s + (Number(l.value) || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">{rows.length} leads · Pipeline value <span className="font-semibold text-foreground">{fmtINR(totalValue)}</span></div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> Add Lead</Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading leads…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No leads yet.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {LEAD_STATUSES.map((st) => {
            const items = rows.filter((l) => l.status === st)
            const colValue = items.reduce((s, l) => s + (Number(l.value) || 0), 0)
            return (
              <div key={st} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={STATUS_COLORS[st]}>{cap(st)}</Badge>
                  <span className="text-xs text-muted-foreground">{items.length} · {fmtINR(colValue)}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60 border border-dashed rounded p-3 text-center">Empty</div>
                  ) : items.map((l) => {
                    const linked = l.campaignId ? campaigns.find((c) => c.id === l.campaignId) : null
                    return (
                      <Card key={l.id} className="group">
                        <CardContent className="p-3 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{l.name}</div>
                              {l.email && <div className="text-[11px] text-muted-foreground truncate">{l.email}</div>}
                              {l.phone && <div className="text-[11px] text-muted-foreground truncate">{l.phone}</div>}
                            </div>
                            <div className="text-xs font-semibold whitespace-nowrap">{fmtINR(Number(l.value) || 0)}</div>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {l.source && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase ${CHANNEL_COLORS[l.source] || "bg-muted"}`}>{l.source}</span>}
                            {linked && <span className="text-[10px] text-muted-foreground truncate">{linked.name}</span>}
                          </div>
                          <div className="flex gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(l)}><Pencil className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => del(l.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Lead" : "Add Lead"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{cap(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{cap(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Value (₹)</Label><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
            <div><Label>Campaign</Label>
              <Select value={form.campaignId} onValueChange={(v) => setForm({ ...form, campaignId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {campaigns.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
