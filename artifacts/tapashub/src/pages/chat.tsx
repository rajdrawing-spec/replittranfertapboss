import * as React from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { useAuth } from "@/contexts/auth-context"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"
import { useDmNotification } from "@/contexts/dm-notification-context"
import { useMeeting } from "@/contexts/meeting-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import {
  MessageSquare, Send, Paperclip, Video, Phone, X, Plus, Smile, Mic, MicOff,
  Users, ArrowLeft, Search, Info, Forward, Reply, Pencil, Trash2, Copy,
  LogOut, UserPlus, Shield, ShieldOff, ChevronDown, Camera, Check,
  Hash, Loader2, MoreVertical, Pin, Sparkles,
} from "lucide-react"

/* ─────────────────────────────── Types ─────────────────────────────────── */
interface ChannelMeta {
  id: number
  type: string
  name: string
  iconUrl?: string | null
  description?: string | null
  isGroup?: boolean
  department?: string | null
  companyId: number
  unread: number
  lastMessage?: { content: string; displayName: string; createdAt: string } | null
}
interface ChatMessage {
  id: number; channelId: number; userId: number; displayName: string; content: string
  replyToId?: number; attachments: Array<{ name: string; objectPath: string; contentType: string; size?: number }>
  reactions: Record<string, number[]>; mentions: number[]; isAnnouncement: boolean
  isPinned: boolean; editedAt: string | null; createdAt: string
}
interface WorkspaceUser {
  id: number; name: string; email: string; avatarUrl?: string | null
  department?: string | null; designation?: string | null
  presence: "online" | "away" | "busy" | "in_meeting" | "offline"
  statusMessage?: string | null; lastSeenAt?: string | null
}
interface ChannelMember {
  userId: number; isAdmin: boolean; joinedAt: string
  user: { id: number; name: string; email: string; avatarUrl?: string | null; department?: string | null } | null
}

type FilterType = "all" | "direct" | "groups" | "unread"
type RightPanel = null | { kind: "user"; userId: number } | { kind: "group"; channelId: number }
type PresenceType = "online" | "away" | "busy" | "in_meeting" | "offline"

/* ─────────────────────────── Constants ─────────────────────────────────── */
const PRESENCE_COLORS: Record<PresenceType, string> = {
  online: "#22c55e",
  away: "#eab308",
  busy: "#ef4444",
  in_meeting: "#8b5cf6",
  offline: "#6b7280",
}
const PRESENCE_LABELS: Record<PresenceType, string> = {
  online: "Online", away: "Away", busy: "Busy", in_meeting: "In Meeting", offline: "Offline",
}
const EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👏", "😮", "🚀", "✅", "💯"]
const BRAND_BLUE = "#3B82F6"

/* ─────────────────────────── Helpers ───────────────────────────────────── */
function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}
function timeAgo(date: string) {
  const d = Date.now() - new Date(date).getTime()
  if (d < 60_000) return "now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return new Date(date).toLocaleDateString([], { month: "short", day: "numeric" })
}
function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "Today"
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
}

/* ─────────────────────────── UserAvatar ────────────────────────────────── */
function UserAvatar({
  name, avatarUrl, size = 40, presence, showPresence = false,
}: {
  name: string; avatarUrl?: string | null; size?: number
  presence?: string; showPresence?: boolean
}) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="rounded-full object-cover"
          style={{ width: size, height: size }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
      ) : (
        <div className="rounded-full flex items-center justify-center select-none"
          style={{
            width: size, height: size,
            background: `hsl(${hue} 60% 40% / 0.18)`,
            border: `1.5px solid hsl(${hue} 60% 50% / 0.3)`,
            fontSize: size * 0.38, fontWeight: 700,
            color: `hsl(${hue} 60% 68%)`,
          }}>
          {initials(name)}
        </div>
      )}
      {showPresence && presence && presence !== "offline" && (
        <span className="absolute bottom-0 right-0 rounded-full border-2 border-background"
          style={{ width: size < 36 ? 8 : 10, height: size < 36 ? 8 : 10, background: PRESENCE_COLORS[presence as PresenceType] ?? "#6b7280" }} />
      )}
    </div>
  )
}

/* ─────────────────────────── GroupAvatar ───────────────────────────────── */
function GroupAvatar({ name, iconUrl, size = 40 }: { name: string; iconUrl?: string | null; size?: number }) {
  if (iconUrl) {
    return <img src={iconUrl} alt={name} className="rounded-2xl object-cover shrink-0"
      style={{ width: size, height: size }} />
  }
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div className="rounded-2xl flex items-center justify-center shrink-0"
      style={{
        width: size, height: size,
        background: `hsl(${hue} 55% 40% / 0.2)`,
        border: `1.5px solid hsl(${hue} 55% 50% / 0.3)`,
        fontSize: size * 0.35, fontWeight: 700, color: `hsl(${hue} 55% 68%)`,
      }}>
      {initials(name)}
    </div>
  )
}

/* ─────────────────────────── Main Page ─────────────────────────────────── */
export default function ChatPage() {
  const { user } = useAuth()
  const { companies, activeCompany } = useCompany()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { startCall, activeCall } = useMeeting()
  const { setActiveChannelId } = useDmNotification()

  const userId = user?.id
  const primaryCompanyId = activeCompany?.id ?? companies?.[0]?.id

  /* ── Socket ── */
  const [socket, setSocket] = React.useState<Socket | null>(null)
  const [onlineUserIds, setOnlineUserIds] = React.useState<Set<number>>(new Set())

  /* ── View state ── */
  const [selectedChannel, setSelectedChannel] = React.useState<ChannelMeta | null>(null)
  const [mobileView, setMobileView] = React.useState<"list" | "conversation">("list")
  const [rightPanel, setRightPanel] = React.useState<RightPanel>(null)
  const selectedChannelRef = React.useRef(selectedChannel)
  selectedChannelRef.current = selectedChannel

  /* ── Message state ── */
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = React.useState<number[]>([])
  const [editingMsg, setEditingMsg] = React.useState<ChatMessage | null>(null)
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  const [forwardMsg, setForwardMsg] = React.useState<ChatMessage | null>(null)
  const [hoveredMsgId, setHoveredMsgId] = React.useState<number | null>(null)

  /* ── Input state ── */
  const [input, setInput] = React.useState("")
  const [showEmoji, setShowEmoji] = React.useState(false)
  const [showMentions, setShowMentions] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)

  /* ── Recording ── */
  const [isRecording, setIsRecording] = React.useState(false)
  const [recordingTime, setRecordingTime] = React.useState(0)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const recordingChunks = React.useRef<BlobPart[]>([])
  const recordingInterval = React.useRef<ReturnType<typeof setInterval> | null>(null)

  /* ── Dialogs ── */
  const [showNewDm, setShowNewDm] = React.useState(false)
  const [showCreateGroup, setShowCreateGroup] = React.useState(false)
  const [showSearch, setShowSearch] = React.useState(false)
  const [showStatusDialog, setShowStatusDialog] = React.useState(false)

  /* ── Sidebar ── */
  const [channelFilter, setChannelFilter] = React.useState<FilterType>("all")
  const [sidebarSearch, setSidebarSearch] = React.useState("")

  /* ── DM dialog ── */
  const [dmSearch, setDmSearch] = React.useState("")

  /* ── Group creation ── */
  const [newGroupName, setNewGroupName] = React.useState("")
  const [newGroupDesc, setNewGroupDesc] = React.useState("")
  const [newGroupMembers, setNewGroupMembers] = React.useState<number[]>([])
  const [newGroupSearch, setNewGroupSearch] = React.useState("")
  const [creatingGroup, setCreatingGroup] = React.useState(false)

  /* ── Search dialog ── */
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<ChatMessage[]>([])
  const [searching, setSearching] = React.useState(false)

  /* ── Status ── */
  const [ownPresence, setOwnPresence] = React.useState<PresenceType>("online")
  const [ownStatusMsg, setOwnStatusMsg] = React.useState("")
  const [startingCall, setStartingCall] = React.useState<"voice" | "video" | null>(null)

  /* ── Refs ── */
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  /* ── Data ── */
  const { data: channels, isLoading: loadingChannels } = useQuery<ChannelMeta[]>({
    queryKey: ["/api/chat/channels"],
    queryFn: async () => {
      const r = await fetch("/api/chat/channels", { credentials: "include" })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    refetchInterval: 30_000,
  })

  const { data: workspaceUsers = [] } = useQuery<WorkspaceUser[]>({
    queryKey: ["/api/chat/users"],
    queryFn: async () => {
      const r = await fetch("/api/chat/users", { credentials: "include" })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    staleTime: 60_000,
  })

  const { data: channelMembers } = useQuery<ChannelMember[]>({
    queryKey: ["/api/chat/channels", selectedChannel?.id, "members"],
    queryFn: async () => {
      const r = await fetch(`/api/chat/channels/${selectedChannel!.id}/members`, { credentials: "include" })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    enabled: !!selectedChannel && (selectedChannel.type === "direct" || selectedChannel.isGroup === true || selectedChannel.type === "group"),
    staleTime: 30_000,
  })

  /* ── Derived ── */
  const userMap = React.useMemo(() => {
    const m = new Map<number, WorkspaceUser>()
    for (const u of workspaceUsers) m.set(u.id, u)
    return m
  }, [workspaceUsers])

  // For DM channels, find the other participant
  const dmOtherUser = React.useMemo<WorkspaceUser | null>(() => {
    if (!selectedChannel || selectedChannel.type !== "direct" || !channelMembers) return null
    const otherMember = channelMembers.find(m => m.userId !== userId)
    if (!otherMember) return null
    return userMap.get(otherMember.userId) ?? null
  }, [selectedChannel, channelMembers, userId, userMap])

  const filteredChannels = React.useMemo(() => {
    if (!channels) return []
    const q = sidebarSearch.toLowerCase()
    return channels.filter(ch => {
      if (channelFilter === "direct") return ch.type === "direct"
      if (channelFilter === "groups") return ch.type !== "direct"
      if (channelFilter === "unread") return ch.unread > 0
      return true
    }).filter(ch => !q || ch.name.toLowerCase().includes(q))
  }, [channels, channelFilter, sidebarSearch])

  const totalUnread = channels?.reduce((s, c) => s + c.unread, 0) ?? 0

  const groupedMessages = React.useMemo(() => {
    const groups: { label: string; messages: ChatMessage[] }[] = []
    let currentLabel = ""
    for (const msg of messages) {
      const label = getDateLabel(msg.createdAt)
      if (label !== currentLabel) { groups.push({ label, messages: [msg] }); currentLabel = label }
      else groups[groups.length - 1].messages.push(msg)
    }
    return groups
  }, [messages])

  /* ── Auto-select first channel once list loads ── */
  React.useEffect(() => {
    if (!selectedChannel && channels && channels.length > 0) {
      setSelectedChannel(channels[0])
    }
  }, [channels, selectedChannel])

  /* ── DM notification context ── */
  React.useEffect(() => {
    setActiveChannelId(selectedChannel?.id ?? null)
    return () => setActiveChannelId(null)
  }, [selectedChannel?.id, setActiveChannelId])

  /* ── Socket setup ── */
  React.useEffect(() => {
    if (!userId) return
    const s: Socket = io({
      path: "/api/socket.io",
      auth: (cb: (data: object) => void) => {
        fetch("/api/chat/token", { credentials: "include" })
          .then(r => r.json()).then(({ token }) => cb({ token })).catch(() => cb({}))
      },
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000,
    })
    s.on("connect", () => {
      s.emit("join", { companyId: primaryCompanyId }, (res: any) => {
        if (!res.ok) return
        const ch = selectedChannelRef.current
        if (ch) s.emit("join:channel", { channelId: ch.id }, () => {})
        // Seed online users
        if (res.users) {
          const online = new Set<number>()
          for (const u of res.users as { userId: number; online: boolean }[]) {
            if (u.online) online.add(u.userId)
          }
          setOnlineUserIds(online)
        }
      })
    })
    s.on("message:new", (msg: ChatMessage) => {
      setMessages(prev => {
        if (msg.channelId !== selectedChannelRef.current?.id) return prev
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
    })
    s.on("message:reaction", (msg: ChatMessage) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
    })
    s.on("message:edited", (msg: ChatMessage) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
    })
    s.on("message:deleted", ({ messageId }: { messageId: number }) => {
      setMessages(prev => prev.filter(m => m.id !== messageId))
    })
    s.on("typing", ({ channelId, userId: uid, typing }: any) => {
      setTypingUsers(prev => {
        if (selectedChannelRef.current?.id !== channelId) return prev
        if (typing) return prev.includes(uid) ? prev : [...prev, uid]
        return prev.filter(id => id !== uid)
      })
    })
    s.on("channel:update", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
    })
    s.on("presence:online", ({ userId: uid }: { userId: number }) => {
      setOnlineUserIds(prev => new Set([...prev, uid]))
    })
    s.on("presence:offline", ({ userId: uid }: { userId: number }) => {
      setOnlineUserIds(prev => { const n = new Set(prev); n.delete(uid); return n })
    })
    setSocket(s)
    return () => { s.disconnect(); setSocket(null) }
  }, [userId, primaryCompanyId, queryClient])

  /* ── Load messages when channel changes ── */
  React.useEffect(() => {
    if (!selectedChannel || !socket) return
    socket.emit("join:channel", { channelId: selectedChannel.id }, (res: any) => {
      if (!res.ok) toast({ title: "Join channel failed", description: res.error, variant: "destructive" })
    })
    fetch(`/api/chat/channels/${selectedChannel.id}/messages`, { credentials: "include" })
      .then(r => r.json()).then(data => setMessages(data))
      .catch(err => toast({ title: "Failed to load messages", description: String(err), variant: "destructive" }))
    setTypingUsers([])
    setReplyTo(null)
    setEditingMsg(null)
  }, [selectedChannel?.id, socket])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  /* ── Typing indicator ── */
  const typingTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleInputChange = (value: string) => {
    setInput(value)
    if (selectedChannel && socket) {
      socket.emit("typing:start", { channelId: selectedChannel.id })
      if (typingTimeout.current) clearTimeout(typingTimeout.current)
      typingTimeout.current = setTimeout(() => {
        socket.emit("typing:stop", { channelId: selectedChannel.id })
      }, 3000)
    }
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px"
    }
    // Mention detection
    const cursor = value.length
    const match = value.slice(0, cursor).match(/@([\w.]*)$/)
    if (match) { setMentionQuery(match[1].toLowerCase()); setShowMentions(true) }
    else { setShowMentions(false); setMentionQuery(null) }
  }

  const insertMention = (name: string) => {
    const match = input.match(/@([\w.]*)$/)
    if (match) setInput(input.slice(0, input.length - match[0].length) + `@${name} `)
    setShowMentions(false); setMentionQuery(null)
  }

  /* ── Send message ── */
  const sendMessage = () => {
    if (!socket || !selectedChannel) return
    const content = input.trim()
    if (!content && !editingMsg) return

    if (editingMsg) {
      fetch(`/api/chat/messages/${editingMsg.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: selectedChannel.id, content }),
      }).then(r => r.json()).then(updated => {
        setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
      })
      setEditingMsg(null)
      setInput("")
      return
    }

    const mentionIds: number[] = []
    for (const u of workspaceUsers) {
      if (content.includes(`@${u.name}`) || content.includes(`@${u.email.split("@")[0]}`)) mentionIds.push(u.id)
    }
    socket.emit("message:send", {
      channelId: selectedChannel.id, content, mentions: mentionIds, replyToId: replyTo?.id,
    }, (res: any) => {
      if (!res.ok) toast({ title: "Send failed", description: res.error, variant: "destructive" })
    })
    setInput(""); setReplyTo(null); setShowEmoji(false)
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  /* ── Reactions ── */
  const toggleReaction = (messageId: number, emoji: string) => {
    if (!socket) return
    const msg = messages.find(m => m.id === messageId)
    const hasReacted = msg?.reactions?.[emoji]?.includes(userId ?? 0)
    socket.emit(hasReacted ? "reaction:remove" : "reaction:add", { messageId, emoji })
  }

  /* ── Delete message ── */
  const deleteMsg = async (msg: ChatMessage) => {
    if (!selectedChannel) return
    await fetch(`/api/chat/messages/${msg.id}?channelId=${selectedChannel.id}`, {
      method: "DELETE", credentials: "include",
    })
    setMessages(prev => prev.filter(m => m.id !== msg.id))
  }

  /* ── Copy message ── */
  const copyMsg = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content)
    toast({ title: "Copied" })
  }

  /* ── Forward message ── */
  const [forwardTarget, setForwardTarget] = React.useState<number | null>(null)
  const doForward = async () => {
    if (!forwardMsg || !forwardTarget) return
    await fetch(`/api/chat/channels/${forwardMsg.channelId}/messages/${forwardMsg.id}/forward`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetChannelId: forwardTarget }),
    })
    setForwardMsg(null); setForwardTarget(null)
    toast({ title: "Message forwarded" })
  }

  /* ── Start DM ── */
  const startDm = async (otherUserId: number) => {
    const r = await fetch("/api/chat/direct", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: otherUserId }),
    })
    if (!r.ok) { toast({ title: "Failed to start DM", variant: "destructive" }); return }
    const { channelId } = await r.json()
    await queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
    setShowNewDm(false); setDmSearch("")
    // Wait for channels to refetch, then select
    setTimeout(() => {
      queryClient.fetchQuery({ queryKey: ["/api/chat/channels"] }).then((chs: any) => {
        const ch = (chs as ChannelMeta[])?.find(c => c.id === channelId)
        if (ch) { setSelectedChannel(ch); setMobileView("conversation") }
      })
    }, 300)
  }

  /* ── Create group ── */
  const doCreateGroup = async () => {
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    try {
      const r = await fetch("/api/chat/groups", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim(), description: newGroupDesc, memberIds: newGroupMembers }),
      })
      if (!r.ok) { toast({ title: "Failed to create group", variant: "destructive" }); return }
      const ch = await r.json()
      await queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
      setShowCreateGroup(false); setNewGroupName(""); setNewGroupDesc(""); setNewGroupMembers([]); setNewGroupSearch("")
      setTimeout(() => {
        const meta: ChannelMeta = { ...ch, unread: 0 }
        setSelectedChannel(meta); setMobileView("conversation")
      }, 300)
    } finally { setCreatingGroup(false) }
  }

  /* ── File upload ── */
  const uploadFile = async (file: File) => {
    if (!selectedChannel) return
    try {
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      })
      const { uploadURL, objectPath } = await urlRes.json()
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
      socket?.emit("message:send", {
        channelId: selectedChannel.id,
        content: `📎 ${file.name}`,
        attachments: [{ name: file.name, objectPath, contentType: file.type, size: file.size }],
        mentions: [],
      }, (res: any) => {
        if (!res.ok) toast({ title: "Upload failed", description: res.error, variant: "destructive" })
      })
    } catch {
      toast({ title: "File upload failed", variant: "destructive" })
    }
  }

  /* ── Voice recording ── */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      recordingChunks.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) recordingChunks.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(recordingChunks.current, { type: "audio/webm" })
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" })
        await uploadFile(file)
      }
      mr.start()
      setIsRecording(true); setRecordingTime(0)
      recordingInterval.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch { toast({ title: "Microphone not available", variant: "destructive" }) }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    if (recordingInterval.current) clearInterval(recordingInterval.current)
  }

  /* ── Call ── */
  const startChannelCall = async (video: boolean) => {
    if (!selectedChannel || startingCall || !primaryCompanyId) return
    setStartingCall(video ? "video" : "voice")
    try {
      const r = await fetch("/api/meetings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: primaryCompanyId, channelId: selectedChannel.id, title: `${selectedChannel.name} ${video ? "Call" : "Voice Call"}` }),
      })
      if (!r.ok) { toast({ title: "Failed to start call", variant: "destructive" }); return }
      const meeting = await r.json()
      const tokenRes = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(meeting.meetingId)}&companyId=${primaryCompanyId}`, { credentials: "include" })
      if (!tokenRes.ok) return
      const { token, serverUrl } = await tokenRes.json()
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      startCall({ id: meeting.id, meetingId: meeting.meetingId, title: meeting.title, companyId: primaryCompanyId! }, token, serverUrl, { video })
    } finally { setStartingCall(null) }
  }

  /* ── Search ── */
  const doSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const r = await fetch(`/api/chat/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" })
      if (r.ok) setSearchResults(await r.json())
    } finally { setSearching(false) }
  }

  /* ── Status update ── */
  const updateStatus = async (presence: PresenceType, statusMessage?: string) => {
    await fetch("/api/users/status", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presence, statusMessage: statusMessage ?? ownStatusMsg }),
    })
    setOwnPresence(presence)
    if (statusMessage !== undefined) setOwnStatusMsg(statusMessage)
    setShowStatusDialog(false)
  }

  /* ── Channel header display ── */
  const channelDisplayName = React.useMemo(() => {
    if (!selectedChannel) return ""
    if (selectedChannel.type === "direct" && dmOtherUser) return dmOtherUser.name
    return selectedChannel.name
  }, [selectedChannel, dmOtherUser])

  const channelSubtitle = React.useMemo(() => {
    if (!selectedChannel) return ""
    if (selectedChannel.type === "direct" && dmOtherUser) {
      const p = onlineUserIds.has(dmOtherUser.id) ? "online" : (dmOtherUser.presence ?? "offline")
      return PRESENCE_LABELS[p as PresenceType] ?? "Offline"
    }
    if (selectedChannel.type === "group" || selectedChannel.isGroup) {
      return `${channelMembers?.length ?? 0} members`
    }
    if (selectedChannel.type === "team") return "Team channel"
    if (selectedChannel.type === "department") return `Department · ${selectedChannel.department ?? ""}`
    return selectedChannel.type
  }, [selectedChannel, dmOtherUser, onlineUserIds, channelMembers])

  /* ── Sidebar channel name ── */
  const getChannelDisplayName = React.useCallback((ch: ChannelMeta): string => {
    if (ch.type === "direct") {
      // Parse out the other user name from "NameA ↔ NameB"
      const parts = ch.name.split(" ↔ ")
      const myName = user?.name ?? ""
      const other = parts.find(p => p.trim() !== myName) ?? ch.name
      return other.trim()
    }
    return ch.name
  }, [user?.name])

  const getChannelPresence = React.useCallback((ch: ChannelMeta): string | undefined => {
    if (ch.type !== "direct") return undefined
    const parts = ch.name.split(" ↔ ")
    const myName = user?.name ?? ""
    const otherName = parts.find(p => p.trim() !== myName)?.trim()
    if (!otherName) return undefined
    const other = workspaceUsers.find(u => u.name === otherName)
    if (!other) return undefined
    return onlineUserIds.has(other.id) ? "online" : (other.presence ?? "offline")
  }, [user?.name, workspaceUsers, onlineUserIds])

  if (loadingChannels) {
    return (
      <div className="flex h-[calc(100vh-5rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: BRAND_BLUE }} />
      </div>
    )
  }

  /* ───────────────────────────────── RENDER ─────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border border-border/50 shadow-2xl" style={{ background: "hsl(var(--background))" }}>

      {/* ══════════════ LEFT SIDEBAR ══════════════ */}
      <div className={cn(
        "flex-col w-72 shrink-0 border-r border-border/60",
        "md:flex",
        mobileView === "list" ? "flex w-full" : "hidden",
      )} style={{ background: "hsl(var(--sidebar, var(--card)))" }}>

        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base leading-tight">Messages</h1>
            {totalUnread > 0 && <p className="text-xs text-muted-foreground">{totalUnread} unread</p>}
          </div>
          <button onClick={() => setShowSearch(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all" title="Search">
            <Search className="h-4 w-4" />
          </button>
          <button onClick={() => setShowNewDm(true)}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-white shadow-sm transition-all"
            style={{ background: BRAND_BLUE }} title="New message">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
              placeholder="Search conversations…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0" />
            {sidebarSearch && <button onClick={() => setSidebarSearch("")}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 py-2">
          {(["all", "direct", "groups", "unread"] as const).map(f => (
            <button key={f} onClick={() => setChannelFilter(f)}
              className={cn(
                "flex-1 text-[11px] font-semibold py-1 rounded-lg capitalize transition-all",
                channelFilter === f ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
              style={channelFilter === f ? { background: BRAND_BLUE } : {}}>
              {f}
            </button>
          ))}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {filteredChannels.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">
              {channelFilter === "unread" ? "All caught up! 🎉" : "No conversations"}
            </div>
          ) : filteredChannels.map(ch => {
            const isSelected = selectedChannel?.id === ch.id
            const displayName = getChannelDisplayName(ch)
            const isDirect = ch.type === "direct"
            const isGroup = ch.type === "group" || ch.isGroup
            const pres = isDirect ? getChannelPresence(ch) : undefined
            const otherUser = isDirect
              ? workspaceUsers.find(u => {
                  const parts = ch.name.split(" ↔ ")
                  return parts.some(p => p.trim() === u.name && u.id !== userId)
                })
              : undefined
            return (
              <button key={ch.id} onClick={() => { setSelectedChannel(ch); setMobileView("conversation"); setRightPanel(null) }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                  isSelected ? "shadow-md" : "hover:bg-muted/50",
                )}
                style={isSelected ? { background: BRAND_BLUE } : {}}>
                {isDirect ? (
                  <UserAvatar name={displayName} avatarUrl={otherUser?.avatarUrl} size={42}
                    presence={pres} showPresence={!!pres} />
                ) : (
                  <GroupAvatar name={displayName} iconUrl={ch.iconUrl} size={42} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn("font-semibold text-[0.875rem] truncate", isSelected ? "text-white" : "text-foreground")}>
                      {displayName}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ch.lastMessage && (
                        <span className={cn("text-[10px]", isSelected ? "text-white/60" : "text-muted-foreground")}>
                          {timeAgo(ch.lastMessage.createdAt)}
                        </span>
                      )}
                      {ch.unread > 0 && (
                        <span className="text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center"
                          style={isSelected
                            ? { background: "rgba(255,255,255,0.25)", color: "#fff" }
                            : { background: BRAND_BLUE, color: "#fff" }}>
                          {ch.unread > 99 ? "99+" : ch.unread}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={cn("text-xs truncate mt-0.5", isSelected ? "text-white/60" : "text-muted-foreground")}>
                    {ch.lastMessage
                      ? `${ch.lastMessage.displayName}: ${ch.lastMessage.content.slice(0, 40)}`
                      : isDirect ? "Direct message" : isGroup ? "Group" : ch.type}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* New group button */}
        <div className="px-3 pb-2 pt-1">
          <button onClick={() => setShowCreateGroup(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all">
            <Users className="h-4 w-4" style={{ color: BRAND_BLUE }} />
            New group chat
          </button>
        </div>

        {/* Own status footer */}
        <div className="px-3 py-3 border-t border-border/40">
          <button onClick={() => setShowStatusDialog(true)}
            className="flex items-center gap-3 w-full px-2 py-2 rounded-xl hover:bg-muted/50 transition-all">
            <div className="relative shrink-0">
              <UserAvatar name={user?.name ?? "Me"} avatarUrl={(user as any)?.avatarUrl} size={34} />
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background"
                style={{ background: PRESENCE_COLORS[ownPresence] }} />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-semibold truncate">{user?.name ?? "Me"}</div>
              <div className="text-xs text-muted-foreground truncate">{PRESENCE_LABELS[ownPresence]}</div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ══════════════ CONVERSATION PANEL ══════════════ */}
      <div className={cn(
        "flex-col flex-1 min-w-0",
        "md:flex",
        mobileView === "conversation" ? "flex" : "hidden md:flex",
      )} style={{ background: "hsl(var(--background))" }}>

        {!selectedChannel ? (
          /* ── Empty state ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 py-12">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl"
              style={{ background: `${BRAND_BLUE}15`, border: `2px solid ${BRAND_BLUE}20` }}>
              <MessageSquare className="h-10 w-10" style={{ color: BRAND_BLUE }} />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xl font-bold">Select a conversation</p>
              <p className="text-muted-foreground text-sm">Choose from your chats or start a new one.</p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setShowNewDm(true)} className="gap-2 rounded-2xl" style={{ background: BRAND_BLUE, color: "#fff" }}>
                <Plus className="h-4 w-4" /> New Message
              </Button>
              <Button variant="outline" onClick={() => setShowCreateGroup(true)} className="gap-2 rounded-2xl">
                <Users className="h-4 w-4" /> New Group
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Chat header ── */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 shrink-0"
              style={{ background: "hsl(var(--card)/0.7)", backdropFilter: "blur(8px)" }}>
              {/* Back (mobile) */}
              <button className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/60 transition-all"
                onClick={() => { setMobileView("list"); setSelectedChannel(null) }}>
                <ArrowLeft className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </button>
              {/* Avatar */}
              <button onClick={() => {
                if (selectedChannel.type === "direct" && dmOtherUser) {
                  setRightPanel({ kind: "user", userId: dmOtherUser.id })
                } else {
                  setRightPanel(r => r ? null : { kind: "group", channelId: selectedChannel.id })
                }
              }}>
                {selectedChannel.type === "direct" && dmOtherUser ? (
                  <UserAvatar name={dmOtherUser.name} avatarUrl={dmOtherUser.avatarUrl} size={40}
                    presence={onlineUserIds.has(dmOtherUser.id) ? "online" : dmOtherUser.presence} showPresence />
                ) : (
                  <GroupAvatar name={selectedChannel.name} iconUrl={selectedChannel.iconUrl} size={40} />
                )}
              </button>
              {/* Name + subtitle */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[0.9375rem] truncate leading-tight">{channelDisplayName}</div>
                <div className="text-xs text-muted-foreground leading-tight">{channelSubtitle}</div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                {[
                  { icon: Phone, title: "Voice call", onClick: () => startChannelCall(false), loading: startingCall === "voice" },
                  { icon: Video, title: "Video call", onClick: () => startChannelCall(true), loading: startingCall === "video" },
                  { icon: Search, title: "Search", onClick: () => setShowSearch(true), loading: false },
                  {
                    icon: Info, title: "Info", loading: false,
                    onClick: () => {
                      if (selectedChannel.type === "direct" && dmOtherUser) setRightPanel({ kind: "user", userId: dmOtherUser.id })
                      else setRightPanel(r => r ? null : { kind: "group", channelId: selectedChannel.id })
                    }
                  },
                ].map(({ icon: Icon, title, onClick, loading }) => (
                  <button key={title} onClick={onClick} disabled={loading || (!!startingCall && title !== "Info" && title !== "Search")}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all disabled:opacity-40" title={title}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon style={{ width: 17, height: 17 }} />}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="text-[8rem] font-black leading-none select-none" style={{ color: BRAND_BLUE, opacity: 0.04 }}>
                    {channelDisplayName.charAt(0).toUpperCase()}
                  </div>
                  <p className="font-semibold text-lg -mt-6">Say hi to {channelDisplayName} 👋</p>
                  <p className="text-sm text-muted-foreground">Be the first to send a message.</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {groupedMessages.map(({ label, messages: dayMsgs }) => (
                    <div key={label}>
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 border-t border-border/40" />
                        <span className="text-xs font-semibold text-muted-foreground px-3 py-1 rounded-full bg-muted/50">{label}</span>
                        <div className="flex-1 border-t border-border/40" />
                      </div>
                      {dayMsgs.map((msg, idx) => {
                        const isOwn = msg.userId === userId
                        const prevMsg = idx > 0 ? dayMsgs[idx - 1] : null
                        const nextMsg = idx < dayMsgs.length - 1 ? dayMsgs[idx + 1] : null
                        const showHeader = !prevMsg || prevMsg.userId !== msg.userId
                        const isGrouped = !showHeader
                        const sender = userMap.get(msg.userId)
                        return (
                          <div key={msg.id}
                            onMouseEnter={() => setHoveredMsgId(msg.id)}
                            onMouseLeave={() => setHoveredMsgId(null)}
                            className={cn("flex gap-3 relative group", isOwn ? "flex-row-reverse" : "flex-row", isGrouped ? "mt-0.5" : "mt-3")}>

                            {/* Avatar (only for first in run, others) */}
                            {!isOwn && (
                              <div style={{ width: 36, flexShrink: 0 }}>
                                {showHeader && (
                                  <UserAvatar name={msg.displayName} avatarUrl={sender?.avatarUrl} size={36} />
                                )}
                              </div>
                            )}

                            <div className={cn("max-w-[72%] flex flex-col", isOwn ? "items-end" : "items-start")}>
                              {/* Header: name + time */}
                              {showHeader && !isOwn && (
                                <div className="flex items-center gap-2 px-1 mb-0.5">
                                  <span className="text-[0.8125rem] font-semibold" style={{ color: BRAND_BLUE }}>{msg.displayName}</span>
                                  <span className="text-[11px] text-muted-foreground">{formatTime(msg.createdAt)}</span>
                                  {msg.isPinned && <Pin className="h-3 w-3 text-muted-foreground" />}
                                </div>
                              )}

                              {/* Reply reference */}
                              {msg.replyToId && (
                                <div className="text-xs text-muted-foreground border-l-2 pl-2 mb-1 max-w-xs truncate"
                                  style={{ borderColor: BRAND_BLUE }}>
                                  {messages.find(m => m.id === msg.replyToId)?.content.slice(0, 60) ?? `Reply #${msg.replyToId}`}
                                </div>
                              )}

                              {/* Announcement badge */}
                              {msg.isAnnouncement && (
                                <div className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full mb-1"
                                  style={{ background: `${BRAND_BLUE}20`, color: BRAND_BLUE }}>
                                  📢 Announcement
                                </div>
                              )}

                              {/* Message bubble */}
                              <div className={cn("px-4 py-2.5 whitespace-pre-wrap text-sm leading-relaxed")}
                                style={isOwn ? {
                                  background: `linear-gradient(135deg, ${BRAND_BLUE}, #1d6fd8)`,
                                  color: "#fff", borderRadius: 18,
                                  borderBottomRightRadius: isGrouped ? 18 : 4,
                                  boxShadow: `0 2px 10px ${BRAND_BLUE}30`,
                                } : {
                                  background: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border)/0.8)",
                                  borderRadius: 18, borderBottomLeftRadius: isGrouped ? 18 : 4,
                                  color: "hsl(var(--foreground))",
                                }}>
                                {msg.content}
                                {isOwn && (
                                  <span className="ml-2 text-[10px] opacity-50 select-none">
                                    {formatTime(msg.createdAt)}{msg.editedAt ? " · edited" : ""}
                                  </span>
                                )}
                              </div>

                              {/* Attachments */}
                              {msg.attachments?.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {msg.attachments.map((a, i) => (
                                    a.contentType?.startsWith("audio") ? (
                                      <audio key={i} controls src={`/api/storage/objects/${a.objectPath}`}
                                        className="h-10 max-w-xs rounded-xl" />
                                    ) : a.contentType?.startsWith("image") ? (
                                      <img key={i} src={`/api/storage/objects/${a.objectPath}`} alt={a.name}
                                        className="max-w-xs max-h-48 rounded-2xl object-cover cursor-pointer"
                                        onClick={() => window.open(`/api/storage/objects/${a.objectPath}`, "_blank")} />
                                    ) : (
                                      <a key={i} href={`/api/storage/objects/${a.objectPath}`} target="_blank" rel="noreferrer"
                                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all hover:opacity-80"
                                        style={{ borderColor: `${BRAND_BLUE}44`, color: BRAND_BLUE }}>
                                        <Paperclip style={{ width: 11, height: 11 }} /> {a.name}
                                      </a>
                                    )
                                  ))}
                                </div>
                              )}

                              {/* Reactions */}
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(msg.reactions ?? {}).filter(([, ids]) => ids.length > 0).map(([emoji, ids]) => (
                                  <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                                    className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border transition-all hover:scale-110"
                                    style={ids.includes(userId ?? 0)
                                      ? { background: `${BRAND_BLUE}20`, borderColor: BRAND_BLUE, color: BRAND_BLUE }
                                      : { borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                                    {emoji} <span>{ids.length}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Hover action toolbar */}
                            {hoveredMsgId === msg.id && (
                              <div className={cn(
                                "absolute top-0 flex items-center gap-0.5 rounded-xl border bg-card shadow-lg px-1 py-0.5 z-10",
                                isOwn ? "right-full mr-2" : "left-full ml-2",
                              )}>
                                {EMOJIS.slice(0, 5).map(e => (
                                  <button key={e} onClick={() => toggleReaction(msg.id, e)}
                                    className="text-base hover:scale-125 transition-transform px-0.5">{e}</button>
                                ))}
                                <div className="w-px h-4 bg-border/60 mx-0.5" />
                                <button title="Reply" onClick={() => { setReplyTo(msg); textareaRef.current?.focus() }}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                                  <Reply style={{ width: 14, height: 14 }} />
                                </button>
                                <button title="Forward" onClick={() => setForwardMsg(msg)}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                                  <Forward style={{ width: 14, height: 14 }} />
                                </button>
                                <button title="Copy" onClick={() => copyMsg(msg)}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                                  <Copy style={{ width: 14, height: 14 }} />
                                </button>
                                {isOwn && (
                                  <button title="Edit" onClick={() => { setEditingMsg(msg); setInput(msg.content); textareaRef.current?.focus() }}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all">
                                    <Pencil style={{ width: 13, height: 13 }} />
                                  </button>
                                )}
                                {(isOwn) && (
                                  <button title="Delete" onClick={() => deleteMsg(msg)}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 transition-all">
                                    <Trash2 style={{ width: 13, height: 13 }} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {typingUsers.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 ml-12">
                      <div className="flex gap-1 px-3 py-2 rounded-2xl rounded-bl-md"
                        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.6)" }}>
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-2 h-2 rounded-full animate-bounce"
                            style={{ background: BRAND_BLUE, animationDelay: `${i * 0.15}s` }} />
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
              style={{ background: "hsl(var(--card)/0.6)", backdropFilter: "blur(8px)" }}>

              {/* Editing indicator */}
              {editingMsg && (
                <div className="flex items-center justify-between text-xs mb-2 px-3 py-1.5 rounded-xl"
                  style={{ background: `${BRAND_BLUE}10`, borderLeft: `3px solid ${BRAND_BLUE}` }}>
                  <span className="text-muted-foreground"><span className="font-semibold" style={{ color: BRAND_BLUE }}>Editing: </span>{editingMsg.content.slice(0, 60)}</span>
                  <button onClick={() => { setEditingMsg(null); setInput("") }}><X style={{ width: 14, height: 14 }} className="text-muted-foreground hover:text-foreground" /></button>
                </div>
              )}

              {/* Reply indicator */}
              {replyTo && !editingMsg && (
                <div className="flex items-center justify-between text-xs mb-2 px-3 py-1.5 rounded-xl"
                  style={{ background: `${BRAND_BLUE}10`, borderLeft: `3px solid ${BRAND_BLUE}` }}>
                  <span className="text-muted-foreground">
                    <span className="font-semibold" style={{ color: BRAND_BLUE }}>↩ {replyTo.displayName}: </span>
                    {replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? "…" : ""}
                  </span>
                  <button onClick={() => setReplyTo(null)}><X style={{ width: 14, height: 14 }} className="text-muted-foreground hover:text-foreground" /></button>
                </div>
              )}

              {/* Emoji quick-row */}
              {showEmoji && (
                <div className="flex gap-2 mb-2 px-1 flex-wrap">
                  {EMOJIS.map(emoji => (
                    <button key={emoji} onClick={() => setInput(v => v + emoji)}
                      className="text-xl hover:scale-125 transition-transform">{emoji}</button>
                  ))}
                </div>
              )}

              {/* Main composer */}
              <div className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-all focus-within:border-blue-400 focus-within:shadow-sm"
                style={{ borderColor: "hsl(var(--border)/0.8)", background: "hsl(var(--card))" }}>
                <button onClick={() => setShowEmoji(v => !v)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors" title="Emoji">
                  <Smile style={{ width: 18, height: 18 }} />
                </button>

                <div className="flex-1 relative">
                  <textarea ref={textareaRef} value={input} rows={1}
                    onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                    placeholder={replyTo ? "Reply…" : editingMsg ? "Edit message…" : `Message ${channelDisplayName}…`}
                    className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground max-h-[120px] py-1" />
                  {/* Mention suggestions */}
                  {showMentions && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 max-h-48 overflow-y-auto rounded-2xl border bg-card shadow-xl z-10 p-1.5 space-y-0.5">
                      {workspaceUsers
                        .filter(u => u.id !== userId && (!mentionQuery || u.name.toLowerCase().includes(mentionQuery)))
                        .slice(0, 6)
                        .map(u => (
                          <button key={u.id} onClick={() => insertMention(u.name)}
                            className="w-full text-left rounded-xl px-3 py-2 hover:bg-muted text-sm flex items-center gap-3 transition-colors">
                            <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={28} presence={u.presence} showPresence />
                            <div>
                              <div className="font-semibold text-[0.8125rem]">{u.name}</div>
                              <div className="text-[11px] text-muted-foreground">{u.designation ?? u.email}</div>
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Attach file */}
                <input ref={fileInputRef} type="file" multiple className="hidden"
                  onChange={e => { Array.from(e.target.files ?? []).forEach(uploadFile); e.target.value = "" }} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors" title="Attach file">
                  <Paperclip style={{ width: 16, height: 16 }} />
                </button>

                {/* Voice note */}
                <button onClick={isRecording ? stopRecording : startRecording}
                  className={cn("shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors", isRecording ? "text-red-500 animate-pulse" : "text-muted-foreground hover:text-foreground")}
                  title={isRecording ? `Stop (${recordingTime}s)` : "Record voice note"}>
                  {isRecording ? <MicOff style={{ width: 16, height: 16 }} /> : <Mic style={{ width: 16, height: 16 }} />}
                </button>

                {/* Send */}
                <button onClick={sendMessage} disabled={!input.trim() && !editingMsg}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-white transition-all disabled:opacity-40"
                  style={{ background: BRAND_BLUE }} title="Send (Enter)">
                  <Send style={{ width: 15, height: 15 }} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ══════════════ RIGHT PROFILE PANEL ══════════════ */}
      {rightPanel && (
        <div className="hidden md:flex flex-col w-80 shrink-0 border-l border-border/50 overflow-y-auto"
          style={{ background: "hsl(var(--card))" }}>
          {rightPanel.kind === "user" && (() => {
            const panelUser = userMap.get(rightPanel.userId)
            if (!panelUser) return null
            const isSelf = panelUser.id === userId
            return (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                  <span className="font-semibold text-sm">Profile</span>
                  <button onClick={() => setRightPanel(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60"><X style={{ width: 16, height: 16 }} /></button>
                </div>
                <div className="flex flex-col items-center gap-3 px-6 py-8 border-b border-border/40">
                  <div className="relative">
                    <UserAvatar name={panelUser.name} avatarUrl={panelUser.avatarUrl} size={80}
                      presence={onlineUserIds.has(panelUser.id) ? "online" : panelUser.presence} showPresence />
                    {/* Avatar upload is handled by the profile settings page */}
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg">{panelUser.name}</div>
                    {panelUser.designation && <div className="text-sm text-muted-foreground">{panelUser.designation}</div>}
                    <div className="flex items-center justify-center gap-1.5 mt-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: PRESENCE_COLORS[panelUser.presence] }} />
                      <span className="text-xs text-muted-foreground">{PRESENCE_LABELS[panelUser.presence]}</span>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-4 space-y-3">
                  {[
                    { label: "Email", value: panelUser.email },
                    { label: "Department", value: panelUser.department },
                    { label: "Status", value: panelUser.statusMessage },
                  ].filter(f => f.value).map(f => (
                    <div key={f.label}>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{f.label}</div>
                      <div className="text-sm">{f.value}</div>
                    </div>
                  ))}
                </div>
                {!isSelf && (
                  <div className="px-4">
                    <Button className="w-full rounded-xl gap-2" size="sm"
                      style={{ background: BRAND_BLUE, color: "#fff" }}
                      onClick={() => { startDm(panelUser.id); setRightPanel(null) }}>
                      <MessageSquare className="h-4 w-4" /> Send Message
                    </Button>
                  </div>
                )}
              </>
            )
          })()}
          {rightPanel.kind === "group" && selectedChannel && (() => (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                <span className="font-semibold text-sm">Group Info</span>
                <button onClick={() => setRightPanel(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60"><X style={{ width: 16, height: 16 }} /></button>
              </div>
              <div className="flex flex-col items-center gap-3 px-6 py-6 border-b border-border/40">
                <GroupAvatar name={selectedChannel.name} iconUrl={selectedChannel.iconUrl} size={72} />
                <div className="text-center">
                  <div className="font-bold text-lg">{selectedChannel.name}</div>
                  {selectedChannel.description && <div className="text-sm text-muted-foreground mt-1">{selectedChannel.description}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{channelMembers?.length ?? 0} members</div>
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Members</div>
                <div className="space-y-1">
                  {channelMembers?.map(m => {
                    const u = m.user
                    if (!u) return null
                    const wu = userMap.get(m.userId)
                    return (
                      <button key={m.userId}
                        onClick={() => setRightPanel({ kind: "user", userId: m.userId })}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-muted/50 transition-all text-left">
                        <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={36}
                          presence={onlineUserIds.has(m.userId) ? "online" : wu?.presence} showPresence />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{u.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{u.department ?? wu?.designation ?? ""}</div>
                        </div>
                        {m.isAdmin && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `${BRAND_BLUE}20`, color: BRAND_BLUE }}>Admin</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Leave group */}
              <div className="px-4 pb-4 mt-2">
                <button onClick={async () => {
                  if (!userId) return
                  await fetch(`/api/chat/channels/${selectedChannel.id}/members/${userId}`, { method: "DELETE", credentials: "include" })
                  setSelectedChannel(null); setRightPanel(null)
                  queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
                }} className="w-full flex items-center justify-center gap-2 text-sm text-destructive hover:bg-destructive/10 rounded-xl px-3 py-2 transition-all">
                  <LogOut className="h-4 w-4" /> Leave Group
                </button>
              </div>
            </>
          ))()}
        </div>
      )}

      {/* ══════════════ NEW DM DIALOG ══════════════ */}
      <Dialog open={showNewDm} onOpenChange={v => { setShowNewDm(v); if (!v) setDmSearch("") }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Message</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 border border-border/40 mb-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input autoFocus value={dmSearch} onChange={e => setDmSearch(e.target.value)}
              placeholder="Search people…" className="flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-80 overflow-y-auto space-y-0.5">
            {workspaceUsers
              .filter(u => u.id !== userId && (!dmSearch || u.name.toLowerCase().includes(dmSearch.toLowerCase()) || u.email.toLowerCase().includes(dmSearch.toLowerCase())))
              .map(u => (
                <button key={u.id} onClick={() => startDm(u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted transition-all text-left">
                  <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={40}
                    presence={onlineUserIds.has(u.id) ? "online" : u.presence} showPresence />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{u.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.designation ?? u.email}</div>
                  </div>
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: PRESENCE_COLORS[onlineUserIds.has(u.id) ? "online" : u.presence] }} />
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════ CREATE GROUP DIALOG ══════════════ */}
      <Dialog open={showCreateGroup} onOpenChange={v => { setShowCreateGroup(v); if (!v) { setNewGroupName(""); setNewGroupDesc(""); setNewGroupMembers([]); setNewGroupSearch("") } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Group Chat</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
              placeholder="Group name (required)" className="rounded-xl" />
            <Input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)}
              placeholder="Description (optional)" className="rounded-xl" />
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Add members</div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40 mb-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input value={newGroupSearch} onChange={e => setNewGroupSearch(e.target.value)}
                  placeholder="Search people…" className="flex-1 bg-transparent text-sm outline-none" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {workspaceUsers
                  .filter(u => u.id !== userId && (!newGroupSearch || u.name.toLowerCase().includes(newGroupSearch.toLowerCase())))
                  .map(u => (
                    <button key={u.id}
                      onClick={() => setNewGroupMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted transition-all text-left">
                      <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.designation ?? u.email}</div>
                      </div>
                      {newGroupMembers.includes(u.id) && (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: BRAND_BLUE }}>
                          <Check style={{ width: 12, height: 12, color: "#fff" }} />
                        </div>
                      )}
                    </button>
                  ))}
              </div>
              {newGroupMembers.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1.5">{newGroupMembers.length} member{newGroupMembers.length !== 1 ? "s" : ""} selected</div>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowCreateGroup(false)}>Cancel</Button>
            <Button className="flex-1 rounded-xl" disabled={!newGroupName.trim() || creatingGroup}
              style={{ background: BRAND_BLUE, color: "#fff" }} onClick={doCreateGroup}>
              {creatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Group"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════ SEARCH DIALOG ══════════════ */}
      <Dialog open={showSearch} onOpenChange={v => { setShowSearch(v); if (!v) { setSearchQuery(""); setSearchResults([]) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Search Messages</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              placeholder="Search in conversations…" className="flex-1 rounded-xl" autoFocus />
            <Button onClick={doSearch} disabled={searching || !searchQuery.trim()}
              style={{ background: BRAND_BLUE, color: "#fff" }} className="rounded-xl">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto space-y-2 mt-2">
            {searchResults.map(msg => {
              const ch = channels?.find(c => c.id === msg.channelId)
              return (
                <button key={msg.id}
                  onClick={() => {
                    const channel = channels?.find(c => c.id === msg.channelId)
                    if (channel) { setSelectedChannel(channel); setMobileView("conversation"); setShowSearch(false) }
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-muted transition-all">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: BRAND_BLUE }}>{msg.displayName}</span>
                    <span className="text-[10px] text-muted-foreground">{ch?.name ?? `#${msg.channelId}`} · {timeAgo(msg.createdAt)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">{msg.content}</div>
                </button>
              )
            })}
            {searchResults.length === 0 && searchQuery && !searching && (
              <div className="text-center text-sm text-muted-foreground py-8">No messages found for "{searchQuery}"</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════ FORWARD MESSAGE DIALOG ══════════════ */}
      <Dialog open={!!forwardMsg} onOpenChange={v => { if (!v) { setForwardMsg(null); setForwardTarget(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Forward Message</DialogTitle></DialogHeader>
          {forwardMsg && (
            <div className="text-sm text-muted-foreground px-3 py-2 rounded-xl bg-muted/50 mb-2 truncate">
              {forwardMsg.content}
            </div>
          )}
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Send to…</div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {channels?.map(ch => (
              <button key={ch.id}
                onClick={() => setForwardTarget(ch.id)}
                className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left", forwardTarget === ch.id ? "shadow-sm" : "hover:bg-muted")}
                style={forwardTarget === ch.id ? { background: `${BRAND_BLUE}15`, border: `1.5px solid ${BRAND_BLUE}` } : {}}>
                {ch.type === "direct"
                  ? <UserAvatar name={getChannelDisplayName(ch)} size={32} />
                  : <GroupAvatar name={ch.name} iconUrl={ch.iconUrl} size={32} />}
                <span className="text-sm font-medium truncate">{getChannelDisplayName(ch)}</span>
                {forwardTarget === ch.id && <Check className="h-4 w-4 ml-auto shrink-0" style={{ color: BRAND_BLUE }} />}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setForwardMsg(null); setForwardTarget(null) }}>Cancel</Button>
            <Button className="flex-1 rounded-xl" disabled={!forwardTarget}
              style={{ background: BRAND_BLUE, color: "#fff" }} onClick={doForward}>Forward</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════ STATUS DIALOG ══════════════ */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Set Status</DialogTitle></DialogHeader>
          <div className="space-y-1">
            {(Object.entries(PRESENCE_LABELS) as [PresenceType, string][]).map(([key, label]) => (
              <button key={key} onClick={() => updateStatus(key)}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left", ownPresence === key ? "shadow-sm" : "hover:bg-muted")}
                style={ownPresence === key ? { background: `${BRAND_BLUE}15`, border: `1.5px solid ${BRAND_BLUE}` } : {}}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PRESENCE_COLORS[key] }} />
                <span className="text-sm font-medium">{label}</span>
                {ownPresence === key && <Check className="h-4 w-4 ml-auto" style={{ color: BRAND_BLUE }} />}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <Input value={ownStatusMsg} onChange={e => setOwnStatusMsg(e.target.value)}
              placeholder="Status message (optional)" className="rounded-xl text-sm" />
          </div>
          <Button className="w-full rounded-xl mt-1" style={{ background: BRAND_BLUE, color: "#fff" }}
            onClick={() => updateStatus(ownPresence, ownStatusMsg)}>Save</Button>
        </DialogContent>
      </Dialog>

    </div>
  )
}
