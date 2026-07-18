import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { ChatSkeleton } from "@/components/skeletons"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMeeting } from "@/contexts/meeting-context"
import {
  MessageSquare, Pin, Search, Send, Paperclip, Megaphone, User, Video, Phone, Briefcase, X, Building2,
  Sparkles, Loader2, ChevronLeft, ClipboardList, CalendarClock, Repeat,
} from "lucide-react"

interface UpcomingMeeting {
  id: number
  meetingId: string
  title: string
  scheduledAt: string | null
  duration: number
  status: string
  isRecurring: boolean
  recurrence: string | null
  organizerId: number
}

interface ChatChannel {
  id: number
  type: "team" | "department" | "direct" | "project"
  name: string
  department?: string
  projectId?: number
  unread: number
}

interface ChatMessage {
  id: number
  channelId: number
  userId: number
  displayName: string
  content: string
  replyToId?: number
  attachments: Array<{ name: string; objectPath: string; contentType: string; size?: number }>
  reactions: Record<string, number[]>
  mentions: number[]
  isAnnouncement: boolean
  isPinned: boolean
  editedAt: string | null
  createdAt: string
}

interface ChatUser {
  id: number
  name: string
  email: string
}

interface MeetingActionItem {
  title: string
  description?: string
  assigneeName?: string
  priority?: string
  dueDate?: string
  taskId?: number
}

interface MeetingNoteSummary {
  id: number
  meetingId: string
  channelId: number | null
  title: string
  summary: string | null
  actionItems: MeetingActionItem[]
  status: "processing" | "done" | "failed"
  error: string | null
  createdAt: string
}

interface MeetingNoteDetail extends MeetingNoteSummary {
  transcript: string | null
  notes: string | null
}

const EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔", "👀"]

export default function ChatPage() {
  const { activeCompany, companies, isParentView } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { startCall, activeCall } = useMeeting()
  const parentCompany = companies.find((c) => c.mode === "parent")

  // In the parent view, let the user pick which workspace to chat in.
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
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [showMentions, setShowMentions] = React.useState(false)
  const [notesOpen, setNotesOpen] = React.useState(false)
  const [notesQuery, setNotesQuery] = React.useState("")
  const [openNoteId, setOpenNoteId] = React.useState<number | null>(null)
  const [startingCall, setStartingCall] = React.useState<"voice" | "video" | null>(null)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [showScheduleForm, setShowScheduleForm] = React.useState(false)
  const [schedTitle, setSchedTitle] = React.useState("")
  const [schedWhen, setSchedWhen] = React.useState("")
  const [schedDuration, setSchedDuration] = React.useState("30")
  const [schedRecurrence, setSchedRecurrence] = React.useState("none")
  const [schedParticipants, setSchedParticipants] = React.useState<number[]>([])
  const [schedSaving, setSchedSaving] = React.useState(false)
  const [joiningId, setJoiningId] = React.useState<string | null>(null)
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

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

  // ── Scheduled / upcoming meetings ──────────────────────────────────────────
  const { data: upcomingMeetings, isLoading: isLoadingUpcoming } = useQuery<UpcomingMeeting[]>({
    queryKey: ["/api/meetings/upcoming", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/upcoming?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && scheduleOpen,
  })

  // ── AI Meeting Notes ────────────────────────────────────────────────────────
  const { data: meetingNotes, isLoading: isLoadingNotes } = useQuery<MeetingNoteSummary[]>({
    queryKey: ["/api/meetings/notes", companyId, notesQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ companyId: String(companyId) })
      if (notesQuery.trim()) params.set("q", notesQuery.trim())
      const res = await fetch(`/api/meetings/notes?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && notesOpen,
    // Auto-refresh while any note is still processing so the list updates
    // when the AI finishes (or fails) without the user reopening the dialog.
    refetchInterval: (query) =>
      query.state.data?.some((n) => n.status === "processing") ? 5_000 : false,
  })

  // Employees list for manually assigning unmatched action items
  const { data: employeesData } = useQuery<{ items: Array<{ id: number; firstName: string; lastName: string }> }>({
    queryKey: ["/api/employees", companyId, "for-assign"],
    queryFn: async () => {
      const res = await fetch(`/api/employees?companyId=${companyId}&limit=200`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && !!openNoteId,
  })

  const [retryingNote, setRetryingNote] = React.useState(false)
  const retryNote = async () => {
    if (!openNoteId || retryingNote) return
    setRetryingNote(true)
    try {
      const res = await fetch(`/api/meetings/notes/${openNoteId}/retry`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Could not retry", description: err.error || "Retry failed", variant: "destructive" })
        return
      }
      toast({ title: "Retrying AI notes", description: "The recording is being re-processed — this page refreshes automatically." })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId] })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally {
      setRetryingNote(false)
    }
  }

  const [assigningIndex, setAssigningIndex] = React.useState<number | null>(null)
  const assignActionItem = async (itemIndex: number, employeeId: string) => {
    if (!openNoteId || assigningIndex !== null) return
    setAssigningIndex(itemIndex)
    try {
      const res = await fetch(`/api/meetings/notes/${openNoteId}/action-items/${itemIndex}/assign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, employeeId: Number(employeeId) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Could not assign", description: err.error || "Assignment failed", variant: "destructive" })
        return
      }
      toast({ title: "Action item assigned", description: "A task was created and the assignee was notified." })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId] })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId] })
    } finally {
      setAssigningIndex(null)
    }
  }

  const { data: openNote } = useQuery<MeetingNoteDetail>({
    queryKey: ["/api/meetings/notes", companyId, "detail", openNoteId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/notes/${openNoteId}?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && !!openNoteId,
    // Auto-refresh an open note while the AI is still working on it.
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 5_000 : false),
  })

  // Keep the currently-selected channel in a ref so socket event handlers can
  // read it without forcing the socket to be torn down on every channel switch.
  const selectedChannelRef = React.useRef(selectedChannel)
  selectedChannelRef.current = selectedChannel

  React.useEffect(() => {
    if (!companyId || !userId) return
    // Socket tokens are single-use on the server: `auth` must be a *function*
    // so every connection AND automatic reconnection fetches a fresh token.
    const s: Socket = io({
      // /api/socket.io so the connection follows the same routing as all API
      // calls (works in dev AND in the deployed app).
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
        if (!res.ok) toast({ title: "Chat join failed", description: res.error, variant: "destructive" })
      })
      const ch = selectedChannelRef.current
      if (ch) {
        s.emit("join:channel", { channelId: ch.id }, () => {})
      }
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

    return () => {
      s.disconnect()
      setSocket(null)
    }
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

  // ── Auto-join when navigated here with ?join=<meetingId> ───────────────────
  // (Deep links to /meetings redirect here and preserve the param.)
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
    fetch(`/api/meetings/token?roomName=${encodeURIComponent(joinId)}&companyId=${companyId}`, {
      credentials: "include",
    })
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
        if (input.includes(`@${u.name}`) || input.includes(`@${u.email.split("@")[0]}`)) {
          mentionIds.push(u.id)
        }
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
      method: "POST",
      credentials: "include",
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

  // ── Scheduled meetings: join + create ──────────────────────────────────────
  const joinScheduledMeeting = async (meetingId: string, title: string) => {
    if (activeCall || joiningId) return
    setJoiningId(meetingId)
    try {
      const tokenRes = await fetch(
        `/api/meetings/token?roomName=${encodeURIComponent(meetingId)}&companyId=${companyId}`,
        { credentials: "include" },
      )
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
    } finally {
      setJoiningId(null)
    }
  }

  const submitSchedule = async () => {
    if (!schedTitle.trim() || !schedWhen || schedSaving) return
    const when = new Date(schedWhen)
    if (isNaN(when.getTime()) || when.getTime() < Date.now()) {
      toast({ title: "Pick a future date and time", variant: "destructive" })
      return
    }
    setSchedSaving(true)
    try {
      const res = await fetch(`/api/meetings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          title: schedTitle.trim(),
          scheduledAt: when.toISOString(),
          duration: Number(schedDuration) || 30,
          participantIds: schedParticipants,
          isRecurring: schedRecurrence !== "none",
          recurrence: schedRecurrence !== "none" ? schedRecurrence : undefined,
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
    } finally {
      setSchedSaving(false)
    }
  }

  // ── One-click calls from chat ───────────────────────────────────────────────
  // Creates a meeting linked to this channel; the server invites every channel
  // member (ringing popup) and this user joins immediately.
  const startChannelCall = async (video: boolean) => {
    if (!selectedChannel || startingCall) return
    setStartingCall(video ? "video" : "voice")
    try {
      const res = await fetch(`/api/meetings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          channelId: selectedChannel.id,
          title: `${selectedChannel.name} ${video ? "Call" : "Voice Call"}`,
        }),
      })
      if (!res.ok) {
        toast({ title: "Failed to start call", description: await res.text(), variant: "destructive" })
        return
      }
      const meeting = await res.json()
      const tokenRes = await fetch(
        `/api/meetings/token?roomName=${encodeURIComponent(meeting.meetingId)}&companyId=${companyId}`,
        { credentials: "include" },
      )
      if (!tokenRes.ok) {
        toast({ title: "Call created, but failed to join", description: await tokenRes.text(), variant: "destructive" })
        return
      }
      const { token, serverUrl } = await tokenRes.json()
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      startCall(
        { id: meeting.id, meetingId: meeting.meetingId, title: meeting.title, companyId: companyId! },
        token,
        serverUrl,
        { video },
      )
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    } finally {
      setStartingCall(null)
    }
  }

  if (!companyId) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Team
          </h1>
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex justify-center">
              <Building2 className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-lg font-medium">Select a workspace</p>
              <p className="text-sm text-muted-foreground">Choose a company or subsidiary to start chatting.</p>
            </div>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="w-full max-w-md mx-auto">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.name} {c.mode === "parent" ? "(Parent)" : "(Subsidiary)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoadingChannels) {
    return <ChatSkeleton />
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-4 p-4 md:p-6">
      <Card className="w-full md:w-64 shrink-0 flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Team
            </span>
            {isParentView && companies.length > 0 && (
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue placeholder="Workspace" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()} className="text-xs">
                      {c.name} {c.mode === "parent" ? "(Parent)" : "(Subsidiary)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-1">
          {channels?.map((channel) => (
            <button
              key={channel.id}
              onClick={() => setSelectedChannel(channel)}
              className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors ${
                selectedChannel?.id === channel.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <span className="truncate">{channel.name}</span>
              {channel.unread > 0 && <Badge variant="secondary" className="ml-2 shrink-0">{channel.unread}</Badge>}
            </button>
          ))}
        </CardContent>
        <div className="p-3 border-t space-y-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => setUsersOpen(true)}>
            <User className="mr-2 h-4 w-4" /> Direct Message
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setSearchOpen(true)}>
            <Search className="mr-2 h-4 w-4" /> Search Messages
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => { setScheduleOpen(true); setShowScheduleForm(false) }}>
            <CalendarClock className="mr-2 h-4 w-4" /> Scheduled Meetings
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => { setNotesOpen(true); setOpenNoteId(null) }}>
            <Sparkles className="mr-2 h-4 w-4" /> Meeting Notes
          </Button>
        </div>
      </Card>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="pb-2 border-b shrink-0">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              {selectedChannel?.type === "direct" && <User className="h-4 w-4" />}
              {selectedChannel?.type === "department" && <MessageSquare className="h-4 w-4" />}
              {selectedChannel?.type === "team" && <Megaphone className="h-4 w-4" />}
              {selectedChannel?.type === "project" && <Briefcase className="h-4 w-4" />}
              {selectedChannel?.name || "Select a channel"}
            </span>
            {selectedChannel && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Start voice call"
                  disabled={!!startingCall || !!activeCall}
                  onClick={() => startChannelCall(false)}
                >
                  {startingCall === "voice" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Start video call"
                  disabled={!!startingCall || !!activeCall}
                  onClick={() => startChannelCall(true)}
                >
                  {startingCall === "video" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto space-y-3 p-4">
          {!selectedChannel ? (
            <EmptyState icon={MessageSquare} message="Select a channel" hint="Choose a channel to start chatting, or start a call with the phone and camera buttons." />
          ) : messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">No messages yet. Say hello!</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`group flex flex-col gap-1 ${msg.isAnnouncement ? "bg-primary/5 rounded-md p-2 border" : ""}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{msg.displayName}</span>
                  <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                  {msg.isPinned && <Pin className="h-3 w-3" />}
                  {msg.editedAt && <span>(edited)</span>}
                </div>
                {msg.replyToId && (
                  <div className="text-xs text-muted-foreground border-l-2 pl-2 mb-1">
                    Replied to message #{msg.replyToId}
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                {msg.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.attachments.map((a, i) => (
                      <a key={i} href={`/api/storage/objects/${a.objectPath}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        {a.name}
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button className="text-xs text-muted-foreground hover:underline" onClick={() => setReplyTo(msg)}>Reply</button>
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => toggleReaction(msg.id, emoji)}
                      className={`text-xs rounded-full px-2 py-0.5 border ${msg.reactions?.[emoji]?.includes(userId ?? 0) ? "bg-primary/20" : "hover:bg-muted"}`}
                    >
                      {emoji} {msg.reactions?.[emoji]?.length || 0}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </CardContent>

        {selectedChannel && (
          <div className="border-t p-3 shrink-0">
            {replyTo && (
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 bg-muted rounded px-2 py-1">
                <span>Replying to {replyTo.displayName}: {replyTo.content.slice(0, 40)}...</span>
                <button onClick={() => setReplyTo(null)}><X className="h-3 w-3" /></button>
              </div>
            )}
            <div className="flex items-center gap-2 relative">
              <div className="flex-1 relative">
                <Input
                  value={input}
                  onChange={(e) => {
                    const value = e.target.value
                    setInput(value)
                    const cursor = e.target.selectionStart ?? value.length
                    const textBeforeCursor = value.slice(0, cursor)
                    const match = textBeforeCursor.match(/@([\w.]*)$/)
                    if (match) {
                      setMentionQuery(match[1].toLowerCase())
                      setShowMentions(true)
                    } else {
                      setShowMentions(false)
                      setMentionQuery(null)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
                  }}
                  placeholder={replyTo ? "Reply..." : "Type a message... @name to mention"}
                  className="w-full"
                />
                {showMentions && (
                  <div className="absolute bottom-full left-0 mb-1 w-full max-h-[180px] overflow-y-auto rounded-md border bg-popover shadow-md z-10 p-1 space-y-1">
                    {(channelUsers?.filter((u) => u.id !== userId).filter((u) => {
                      const q = (mentionQuery ?? "").toLowerCase()
                      return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                    }).length ?? 0) === 0 ? (
                      <div className="text-xs text-muted-foreground px-2 py-1">No matching members</div>
                    ) : (
                      channelUsers
                        ?.filter((u) => u.id !== userId)
                        .filter((u) => {
                          const q = (mentionQuery ?? "").toLowerCase()
                          return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                        })
                        .slice(0, 6)
                        .map((u) => (
                          <button
                            key={u.id}
                            onClick={() => insertMention(u.name)}
                            className="w-full text-left rounded px-2 py-1 hover:bg-muted text-sm"
                          >
                            <div className="font-medium">{u.name}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
              <input
                type="file"
                multiple
                className="hidden"
                id="chat-file-input"
              />
              <label htmlFor="chat-file-input">
                <Button variant="ghost" size="icon" asChild>
                  <span><Paperclip className="h-4 w-4" /></span>
                </Button>
              </label>
              <Button onClick={sendMessage} disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {typingUsers.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">Someone is typing...</div>
            )}
          </div>
        )}
      </Card>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Search Messages</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search..." />
            <Button onClick={handleSearch}>Search</Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {searchResults.map((msg) => (
              <div key={msg.id} className="rounded-md border p-2 text-sm">
                <div className="font-medium">{msg.displayName}</div>
                <div className="text-muted-foreground">{msg.content}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={usersOpen} onOpenChange={(o) => { setUsersOpen(o); if (!o) setDmQuery("") }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Start Direct Message</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search team members…"
            value={dmQuery}
            onChange={(e) => setDmQuery(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {isLoadingUsers ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              (channelUsers?.filter((u) => u.id !== userId).filter((u) => {
                const q = dmQuery.toLowerCase()
                return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
              })?.length ?? 0) === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6">
                  No team members found in this workspace.
                </div>
              ) : (
                channelUsers
                  ?.filter((u) => u.id !== userId)
                  .filter((u) => {
                    const q = dmQuery.toLowerCase()
                    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                  })
                  .map((u) => (
                    <button
                      key={u.id}
                      onClick={() => startDirect(u.id)}
                      className="w-full text-left rounded-md border p-2 hover:bg-muted text-sm"
                    >
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </button>
                  ))
              )
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Scheduled Meetings ── */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Scheduled Meetings
            </DialogTitle>
          </DialogHeader>

          {!showScheduleForm ? (
            <>
              <div className="max-h-[360px] overflow-y-auto space-y-2">
                {isLoadingUpcoming ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : !upcomingMeetings?.length ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No upcoming meetings. Schedule one below.
                  </div>
                ) : (
                  upcomingMeetings.map((m) => (
                    <div key={m.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={!!activeCall || !!joiningId}
                        onClick={() => joinScheduledMeeting(m.meetingId, m.title)}
                      >
                        {joiningId === m.meetingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <Button onClick={() => setShowScheduleForm(true)}>
                <CalendarClock className="mr-2 h-4 w-4" /> Schedule a Meeting
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <Input value={schedTitle} onChange={(e) => setSchedTitle(e.target.value)} placeholder="Meeting title" />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="datetime-local"
                  value={schedWhen}
                  onChange={(e) => setSchedWhen(e.target.value)}
                />
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
                <div className="max-h-[160px] overflow-y-auto rounded-md border p-2 space-y-1">
                  {!channelUsers?.length ? (
                    <div className="text-xs text-muted-foreground p-1">No other members in this workspace.</div>
                  ) : (
                    channelUsers.filter((u) => u.id !== userId).map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm rounded px-1 py-0.5 hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={schedParticipants.includes(u.id)}
                          onChange={(e) =>
                            setSchedParticipants((prev) =>
                              e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                            )
                          }
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
                <Button onClick={submitSchedule} disabled={schedSaving || !schedTitle.trim() || !schedWhen}>
                  {schedSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
                  Schedule
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── AI Meeting Notes ── */}
      <Dialog open={notesOpen} onOpenChange={(o) => { setNotesOpen(o); if (!o) setOpenNoteId(null) }}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openNoteId && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpenNoteId(null)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <Sparkles className="h-4 w-4" /> {openNoteId ? openNote?.title ?? "Meeting Notes" : "Meeting Notes"}
            </DialogTitle>
          </DialogHeader>

          {!openNoteId ? (
            <>
              <Input
                value={notesQuery}
                onChange={(e) => setNotesQuery(e.target.value)}
                placeholder="Search notes, summaries, and transcripts..."
              />
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {isLoadingNotes ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : !meetingNotes?.length ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No meeting notes yet. After a call ends, the AI assistant transcribes it and posts notes here.
                  </div>
                ) : (
                  meetingNotes.map((note) => (
                    <button
                      key={note.id}
                      onClick={() => setOpenNoteId(note.id)}
                      className="w-full text-left rounded-md border p-3 hover:bg-muted space-y-1"
                    >
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
                      {note.status === "failed" ? (
                        <div className="text-xs text-destructive line-clamp-2">
                          AI notes couldn't be generated for this meeting. Open for details and how to retry.
                        </div>
                      ) : note.status === "processing" ? (
                        <div className="text-xs text-muted-foreground">
                          The AI assistant is transcribing this meeting — this list refreshes automatically.
                        </div>
                      ) : (
                        note.summary && <div className="text-xs text-muted-foreground line-clamp-2">{note.summary}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="max-h-[440px] overflow-y-auto space-y-4 text-sm">
              {!openNote ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : openNote.status === "processing" ? (
                <div className="text-center text-muted-foreground py-8 space-y-2">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  <p>The AI assistant is still processing this meeting…</p>
                  <p className="text-xs">This page refreshes automatically — the notes will appear here when they're ready.</p>
                </div>
              ) : openNote.status === "failed" ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-2">
                  <div className="font-medium text-destructive">AI notes couldn't be generated</div>
                  <p className="text-muted-foreground">
                    Something went wrong while the AI assistant was processing this meeting's recording, so no
                    transcript or notes were saved.
                  </p>
                  {openNote.error && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Technical detail:</span> {openNote.error}
                    </p>
                  )}
                  <Button size="sm" onClick={retryNote} disabled={retryingNote} className="gap-1.5">
                    {retryingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
                    Retry AI notes
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    If retrying keeps failing (or the recording wasn't stored), rejoin the meeting room and leave
                    again so the recording re-uploads, or ask an administrator to check the AI provider configuration.
                  </p>
                </div>
              ) : (
                <>
                  {openNote.summary && (
                    <div>
                      <div className="font-medium mb-1">Summary</div>
                      <p className="text-muted-foreground whitespace-pre-wrap">{openNote.summary}</p>
                    </div>
                  )}
                  {!!openNote.actionItems?.length && (
                    <div>
                      <div className="font-medium mb-1">Action Items</div>
                      <div className="space-y-2">
                        {openNote.actionItems.map((item, i) => (
                          <div key={i} className="rounded-md border p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{item.title}</span>
                              <span className="flex items-center gap-1 shrink-0">
                                {item.priority && <Badge variant="outline" className="text-xs">{item.priority}</Badge>}
                                {item.taskId && <Badge variant="secondary" className="text-xs">Task created</Badge>}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.assigneeName ? `Assigned to ${item.assigneeName}` : "Unassigned"}
                              {item.dueDate ? ` · Due ${item.dueDate}` : ""}
                            </div>
                            {!item.taskId && (
                              <div className="mt-2 max-w-[240px]">
                                <Select
                                  disabled={assigningIndex !== null}
                                  onValueChange={(v) => assignActionItem(i, v)}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder={assigningIndex === i ? "Assigning..." : "Assign to employee..."} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {employeesData?.items?.map((e) => (
                                      <SelectItem key={e.id} value={e.id.toString()} className="text-xs">
                                        {e.firstName} {e.lastName}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {item.description && <div className="text-xs text-muted-foreground mt-1">{item.description}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {openNote.notes && (
                    <div>
                      <div className="font-medium mb-1">Notes</div>
                      <p className="text-muted-foreground whitespace-pre-wrap">{openNote.notes}</p>
                    </div>
                  )}
                  {openNote.transcript && (
                    <div>
                      <div className="font-medium mb-1">Transcript</div>
                      <p className="text-muted-foreground whitespace-pre-wrap text-xs">{openNote.transcript}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
