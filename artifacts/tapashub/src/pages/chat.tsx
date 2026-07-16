import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { MessageSquare, Pin, Search, Send, Paperclip, Megaphone, User, Video } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface ChatChannel {
  id: number
  type: "team" | "department" | "direct"
  name: string
  department?: string
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

const EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔", "👀"]

export default function ChatPage() {
  const { activeCompany } = useCompany()
  const { user, hasPermission } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const companyId = activeCompany?.id
  const userId = user?.id
  const canManage = hasPermission("chat.manage")

  const [socket, setSocket] = React.useState<Socket | null>(null)
  const [selectedChannel, setSelectedChannel] = React.useState<ChatChannel | null>(null)
  const [input, setInput] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = React.useState<number[]>([])
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<ChatMessage[]>([])
  const [usersOpen, setUsersOpen] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const { data: channels } = useQuery<ChatChannel[]>({
    queryKey: ["/api/chat/channels", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/chat/channels?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: channelUsers } = useQuery<ChatUser[]>({
    queryKey: ["/api/chat/users", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/chat/users?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && usersOpen,
  })

  React.useEffect(() => {
    if (!companyId || !userId) return
    let s: Socket | null = null
    fetch(`${basePath}/api/chat/token`, { credentials: "include" })
      .then((r) => r.json())
      .then(({ token }) => {
        s = io({
          path: "/socket.io",
          auth: { token },
          transports: ["websocket"],
          reconnection: true,
          reconnectionDelay: 1000,
        })
        s.on("connect", () => {
          s!.emit("join", { companyId }, (res: any) => {
            if (!res.ok) toast({ title: "Chat join failed", description: res.error, variant: "destructive" })
          })
        })
        s.on("message:new", (msg: ChatMessage) => {
          setMessages((prev) => [...prev, msg])
          queryClient.invalidateQueries({ queryKey: ["/api/chat/channels", companyId] })
        })
        s.on("message:reaction", (msg: ChatMessage) => {
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)))
        })
        s.on("typing", ({ channelId, userId: uid, typing }: any) => {
          setTypingUsers((prev) => {
            if (selectedChannel?.id !== channelId) return prev
            if (typing) return prev.includes(uid) ? prev : [...prev, uid]
            return prev.filter((id) => id !== uid)
          })
        })
        s.on("channel:update", () => {
          queryClient.invalidateQueries({ queryKey: ["/api/chat/channels", companyId] })
        })
        setSocket(s)
      })
      .catch((err) => toast({ title: "Chat failed", description: String(err), variant: "destructive" }))

    return () => {
      s?.disconnect()
    }
  }, [companyId, userId, selectedChannel?.id, queryClient, toast])

  React.useEffect(() => {
    if (!selectedChannel || !socket) return
    socket.emit("join:channel", { channelId: selectedChannel.id }, (res: any) => {
      if (!res.ok) toast({ title: "Join channel failed", description: res.error, variant: "destructive" })
    })
    fetch(`${basePath}/api/chat/channels/${selectedChannel.id}/messages?companyId=${companyId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setMessages(data))
      .catch((err) => toast({ title: "Failed to load messages", description: String(err), variant: "destructive" }))
    setTypingUsers([])
  }, [selectedChannel, socket, companyId, toast])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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
    socket.emit("message:send", { channelId: selectedChannel.id, content: input, mentions: mentionIds }, (res: any) => {
      if (!res.ok) toast({ title: "Send failed", description: res.error, variant: "destructive" })
    })
    setInput("")
  }

  const toggleReaction = (messageId: number, emoji: string) => {
    if (!socket) return
    const msg = messages.find((m) => m.id === messageId)
    const hasReacted = msg?.reactions?.[emoji]?.includes(userId ?? 0)
    socket.emit(hasReacted ? "reaction:remove" : "reaction:add", { messageId, emoji })
  }

  const handleSearch = async () => {
    if (!searchQuery || !companyId) return
    const res = await fetch(`${basePath}/api/chat/search?companyId=${companyId}&q=${encodeURIComponent(searchQuery)}`, { credentials: "include" })
    if (res.ok) setSearchResults(await res.json())
  }

  const startDirect = async (otherUserId: number) => {
    const res = await fetch(`${basePath}/api/chat/direct`, {
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

  const startChannelMeeting = async () => {
    if (!selectedChannel) return
    const res = await fetch(`${basePath}/api/meetings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        channelId: selectedChannel.id,
        title: `${selectedChannel.name} Meeting`,
      }),
    })
    if (!res.ok) {
      toast({ title: "Failed to start meeting", description: await res.text(), variant: "destructive" })
      return
    }
    const meeting = await res.json()
    window.open(meeting.roomUrl, "_blank", "noopener,noreferrer")
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <EmptyState icon={MessageSquare} message="No company selected" hint="Select a company to start chatting." />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-4 p-4 md:p-6">
      <Card className="w-full md:w-64 shrink-0 flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Channels
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
          <Button variant="outline" size="sm" className="w-full" onClick={() => setSearchOpen(true)}>
            <Search className="mr-2 h-4 w-4" /> Search
          </Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setUsersOpen(true)}>
            <User className="mr-2 h-4 w-4" /> Direct Message
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
              {selectedChannel?.name || "Select a channel"}
            </span>
            {selectedChannel && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => startChannelMeeting()}>
                  <Video className="h-4 w-4" />
                </Button>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)}>
                    <Search className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto space-y-3 p-4">
          {!selectedChannel ? (
            <EmptyState icon={MessageSquare} message="Select a channel" hint="Choose a channel to start chatting." />
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
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                {msg.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.attachments.map((a, i) => (
                      <a key={i} href={`${basePath}/api/storage/objects/${a.objectPath}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                        {a.name}
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1">
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
            <div className="flex items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Type a message..."
                className="flex-1"
              />
              <Button variant="ghost" size="icon" onClick={() => toast({ title: "Attachments use /storage uploads" })}>
                <Paperclip className="h-4 w-4" />
              </Button>
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
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..." />
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

      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Start Direct Message</DialogTitle>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {channelUsers?.map((u) => (
              <button
                key={u.id}
                onClick={() => startDirect(u.id)}
                className="w-full text-left rounded-md border p-2 hover:bg-muted text-sm"
              >
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
