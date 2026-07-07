import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Megaphone, TrendingUp, Target, Users, Pencil, Trash2, IndianRupee } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"

interface Campaign {
  id: number; companyId: number; name: string; channel: string; objective: string | null; status: string
  budget: number; spent: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number
}
interface Summary { totalBudget: number; totalSpent: number; totalRevenue: number; totalLeads: number; totalConversions: number; totalClicks: number; totalImpressions: number; activeCount: number; roas: number }

const CHANNELS = ["meta", "google", "instagram", "facebook", "whatsapp", "email"]
const OBJECTIVES = ["awareness", "traffic", "leads", "conversions", "sales"]
const STATUSES = ["draft", "active", "paused", "completed"]
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
}
const CHANNEL_COLORS: Record<string, string> = {
  meta: "bg-blue-600/10 text-blue-400", google: "bg-red-500/10 text-red-400",
  instagram: "bg-pink-500/10 text-pink-400", facebook: "bg-indigo-500/10 text-indigo-400",
  whatsapp: "bg-green-500/10 text-green-400", email: "bg-amber-500/10 text-amber-400",
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN")

interface Form { name: string; channel: string; objective: string; status: string; budget: string; spent: string; leads: string; conversions: string; revenue: string; impressions: string; clicks: string }
const emptyForm = (): Form => ({ name: "", channel: "meta", objective: "conversions", status: "active", budget: "", spent: "0", leads: "0", conversions: "0", revenue: "0", impressions: "0", clicks: "0" })

export default function Marketing() {
  const { activeCompany, isParentView } = useCompany()
  const { toast } = useToast()
  const [rows, setRows] = React.useState<Campaign[]>([])
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [showDialog, setShowDialog] = React.useState(false)
  const [editing, setEditing] = React.useState<Campaign | null>(null)
  const [form, setForm] = React.useState<Form>(emptyForm())
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (activeCompany) p.set("companyId", String(activeCompany.id))
      const [c, s] = await Promise.all([
        fetch(`/api/campaigns?${p}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/campaigns/summary?${p}`, { credentials: "include" }).then((r) => r.json()),
      ])
      setRows(c); setSummary(s)
    } catch { toast({ title: "Failed to load campaigns", variant: "destructive" }) }
    finally { setLoading(false) }
  }, [activeCompany, toast])

  React.useEffect(() => { load() }, [load])

  function openAdd() { setEditing(null); setForm(emptyForm()); setShowDialog(true) }
  function openEdit(c: Campaign) {
    setEditing(c)
    setForm({ name: c.name, channel: c.channel, objective: c.objective ?? "conversions", status: c.status, budget: String(c.budget), spent: String(c.spent), leads: String(c.leads), conversions: String(c.conversions), revenue: String(c.revenue), impressions: String(c.impressions), clicks: String(c.clicks) })
    setShowDialog(true)
  }
  async function save() {
    if (!form.name) { toast({ title: "Campaign name required", variant: "destructive" }); return }
    if (!editing && !activeCompany) { toast({ title: "Select a brand workspace first", variant: "destructive" }); return }
    setSaving(true)
    try {
      const num = (v: string) => (v ? parseFloat(v) : 0)
      const body: any = { name: form.name, channel: form.channel, objective: form.objective, status: form.status, budget: num(form.budget), spent: num(form.spent), leads: num(form.leads), conversions: num(form.conversions), revenue: num(form.revenue), impressions: num(form.impressions), clicks: num(form.clicks) }
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

  const stats = summary ? [
    { l: "Ad Spend", v: fmtINR(summary.totalSpent), sub: `of ${fmtINR(summary.totalBudget)} budget`, icon: IndianRupee, c: "text-blue-400" },
    { l: "Revenue", v: fmtINR(summary.totalRevenue), sub: `${summary.roas.toFixed(1)}x ROAS`, icon: TrendingUp, c: "text-green-400" },
    { l: "Leads", v: summary.totalLeads.toLocaleString("en-IN"), sub: `${summary.totalConversions} conversions`, icon: Users, c: "text-purple-400" },
    { l: "Active Campaigns", v: String(summary.activeCount), sub: `${rows.length} total`, icon: Target, c: "text-orange-400" },
  ] : []

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="w-6 h-6 text-primary" /> Marketing Workspace</h1>
          <p className="text-sm text-muted-foreground mt-1">{isParentView ? "Campaign performance across all brands" : `${activeCompany?.name} campaigns, ads & ROI`}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" /> New Campaign</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.l}><CardContent className="p-4">
            <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{s.l}</span><s.icon className={`w-4 h-4 ${s.c}`} /></div>
            <div className="text-2xl font-bold mt-1">{s.v}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
          </CardContent></Card>
        ))}
      </div>

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

                  <div>
                    <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{fmtINR(c.spent)} spent</span><span className="text-muted-foreground">{fmtINR(c.budget)}</span></div>
                    <Progress value={pct} className="h-1.5" />
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div><div className="text-sm font-bold">{c.leads}</div><div className="text-[10px] text-muted-foreground">Leads</div></div>
                    <div><div className="text-sm font-bold">{c.conversions}</div><div className="text-[10px] text-muted-foreground">Conv.</div></div>
                    <div><div className="text-sm font-bold text-green-400">{fmtINR(c.revenue)}</div><div className="text-[10px] text-muted-foreground">Revenue</div></div>
                    <div><div className={`text-sm font-bold ${roas >= 1 ? "text-green-400" : "text-red-400"}`}>{roas.toFixed(1)}x</div><div className="text-[10px] text-muted-foreground">ROAS</div></div>
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
