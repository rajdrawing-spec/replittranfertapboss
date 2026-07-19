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
  Sparkles, Loader2, Plus, Smile, Mic,
  Hash, Users, ArrowLeft, MoreVertical,
} from "lucide-react"

/* ─────────────────────────────── Types ─────────────────────────────────── */
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

/* ─────────────────────────── Brand palette ─────────────────────────────── */
const BRAND_BLUE = "#3B82F6"
const BRAND_BLUE_DARK = "#1d6fd8"
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
function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
}
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/* ─────────────────────────── Channel avatar ────────────────────────────── */
function ChannelAvatar({ name, size = 40, own = false }: { name: string; size?: number; own?: boolean }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.3, flexShrink: 0,
        background: own ? `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_BLUE_DARK})` : `hsl(${hue} 60% 40% / 0.2)`,
        border: own ? "none" : `1.5px solid hsl(${hue} 60% 50% / 0.3)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.35, fontWeight: 700,
        color: own ? "#fff" : `hsl(${hue} 60% 70%)`,
      }}
    >
      {initials(name)}
    </div>
  )
}

/* ─────────────────────────── Message avatar ────────────────────────────── */
function MsgAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: `hsl(${hue} 55% 40% / 0.25)`,
        border: `1.5px solid hsl(${hue} 55% 50% / 0.35)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700,
        color: `hsl(${hue} 55% 70%)`,
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
  const [mobileView, setMobileView] = React.useState<"list" | "conversation">("list")
  const [input, setInput] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = React.useState<number[]>([])
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<ChatMessage[]>([])
  const [usersOpen, setUsersOpen] = React.useState(false)
  const [dmQuery, setDmQuery] = React.useState("")
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  const [showMentions, setShowMentions] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [startingCall, setStartingCall] = React.useState<"voice" | "video" | null>(null)
  const [channelFilter, setChannelFilter] = React.useState<"all" | "direct" | "groups" | "unread">("all")
  const [showEmojiRow, setShowEmojiRow] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Tell the global DM notification listener which channel is active
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
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
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
      if (ch) { setSelectedChannel(ch); setMobileView("conversation") }
      setUsersOpen(false)
    }
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

  /* ── Date-grouped messages ── */
  const groupedMessages = React.useMemo(() => {
    const groups: { label: string; messages: ChatMessage[] }[] = []
    let currentLabel = ""
    for (const msg of messages) {
      const label = getDateLabel(msg.createdAt)
      if (label !== currentLabel) {
        groups.push({ label, messages: [msg] })
        currentLabel = label
      } else {
        groups[groups.length - 1].messages.push(msg)
      }
    }
    return groups
  }, [messages])

  /* ── Handle channel select ── */
  const handleSelectChannel = (ch: ChatChannel) => {
    setSelectedChannel(ch)
    setMobileView("conversation")
  }

  /* ── Guards ── */
  if (!companyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${BRAND_BLUE}20` }}>
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
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border border-border/50 shadow-2xl"
      style={{ background: "hsl(var(--background))" }}>

      {/* ══════════ CHANNEL SIDEBAR ══════════ */}
      <div
        className={cn(
          "flex-col border-r border-border/60",
          "md:flex md:w-72 md:shrink-0",
          // Mobile: show list OR conversation, never both
          mobileView === "list" ? "flex w-full" : "hidden",
        )}
        style={{ background: "hsl(var(--sidebar))" }}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border/50">
          <div>
            <h1 className="font-bold text-lg leading-tight">Messages</h1>
            {totalUnread > 0 && (
              <p className="text-xs text-muted-foreground">{totalUnread} unread</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              data-compact
              onClick={() => setUsersOpen(true)}
              className="btn-compact w-9 h-9 flex items-center justify-center rounded-xl transition-all text-white"
              style={{ background: BRAND_BLUE }}
              title="New direct message"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Company switcher — only shown when there is more than one workspace */}
        {companies.length > 1 && (
          <div className="px-3 pt-2.5 pb-1">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {companies.map((c) => {
                const isActive = c.id.toString() === selectedCompanyId
                const abbr = c.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)
                return (
                  <button
                    key={c.id}
                    data-compact
                    title={c.name}
                    onClick={() => {
                      setSelectedCompanyId(c.id.toString())
                      setSelectedChannel(null)
                      setMobileView("list")
                    }}
                    className={cn(
                      "btn-compact shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border whitespace-nowrap",
                      isActive
                        ? "text-white border-transparent shadow-md"
                        : "text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/60"
                    )}
                    style={isActive ? {
                      background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_BLUE_DARK})`,
                      boxShadow: `0 3px 10px ${BRAND_BLUE}40`,
                    } : {}}
                  >
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0"
                      style={{
                        background: isActive ? "rgba(255,255,255,0.25)" : `${BRAND_BLUE}20`,
                        color: isActive ? "#fff" : BRAND_BLUE,
                      }}
                    >
                      {abbr}
                    </span>
                    <span className="truncate max-w-[80px]">{c.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 py-2.5">
          {(["all", "direct", "groups", "unread"] as const).map((f) => (
            <button
              key={f}
              data-compact
              onClick={() => setChannelFilter(f)}
              className={cn(
                "btn-compact flex-1 text-[11px] font-semibold py-1.5 rounded-lg capitalize transition-all",
                channelFilter === f
                  ? "text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              style={channelFilter === f ? { background: BRAND_BLUE, boxShadow: `0 2px 8px ${BRAND_BLUE}40` } : {}}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {filteredChannels.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              {channelFilter === "unread" ? "No unread messages 🎉" : "No channels yet"}
            </div>
          ) : (
            filteredChannels.map((ch) => {
              const isSelected = selectedChannel?.id === ch.id
              const typeIcon = ch.type === "direct"
                ? <User style={{ width: 12, height: 12 }} />
                : ch.type === "team" ? <Users style={{ width: 12, height: 12 }} />
                : ch.type === "department" ? <Hash style={{ width: 12, height: 12 }} />
                : <Briefcase style={{ width: 12, height: 12 }} />

              return (
                <button
                  key={ch.id}
                  onClick={() => handleSelectChannel(ch)}
                  className={cn("channel-row", isSelected && "channel-row-active")}
                  style={isSelected ? {
                    background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_BLUE_DARK})`,
                    boxShadow: `0 4px 16px ${BRAND_BLUE}35`,
                  } : {}}
                >
                  {/* Avatar with online dot */}
                  <div className="relative">
                    <ChannelAvatar name={ch.name} size={42} own={isSelected} />
                    {/* Simulated online dot for group channels */}
                    {ch.type !== "direct" && (
                      <span className="online-dot" style={isSelected ? { borderColor: BRAND_BLUE_DARK } : {}} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className={cn("font-semibold text-[0.9375rem] truncate flex items-center gap-1.5",
                        isSelected ? "text-white" : "text-foreground")}>
                        {typeIcon}
                        <span>{ch.name}</span>
                      </div>
                      {ch.unread > 0 && (
                        <span
                          className="text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center shrink-0"
                          style={isSelected
                            ? { background: "rgba(255,255,255,0.25)", color: "#fff" }
                            : { background: BRAND_BLUE, color: "#fff" }}
                        >
                          {ch.unread > 99 ? "99+" : ch.unread}
                        </span>
                      )}
                    </div>
                    <div className={cn("text-xs truncate mt-0.5",
                      isSelected ? "text-white/65" : "text-muted-foreground")}>
                      {ch.type === "direct" ? "Direct message" : ch.type === "team" ? "Team channel" : ch.department ?? ch.type}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Sidebar actions */}
        <div className="p-3 border-t border-border/50 space-y-0.5">
          {[
            { icon: Search, label: "Search Messages", action: () => setSearchOpen(true) },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all font-medium"
            >
              <Icon className="h-4 w-4 shrink-0" style={{ color: BRAND_BLUE }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════ CHAT AREA ══════════ */}
      <div
        className={cn(
          "flex-col min-w-0",
          "md:flex md:flex-1",
          // Mobile: show conversation OR empty list
          mobileView === "conversation" ? "flex flex-1" : "hidden md:flex md:flex-1",
        )}
        style={{ background: "hsl(var(--background))" }}
      >
        {!selectedChannel ? (
          /* ── Dashboard empty state ── */
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 gap-6 overflow-y-auto">
            {/* Watermark logo */}
            <div className="relative">
              <div
                className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl"
                style={{ background: `linear-gradient(135deg, ${BRAND_BLUE}20, ${BRAND_BLUE}40)`, border: `2px solid ${BRAND_BLUE}30` }}
              >
                <span className="text-5xl font-black" style={{ color: BRAND_BLUE, opacity: 0.7 }}>T</span>
              </div>
            </div>

            <div className="text-center space-y-1">
              <p className="text-2xl font-bold">{getGreeting()}, {user?.name?.split(" ")[0] ?? "there"} 👋</p>
              <p className="text-muted-foreground">Select a conversation or start a new one.</p>
            </div>

            {/* Quick stats */}
            <div className="flex gap-3 flex-wrap justify-center">
              {totalUnread > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-border/60"
                  style={{ background: "hsl(var(--card))" }}>
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: BRAND_BLUE }} />
                  <span className="text-sm font-semibold">{totalUnread}</span>
                  <span className="text-sm text-muted-foreground">unread</span>
                </div>
              )}
              {(channels?.length ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-border/60"
                  style={{ background: "hsl(var(--card))" }}>
                  <MessageSquare className="w-4 h-4" style={{ color: BRAND_BLUE }} />
                  <span className="text-sm font-semibold">{channels!.length}</span>
                  <span className="text-sm text-muted-foreground">channels</span>
                </div>
              )}
            </div>

            {/* Recent channels */}
            {(channels?.length ?? 0) > 0 && (
              <div className="w-full max-w-sm space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 text-center mb-3">Recent</p>
                {channels!.slice(0, 4).map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => handleSelectChannel(ch)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border/60 hover:border-primary/40 transition-all group"
                    style={{ background: "hsl(var(--card))" }}
                  >
                    <ChannelAvatar name={ch.name} size={38} />
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{ch.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{ch.type === "direct" ? "Direct message" : ch.type}</div>
                    </div>
                    {ch.unread > 0 && (
                      <span className="text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center text-white"
                        style={{ background: BRAND_BLUE }}>
                        {ch.unread}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <Button
              onClick={() => setUsersOpen(true)}
              className="rounded-2xl px-6 gap-2"
              style={{ background: BRAND_BLUE, color: "#fff", boxShadow: `0 4px 20px ${BRAND_BLUE}45` }}
            >
              <Plus className="h-4 w-4" /> New Direct Message
            </Button>
          </div>
        ) : (
          <>
            {/* ── Chat header ── */}
            <div className="flex items-center justify-between px-4 py-3 glass-header shrink-0 gap-3">
              {/* Back button (mobile) */}
              <button
                data-compact
                className="btn-compact md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/60 transition-all shrink-0"
                onClick={() => { setMobileView("list"); setSelectedChannel(null) }}
              >
                <ArrowLeft className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </button>

              {/* Channel info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="relative">
                  <ChannelAvatar name={selectedChannel.name} size={40} />
                  {selectedChannel.type !== "direct" && <span className="online-dot" />}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[0.9375rem] truncate leading-tight">{selectedChannel.name}</div>
                  <div className="text-xs text-muted-foreground capitalize leading-tight">
                    {selectedChannel.type === "direct"
                      ? "Direct message"
                      : `${selectedChannel.type} · ${channelUsers?.length ?? 0} members`}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                {[
                  { icon: Phone, title: "Voice call", disabled: !!startingCall || !!activeCall, onClick: () => startChannelCall(false), loading: startingCall === "voice" },
                  { icon: Video, title: "Video call", disabled: !!startingCall || !!activeCall, onClick: () => startChannelCall(true), loading: startingCall === "video" },
                  { icon: Search, title: "Search", disabled: false, onClick: () => setSearchOpen(true), loading: false },
                ].map(({ icon: Icon, title, disabled, onClick, loading }) => (
                  <button
                    key={title}
                    data-compact
                    className="btn-compact w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-40"
                    title={title}
                    disabled={disabled}
                    onClick={onClick}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon style={{ width: 17, height: 17 }} />}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4" style={{ background: "hsl(var(--background))" }}>
              {messages.length === 0 ? (
                /* Empty message area with watermark */
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center select-none">
                  <div className="text-9xl font-black text-center leading-none"
                    style={{ color: BRAND_BLUE, opacity: 0.04, userSelect: "none", fontSize: "clamp(6rem, 15vw, 12rem)" }}>
                    T
                  </div>
                  <div className="text-center space-y-1 -mt-8">
                    <p className="font-semibold text-lg">Say hello to {selectedChannel.name} 👋</p>
                    <p className="text-sm text-muted-foreground">Be the first to send a message.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {groupedMessages.map(({ label, messages: dayMsgs }) => (
                    <div key={label}>
                      {/* Date separator */}
                      <div className="date-separator">
                        <span>{label}</span>
                      </div>

                      {/* Messages for this day */}
                      {dayMsgs.map((msg, idx) => {
                        const isOwn = msg.userId === userId
                        const prevMsg = idx > 0 ? dayMsgs[idx - 1] : null
                        const showAvatar = !isOwn && (prevMsg?.userId !== msg.userId)
                        const isGrouped = prevMsg?.userId === msg.userId && !showAvatar

                        return (
                          <div
                            key={msg.id}
                            className={cn("flex gap-3 group", isOwn ? "flex-row-reverse" : "flex-row", isGrouped ? "mt-0.5" : "mt-3")}
                          >
                            {/* Avatar — only on first message of a run */}
                            {!isOwn && (
                              <div style={{ width: 32, flexShrink: 0 }}>
                                {showAvatar && <MsgAvatar name={msg.displayName} size={32} />}
                              </div>
                            )}

                            <div className={cn("max-w-[72%] flex flex-col gap-1", isOwn && "items-end")}>
                              {/* Sender + time — only on first of a run */}
                              {showAvatar && (
                                <div className="flex items-center gap-2 px-1">
                                  <span className="text-[0.8125rem] font-semibold" style={{ color: BRAND_BLUE }}>{msg.displayName}</span>
                                  <span className="text-[11px] text-muted-foreground">{formatTime(msg.createdAt)}</span>
                                  {msg.isPinned && <Pin className="h-3 w-3 text-muted-foreground" />}
                                </div>
                              )}

                              {msg.replyToId && (
                                <div className="text-xs text-muted-foreground border-l-2 pl-2 ml-1 mb-0.5" style={{ borderColor: BRAND_BLUE }}>
                                  Reply to #{msg.replyToId}
                                </div>
                              )}

                              {msg.isAnnouncement && (
                                <div className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full w-fit"
                                  style={{ background: `${BRAND_BLUE}20`, color: BRAND_BLUE }}>
                                  📢 Announcement
                                </div>
                              )}

                              {/* Bubble */}
                              <div
                                className={cn(
                                  "msg-content px-4 py-2.5 relative whitespace-pre-wrap",
                                  isOwn ? "msg-appear-own" : "msg-appear"
                                )}
                                style={isOwn ? {
                                  background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_BLUE_DARK})`,
                                  color: "#fff",
                                  borderRadius: 20,
                                  borderBottomRightRadius: isGrouped ? 20 : 6,
                                  boxShadow: `0 4px 14px ${BRAND_BLUE}35`,
                                } : {
                                  background: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border) / 0.8)",
                                  borderRadius: 20,
                                  borderBottomLeftRadius: isGrouped ? 20 : 6,
                                  color: "hsl(var(--foreground))",
                                }}
                              >
                                {msg.content}
                                {isOwn && (
                                  <span className="ml-2 text-[10px] opacity-60">
                                    {formatTime(msg.createdAt)}{msg.editedAt ? " · edited" : ""}
                                  </span>
                                )}
                              </div>

                              {/* Attachments */}
                              {msg.attachments?.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {msg.attachments.map((a, i) => (
                                    <a
                                      key={i}
                                      href={`/api/storage/objects/${a.objectPath}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-link flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all hover:opacity-80"
                                      style={{ borderColor: `${BRAND_BLUE}44`, color: BRAND_BLUE }}
                                    >
                                      <Paperclip style={{ width: 11, height: 11 }} /> {a.name}
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
                                      data-compact
                                      onClick={() => toggleReaction(msg.id, emoji)}
                                      className="btn-compact flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border transition-all hover:scale-110 active:scale-95"
                                      style={
                                        ids.includes(userId ?? 0)
                                          ? { background: `${BRAND_BLUE}20`, borderColor: BRAND_BLUE, color: BRAND_BLUE }
                                          : { borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }
                                      }
                                    >
                                      {emoji} <span>{ids.length}</span>
                                    </button>
                                  ))}
                                {/* Add reaction + reply — visible on hover */}
                                <button
                                  data-compact
                                  className="btn-compact opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:bg-muted transition-all"
                                  onClick={() => toggleReaction(msg.id, "👍")}
                                  title="React"
                                >
                                  <Smile style={{ width: 12, height: 12 }} />
                                </button>
                                <button
                                  data-compact
                                  className="btn-compact opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-foreground transition-all px-1.5 py-0.5 rounded-full border border-transparent hover:border-border/60"
                                  onClick={() => setReplyTo(msg)}
                                >
                                  Reply
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {typingUsers.length > 0 && (
                    <div className="flex items-center gap-2 px-2 mt-3 ml-11">
                      <div className="flex gap-1 px-3 py-2 rounded-2xl rounded-bl-md"
                        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.6)" }}>
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className="w-2 h-2 rounded-full animate-bounce"
                            style={{ background: BRAND_BLUE, animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">typing…</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} className="h-1" />
                </div>
              )}
            </div>

            {/* ── Composer ── */}
            <div className="px-4 pb-4 pt-2 shrink-0 border-t border-border/40"
              style={{ background: "hsl(var(--card) / 0.6)", backdropFilter: "blur(8px)" }}>

              {/* Reply indicator */}
              {replyTo && (
                <div className="flex items-center justify-between text-xs mb-2 px-3 py-2 rounded-xl"
                  style={{ background: `${BRAND_BLUE}12`, borderLeft: `3px solid ${BRAND_BLUE}` }}>
                  <span className="text-muted-foreground">
                    <span className="font-semibold" style={{ color: BRAND_BLUE }}>{replyTo.displayName}:</span>{" "}
                    {replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? "…" : ""}
                  </span>
                  <button data-compact className="btn-compact w-5 h-5 text-muted-foreground hover:text-foreground ml-2" onClick={() => setReplyTo(null)}>
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              )}

              {/* Emoji quick-row */}
              {showEmojiRow && (
                <div className="flex gap-2 mb-2 px-1">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      data-compact
                      onClick={() => {
                        if (selectedChannel) socket?.emit("message:send", { channelId: selectedChannel.id, content: emoji, mentions: [] }, () => {})
                        setShowEmojiRow(false)
                      }}
                      className="btn-compact text-xl hover:scale-125 transition-transform active:scale-110"
                      title={`Send ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Main composer box */}
              <div
                className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-all focus-within:shadow-lg"
                style={{
                  borderColor: "hsl(var(--border) / 0.8)",
                  background: "hsl(var(--card))",
                  transition: "border-color 200ms, box-shadow 200ms",
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = BRAND_BLUE}
                onBlur={(e) => e.currentTarget.style.borderColor = "hsl(var(--border) / 0.8)"}
              >
                {/* Emoji toggle */}
                <button
                  data-compact
                  className="btn-compact shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowEmojiRow((v) => !v)}
                  title="Emoji"
                >
                  <Smile style={{ width: 17, height: 17 }} />
                </button>

                {/* Textarea */}
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    rows={1}
                    onChange={(e) => {
                      const value = e.target.value
                      setInput(value)
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
                    placeholder={replyTo ? "Reply…" : "Message " + selectedChannel.name + "…"}
                    className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground max-h-[120px] py-1"
                    style={{ minHeight: 26 }}
                  />
                  {showMentions && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 max-h-[200px] overflow-y-auto rounded-2xl border bg-card shadow-xl z-10 p-1.5 space-y-0.5">
                      {(channelUsers?.filter((u) => u.id !== userId && (
                        !(mentionQuery ?? "") || u.name.toLowerCase().includes(mentionQuery!) || u.email.toLowerCase().includes(mentionQuery!)
                      )).length ?? 0) === 0 ? (
                        <div className="text-xs text-muted-foreground px-3 py-2">No matching members</div>
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
                              className="w-full text-left rounded-xl px-3 py-2 hover:bg-muted text-sm flex items-center gap-3 transition-colors"
                            >
                              <MsgAvatar name={u.name} size={28} />
                              <div>
                                <div className="font-semibold text-[0.8125rem]">{u.name}</div>
                                <div className="text-[11px] text-muted-foreground">{u.email}</div>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Attach */}
                  <input type="file" multiple className="hidden" id="chat-file-input" />
                  <label htmlFor="chat-file-input" data-compact>
                    <span className="btn-compact w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                      <Paperclip style={{ width: 16, height: 16 }} />
                    </span>
                  </label>
                  {/* Mic */}
                  <button
                    data-compact
                    className="btn-compact w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                    title="Voice message"
                  >
                    <Mic style={{ width: 16, height: 16 }} />
                  </button>
                  {/* AI Meeting Notes shortcut */}
                  <button
                    data-compact
                    className="btn-compact w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: "#7c3aed" }}
                    title="AI Meeting Notes"
                    onClick={() => window.location.assign("/meetings#notes")}
                  >
                    <Sparkles style={{ width: 16, height: 16 }} />
                  </button>
                  {/* Send */}
                  <button
                    data-compact
                    className="btn-compact w-9 h-9 flex items-center justify-center rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    disabled={!input.trim()}
                    onClick={sendMessage}
                    style={input.trim() ? {
                      background: `linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_BLUE_DARK})`,
                      color: "#fff",
                      boxShadow: `0 4px 12px ${BRAND_BLUE}40`,
                    } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                  >
                    <Send style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              </div>

              <p className="text-center text-[11px] text-muted-foreground/50 mt-1.5">
                Enter to send · Shift+Enter for new line · @name to mention
              </p>
            </div>
          </>
        )}
      </div>


      {/* ─────────────────── Dialogs ────────────────────── */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader><DialogTitle>Search Messages</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search messages…" />
            <Button onClick={handleSearch} style={{ background: BRAND_BLUE, color: "#fff" }}>Search</Button>
          </div>
          <div className="max-h-[320px] overflow-y-auto space-y-2">
            {searchResults.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6">Type a keyword and press Search.</div>
            )}
            {searchResults.map((msg) => (
              <div key={msg.id} className="rounded-2xl border p-3.5 text-sm hover:bg-muted/50 transition-colors">
                <div className="font-semibold text-xs mb-1" style={{ color: BRAND_BLUE }}>{msg.displayName}</div>
                <div className="text-muted-foreground leading-relaxed">{msg.content}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={usersOpen} onOpenChange={(o) => { setUsersOpen(o); if (!o) setDmQuery("") }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>New Direct Message</DialogTitle></DialogHeader>
          <Input placeholder="Search team members…" value={dmQuery} onChange={(e) => setDmQuery(e.target.value)} className="mb-3" />
          <div className="max-h-[320px] overflow-y-auto space-y-1.5">
            {isLoadingUsers ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_BLUE }} /></div>
            ) : (channelUsers?.filter((u) => u.id !== userId).filter((u) => {
              const q = dmQuery.toLowerCase()
              return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
            })?.length ?? 0) === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">No team members found.</div>
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
                    className="w-full text-left rounded-2xl border p-3.5 hover:bg-muted/50 text-sm flex items-center gap-3 transition-all"
                  >
                    <MsgAvatar name={u.name} size={40} />
                    <div>
                      <div className="font-semibold">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </button>
                ))
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
