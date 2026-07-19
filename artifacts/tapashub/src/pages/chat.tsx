import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { useDmNotification } from "@/contexts/dm-notification-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMeeting } from "@/contexts/meeting-context"
import { cn } from "@/lib/utils"
import {
  MessageSquare, Pin, Search, Send, Paperclip, Megaphone, User, Video, Phone, Briefcase, X, Building2,
  Sparkles, Loader2, ChevronLeft, ClipboardList, CalendarClock, Repeat, Plus, Smile, Mic,
  Hash, Users,
} from "lucide-react"

/* ─────────────────────────────── Types ─────────────────────────────────── */
interface UpcomingMeeting {
  id: number; meetingId: string; title: string; scheduledAt: string | null
  duration: number; status: string; isRecurring: boolean; recurrence: string | null; organizerId: number
}
interface ChatChannel {
  id: number; type: "team" | "department" | "direct" | "project"; name: string
  department?: string; projectId?: number; unread: number
}
interface ChatMessage {
  id: number; channelId: number; userId: number; displayName: string; content: string
  replyToId?: number; attachments: Array<{ name: string; objectPath: string; contentType: string; size?: number }>
  reactions: Record<string, number[]>; mentions: number[]; isAnnouncement: boolean
  isPinned: boolean; editedAt: string | null; createdAt: string
}
interface ChatUser { id: number; name: string; email: string }
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

/* ─────────────────────────── Brand palette ─────────────────────────────── */
// TapasHub: #111111 black | #FFFFFF white | #2DA8FF primary blue | #0F1115 dark bg
// Used via inline styles so they work in both light and dark mode.

const BRAND_BLUE = "#2DA8FF"
const EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👏", "😮", "🚀"]

/* ─────────────────────────── Helpers ───────────────────────────────────── */
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
}
function timeAgo(date: string) {
  const d = Date.now() - new Date(date).getTime()
  if (d < 60_000) return "just now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return new Date(date).toLocaleDateString()
}

/* ─────────────────────────── Reusable avatar ───────────────────────────── */
function Avatar({ name, size = 36, blue = false }: { name: string; size?: number; blue?: boolean }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: blue ? BRAND_BLUE : "linear-gradient(135deg,#2DA8FF22,#2DA8FF55)",
        border: `1.5px solid ${BRAND_BLUE}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.35, fontWeight: 700, color: BRAND_BLUE,
      }}
    >
      {initials(name)}
    </div>
  )
}

/* ─────────────────────────────── Main Page ─────────────────────────────── */
export default function ChatPage() {
  const { activeCompany, companies, isParentView } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { startCall, activeCall } = useMeeting()
  const { setActiveChannelId } = useDmNotification()
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

  const userId = user?.id

  const [socket, setSocket] = React.useState<Socket | null>(null)
  const [selectedChannel, setSelectedChannel] = React.useState<ChatChannel | null>(null)
  const [input, setInput] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = React.useState<number[]>([])
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<ChatMessage[]>([])
  const [usersOpen, setUsersOpen] = React.useState(false)
  const [dmQuery, setDmQuery] = React.useState("")
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [showScheduleForm, setShowScheduleForm] = React.useState(false)
  const [schedTitle, setSchedTitle] = React.useState("")
  const [schedWhen, setSchedWhen] = React.useState("")
  const [schedDuration, setSchedDuration] = React.useState("30")
  const [schedRecurrence, setSchedRecurrence] = React.useState("none")
  const [schedParticipants, setSchedParticipants] = React.useState<number[]>([])
  const [schedSaving, setSchedSaving] = React.useState(false)
  const [joiningId, setJoiningId] = React.useState<string | null>(null)
  const [notesOpen, setNotesOpen] = React.useState(false)
  const [notesQuery, setNotesQuery] = React.useState("")
  const [openNoteId, setOpenNoteId] = React.useState<number | null>(null)
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  const [showMentions, setShowMentions] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [startingCall, setStartingCall] = React.useState<"voice" | "video" | null>(null)
  const [assigningIndex, setAssigningIndex] = React.useState<number | null>(null)
  const [retryingNote, setRetryingNote] = React.useState(false)
  const [channelFilter, setChannelFilter] = React.useState<"all" | "direct" | "groups" | "unread">("all")
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  // Tell the global DM notification listener which channel is active so it
  // doesn't pop a toast for messages the user is already reading.
  React.useEffect(() => {
    setActiveChannelId(selectedChannel?.id ?? null)
    return () => setActiveChannelId(null)
  }, [selectedChannel?.id, setActiveChannelId])

  const { data: channels, isLoading: isLoadingChannels } = useQuery<ChatChannel[]>({
    queryKey: ["/api/chat/channels", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/channels?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: channelUsers, isLoading: isLoadingUsers } = useQuery<ChatUser[]>({
    queryKey: ["/api/chat/users", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/users?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: upcomingMeetings, isLoading: isLoadingUpcoming } = useQuery<UpcomingMeeting[]>({
    queryKey: ["/api/meetings/upcoming", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/upcoming?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && scheduleOpen,
  })

  const { data: meetingNotes, isLoading: isLoadingNotes } = useQuery<MeetingNoteSummary[]>({
    queryKey: ["/api/meetings/notes", companyId, notesQuery],
    queryFn: async () => {
      const q = notesQuery ? `&q=${encodeURIComponent(notesQuery)}` : ""
      const res = await fetch(`/api/meetings/notes?companyId=${companyId}${q}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && notesOpen,
  })

  const { data: employeesData } = useQuery<{ items: Array<{ id: number; firstName: string; lastName: string }> }>({
    queryKey: ["/api/hr/employees", companyId, 1],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employees?companyId=${companyId}&page=1&limit=100`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && notesOpen && !!openNoteId,
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

  const selectedChannelRef = React.useRef(selectedChannel)
  selectedChannelRef.current = selectedChannel

  React.useEffect(() => {
    if (!companyId || !userId) return
    const s: Socket = io({
      path: "/api/socket.io",
      auth: (cb: (data: object) => void) => {
        fetch(`/api/chat/token`, { credentials: "include" })
          .then((r) => r.json())
          .then(({ token }) => cb({ token }))
          .catch(() => cb({}))
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
    })
    s.on("connect", () => {
      s.emit("join", { companyId }, (res: any) => {
        if (!res.ok) { toast({ title: "Chat join failed", description: res.error, variant: "destructive" }); return }
        const ch = selectedChannelRef.current
        if (ch) s.emit("join:channel", { channelId: ch.id }, (joinRes: any) => {
          if (!joinRes.ok) toast({ title: "Join channel failed", description: joinRes.error, variant: "destructive" })
        })
      })
    })
    s.on("message:new", (msg: ChatMessage) => {
      setMessages((prev) => {
        if (msg.channelId !== selectedChannelRef.current?.id) return prev
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels", companyId] })
    })
    s.on("message:reaction", (msg: ChatMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
    })
    s.on("typing", ({ channelId, userId: uid, typing }: any) => {
      setTypingUsers((prev) => {
        if (selectedChannelRef.current?.id !== channelId) return prev
        if (typing) return prev.includes(uid) ? prev : [...prev, uid]
        return prev.filter((id) => id !== uid)
      })
    })
    s.on("channel:update", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels", companyId] })
    })
    setSocket(s)
    return () => { s.disconnect(); setSocket(null) }
  }, [companyId, userId, queryClient, toast])

  React.useEffect(() => {
    if (!selectedChannel || !socket) return
    socket.emit("join:channel", { channelId: selectedChannel.id }, (res: any) => {
      if (!res.ok) toast({ title: "Join channel failed", description: res.error, variant: "destructive" })
    })
    fetch(`/api/chat/channels/${selectedChannel.id}/messages?companyId=${companyId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setMessages(data))
      .catch((err) => toast({ title: "Failed to load messages", description: String(err), variant: "destructive" }))
    setTypingUsers([])
  }, [selectedChannel, socket, companyId, toast])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-join from ?join= deep link
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

  const insertMention = (name: string) => {
    const cursor = input.length
    const textBeforeCursor = input.slice(0, cursor)
    const match = textBeforeCursor.match(/@([\w.]*)$/)
    if (match) {
      const before = textBeforeCursor.slice(0, textBeforeCursor.length - match[0].length)
      setInput(`${before}@${name} `)
    }
    setShowMentions(false)
    setMentionQuery(null)
  }

  const sendMessage = () => {
    if (!socket || !selectedChannel || !input.trim()) return
    const mentionIds: number[] = []
    if (channelUsers) {
      for (const u of channelUsers) {
        if (input.includes(`@${u.name}`) || input.includes(`@${u.email.split("@")[0]}`)) mentionIds.push(u.id)
      }
    }
    socket.emit("message:send", { channelId: selectedChannel.id, content: input, mentions: mentionIds, replyToId: replyTo?.id }, (res: any) => {
      if (!res.ok) toast({ title: "Send failed", description: res.error, variant: "destructive" })
    })
    setInput("")
    setReplyTo(null)
  }

  const toggleReaction = (messageId: number, emoji: string) => {
    if (!socket) return
    const msg = messages.find((m) => m.id === messageId)
    const hasReacted = msg?.reactions?.[emoji]?.includes(userId ?? 0)
    socket.emit(hasReacted ? "reaction:remove" : "reaction:add", { messageId, emoji })
  }

  const handleSearch = async () => {
    if (!searchQuery || !companyId) return
    const res = await fetch(`/api/chat/search?companyId=${companyId}&q=${encodeURIComponent(searchQuery)}`, { credentials: "include" })
    if (res.ok) setSearchResults(await res.json())
  }

  const startDirect = async (otherUserId: number) => {
    const res = await fetch(`/api/chat/direct`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, userId: otherUserId }),
    })
    if (res.ok) {
      const { channelId } = await res.json()
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels", companyId] })
      const ch = channels?.find((c) => c.id === channelId)
      if (ch) setSelectedChannel(ch)
      setUsersOpen(false)
    }
  }

  const joinScheduledMeeting = async (meetingId: string, title: string) => {
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
      setScheduleOpen(false)
    } finally { setJoiningId(null) }
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
        toast({ title: "Failed to schedule meeting", description: err.error || (await res.text().catch(() => "")), variant: "destructive" })
        return
      }
      toast({ title: "Meeting scheduled", description: `"${schedTitle.trim()}" — invitees have been notified.` })
      setShowScheduleForm(false)
      setSchedTitle(""); setSchedWhen(""); setSchedDuration("30"); setSchedRecurrence("none"); setSchedParticipants([])
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/upcoming", companyId] })
    } finally { setSchedSaving(false) }
  }

  const startChannelCall = async (video: boolean) => {
    if (!selectedChannel || startingCall) return
    setStartingCall(video ? "video" : "voice")
    try {
      const res = await fetch(`/api/meetings`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, channelId: selectedChannel.id, title: `${selectedChannel.name} ${video ? "Call" : "Voice Call"}` }),
      })
      if (!res.ok) { toast({ title: "Failed to start call", description: await res.text(), variant: "destructive" }); return }
      const meeting = await res.json()
      const tokenRes = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meeting.meetingId)}&companyId=${companyId}`, { credentials: "include" })
      if (!tokenRes.ok) { toast({ title: "Call created, but failed to join", description: await tokenRes.text(), variant: "destructive" }); return }
      const { token, serverUrl } = await tokenRes.json()
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      startCall({ id: meeting.id, meetingId: meeting.meetingId, title: meeting.title, companyId: companyId! }, token, serverUrl, { video })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    } finally { setStartingCall(null) }
  }

  const retryNote = async () => {
    if (!openNoteId || !companyId || retryingNote) return
    setRetryingNote(true)
    try {
      const res = await fetch(`/api/meetings/notes/${openNoteId}/retry?companyId=${companyId}`, { method: "POST", credentials: "include" })
      if (!res.ok) { toast({ title: "Retry failed", variant: "destructive" }); return }
      toast({ title: "AI notes retriggered — processing…" })
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

  /* ── Filter helpers ── */
  const filteredChannels = React.useMemo(() => {
    if (!channels) return []
    return channels.filter((ch) => {
      if (channelFilter === "direct") return ch.type === "direct"
      if (channelFilter === "groups") return ch.type !== "direct"
      if (channelFilter === "unread") return ch.unread > 0
      return true
    })
  }, [channels, channelFilter])

  const totalUnread = channels?.reduce((s, c) => s + c.unread, 0) ?? 0

  if (!companyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: `${BRAND_BLUE}22` }}
        >
          <MessageSquare className="h-8 w-8" style={{ color: BRAND_BLUE }} />
        </div>
        <div className="text-center space-y-1">
          <p className="text-lg font-semibold">Select a workspace</p>
          <p className="text-sm text-muted-foreground">Choose a company to start chatting.</p>
        </div>
        <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Choose a workspace" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (isLoadingChannels) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: BRAND_BLUE }} />
      </div>
    )
  }

  /* ───────────────────────────────── RENDER ─────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border border-border/60 shadow-xl bg-card">

      {/* ── Sidebar ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border/60 bg-card">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <span className="font-bold text-base">Chats</span>
          <div className="flex items-center gap-1">
            {totalUnread > 0 && (
              <Badge
                className="text-[10px] h-5 px-1.5"
                style={{ background: BRAND_BLUE, color: "#fff", border: "none" }}
              >
                {totalUnread}
              </Badge>
            )}
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              style={{ color: BRAND_BLUE }}
              title="New direct message"
              onClick={() => setUsersOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 py-2">
          {(["all", "direct", "groups", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setChannelFilter(f)}
              className={cn(
                "flex-1 text-[11px] font-medium py-1 rounded-md capitalize transition-all",
                channelFilter === f
                  ? "text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              style={channelFilter === f ? { background: BRAND_BLUE } : {}}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 py-1">
          {filteredChannels.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              {channelFilter === "unread" ? "No unread messages" : "No channels yet"}
            </div>
          ) : (
            filteredChannels.map((ch) => {
              const isSelected = selectedChannel?.id === ch.id
              const icon = ch.type === "direct" ? <User className="h-3.5 w-3.5 shrink-0" />
                : ch.type === "team" ? <Users className="h-3.5 w-3.5 shrink-0" />
                : ch.type === "department" ? <Hash className="h-3.5 w-3.5 shrink-0" />
                : <Briefcase className="h-3.5 w-3.5 shrink-0" />
              return (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChannel(ch)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-left transition-all",
                    isSelected
                      ? "text-white shadow-sm"
                      : "hover:bg-muted/60 text-foreground"
                  )}
                  style={isSelected ? { background: BRAND_BLUE } : {}}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
                    style={{
                      background: isSelected ? "rgba(255,255,255,0.2)" : `${BRAND_BLUE}18`,
                      color: isSelected ? "#fff" : BRAND_BLUE,
                    }}
                  >
                    {initials(ch.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-medium text-sm truncate flex items-center gap-1.5")}>
                      {icon}
                      {ch.name}
                    </div>
                    <div className={cn("text-xs truncate", isSelected ? "text-white/70" : "text-muted-foreground")}>
                      {ch.type === "direct" ? "Direct message" : ch.type}
                    </div>
                  </div>
                  {ch.unread > 0 && (
                    <Badge
                      className="text-[10px] h-5 px-1.5 shrink-0"
                      style={isSelected
                        ? { background: "rgba(255,255,255,0.3)", color: "#fff", border: "none" }
                        : { background: BRAND_BLUE, color: "#fff", border: "none" }}
                    >
                      {ch.unread}
                    </Badge>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Sidebar actions */}
        <div className="p-3 border-t border-border/60 space-y-1">
          {[
            { icon: User, label: "Direct Message", action: () => setUsersOpen(true) },
            { icon: Search, label: "Search Messages", action: () => setSearchOpen(true) },
            { icon: CalendarClock, label: "Scheduled Meetings", action: () => { setScheduleOpen(true); setShowScheduleForm(false) } },
            { icon: Sparkles, label: "Meeting Notes", action: () => { setNotesOpen(true); setOpenNoteId(null) } },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
            >
              <Icon className="h-4 w-4" style={{ color: BRAND_BLUE }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedChannel ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: `${BRAND_BLUE}18` }}
            >
              <MessageSquare className="h-10 w-10" style={{ color: BRAND_BLUE }} />
            </div>
            <div>
              <p className="text-lg font-semibold mb-1">Select a conversation</p>
              <p className="text-sm text-muted-foreground">Choose a channel from the left or start a direct message.</p>
            </div>
            <Button
              onClick={() => setUsersOpen(true)}
              style={{ background: BRAND_BLUE, color: "#fff" }}
              className="rounded-xl"
            >
              <Plus className="h-4 w-4 mr-2" /> New Direct Message
            </Button>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-card shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                  style={{ background: `${BRAND_BLUE}18`, color: BRAND_BLUE }}
                >
                  {initials(selectedChannel.name)}
                </div>
                <div>
                  <div className="font-semibold flex items-center gap-1.5">
                    {selectedChannel.type === "direct" && <User className="h-3.5 w-3.5" style={{ color: BRAND_BLUE }} />}
                    {selectedChannel.type === "team" && <Users className="h-3.5 w-3.5" style={{ color: BRAND_BLUE }} />}
                    {selectedChannel.type === "department" && <Hash className="h-3.5 w-3.5" style={{ color: BRAND_BLUE }} />}
                    {selectedChannel.name}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{selectedChannel.type} channel</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 rounded-xl"
                  title="Voice call"
                  disabled={!!startingCall || !!activeCall}
                  onClick={() => startChannelCall(false)}
                  style={{ color: BRAND_BLUE }}
                >
                  {startingCall === "voice" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 rounded-xl"
                  title="Video call"
                  disabled={!!startingCall || !!activeCall}
                  onClick={() => startChannelCall(true)}
                  style={{ color: BRAND_BLUE }}
                >
                  {startingCall === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-9 w-9 rounded-xl"
                  title="Search messages"
                  onClick={() => setSearchOpen(true)}
                  style={{ color: BRAND_BLUE }}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: `${BRAND_BLUE}18` }}
                  >
                    <MessageSquare className="h-7 w-7" style={{ color: BRAND_BLUE }} />
                  </div>
                  <p className="text-sm text-muted-foreground">No messages yet. Say hello! 👋</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = msg.userId === userId
                  return (
                    <div key={msg.id} className={cn("flex gap-3", isOwn ? "flex-row-reverse" : "flex-row")}>
                      {!isOwn && <Avatar name={msg.displayName} size={32} />}
                      <div className={cn("max-w-[70%] flex flex-col gap-1", isOwn && "items-end")}>
                        {!isOwn && (
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-xs font-semibold" style={{ color: BRAND_BLUE }}>{msg.displayName}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            {msg.isPinned && <Pin className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        )}
                        {msg.replyToId && (
                          <div className="text-xs text-muted-foreground border-l-2 pl-2 ml-1 mb-0.5" style={{ borderColor: BRAND_BLUE }}>
                            Reply to #{msg.replyToId}
                          </div>
                        )}
                        {msg.isAnnouncement && (
                          <div
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit"
                            style={{ background: `${BRAND_BLUE}22`, color: BRAND_BLUE }}
                          >
                            📢 Announcement
                          </div>
                        )}
                        <div
                          className="px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed shadow-sm"
                          style={isOwn
                            ? { background: BRAND_BLUE, color: "#fff", borderBottomRightRadius: 4 }
                            : { background: "var(--card)", border: "1px solid var(--border)", borderBottomLeftRadius: 4 }
                          }
                        >
                          {msg.content}
                          {isOwn && (
                            <span className="ml-2 text-[10px] opacity-70">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {msg.editedAt && " · edited"}
                            </span>
                          )}
                        </div>
                        {/* Attachments */}
                        {msg.attachments?.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-1">
                            {msg.attachments.map((a, i) => (
                              <a
                                key={i}
                                href={`/api/storage/objects/${a.objectPath}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all hover:opacity-80"
                                style={{ borderColor: `${BRAND_BLUE}44`, color: BRAND_BLUE }}
                              >
                                <Paperclip className="h-3 w-3" /> {a.name}
                              </a>
                            ))}
                          </div>
                        )}
                        {/* Reactions */}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {Object.entries(msg.reactions ?? {})
                            .filter(([, ids]) => ids.length > 0)
                            .map(([emoji, ids]) => (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border transition-all hover:scale-105"
                                style={
                                  ids.includes(userId ?? 0)
                                    ? { background: `${BRAND_BLUE}22`, borderColor: BRAND_BLUE, color: BRAND_BLUE }
                                    : { borderColor: "var(--border)" }
                                }
                              >
                                {emoji} <span>{ids.length}</span>
                              </button>
                            ))}
                          <button
                            className="text-xs px-1.5 py-0.5 rounded-full border border-transparent text-muted-foreground hover:border-border opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => toggleReaction(msg.id, "👍")}
                            title="React"
                          >
                            <Smile className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setReplyTo(msg)}
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ background: BRAND_BLUE, animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">Someone is typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="px-4 pb-4 pt-2 shrink-0">
              {replyTo && (
                <div
                  className="flex items-center justify-between text-xs mb-2 px-3 py-1.5 rounded-lg"
                  style={{ background: `${BRAND_BLUE}14`, borderLeft: `3px solid ${BRAND_BLUE}` }}
                >
                  <span className="text-muted-foreground">
                    <span className="font-medium" style={{ color: BRAND_BLUE }}>{replyTo.displayName}:</span>{" "}
                    {replyTo.content.slice(0, 50)}{replyTo.content.length > 50 ? "…" : ""}
                  </span>
                  <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground ml-2">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div
                className="flex items-end gap-2 rounded-2xl border px-3 py-2.5 transition-all focus-within:border-[#2DA8FF] focus-within:ring-2 focus-within:ring-[#2DA8FF22]"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    rows={1}
                    onChange={(e) => {
                      const value = e.target.value
                      setInput(value)
                      // Auto-resize
                      e.target.style.height = "auto"
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
                      const cursor = e.target.selectionStart ?? value.length
                      const textBeforeCursor = value.slice(0, cursor)
                      const match = textBeforeCursor.match(/@([\w.]*)$/)
                      if (match) { setMentionQuery(match[1].toLowerCase()); setShowMentions(true) }
                      else { setShowMentions(false); setMentionQuery(null) }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
                    }}
                    placeholder={replyTo ? "Reply…" : "Type a message… @name to mention"}
                    className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground max-h-[120px]"
                    style={{ minHeight: 24 }}
                  />
                  {showMentions && (
                    <div className="absolute bottom-full left-0 mb-1 w-full max-h-[180px] overflow-y-auto rounded-xl border bg-card shadow-lg z-10 p-1 space-y-0.5">
                      {(channelUsers?.filter((u) => u.id !== userId).filter((u) => {
                        const q = (mentionQuery ?? "").toLowerCase()
                        return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                      }).length ?? 0) === 0 ? (
                        <div className="text-xs text-muted-foreground px-2 py-1">No matching members</div>
                      ) : (
                        channelUsers?.filter((u) => u.id !== userId)
                          .filter((u) => {
                            const q = (mentionQuery ?? "").toLowerCase()
                            return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                          })
                          .slice(0, 6)
                          .map((u) => (
                            <button
                              key={u.id}
                              onClick={() => insertMention(u.name)}
                              className="w-full text-left rounded-lg px-3 py-1.5 hover:bg-muted text-sm flex items-center gap-2"
                            >
                              <Avatar name={u.name} size={24} />
                              <div>
                                <div className="font-medium text-xs">{u.name}</div>
                                <div className="text-[10px] text-muted-foreground">{u.email}</div>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <input type="file" multiple className="hidden" id="chat-file-input" />
                  <label htmlFor="chat-file-input">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" asChild>
                      <span title="Attach file"><Paperclip className="h-4 w-4 text-muted-foreground" /></span>
                    </Button>
                  </label>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-xl transition-all"
                    disabled={!input.trim()}
                    onClick={sendMessage}
                    style={{ background: input.trim() ? BRAND_BLUE : undefined }}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex justify-center gap-2 mt-2">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      if (selectedChannel) {
                        socket?.emit("message:send", { channelId: selectedChannel.id, content: emoji, mentions: [] }, () => {})
                      }
                    }}
                    className="text-lg hover:scale-125 transition-transform"
                    title={`Send ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─────────────────── Dialogs ────────────────────── */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader><DialogTitle>Search Messages</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search…" />
            <Button onClick={handleSearch} style={{ background: BRAND_BLUE, color: "#fff" }}>Search</Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {searchResults.map((msg) => (
              <div key={msg.id} className="rounded-xl border p-3 text-sm hover:bg-muted/50 transition-colors">
                <div className="font-medium text-xs mb-0.5" style={{ color: BRAND_BLUE }}>{msg.displayName}</div>
                <div className="text-muted-foreground">{msg.content}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={usersOpen} onOpenChange={(o) => { setUsersOpen(o); if (!o) setDmQuery("") }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>New Direct Message</DialogTitle></DialogHeader>
          <Input placeholder="Search team members…" value={dmQuery} onChange={(e) => setDmQuery(e.target.value)} className="mb-2" />
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {isLoadingUsers ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} /></div>
            ) : (
              (channelUsers?.filter((u) => u.id !== userId).filter((u) => {
                const q = dmQuery.toLowerCase()
                return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
              })?.length ?? 0) === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">No team members found.</div>
              ) : (
                channelUsers?.filter((u) => u.id !== userId)
                  .filter((u) => {
                    const q = dmQuery.toLowerCase()
                    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                  })
                  .map((u) => (
                    <button
                      key={u.id}
                      onClick={() => startDirect(u.id)}
                      className="w-full text-left rounded-xl border p-3 hover:bg-muted/60 text-sm flex items-center gap-3 transition-all"
                    >
                      <Avatar name={u.name} size={36} />
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </button>
                  ))
              )
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" style={{ color: BRAND_BLUE }} /> Scheduled Meetings
            </DialogTitle>
          </DialogHeader>
          {!showScheduleForm ? (
            <>
              <div className="max-h-[360px] overflow-y-auto space-y-2">
                {isLoadingUpcoming ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} /></div>
                ) : !upcomingMeetings?.length ? (
                  <div className="text-center text-sm text-muted-foreground py-8">No upcoming meetings.</div>
                ) : (
                  upcomingMeetings.map((m) => (
                    <div key={m.id} className="rounded-xl border p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate flex items-center gap-1.5">
                          {m.title}
                          {m.isRecurring && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString() : "Now"} · {m.duration} min
                          {m.recurrence ? ` · ${m.recurrence}` : ""}
                        </div>
                      </div>
                      <Button size="sm" disabled={!!activeCall || !!joiningId} onClick={() => joinScheduledMeeting(m.meetingId, m.title)} style={{ background: BRAND_BLUE, color: "#fff" }}>
                        {joiningId === m.meetingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <Button onClick={() => setShowScheduleForm(true)} style={{ background: BRAND_BLUE, color: "#fff" }}>
                <CalendarClock className="mr-2 h-4 w-4" /> Schedule a Meeting
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <Input value={schedTitle} onChange={(e) => setSchedTitle(e.target.value)} placeholder="Meeting title" />
              <div className="grid grid-cols-2 gap-3">
                <Input type="datetime-local" value={schedWhen} onChange={(e) => setSchedWhen(e.target.value)} />
                <Select value={schedDuration} onValueChange={setSchedDuration}>
                  <SelectTrigger><SelectValue placeholder="Duration" /></SelectTrigger>
                  <SelectContent>
                    {["15", "30", "45", "60", "90", "120"].map((d) => (
                      <SelectItem key={d} value={d}>{d} minutes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select value={schedRecurrence} onValueChange={setSchedRecurrence}>
                <SelectTrigger><SelectValue placeholder="Repeats" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <div>
                <div className="text-xs font-medium mb-1">Invite participants</div>
                <div className="max-h-[160px] overflow-y-auto rounded-xl border p-2 space-y-1">
                  {!channelUsers?.length ? (
                    <div className="text-xs text-muted-foreground p-1">No other members.</div>
                  ) : (
                    channelUsers.filter((u) => u.id !== userId).map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={schedParticipants.includes(u.id)}
                          onChange={(e) => setSchedParticipants((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))}
                        />
                        <span className="truncate">{u.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowScheduleForm(false)} disabled={schedSaving}>Back</Button>
                <Button onClick={submitSchedule} disabled={schedSaving || !schedTitle.trim() || !schedWhen} style={{ background: BRAND_BLUE, color: "#fff" }}>
                  {schedSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
                  Schedule
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={notesOpen} onOpenChange={(o) => { setNotesOpen(o); if (!o) setOpenNoteId(null) }}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openNoteId && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpenNoteId(null)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <Sparkles className="h-4 w-4" style={{ color: BRAND_BLUE }} />
              {openNoteId ? openNote?.title ?? "Meeting Notes" : "Meeting Notes"}
            </DialogTitle>
          </DialogHeader>
          {!openNoteId ? (
            <>
              <Input value={notesQuery} onChange={(e) => setNotesQuery(e.target.value)} placeholder="Search notes, summaries…" />
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {isLoadingNotes ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} /></div>
                ) : !meetingNotes?.length ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No meeting notes yet. After a call ends, the AI assistant transcribes it and posts notes here.
                  </div>
                ) : (
                  meetingNotes.map((note) => (
                    <button key={note.id} onClick={() => setOpenNoteId(note.id)} className="w-full text-left rounded-xl border p-3 hover:bg-muted/50 space-y-1 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{note.title}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          {note.status === "processing" && <Badge variant="outline" className="text-xs gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>}
                          {note.status === "failed" && <Badge variant="destructive" className="text-xs">Failed</Badge>}
                          {note.status === "done" && !!note.actionItems?.length && (
                            <Badge variant="secondary" className="text-xs gap-1"><ClipboardList className="h-3 w-3" /> {note.actionItems.length}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleDateString()}</span>
                        </span>
                      </div>
                      {note.status !== "failed" && note.summary && (
                        <div className="text-xs text-muted-foreground line-clamp-2">{note.summary}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="max-h-[440px] overflow-y-auto space-y-4 text-sm">
              {!openNote ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} /></div>
              ) : openNote.status === "processing" ? (
                <div className="text-center text-muted-foreground py-8 space-y-2">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" style={{ color: BRAND_BLUE }} />
                  <p>The AI assistant is processing this meeting…</p>
                </div>
              ) : openNote.status === "failed" ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
                  <div className="font-medium text-destructive">AI notes couldn't be generated</div>
                  <Button size="sm" onClick={retryNote} disabled={retryingNote} style={{ background: BRAND_BLUE, color: "#fff" }}>
                    {retryingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Repeat className="h-3.5 w-3.5 mr-1" />}
                    Retry AI notes
                  </Button>
                </div>
              ) : (
                <>
                  {openNote.summary && <div><div className="font-semibold mb-1">Summary</div><p className="text-muted-foreground whitespace-pre-wrap">{openNote.summary}</p></div>}
                  {!!openNote.actionItems?.length && (
                    <div>
                      <div className="font-semibold mb-1">Action Items</div>
                      <div className="space-y-2">
                        {openNote.actionItems.map((item, i) => (
                          <div key={i} className="rounded-xl border p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{item.title}</span>
                              <span className="flex items-center gap-1 shrink-0">
                                {item.priority && <Badge variant="outline" className="text-xs">{item.priority}</Badge>}
                                {item.taskId && <Badge className="text-xs" style={{ background: `${BRAND_BLUE}22`, color: BRAND_BLUE, border: "none" }}>Task created</Badge>}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.assigneeName ? `Assigned to ${item.assigneeName}` : "Unassigned"}
                              {item.dueDate ? ` · Due ${item.dueDate}` : ""}
                            </div>
                            {!item.taskId && (
                              <div className="mt-2 max-w-[240px]">
                                <Select disabled={assigningIndex !== null} onValueChange={(v) => assignActionItem(i, v)}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={assigningIndex === i ? "Assigning…" : "Assign to employee…"} /></SelectTrigger>
                                  <SelectContent>
                                    {employeesData?.items?.map((e) => (
                                      <SelectItem key={e.id} value={e.id.toString()} className="text-xs">{e.firstName} {e.lastName}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {openNote.notes && <div><div className="font-semibold mb-1">Notes</div><p className="text-muted-foreground whitespace-pre-wrap">{openNote.notes}</p></div>}
                  {openNote.transcript && <div><div className="font-semibold mb-1">Transcript</div><p className="text-muted-foreground whitespace-pre-wrap text-xs">{openNote.transcript}</p></div>}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
