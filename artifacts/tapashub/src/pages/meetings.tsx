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
import { cn } from "@/lib/utils"
import {
  Video, Phone, Plus, CalendarClock, Repeat, ClipboardList, Loader2,
  Sparkles, ChevronRight, Users, Search, X, Calendar, Clock, Mic,
  CheckCircle2, AlertCircle, RotateCcw, UserPlus,
} from "lucide-react"

/* ─────────────────────────── Types ─────────────────────────────────────── */
interface UpcomingMeeting {
  id: number; meetingId: string; title: string; scheduledAt: string | null
  duration: number; status: string; isRecurring: boolean; recurrence: string | null; organizerId: number
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

/* ─────────────────────────── Constants ─────────────────────────────────── */
const BRAND_BLUE = "#3B82F6"
const BRAND_BLUE_DARK = "#1d6fd8"

/* ─────────────────────────── Helpers ───────────────────────────────────── */
function formatRelative(date: string | null) {
  if (!date) return "Unscheduled"
  const d = new Date(date)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const absDiff = Math.abs(diff)
  if (absDiff < 60_000) return "Now"
  if (absDiff < 3_600_000) return `${Math.floor(absDiff / 60_000)}m ${diff > 0 ? "from now" : "ago"}`
  if (absDiff < 86_400_000) return `${Math.floor(absDiff / 3_600_000)}h ${diff > 0 ? "from now" : "ago"}`
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}
function formatDateTime(date: string | null) {
  if (!date) return "—"
  return new Date(date).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}
function timeAgo(date: string) {
  const d = Date.now() - new Date(date).getTime()
  if (d < 60_000) return "just now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return new Date(date).toLocaleDateString()
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
      const defaultId = activeCompany?.id ?? parentCompany?.id
      if (defaultId) setSelectedCompanyId(defaultId.toString())
    }
  }, [activeCompany?.id, parentCompany?.id])

  /* ── View state ── */
  const [tab, setTab] = React.useState<"upcoming" | "notes">("upcoming")
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [schedTitle, setSchedTitle] = React.useState("")
  const [schedWhen, setSchedWhen] = React.useState("")
  const [schedDuration, setSchedDuration] = React.useState("30")
  const [schedRecurrence, setSchedRecurrence] = React.useState("none")
  const [schedParticipants, setSchedParticipants] = React.useState<number[]>([])
  const [schedSaving, setSchedSaving] = React.useState(false)
  const [joiningId, setJoiningId] = React.useState<string | null>(null)
  const [startingInstant, setStartingInstant] = React.useState<"voice" | "video" | null>(null)
  const [notesQuery, setNotesQuery] = React.useState("")
  const [openNoteId, setOpenNoteId] = React.useState<number | null>(null)
  const [retryingNote, setRetryingNote] = React.useState(false)
  const [assigningIndex, setAssigningIndex] = React.useState<number | null>(null)

  /* ── Queries ── */
  const { data: upcomingMeetings, isLoading: isLoadingUpcoming } = useQuery<UpcomingMeeting[]>({
    queryKey: ["/api/meetings/upcoming", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/upcoming?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
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
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 5_000 : false),
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
        queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      })
      .catch((e) => toast({ title: "Could not join the meeting", description: String(e), variant: "destructive" }))
  }, [companyId, activeCall, startCall, queryClient, toast])

  /* ── Actions ── */
  const joinMeeting = async (meetingId: string, title: string) => {
    if (activeCall || joiningId) return
    setJoiningId(meetingId)
    try {
      const tokenRes = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meetingId)}&companyId=${companyId}`, { credentials: "include" })
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}))
        toast({ title: "Could not join", description: err.error || "Failed to get call token", variant: "destructive" })
        return
      }
      const { token, serverUrl } = await tokenRes.json()
      await fetch(`/api/meetings/join/${meetingId}`, { method: "POST", credentials: "include" })
      startCall({ meetingId, title, companyId: companyId! }, token, serverUrl)
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    } finally { setJoiningId(null) }
  }

  const startInstantMeeting = async (video: boolean) => {
    if (startingInstant) return
    setStartingInstant(video ? "video" : "voice")
    try {
      const res = await fetch(`/api/meetings`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, title: video ? "Instant Video Meeting" : "Instant Voice Meeting" }),
      })
      if (!res.ok) { toast({ title: "Failed to start meeting", description: await res.text(), variant: "destructive" }); return }
      const meeting = await res.json()
      const tokenRes = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meeting.meetingId)}&companyId=${companyId}`, { credentials: "include" })
      if (!tokenRes.ok) { toast({ title: "Meeting created but failed to join", description: await tokenRes.text(), variant: "destructive" }); return }
      const { token, serverUrl } = await tokenRes.json()
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      startCall({ id: meeting.id, meetingId: meeting.meetingId, title: meeting.title, companyId: companyId! }, token, serverUrl, { video })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    } finally { setStartingInstant(null) }
  }

  const submitSchedule = async () => {
    if (!schedTitle.trim() || !schedWhen || schedSaving) return
    const when = new Date(schedWhen)
    if (isNaN(when.getTime()) || when.getTime() < Date.now()) {
      toast({ title: "Pick a future date and time", variant: "destructive" }); return
    }
    setSchedSaving(true)
    try {
      const res = await fetch(`/api/meetings`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, title: schedTitle.trim(), scheduledAt: when.toISOString(),
          duration: Number(schedDuration) || 30, participantIds: schedParticipants,
          isRecurring: schedRecurrence !== "none", recurrence: schedRecurrence !== "none" ? schedRecurrence : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Failed to schedule", description: err.error || "", variant: "destructive" })
        return
      }
      toast({ title: "Meeting scheduled ✓", description: `"${schedTitle.trim()}" — invitees notified` })
      setScheduleOpen(false)
      setSchedTitle(""); setSchedWhen(""); setSchedDuration("30"); setSchedRecurrence("none"); setSchedParticipants([])
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/upcoming", companyId] })
    } finally { setSchedSaving(false) }
  }

  const retryNote = async () => {
    if (!openNoteId || !companyId || retryingNote) return
    setRetryingNote(true)
    try {
      const res = await fetch(`/api/meetings/notes/${openNoteId}/retry?companyId=${companyId}`, { method: "POST", credentials: "include" })
      if (!res.ok) { toast({ title: "Retry failed", variant: "destructive" }); return }
      toast({ title: "AI notes re-triggered — processing…" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally { setRetryingNote(false) }
  }

  const assignActionItem = async (index: number, employeeId: string) => {
    if (!openNoteId || !companyId || assigningIndex !== null) return
    setAssigningIndex(index)
    try {
      const res = await fetch(`/api/meetings/notes/${openNoteId}/assign-task`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, actionItemIndex: index, employeeId: Number(employeeId) }),
      })
      if (!res.ok) { toast({ title: "Failed to assign task", variant: "destructive" }); return }
      toast({ title: "Task created and assigned" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally { setAssigningIndex(null) }
  }

  /* ── No company guard ── */
  if (!companyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${BRAND_BLUE}20` }}>
          <Video className="h-8 w-8" style={{ color: BRAND_BLUE }} />
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

  /* ─────────────────────────────── RENDER ──────────────────────────────── */
  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] overflow-hidden">
      {/* ── Page header ── */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0 glass-header"
        style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
      >
        <div>
          <h1 className="text-xl font-bold leading-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground leading-tight">
            {activeCompany?.name ?? "Workspace"} · {upcomingMeetings?.length ?? 0} upcoming
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Instant meeting buttons */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
            disabled={!!startingInstant || !!activeCall}
            onClick={() => startInstantMeeting(false)}
          >
            {startingInstant === "voice"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Mic className="h-4 w-4" />}
            Voice
          </Button>
          <Button
            size="sm"
            className="gap-2 rounded-xl"
            style={{ background: BRAND_BLUE, color: "#fff", boxShadow: `0 4px 14px ${BRAND_BLUE}40` }}
            disabled={!!startingInstant || !!activeCall}
            onClick={() => startInstantMeeting(true)}
          >
            {startingInstant === "video"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Video className="h-4 w-4" />}
            Start Now
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 rounded-xl"
            onClick={() => setScheduleOpen(true)}
          >
            <CalendarClock className="h-4 w-4" />
            Schedule
          </Button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 px-6 py-3 shrink-0 border-b border-border/40">
        {([
          { key: "upcoming", label: "Upcoming", icon: CalendarClock },
          { key: "notes", label: "AI Notes", icon: Sparkles },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            data-compact
            onClick={() => setTab(key)}
            className={cn(
              "btn-compact flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              tab === key
                ? "text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
            style={tab === key ? { background: BRAND_BLUE, boxShadow: `0 4px 12px ${BRAND_BLUE}40` } : {}}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ════ UPCOMING TAB ════ */}
        {tab === "upcoming" && (
          <div className="space-y-3 max-w-3xl mx-auto">
            {isLoadingUpcoming ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: BRAND_BLUE }} />
              </div>
            ) : !upcomingMeetings?.length ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div
                  className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: `${BRAND_BLUE}15`, border: `2px solid ${BRAND_BLUE}25` }}
                >
                  <CalendarClock className="h-9 w-9" style={{ color: BRAND_BLUE, opacity: 0.7 }} />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-lg">No upcoming meetings</p>
                  <p className="text-sm text-muted-foreground">Schedule one or start an instant meeting.</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2"
                    onClick={() => startInstantMeeting(false)}
                    disabled={!!startingInstant || !!activeCall}
                  >
                    <Mic className="h-4 w-4" /> Voice Call
                  </Button>
                  <Button
                    className="rounded-xl gap-2"
                    style={{ background: BRAND_BLUE, color: "#fff" }}
                    onClick={() => startInstantMeeting(true)}
                    disabled={!!startingInstant || !!activeCall}
                  >
                    <Video className="h-4 w-4" /> Start Video Meeting
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2"
                    onClick={() => setScheduleOpen(true)}
                  >
                    <CalendarClock className="h-4 w-4" /> Schedule Meeting
                  </Button>
                </div>
              </div>
            ) : (
              upcomingMeetings.map((m) => {
                const isPast = m.scheduledAt ? new Date(m.scheduledAt).getTime() < Date.now() : false
                const isJoining = joiningId === m.meetingId
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-border/60 transition-all hover:border-primary/30"
                    style={{ background: "hsl(var(--card))" }}
                  >
                    {/* Date block */}
                    <div
                      className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0"
                      style={{ background: isPast ? "hsl(var(--muted))" : `${BRAND_BLUE}18`, border: `1.5px solid ${isPast ? "hsl(var(--border))" : `${BRAND_BLUE}30`}` }}
                    >
                      {m.scheduledAt ? (
                        <>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
                            {new Date(m.scheduledAt).toLocaleDateString(undefined, { month: "short" })}
                          </span>
                          <span className="text-xl font-black leading-tight" style={{ color: isPast ? undefined : BRAND_BLUE }}>
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
                        {m.isRecurring && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                            style={{ background: `${BRAND_BLUE}18`, color: BRAND_BLUE }}>
                            <Repeat className="h-2.5 w-2.5" /> {m.recurrence}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 capitalize"
                          style={m.status === "live" ? { borderColor: "#22c55e", color: "#22c55e" } : {}}
                        >
                          {m.status === "live" ? "🔴 Live" : m.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(m.scheduledAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {m.duration} min
                        </span>
                        <span className="font-medium" style={{ color: isPast ? undefined : BRAND_BLUE }}>
                          {formatRelative(m.scheduledAt)}
                        </span>
                      </div>
                    </div>

                    {/* Join button */}
                    <Button
                      size="sm"
                      className="rounded-xl gap-2 shrink-0"
                      style={m.status === "live"
                        ? { background: "#22c55e", color: "#fff", boxShadow: "0 4px 14px #22c55e40" }
                        : { background: BRAND_BLUE, color: "#fff", boxShadow: `0 4px 14px ${BRAND_BLUE}40` }}
                      disabled={!!activeCall || !!joiningId}
                      onClick={() => joinMeeting(m.meetingId, m.title)}
                    >
                      {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                      {m.status === "live" ? "Join Live" : "Join"}
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ════ NOTES TAB ════ */}
        {tab === "notes" && (
          <div className="max-w-3xl mx-auto space-y-4">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={notesQuery}
                onChange={(e) => setNotesQuery(e.target.value)}
                placeholder="Search meeting notes…"
                className="pl-9 rounded-xl"
              />
              {notesQuery && (
                <button data-compact className="btn-compact absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setNotesQuery("")}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            {isLoadingNotes ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: BRAND_BLUE }} />
              </div>
            ) : !meetingNotes?.length ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: `${BRAND_BLUE}15`, border: `2px solid ${BRAND_BLUE}25` }}>
                  <Sparkles className="h-9 w-9" style={{ color: BRAND_BLUE, opacity: 0.7 }} />
                </div>
                <p className="font-semibold text-lg">No AI notes yet</p>
                <p className="text-sm text-muted-foreground">
                  Notes are generated automatically after meetings end.
                </p>
              </div>
            ) : (
              meetingNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => setOpenNoteId(note.id)}
                  className="w-full text-left flex items-start gap-4 px-5 py-4 rounded-2xl border border-border/60 hover:border-primary/30 transition-all group"
                  style={{ background: "hsl(var(--card))" }}
                >
                  {/* Status icon */}
                  <div className="mt-0.5 shrink-0">
                    {note.status === "done" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                    {note.status === "processing" && <Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} />}
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
                        <ClipboardList className="h-3.5 w-3.5" style={{ color: BRAND_BLUE }} />
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
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" style={{ color: BRAND_BLUE }} />
              Schedule a Meeting
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <Input
                value={schedTitle}
                onChange={(e) => setSchedTitle(e.target.value)}
                placeholder="e.g. Weekly sync, Sprint review…"
                className="rounded-xl"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Date & Time</label>
              <Input
                type="datetime-local"
                value={schedWhen}
                onChange={(e) => setSchedWhen(e.target.value)}
                className="rounded-xl"
              />
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
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button
                className="rounded-xl gap-2"
                style={{ background: BRAND_BLUE, color: "#fff" }}
                disabled={!schedTitle.trim() || !schedWhen || schedSaving}
                onClick={submitSchedule}
              >
                {schedSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                Schedule
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
                  <Sparkles className="h-5 w-5 shrink-0" style={{ color: BRAND_BLUE }} />
                  <span className="truncate">{openNote.title}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 pt-1">
                {/* Status */}
                {openNote.status === "processing" && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: `${BRAND_BLUE}12`, border: `1px solid ${BRAND_BLUE}25` }}>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: BRAND_BLUE }} />
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

                {/* Summary */}
                {openNote.summary && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Summary</h3>
                    <p className="text-sm leading-relaxed">{openNote.summary}</p>
                  </div>
                )}

                {/* Notes */}
                {openNote.notes && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Full Notes</h3>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-3 rounded-xl border border-border/50"
                      style={{ background: "hsl(var(--muted) / 0.4)" }}>
                      {openNote.notes}
                    </div>
                  </div>
                )}

                {/* Action items */}
                {openNote.actionItems?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" style={{ color: BRAND_BLUE }} />
                      Action Items ({openNote.actionItems.length})
                    </h3>
                    <div className="space-y-2">
                      {openNote.actionItems.map((item, idx) => (
                        <div key={idx}
                          className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/50"
                          style={{ background: "hsl(var(--card))" }}>
                          <div className="w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-bold text-white"
                            style={{ background: BRAND_BLUE }}>{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.title}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {item.priority && (
                                <Badge variant="outline" className="text-[10px] h-4">
                                  {item.priority}
                                </Badge>
                              )}
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
                          {/* Assign to employee */}
                          {!item.taskId && employeesData?.items?.length ? (
                            <Select
                              onValueChange={(v) => assignActionItem(idx, v)}
                              disabled={assigningIndex !== null}
                            >
                              <SelectTrigger className="w-36 h-7 text-xs rounded-lg">
                                {assigningIndex === idx
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <><UserPlus className="h-3.5 w-3.5" /><SelectValue placeholder="Assign" /></>}
                              </SelectTrigger>
                              <SelectContent>
                                {employeesData.items.map((e) => (
                                  <SelectItem key={e.id} value={e.id.toString()}>
                                    {e.firstName} {e.lastName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : item.taskId ? (
                            <Badge className="text-[10px] h-5 gap-1 rounded-lg" style={{ background: "#22c55e20", color: "#22c55e", border: "1px solid #22c55e40" }}>
                              <CheckCircle2 className="h-3 w-3" /> Task created
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transcript */}
                {openNote.transcript && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 uppercase tracking-wide text-muted-foreground">Transcript</h3>
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
              <Loader2 className="h-7 w-7 animate-spin" style={{ color: BRAND_BLUE }} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
