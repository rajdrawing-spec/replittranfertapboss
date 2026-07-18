import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneCall, PhoneOff, Clock, Users, Radio,
  Delete, Star, Search, Plus, Mic, MicOff, Pause, Play, ArrowRightLeft, Loader2, Settings2,
  Hash, Volume2, CircleDot, Sparkles, Headset,
} from "lucide-react"

interface BusinessNumber {
  id: number
  department: string
  displayName: string
  phoneNumber: string
  exotelSid: string | null
  exotelVirtualNumber: string | null
  status: string
  isDefault: boolean
}

interface CallContact {
  id: number
  name: string
  phone: string
  email: string | null
  department: string | null
  tags: string[]
  favorite: boolean
}

interface CallLog {
  id: number
  callId: string
  businessNumberId: number | null
  contactId: number | null
  userId: number | null
  callerName: string | null
  callerNumber: string
  direction: "incoming" | "outgoing"
  status: string
  duration: number
  recordingUrl: string | null
  summary: string | null
  notes: string | null
  startedAt: string
  endedAt: string | null
}

interface CallStats {
  todaysCalls: number
  incoming: number
  outgoing: number
  missed: number
  avgDurationSec: number
  activeCalls: number
  liveQueue: number
  activeAgents: number
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function CallTimer({ since }: { since: string }) {
  const [, force] = React.useReducer((x) => x + 1, 0)
  React.useEffect(() => {
    const t = setInterval(force, 1000)
    return () => clearInterval(t)
  }, [])
  const sec = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000))
  return <span className="tabular-nums">{fmtDuration(sec)}</span>
}

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]

export default function CallCenterPage() {
  const { activeCompany, companies } = useCompany()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const parentCompany = companies.find((c) => c.mode === "parent")
  const companyId = activeCompany?.id ?? parentCompany?.id
  const canManage = hasPermission("callcenter.manage")

  const [tab, setTab] = React.useState("dashboard")

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<CallStats>({
    queryKey: ["/api/call-center/stats", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/call-center/stats?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
    refetchInterval: tab === "dashboard" ? 10_000 : false,
  })

  const { data: numbers } = useQuery<BusinessNumber[]>({
    queryKey: ["/api/business-numbers", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/business-numbers?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: activeCalls } = useQuery<CallLog[]>({
    queryKey: ["/api/call/active", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/call/active?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
    refetchInterval: 5_000,
  })

  const invalidateCalls = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/call/active", companyId] })
    queryClient.invalidateQueries({ queryKey: ["/api/call-center/stats", companyId] })
    queryClient.invalidateQueries({ queryKey: ["/api/call/history", companyId] })
  }

  const callAction = async (path: string, body: Record<string, unknown>, okMsg?: string) => {
    const res = await fetch(`/api/call/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, ...body }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Call action failed", description: err.error || path, variant: "destructive" })
      return null
    }
    if (okMsg) toast({ title: okMsg })
    invalidateCalls()
    return res.json()
  }

  const ringing = (activeCalls ?? []).filter((c) => c.status === "ringing" && c.direction === "incoming")
  const live = (activeCalls ?? []).filter((c) => c.status === "active" || c.status === "held")

  if (!companyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Select a workspace to use the Call Center.</div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Headset className="h-6 w-6" /> Call Center
        </h1>
        <div className="flex items-center gap-2">
          {ringing.length > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              <PhoneIncoming className="h-3 w-3 mr-1" /> {ringing.length} ringing
            </Badge>
          )}
          {live.length > 0 && (
            <Badge variant="secondary">
              <PhoneCall className="h-3 w-3 mr-1" /> {live.length} active
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="dialpad">Dial Pad</TabsTrigger>
          <TabsTrigger value="incoming">
            Incoming{ringing.length > 0 ? ` (${ringing.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="active">
            Active{live.length > 0 ? ` (${live.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history">Call History</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          {canManage && <TabsTrigger value="numbers">Business Numbers</TabsTrigger>}
          {canManage && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab stats={stats} />
        </TabsContent>
        <TabsContent value="dialpad">
          <DialPadTab numbers={numbers ?? []} onCall={callAction} />
        </TabsContent>
        <TabsContent value="incoming">
          <IncomingTab ringing={ringing} numbers={numbers ?? []} onAction={callAction} onSimulate={callAction} />
        </TabsContent>
        <TabsContent value="active">
          <ActiveTab live={live} numbers={numbers ?? []} onAction={callAction} companyId={companyId} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab companyId={companyId} numbers={numbers ?? []} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab companyId={companyId} onQuickCall={(phone) => { setTab("dialpad"); setPrefill(phone) }} />
        </TabsContent>
        {canManage && (
          <TabsContent value="numbers">
            <NumbersTab companyId={companyId} numbers={numbers ?? []} />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="settings">
            <SettingsTab companyId={companyId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )

  // Prefill helper for Quick Call — stored on window-scope of the component via ref
  function setPrefill(phone: string) {
    window.dispatchEvent(new CustomEvent("callcenter:prefill", { detail: phone }))
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardTab({ stats }: { stats?: CallStats }) {
  const cards = [
    { label: "Today's Calls", value: stats?.todaysCalls ?? 0, icon: Phone },
    { label: "Incoming", value: stats?.incoming ?? 0, icon: PhoneIncoming },
    { label: "Outgoing", value: stats?.outgoing ?? 0, icon: PhoneOutgoing },
    { label: "Missed", value: stats?.missed ?? 0, icon: PhoneMissed },
    { label: "Avg Duration", value: fmtDuration(stats?.avgDurationSec ?? 0), icon: Clock },
    { label: "Active Agents", value: stats?.activeAgents ?? 0, icon: Users },
    { label: "Active Calls", value: stats?.activeCalls ?? 0, icon: PhoneCall },
    { label: "Live Queue", value: stats?.liveQueue ?? 0, icon: Radio },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-md bg-muted p-2"><c.icon className="h-5 w-5 text-muted-foreground" /></div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Dial Pad ──────────────────────────────────────────────────────────────────
function DialPadTab({ numbers, onCall }: {
  numbers: BusinessNumber[]
  onCall: (path: string, body: Record<string, unknown>, okMsg?: string) => Promise<any>
}) {
  const [number, setNumber] = React.useState("")
  const [fromId, setFromId] = React.useState<string>("")
  const [calling, setCalling] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: Event) => setNumber((e as CustomEvent<string>).detail)
    window.addEventListener("callcenter:prefill", handler)
    return () => window.removeEventListener("callcenter:prefill", handler)
  }, [])

  React.useEffect(() => {
    if (!fromId && numbers.length) {
      const def = numbers.find((n) => n.isDefault) ?? numbers[0]
      setFromId(def.id.toString())
    }
  }, [numbers, fromId])

  const placeCall = async () => {
    if (!number.trim() || calling) return
    setCalling(true)
    try {
      const result = await onCall("outgoing", { toNumber: number.trim(), businessNumberId: Number(fromId) })
      if (result) toast(result)
    } finally {
      setCalling(false)
    }
  }
  const { toast: showToast } = useToast()
  function toast(result: any) {
    showToast({ title: "Calling…", description: result?.message || "Mock call placed (Exotel not connected yet)." })
  }

  return (
    <div className="max-w-sm mx-auto">
      <Card>
        <CardContent className="p-6 space-y-4">
          <Select value={fromId} onValueChange={setFromId}>
            <SelectTrigger>
              <SelectValue placeholder="Call from…" />
            </SelectTrigger>
            <SelectContent>
              {numbers.filter((n) => n.status === "active").map((n) => (
                <SelectItem key={n.id} value={n.id.toString()}>
                  {n.displayName} ({n.phoneNumber})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^0-9+*# ()-]/g, ""))}
            placeholder="+91 98765 43210"
            className="text-center text-xl h-12 tracking-wider"
          />
          <div className="grid grid-cols-3 gap-2">
            {DIAL_KEYS.map((k) => (
              <Button key={k} variant="outline" className="h-12 text-lg" onClick={() => setNumber((n) => n + k)}>
                {k}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 h-12 bg-green-600 hover:bg-green-700 text-white" disabled={!number.trim() || calling} onClick={placeCall}>
              {calling ? <Loader2 className="h-5 w-5 animate-spin" /> : <Phone className="h-5 w-5 mr-2" />} Call
            </Button>
            <Button variant="outline" className="h-12" onClick={() => setNumber((n) => n.slice(0, -1))}>
              <Delete className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Calls are routed through your business numbers — your personal number is never shown.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Incoming ──────────────────────────────────────────────────────────────────
function IncomingTab({ ringing, numbers, onAction, onSimulate }: {
  ringing: CallLog[]
  numbers: BusinessNumber[]
  onAction: (path: string, body: Record<string, unknown>, okMsg?: string) => Promise<any>
  onSimulate: (path: string, body: Record<string, unknown>, okMsg?: string) => Promise<any>
}) {
  const call = ringing[0]
  const dept = call?.businessNumberId ? numbers.find((n) => n.id === call.businessNumberId)?.department : undefined
  return (
    <div className="max-w-md mx-auto space-y-4">
      {call ? (
        <Card className="border-2 border-green-500/50">
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center animate-pulse">
              <PhoneIncoming className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{call.callerName || "Unknown caller"}</div>
              <div className="text-xl text-muted-foreground tabular-nums">{call.callerNumber}</div>
              {dept && <Badge variant="secondary" className="mt-2">{dept}</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button className="h-12 bg-green-600 hover:bg-green-700 text-white" onClick={() => onAction("answer", { callId: call.callId }, "Call answered")}>
                <Phone className="h-5 w-5 mr-2" /> Answer
              </Button>
              <Button variant="destructive" className="h-12" onClick={() => onAction("reject", { callId: call.callId }, "Call rejected")}>
                <PhoneOff className="h-5 w-5 mr-2" /> Reject
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-muted-foreground">
              <Button variant="outline" size="sm" disabled title="Mute"><MicOff className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled title="Hold"><Pause className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled title="Keypad"><Hash className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled title="Speaker"><Volume2 className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <PhoneIncoming className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No incoming calls right now.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onSimulate("incoming", {
                  fromNumber: "+91 98220 11223",
                  businessNumberId: numbers.find((n) => n.isDefault)?.id ?? numbers[0]?.id,
                }, "Simulated incoming call")
              }
            >
              <Sparkles className="h-4 w-4 mr-2" /> Simulate incoming call (mock)
            </Button>
            <p className="text-xs text-muted-foreground">Exotel webhooks will replace this once connected.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Active calls ──────────────────────────────────────────────────────────────
function ActiveTab({ live, numbers, onAction, companyId }: {
  live: CallLog[]
  numbers: BusinessNumber[]
  onAction: (path: string, body: Record<string, unknown>, okMsg?: string) => Promise<any>
  companyId: number
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [muted, setMuted] = React.useState<Record<string, boolean>>({})
  const [notesFor, setNotesFor] = React.useState<CallLog | null>(null)
  const [notesDraft, setNotesDraft] = React.useState("")

  const saveNotes = async () => {
    if (!notesFor) return
    const res = await fetch(`/api/call/logs/${notesFor.id}/notes`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, notes: notesDraft }),
    })
    if (res.ok) {
      toast({ title: "Notes saved" })
      setNotesFor(null)
      queryClient.invalidateQueries({ queryKey: ["/api/call/active", companyId] })
    } else {
      toast({ title: "Failed to save notes", variant: "destructive" })
    }
  }

  if (!live.length) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          <PhoneCall className="h-10 w-10 mx-auto mb-3" /> No active calls.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {live.map((call) => {
        const dept = call.businessNumberId ? numbers.find((n) => n.id === call.businessNumberId)?.department : undefined
        const held = call.status === "held"
        return (
          <Card key={call.id} className={held ? "opacity-75" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="truncate">{call.callerName || call.callerNumber}</span>
                <Badge variant={held ? "outline" : "secondary"}>
                  {held ? "On hold" : <><CircleDot className="h-3 w-3 mr-1 text-red-500 animate-pulse" /> Live</>}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="tabular-nums">{call.callerNumber}</span>
                {dept && <Badge variant="outline">{dept}</Badge>}
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> <CallTimer since={call.startedAt} /></span>
                <span className="flex items-center gap-1 text-xs">
                  <CircleDot className="h-3 w-3" /> Recording: {call.recordingUrl ? "on" : "off"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Button
                  variant={muted[call.callId] ? "default" : "outline"}
                  size="sm"
                  title={muted[call.callId] ? "Unmute" : "Mute"}
                  onClick={() => setMuted((m) => ({ ...m, [call.callId]: !m[call.callId] }))}
                >
                  {muted[call.callId] ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  title={held ? "Resume" : "Hold"}
                  onClick={() => onAction("hold", { callId: call.callId, hold: !held }, held ? "Call resumed" : "Call on hold")}
                >
                  {held ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="sm" title="Transfer" onClick={() => onAction("transfer", { callId: call.callId }, "Transfer requested (mock)")}>
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  title="AI Notes"
                  onClick={() => { setNotesFor(call); setNotesDraft(call.notes ?? "") }}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="destructive" className="w-full" onClick={() => onAction("end", { callId: call.callId }, "Call ended")}>
                <PhoneOff className="h-4 w-4 mr-2" /> End Call
              </Button>
            </CardContent>
          </Card>
        )
      })}

      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call notes</DialogTitle>
          </DialogHeader>
          <textarea
            className="w-full min-h-[140px] rounded-md border bg-background p-3 text-sm"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Notes about this call…"
          />
          <Button onClick={saveNotes}>Save notes</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── History ───────────────────────────────────────────────────────────────────
function HistoryTab({ companyId, numbers }: { companyId: number; numbers: BusinessNumber[] }) {
  const [q, setQ] = React.useState("")
  const [direction, setDirection] = React.useState("all")
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery<{ items: CallLog[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/call/history", companyId, q, direction, page],
    queryFn: async () => {
      const params = new URLSearchParams({ companyId: String(companyId), page: String(page), limit: "20" })
      if (q.trim()) params.set("q", q.trim())
      if (direction !== "all") params.set("direction", direction)
      const res = await fetch(`/api/call/history?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search by name or number…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          </div>
          <Select value={direction} onValueChange={(v) => { setDirection(v); setPage(1) }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All calls</SelectItem>
              <SelectItem value="incoming">Incoming</SelectItem>
              <SelectItem value="outgoing">Outgoing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data?.items.length ? (
          <div className="text-center text-sm text-muted-foreground py-8">No calls yet.</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Caller</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => {
                  const dept = c.businessNumberId ? numbers.find((n) => n.id === c.businessNumberId)?.department : "—"
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(c.startedAt).toLocaleString()}</TableCell>
                      <TableCell>{c.callerName || "Unknown"}</TableCell>
                      <TableCell className="tabular-nums">{c.callerNumber}</TableCell>
                      <TableCell>{dept}</TableCell>
                      <TableCell>
                        {c.status === "missed" ? (
                          <span className="flex items-center gap-1 text-red-600 text-xs"><PhoneMissed className="h-3 w-3" /> Missed</span>
                        ) : c.direction === "incoming" ? (
                          <span className="flex items-center gap-1 text-xs"><PhoneIncoming className="h-3 w-3" /> Incoming</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs"><PhoneOutgoing className="h-3 w-3" /> Outgoing</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{c.duration ? fmtDuration(c.duration) : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{c.status}</Badge></TableCell>
                      <TableCell className="max-w-[220px]">
                        {c.summary ? (
                          <span className="text-xs flex items-start gap-1"><Sparkles className="h-3 w-3 mt-0.5 shrink-0" /> {c.summary}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground truncate block">{c.notes || "—"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-muted-foreground">{data.total} calls</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="py-1.5 text-xs text-muted-foreground">Page {page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Contacts ──────────────────────────────────────────────────────────────────
function ContactsTab({ companyId, onQuickCall }: { companyId: number; onQuickCall: (phone: string) => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [q, setQ] = React.useState("")
  const [addOpen, setAddOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", phone: "", email: "", department: "" })
  const [saving, setSaving] = React.useState(false)

  const { data: contacts, isLoading } = useQuery<CallContact[]>({
    queryKey: ["/api/call-center/contacts", companyId, q],
    queryFn: async () => {
      const params = new URLSearchParams({ companyId: String(companyId) })
      if (q.trim()) params.set("q", q.trim())
      const res = await fetch(`/api/call-center/contacts?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const addContact = async () => {
    if (!form.name.trim() || !form.phone.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/call-center/contacts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...form, email: form.email || undefined, department: form.department || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Failed to add contact", description: err.error, variant: "destructive" })
        return
      }
      toast({ title: "Contact added" })
      setAddOpen(false)
      setForm({ name: "", phone: "", email: "", department: "" })
      queryClient.invalidateQueries({ queryKey: ["/api/call-center/contacts", companyId] })
    } finally {
      setSaving(false)
    }
  }

  const toggleFavorite = async (c: CallContact) => {
    await fetch(`/api/call-center/contacts/${c.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, favorite: !c.favorite }),
    })
    queryClient.invalidateQueries({ queryKey: ["/api/call-center/contacts", companyId] })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !contacts?.length ? (
          <div className="text-center text-sm text-muted-foreground py-8">No contacts yet.</div>
        ) : (
          <div className="divide-y">
            {contacts.map((c) => (
              <div key={c.id} className="py-3 flex items-center gap-3">
                <button onClick={() => toggleFavorite(c)} title={c.favorite ? "Unfavorite" : "Favorite"}>
                  <Star className={`h-4 w-4 ${c.favorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    <span className="tabular-nums">{c.phone}</span>
                    {c.email ? ` · ${c.email}` : ""}
                  </div>
                </div>
                {c.department && <Badge variant="outline" className="text-xs">{c.department}</Badge>}
                {c.tags?.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                <Button size="sm" variant="outline" onClick={() => onQuickCall(c.phone)}>
                  <Phone className="h-4 w-4 mr-1" /> Call
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Phone (+91…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input placeholder="Department (optional)" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <Button className="w-full" onClick={addContact} disabled={saving || !form.name.trim() || !form.phone.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save contact
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Business Numbers (admin) ─────────────────────────────────────────────────
function NumbersTab({ companyId, numbers }: { companyId: number; numbers: BusinessNumber[] }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = React.useState(false)
  const [form, setForm] = React.useState({ department: "", displayName: "", phoneNumber: "", exotelSid: "", exotelVirtualNumber: "", isDefault: false })
  const [saving, setSaving] = React.useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/business-numbers", companyId] })

  const addNumber = async () => {
    if (!form.department.trim() || !form.displayName.trim() || !form.phoneNumber.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/business-numbers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...form,
          exotelSid: form.exotelSid || undefined,
          exotelVirtualNumber: form.exotelVirtualNumber || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Failed to add number", description: err.error, variant: "destructive" })
        return
      }
      toast({ title: "Business number added" })
      setAddOpen(false)
      setForm({ department: "", displayName: "", phoneNumber: "", exotelSid: "", exotelVirtualNumber: "", isDefault: false })
      refresh()
    } finally {
      setSaving(false)
    }
  }

  const patchNumber = async (id: number, body: Record<string, unknown>) => {
    const res = await fetch(`/api/business-numbers/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, ...body }),
    })
    if (!res.ok) toast({ title: "Update failed", variant: "destructive" })
    refresh()
  }

  const deleteNumber = async (id: number) => {
    if (!confirm("Delete this business number?")) return
    const res = await fetch(`/api/business-numbers/${id}?companyId=${companyId}`, {
      method: "DELETE",
      credentials: "include",
    })
    if (!res.ok) toast({ title: "Delete failed", variant: "destructive" })
    else { toast({ title: "Number deleted" }); refresh() }
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Business Numbers</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add number</Button>
      </CardHeader>
      <CardContent>
        {!numbers.length ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No business numbers yet. Add your Exotel virtual numbers here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Exotel SID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {numbers.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>{n.department}</TableCell>
                  <TableCell>{n.displayName}</TableCell>
                  <TableCell className="tabular-nums">{n.phoneNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{n.exotelSid || "Not linked"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={n.status === "active"}
                      onCheckedChange={(v) => patchNumber(n.id, { status: v ? "active" : "inactive" })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={n.isDefault} disabled={n.isDefault} onCheckedChange={() => patchNumber(n.id, { isDefault: true })} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteNumber(n.id)}>
                      <Delete className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add business number</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Department (e.g. Sales)" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <Input placeholder="Display name (e.g. Sales Line)" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <Input placeholder="Business number (+91…)" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
            <Input placeholder="Exotel SID (optional, add later)" value={form.exotelSid} onChange={(e) => setForm({ ...form, exotelSid: e.target.value })} />
            <Input placeholder="Exotel virtual number (optional)" value={form.exotelVirtualNumber} onChange={(e) => setForm({ ...form, exotelVirtualNumber: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} /> Set as default number
            </label>
            <Button className="w-full" onClick={addNumber} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save number
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Settings (placeholder until Exotel is connected) ─────────────────────────
function SettingsTab({ companyId }: { companyId: number | undefined }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [form, setForm] = React.useState({
    accountSid: "", apiKey: "", apiToken: "", webhookUrl: "", callerId: "",
    callRecording: false, callQueue: false,
  })
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!companyId) return
    fetch(`/api/call-center/settings?companyId=${companyId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setForm({
            accountSid: d.accountSid ?? "",
            apiKey: d.apiKey ?? "",
            apiToken: d.apiToken ?? "",
            webhookUrl: d.webhookUrl ?? "",
            callerId: d.callerId ?? "",
            callRecording: !!d.callRecording,
            callQueue: !!d.callQueue,
          })
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [companyId])

  async function testConnection() {
    if (!companyId) return
    setTesting(true)
    try {
      const res = await fetch("/api/call-center/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId, accountSid: form.accountSid, apiKey: form.apiKey, apiToken: form.apiToken }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        toast({ title: "✓ Exotel connected", description: data.message ?? "Credentials are valid." })
      } else {
        toast({ title: "Connection failed", description: data.error ?? "Check your credentials and try again.", variant: "destructive" })
      }
    } catch {
      toast({ title: "Connection failed", description: "Network error. Try again.", variant: "destructive" })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!companyId) return
    setSaving(true)
    try {
      const res = await fetch("/api/call-center/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId, ...form }),
      })
      if (!res.ok) throw new Error("Failed")
      toast({ title: "Settings saved" })
      queryClient.invalidateQueries({ queryKey: ["/api/call-center/settings", companyId] })
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>

  const fields: { key: keyof typeof form; label: string; placeholder: string; type?: string }[] = [
    { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "apiKey",     label: "API Key",      placeholder: "Your Exotel API key" },
    { key: "apiToken",   label: "API Token",    placeholder: "Your Exotel API token", type: "password" },
    { key: "webhookUrl", label: "Webhook URL",  placeholder: "https://your-server.com/api/call/incoming" },
    { key: "callerId",   label: "Caller ID",    placeholder: "+91xxxxxxxxxx" },
  ]

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4" /> Exotel Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Enter your Exotel credentials to connect the call center. These are saved securely in the database.
        </p>
        {fields.map(({ key, label, placeholder, type }) => (
          <div key={key}>
            <div className="text-xs font-medium mb-1">{label}</div>
            <Input
              type={type ?? "text"}
              placeholder={placeholder}
              value={form[key] as string}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex items-center justify-between text-sm border rounded-md p-3">
          <span>Call recording</span>
          <Switch checked={form.callRecording} onCheckedChange={(v) => setForm({ ...form, callRecording: v })} />
        </div>
        <div className="flex items-center justify-between text-sm border rounded-md p-3">
          <span>Call queue</span>
          <Switch checked={form.callQueue} onCheckedChange={(v) => setForm({ ...form, callQueue: v })} />
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={save} disabled={saving || testing}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save Settings"}
          </Button>
          <Button variant="outline" onClick={testConnection} disabled={saving || testing || !form.accountSid || !form.apiKey || !form.apiToken}>
            {testing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Testing…</> : "Test Connection"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
