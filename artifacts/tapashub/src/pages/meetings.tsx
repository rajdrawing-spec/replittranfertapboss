import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { useMeeting } from "@/contexts/meeting-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  Video, Mic, CalendarClock, Repeat, ClipboardList, Loader2,
  Sparkles, ChevronRight, Search, X, Clock, CheckCircle2,
  AlertCircle, RotateCcw, UserPlus, Calendar, Trash2, Users,
  ChevronLeft, Plus, Pencil, MoreVertical,
} from "lucide-react"

/* ─────────────────────────────── Types ─────────────────────────────────── */
interface Meeting {
  id: number; meetingId: string; title: string; scheduledAt: string | null
  duration: number; status: string; isRecurring: boolean; recurrence: string | null
  organizerId: number; createdAt: string
  participants?: Array<{ userId: number; status: string }>
}
interface MeetingActionItem {
  title: string; description?: string; assigneeName?: string
  priority?: string; dueDate?: string; taskId?: number
}
interface MeetingNoteSummary {
  id: number; meetingId: string; channelId: number | null; title: string
  summary: string | null; actionItems: MeetingActionItem[]
  status: "processing" | "done" | "failed"; error: string | null; createdAt: string
}
interface MeetingNoteDetail extends MeetingNoteSummary { transcript: string | null; notes: string | null }
interface WorkspaceUser { id: number; name: string; email: string }

/* ─────────────────────────── Constants ─────────────────────────────────── */
const BLUE = "#3B82F6"
const BLUE_DARK = "#1d6fd8"

/* ─────────────────────────── Helpers ───────────────────────────────────── */
function formatDateTime(d: string | null) {
  if (!d) return "Instant meeting"
  return new Date(d).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}
function fromNow(d: string | null) {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  const abs = Math.abs(diff)
  const past = diff < 0
  if (abs < 60_000) return "now"
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ${past ? "ago" : "from now"}`
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ${past ? "ago" : "from now"}`
  if (!past) return new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  return null
}
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(d).toLocaleDateString()
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    scheduled: { label: "Scheduled", color: BLUE, bg: `${BLUE}18` },
    ongoing:   { label: "🔴 Live",   color: "#22c55e", bg: "#22c55e18" },
    ended:     { label: "Ended",    color: "#6b7280", bg: "hsl(var(--muted))" },
    cancelled: { label: "Cancelled",color: "#ef4444", bg: "#ef444418" },
  }
  const { label, color, bg } = cfg[status] ?? cfg.scheduled
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ color, background: bg }}>
      {label}
    </span>
  )
}

/* ─────────────────────────────── Main Page ─────────────────────────────── */
export default function MeetingsPage() {
  const { activeCompany, companies } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { startCall, activeCall } = useMeeting()

  const parentCompany = companies.find((c) => c.mode === "parent")
  const [selectedCompanyId, setSelectedCompanyId] = React.useState<string>(
    activeCompany?.id?.toString() ?? parentCompany?.id?.toString() ?? "",
  )
  const companyId = selectedCompanyId ? Number(selectedCompanyId) : activeCompany?.id ?? parentCompany?.id

  React.useEffect(() => {
    if (!selectedCompanyId) {
      const def = activeCompany?.id ?? parentCompany?.id
      if (def) setSelectedCompanyId(def.toString())
    }
  }, [activeCompany?.id, parentCompany?.id])

  /* ── View state ── */
  const [tab, setTab] = React.useState<"meetings" | "notes">("meetings")
  const [filter, setFilter] = React.useState<"all" | "upcoming" | "completed">("upcoming")
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [schedTitle, setSchedTitle] = React.useState("")
  const [schedWhen, setSchedWhen] = React.useState("")
  const [schedDuration, setSchedDuration] = React.useState("30")
  const [schedRecurrence, setSchedRecurrence] = React.useState("none")
  const [schedParticipants, setSchedParticipants] = React.useState<number[]>([])
  const [schedSaving, setSchedSaving] = React.useState(false)
  const [joiningId, setJoiningId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<number | null>(null)
  const [startingInstant, setStartingInstant] = React.useState<"voice" | "video" | null>(null)
  const [notesQuery, setNotesQuery] = React.useState("")
  const [openNoteId, setOpenNoteId] = React.useState<number | null>(null)
  const [retryingNote, setRetryingNote] = React.useState(false)
  const [assigningIndex, setAssigningIndex] = React.useState<number | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editingMeeting, setEditingMeeting] = React.useState<Meeting | null>(null)
  const [editSaving, setEditSaving] = React.useState(false)

  /* ── Queries ── */
  const { data: meetings, isLoading: isLoadingMeetings } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  })

  const { data: workspaceUsers } = useQuery<WorkspaceUser[]>({
    queryKey: ["/api/chat/users", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/users?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && (scheduleOpen || editOpen),
  })

  const { data: meetingNotes, isLoading: isLoadingNotes } = useQuery<MeetingNoteSummary[]>({
    queryKey: ["/api/meetings/notes", companyId, notesQuery],
    queryFn: async () => {
      const q = notesQuery ? `&q=${encodeURIComponent(notesQuery)}` : ""
      const res = await fetch(`/api/meetings/notes?companyId=${companyId}${q}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && tab === "notes",
  })

  const { data: employeesData } = useQuery<{ items: Array<{ id: number; firstName: string; lastName: string }> }>({
    queryKey: ["/api/hr/employees", companyId, 1],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employees?companyId=${companyId}&page=1&limit=100`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && !!openNoteId,
  })

  const { data: openNote } = useQuery<MeetingNoteDetail>({
    queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/notes/${openNoteId}?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && !!openNoteId,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 5_000 : false),
  })

  /* ── Auto-join from ?join= deep link ── */
  const autoJoinAttempted = React.useRef(false)
  React.useEffect(() => {
    if (autoJoinAttempted.current || !companyId || activeCall) return
    const params = new URLSearchParams(window.location.search)
    const joinId = params.get("join")
    if (!joinId) return
    autoJoinAttempted.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete("join")
    window.history.replaceState(null, "", url.toString())
    fetch(`/api/meetings/token?roomName=${encodeURIComponent(joinId)}&companyId=${companyId}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to get token")
        return r.json()
      })
      .then(async ({ token, serverUrl }: { token: string; serverUrl: string }) => {
        await fetch(`/api/meetings/join/${joinId}`, { method: "POST", credentials: "include" })
        startCall({ meetingId: joinId, title: "Meeting", companyId }, token, serverUrl)
        queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
      })
      .catch((e) => toast({ title: "Could not join the meeting", description: String(e), variant: "destructive" }))
  }, [companyId, activeCall, startCall, queryClient, toast])

  /* ── Filtered list ── */
  const filteredMeetings = React.useMemo(() => {
    if (!meetings) return []
    if (filter === "upcoming") return meetings.filter((m) => m.status === "scheduled" || m.status === "ongoing")
    if (filter === "completed") return meetings.filter((m) => m.status === "ended" || m.status === "cancelled")
    return meetings
  }, [meetings, filter])

  /* ── Actions ── */
  const joinMeeting = async (meetingId: string, title: string) => {
    if (activeCall || joiningId) return
    setJoiningId(meetingId)
    try {
      const r = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meetingId)}&companyId=${companyId}`, { credentials: "include" })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast({ title: "Could not join", description: err.error || "Failed to get token", variant: "destructive" })
        return
      }
      const { token, serverUrl } = await r.json()
      await fetch(`/api/meetings/join/${meetingId}`, { method: "POST", credentials: "include" })
      startCall({ meetingId, title, companyId: companyId! }, token, serverUrl)
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
    } finally { setJoiningId(null) }
  }

  const deleteMeeting = async (id: number) => {
    if (deletingId) return
    setDeletingId(id)
    try {
      const r = await fetch(`/api/meetings/${id}?companyId=${companyId}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) { toast({ title: "Failed to delete meeting", variant: "destructive" }); return }
      toast({ title: "Meeting removed" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
    } finally { setDeletingId(null) }
  }

  const startInstantMeeting = async (video: boolean) => {
    if (startingInstant) return
    setStartingInstant(video ? "video" : "voice")
    try {
      const r = await fetch(`/api/meetings`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, title: video ? "Instant Video Meeting" : "Instant Voice Meeting" }),
      })
      if (!r.ok) { toast({ title: "Failed to start", description: await r.text(), variant: "destructive" }); return }
      const meeting = await r.json()
      const tr = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meeting.meetingId)}&companyId=${companyId}`, { credentials: "include" })
      if (!tr.ok) { toast({ title: "Meeting created but failed to join", description: await tr.text(), variant: "destructive" }); return }
      const { token, serverUrl } = await tr.json()
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      startCall({ id: meeting.id, meetingId: meeting.meetingId, title: meeting.title, companyId: companyId! }, token, serverUrl, { video })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
    } finally { setStartingInstant(null) }
  }

  const openEditMeeting = (m: Meeting) => {
    setEditingMeeting(m)
    setSchedTitle(m.title)
    setSchedWhen(m.scheduledAt ? new Date(m.scheduledAt).toISOString().slice(0, 16) : "")
    setSchedDuration(String(m.duration))
    setSchedRecurrence(m.isRecurring && m.recurrence ? m.recurrence : "none")
    setSchedParticipants(m.participants?.map((p) => p.userId) ?? [])
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!editingMeeting || !schedTitle.trim() || editSaving) return
    const when = schedWhen ? new Date(schedWhen) : null
    if (when && isNaN(when.getTime())) {
      toast({ title: "Invalid date and time", variant: "destructive" }); return
    }
    setEditSaving(true)
    try {
      const r = await fetch(`/api/meetings/${editingMeeting.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, title: schedTitle.trim(),
          scheduledAt: when?.toISOString(),
          duration: Number(schedDuration) || 30,
          isRecurring: schedRecurrence !== "none",
          recurrence: schedRecurrence !== "none" ? schedRecurrence : null,
          participantIds: schedParticipants,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast({ title: "Failed to update meeting", description: err.error || "", variant: "destructive" }); return
      }
      toast({ title: "Meeting updated" })
      setEditOpen(false)
      setEditingMeeting(null)
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
    } finally { setEditSaving(false) }
  }

  const submitSchedule = async () => {
    if (!schedTitle.trim() || !schedWhen || schedSaving) return
    const when = new Date(schedWhen)
    if (isNaN(when.getTime()) || when.getTime() < Date.now()) {
      toast({ title: "Pick a future date and time", variant: "destructive" }); return
    }
    setSchedSaving(true)
    try {
      const r = await fetch(`/api/meetings`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, title: schedTitle.trim(), scheduledAt: when.toISOString(),
          duration: Number(schedDuration) || 30, participantIds: schedParticipants,
          isRecurring: schedRecurrence !== "none", recurrence: schedRecurrence !== "none" ? schedRecurrence : undefined,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast({ title: "Failed to schedule", description: err.error || "", variant: "destructive" }); return
      }
      toast({ title: "Meeting scheduled ✓", description: `"${schedTitle.trim()}" — invitees notified` })
      setScheduleOpen(false)
      setSchedTitle(""); setSchedWhen(""); setSchedDuration("30"); setSchedRecurrence("none"); setSchedParticipants([])
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", companyId] })
    } finally { setSchedSaving(false) }
  }

  const retryNote = async () => {
    if (!openNoteId || !companyId || retryingNote) return
    setRetryingNote(true)
    try {
      const r = await fetch(`/api/meetings/notes/${openNoteId}/retry?companyId=${companyId}`, { method: "POST", credentials: "include" })
      if (!r.ok) { toast({ title: "Retry failed", variant: "destructive" }); return }
      toast({ title: "AI notes re-triggered — processing…" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally { setRetryingNote(false) }
  }

  const assignActionItem = async (index: number, employeeId: string) => {
    if (!openNoteId || !companyId || assigningIndex !== null) return
    setAssigningIndex(index)
    try {
      const r = await fetch(`/api/meetings/notes/${openNoteId}/assign-task`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, actionItemIndex: index, employeeId: Number(employeeId) }),
      })
      if (!r.ok) { toast({ title: "Failed to assign task", variant: "destructive" }); return }
      toast({ title: "Task created and assigned" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally { setAssigningIndex(null) }
  }

  /* ── No company guard ── */
  if (!companyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${BLUE}20` }}>
          <Video className="h-8 w-8" style={{ color: BLUE }} />
        </div>
        <div className="text-center space-y-1">
          <p className="text-lg font-semibold">Select a workspace</p>
          <p className="text-sm text-muted-foreground">Choose a company to view meetings.</p>
        </div>
        <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Choose a workspace" /></SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const upcomingCount = meetings?.filter((m) => m.status === "scheduled" || m.status === "ongoing").length ?? 0

  /* ─────────────────────────────── RENDER ──────────────────────────────── */
  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] overflow-hidden">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0 glass-header"
        style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
        <div>
          <h1 className="text-xl font-bold leading-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground leading-tight">
            {activeCompany?.name ?? "Workspace"} · {upcomingCount} upcoming
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" className="gap-2 rounded-xl"
            disabled={!!startingInstant || !!activeCall} onClick={() => startInstantMeeting(false)}>
            {startingInstant === "voice" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Voice
          </Button>
          <Button size="sm" className="gap-2 rounded-xl"
            style={{ background: BLUE, color: "#fff", boxShadow: `0 4px 14px ${BLUE}40` }}
            disabled={!!startingInstant || !!activeCall} onClick={() => startInstantMeeting(true)}>
            {startingInstant === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            Start Now
          </Button>
          <Button size="sm" variant="outline" className="gap-2 rounded-xl" onClick={() => setScheduleOpen(true)}>
            <Plus className="h-4 w-4" /> Schedule
          </Button>
        </div>
      </div>

      {/* ── Module tabs ── */}
      <div className="flex gap-1 px-6 pt-3 pb-0 shrink-0">
        {([
          { key: "meetings", label: "Meetings", icon: CalendarClock },
          { key: "notes",    label: "AI Notes",  icon: Sparkles },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} data-compact
            onClick={() => setTab(key)}
            className={cn(
              "btn-compact flex items-center gap-2 px-4 py-2 rounded-t-xl text-sm font-semibold transition-all border-b-2",
              tab === key
                ? "text-white border-transparent"
                : "text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/60"
            )}
            style={tab === key ? { background: BLUE, boxShadow: `0 4px 12px ${BLUE}40` } : {}}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ════ MEETINGS TAB ════ */}
        {tab === "meetings" && (
          <div className="px-6 py-4 space-y-4 max-w-3xl mx-auto">

            {/* Filter pills */}
            <div className="flex gap-2">
              {([
                { key: "upcoming",  label: "Upcoming" },
                { key: "all",       label: "All" },
                { key: "completed", label: "Completed" },
              ] as const).map(({ key, label }) => (
                <button key={key} data-compact
                  onClick={() => setFilter(key)}
                  className={cn(
                    "btn-compact px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-all border",
                    filter === key
                      ? "text-white border-transparent"
                      : "text-muted-foreground border-border hover:bg-muted/60"
                  )}
                  style={filter === key ? { background: BLUE, boxShadow: `0 2px 8px ${BLUE}40` } : {}}
                >
                  {label}
                </button>
              ))}
            </div>

            {isLoadingMeetings ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: BLUE }} />
              </div>
            ) : filteredMeetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: `${BLUE}15`, border: `2px solid ${BLUE}25` }}>
                  <CalendarClock className="h-9 w-9" style={{ color: BLUE, opacity: 0.7 }} />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-lg">
                    {filter === "upcoming" ? "No upcoming meetings" :
                     filter === "completed" ? "No completed meetings" : "No meetings yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {filter === "upcoming" ? "Schedule one or start an instant meeting." :
                     filter === "completed" ? "Completed meetings will appear here." :
                     "Your meeting history will appear here."}
                  </p>
                </div>
                {filter === "upcoming" && (
                  <div className="flex gap-2 flex-wrap justify-center">
                    <Button variant="outline" className="rounded-xl gap-2" onClick={() => startInstantMeeting(false)}
                      disabled={!!startingInstant || !!activeCall}>
                      <Mic className="h-4 w-4" /> Voice Call
                    </Button>
                    <Button className="rounded-xl gap-2" style={{ background: BLUE, color: "#fff" }}
                      onClick={() => startInstantMeeting(true)} disabled={!!startingInstant || !!activeCall}>
                      <Video className="h-4 w-4" /> Start Video
                    </Button>
                    <Button variant="outline" className="rounded-xl gap-2" onClick={() => setScheduleOpen(true)}>
                      <CalendarClock className="h-4 w-4" /> Schedule
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMeetings.map((m) => {
                  const isCompleted = m.status === "ended" || m.status === "cancelled"
                  const isJoining = joiningId === m.meetingId
                  const isDeleting = deletingId === m.id
                  const rel = fromNow(m.scheduledAt)

                  return (
                    <div key={m.id}
                      className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-border/60 transition-all hover:border-border"
                      style={{ background: "hsl(var(--card))", opacity: isCompleted ? 0.75 : 1 }}>

                      {/* Date block */}
                      <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 text-center"
                        style={{
                          background: isCompleted ? "hsl(var(--muted))" : `${BLUE}18`,
                          border: `1.5px solid ${isCompleted ? "hsl(var(--border))" : `${BLUE}30`}`,
                        }}>
                        {m.scheduledAt ? (
                          <>
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
                              {new Date(m.scheduledAt).toLocaleDateString(undefined, { month: "short" })}
                            </span>
                            <span className="text-xl font-black leading-tight" style={{ color: isCompleted ? undefined : BLUE }}>
                              {new Date(m.scheduledAt).getDate()}
                            </span>
                          </>
                        ) : (
                          <Clock className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[0.9375rem] truncate">{m.title}</span>
                          <StatusBadge status={m.status} />
                          {m.isRecurring && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: `${BLUE}18`, color: BLUE }}>
                              <Repeat className="h-2.5 w-2.5" />{m.recurrence}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />{formatDateTime(m.scheduledAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{m.duration} min
                          </span>
                          {rel && (
                            <span className="font-medium" style={{ color: isCompleted ? undefined : BLUE }}>{rel}</span>
                          )}
                          {(m.participants?.length ?? 0) > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />{m.participants!.length} participant{m.participants!.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isCompleted ? (
                          <Button size="sm" variant="outline"
                            className="rounded-xl gap-2 shrink-0 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                            disabled={isDeleting} onClick={() => deleteMeeting(m.id)}>
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Delete
                          </Button>
                        ) : (
                          <Button size="sm" className="rounded-xl gap-2 shrink-0"
                            style={m.status === "ongoing"
                              ? { background: "#22c55e", color: "#fff", boxShadow: "0 4px 14px #22c55e40" }
                              : { background: BLUE, color: "#fff", boxShadow: `0 4px 14px ${BLUE}40` }}
                            disabled={!!activeCall || !!joiningId} onClick={() => joinMeeting(m.meetingId, m.title)}>
                            {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                            {m.status === "ongoing" ? "Join Live" : "Join"}
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl">
                            <DropdownMenuItem onClick={() => openEditMeeting(m)} className="gap-2 cursor-pointer">
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => deleteMeeting(m.id)}
                              disabled={isDeleting}
                              className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                            >
                              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ════ AI NOTES TAB ════ */}
        {tab === "notes" && (
          <div className="px-6 py-4 max-w-3xl mx-auto space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={notesQuery} onChange={(e) => setNotesQuery(e.target.value)}
                placeholder="Search meeting notes…" className="pl-9 rounded-xl" />
              {notesQuery && (
                <button data-compact className="btn-compact absolute right-3 top-1/2 -translate-y-1/2"
                  onClick={() => setNotesQuery("")}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            {isLoadingNotes ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: BLUE }} />
              </div>
            ) : !meetingNotes?.length ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: `${BLUE}15`, border: `2px solid ${BLUE}25` }}>
                  <Sparkles className="h-9 w-9" style={{ color: BLUE, opacity: 0.7 }} />
                </div>
                <p className="font-semibold text-lg">No AI notes yet</p>
                <p className="text-sm text-muted-foreground">Generated automatically after meetings end.</p>
              </div>
            ) : (
              meetingNotes.map((note) => (
                <button key={note.id} onClick={() => setOpenNoteId(note.id)}
                  className="w-full text-left flex items-start gap-4 px-5 py-4 rounded-2xl border border-border/60 hover:border-primary/30 transition-all group"
                  style={{ background: "hsl(var(--card))" }}>
                  <div className="mt-0.5 shrink-0">
                    {note.status === "done" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                    {note.status === "processing" && <Loader2 className="h-5 w-5 animate-spin" style={{ color: BLUE }} />}
                    {note.status === "failed" && <AlertCircle className="h-5 w-5 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[0.9375rem] truncate group-hover:text-primary transition-colors">
                        {note.title}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(note.createdAt)}</span>
                    </div>
                    {note.summary && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{note.summary}</p>
                    )}
                    {note.actionItems?.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <ClipboardList className="h-3.5 w-3.5" style={{ color: BLUE }} />
                        <span className="text-xs text-muted-foreground">
                          {note.actionItems.length} action item{note.actionItems.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-1 group-hover:text-primary transition-colors" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ════ SCHEDULE DIALOG ════ */}
      <Dialog open={scheduleOpen || editOpen} onOpenChange={(v) => { if (!v) { setScheduleOpen(false); setEditOpen(false); setEditingMeeting(null) } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" style={{ color: BLUE }} />
              {editOpen ? "Edit Meeting" : "Schedule a Meeting"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <Input value={schedTitle} onChange={(e) => setSchedTitle(e.target.value)}
                placeholder="e.g. Weekly sync, Sprint review…" className="rounded-xl" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Date & Time</label>
              <Input type="datetime-local" value={schedWhen} onChange={(e) => setSchedWhen(e.target.value)} className="rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Duration</label>
                <Select value={schedDuration} onValueChange={setSchedDuration}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[15, 30, 45, 60, 90, 120].map((d) => (
                      <SelectItem key={d} value={d.toString()}>{d} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Recurrence</label>
                <Select value={schedRecurrence} onValueChange={setSchedRecurrence}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Invite participants */}
            {workspaceUsers && workspaceUsers.filter((u) => u.id !== user?.id).length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Invite participants</label>
                <div className="max-h-40 overflow-y-auto rounded-xl border p-2 space-y-0.5">
                  {workspaceUsers.filter((u) => u.id !== user?.id).map((u) => (
                    <label key={u.id} className="flex items-center gap-3 text-sm rounded-xl px-2 py-2 hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={schedParticipants.includes(u.id)}
                        onChange={(e) => setSchedParticipants((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} />
                      <span className="flex-1 font-medium truncate">{u.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button className="rounded-xl gap-2" style={{ background: BLUE, color: "#fff" }}
                disabled={!schedTitle.trim() || (editOpen ? false : !schedWhen) || (editOpen ? editSaving : schedSaving)} onClick={editOpen ? submitEdit : submitSchedule}>
                {(editOpen ? editSaving : schedSaving) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                {editOpen ? "Save Changes" : "Schedule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ════ NOTE DETAIL DIALOG ════ */}
      <Dialog open={!!openNoteId} onOpenChange={(v) => { if (!v) setOpenNoteId(null) }}>
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85vh] overflow-y-auto">
          {openNote ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <button data-compact className="btn-compact mr-1" onClick={() => setOpenNoteId(null)}>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <Sparkles className="h-5 w-5 shrink-0" style={{ color: BLUE }} />
                  <span className="truncate">{openNote.title}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-5 pt-1">
                {openNote.status === "processing" && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: `${BLUE}12`, border: `1px solid ${BLUE}25` }}>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: BLUE }} />
                    <span className="text-sm">AI is generating notes — check back in a moment…</span>
                  </div>
                )}
                {openNote.status === "failed" && (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-sm text-destructive">{openNote.error || "AI notes generation failed"}</span>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-lg gap-1.5 shrink-0" onClick={retryNote} disabled={retryingNote}>
                      {retryingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Retry
                    </Button>
                  </div>
                )}
                {openNote.summary && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Summary</h3>
                    <p className="text-sm leading-relaxed">{openNote.summary}</p>
                  </div>
                )}
                {openNote.notes && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Full Notes</h3>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans px-4 py-3 rounded-xl border border-border/50"
                      style={{ background: "hsl(var(--muted) / 0.4)" }}>{openNote.notes}</pre>
                  </div>
                )}
                {openNote.actionItems?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" style={{ color: BLUE }} />
                      Action Items ({openNote.actionItems.length})
                    </h3>
                    <div className="space-y-2">
                      {openNote.actionItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/50"
                          style={{ background: "hsl(var(--card))" }}>
                          <div className="w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-bold text-white"
                            style={{ background: BLUE }}>{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.title}</p>
                            {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {item.priority && <Badge variant="outline" className="text-[10px] h-4">{item.priority}</Badge>}
                              {item.dueDate && (
                                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> Due {item.dueDate}
                                </span>
                              )}
                              {item.assigneeName && (
                                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Users className="h-3 w-3" /> {item.assigneeName}
                                </span>
                              )}
                            </div>
                          </div>
                          {item.taskId ? (
                            <Badge className="text-[10px] h-5 gap-1 rounded-lg shrink-0"
                              style={{ background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e40" }}>
                              <CheckCircle2 className="h-3 w-3" /> Task #{item.taskId}
                            </Badge>
                          ) : employeesData?.items?.length ? (
                            <Select onValueChange={(v) => assignActionItem(idx, v)} disabled={assigningIndex !== null}>
                              <SelectTrigger className="w-36 h-7 text-xs rounded-lg shrink-0">
                                {assigningIndex === idx
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <><UserPlus className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Assign" /></>}
                              </SelectTrigger>
                              <SelectContent>
                                {employeesData.items.map((e) => (
                                  <SelectItem key={e.id} value={e.id.toString()}>
                                    {e.firstName} {e.lastName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {openNote.transcript && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Transcript</h3>
                    <div className="text-xs leading-relaxed whitespace-pre-wrap px-4 py-3 rounded-xl border border-border/50 max-h-40 overflow-y-auto"
                      style={{ background: "hsl(var(--muted) / 0.4)" }}>
                      {openNote.transcript}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin" style={{ color: BLUE }} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
