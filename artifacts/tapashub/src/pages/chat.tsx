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
import { MessageSquare, Pin, Search, Send, Paperclip, Megaphone, User, Video, BarChart, Briefcase, Smile, X } from "lucide-react"
import { ChatSkeleton } from "@/components/skeletons"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

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

interface ChatPoll {
  id: number
  channelId: number
  userId: number
  question: string
  options: string[]
  votes: Record<string, number>
  closed: boolean
  createdAt: string
}

interface UserStatus {
  userId: number
  presence: "online" | "away" | "offline"
  statusMessage?: string
  doNotDisturb: boolean
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
  const [pollsOpen, setPollsOpen] = React.useState(false)
  const [pollQuestion, setPollQuestion] = React.useState("")
  const [pollOptions, setPollOptions] = React.useState(["", ""])
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [statusPresence, setStatusPresence] = React.useState<"online" | "away" | "offline">("online")
  const [statusMessage, setStatusMessage] = React.useState("")
  const [dnd, setDnd] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  const [draggedFiles, setDraggedFiles] = React.useState<File[]>([])
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const { data: channels, isLoading: isLoadingChannels } = useQuery<ChatChannel[]>({
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

  const { data: polls, refetch: refetchPolls } = useQuery<ChatPoll[]>({
    queryKey: ["/api/chat/channels", selectedChannel?.id, "polls"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/chat/channels/${selectedChannel?.id}/polls`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!selectedChannel,
  })

  const { data: userStatuses } = useQuery<UserStatus[]>({
    queryKey: ["/api/users/status", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/users/status?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const statusMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/users/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presence: statusPresence, statusMessage, doNotDisturb: dnd }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/status", companyId] })
      setStatusOpen(false)
    },
  })

  const createPollMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/chat/channels/${selectedChannel?.id}/polls`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: pollQuestion, options: pollOptions.filter(o => o.trim()), isMultiple: false }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      setPollQuestion("")
      setPollOptions(["", ""])
      setPollsOpen(false)
      refetchPolls()
    },
  })

  const voteMutation = useMutation({
    mutationFn: async ({ pollId, optionIndex }: { pollId: number; optionIndex: number }) => {
      const res = await fetch(`${basePath}/api/chat/polls/${pollId}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionIndex }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => refetchPolls(),
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

  if (isLoadingChannels) {
    return <ChatSkeleton />
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
              {selectedChannel?.type === "project" && <Briefcase className="h-4 w-4" />}
              {selectedChannel?.name || "Select a channel"}
              {selectedChannel && userId && userStatuses?.find(s => s.userId === userId)?.doNotDisturb && (
                <Badge variant="outline" className="ml-2 text-xs">DND</Badge>
              )}
            </span>
            {selectedChannel && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPollsOpen(true)}>
                  <BarChart className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStatusOpen(true)}>
                  <Smile className="h-4 w-4" />
                </Button>
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
                {msg.replyToId && (
                  <div className="text-xs text-muted-foreground border-l-2 pl-2 mb-1">
                    Replied to message #{msg.replyToId}
                  </div>
                )}
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
            <div
              className="flex items-center gap-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault()
                const files = Array.from(e.dataTransfer.files)
                if (files.length > 0) {
                  setDraggedFiles(files)
                  toast({ title: "Files dropped", description: `${files.length} file(s) ready for upload` })
                }
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={replyTo ? "Reply..." : "Type a message..."}
                className="flex-1"
              />
              <input
                type="file"
                multiple
                className="hidden"
                id="chat-file-input"
                onChange={(e) => setDraggedFiles(Array.from(e.target.files || []))}
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
            {draggedFiles.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">{draggedFiles.length} file(s) selected (upload via storage)</div>
            )}
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

      <Dialog open={pollsOpen} onOpenChange={setPollsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>Polls</DialogTitle></DialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-3">
            {polls?.map(poll => (
              <div key={poll.id} className="border rounded-md p-3 space-y-2">
                <div className="font-medium text-sm">{poll.question}</div>
                {poll.options.map((opt, idx) => {
                  const votes = Object.values(poll.votes || {}).filter(v => v === idx).length
                  const hasVoted = poll.votes ? Object.keys(poll.votes).includes(String(userId)) : false
                  return (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span>{opt}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{votes} votes</span>
                        {!poll.closed && !hasVoted && (
                          <Button size="sm" variant="outline" onClick={() => voteMutation.mutate({ pollId: poll.id, optionIndex: idx })}>Vote</Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="space-y-2 pt-2 border-t">
              <Input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Poll question" />
              {pollOptions.map((opt, i) => (
                <Input key={i} value={opt} onChange={e => {
                  const arr = [...pollOptions]
                  arr[i] = e.target.value
                  setPollOptions(arr)
                }} placeholder={`Option ${i + 1}`} />
              ))}
              <Button variant="outline" size="sm" onClick={() => setPollOptions([...pollOptions, ""])}>Add option</Button>
              <Button size="sm" onClick={() => createPollMutation.mutate()} disabled={!pollQuestion || pollOptions.filter(o => o.trim()).length < 2}>Create Poll</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>My Status</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Presence</Label>
              <div className="flex gap-2">
                {(["online", "away", "offline"] as const).map(p => (
                  <Button key={p} variant={statusPresence === p ? "default" : "outline"} size="sm" onClick={() => setStatusPresence(p)}>{p}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status message</Label>
              <Input value={statusMessage} onChange={e => setStatusMessage(e.target.value)} placeholder="In a meeting..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={dnd} onCheckedChange={setDnd} />
              <Label>Do not disturb</Label>
            </div>
            <Button onClick={() => statusMutation.mutate()} disabled={statusMutation.isPending}>Save Status</Button>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1 pt-2 border-t">
            {userStatuses?.map(s => (
              <div key={s.userId} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.presence === "online" ? "bg-green-500" : s.presence === "away" ? "bg-yellow-500" : "bg-gray-400"}`} />
                  <span>{s.statusMessage || s.presence}</span>
                </div>
                {s.doNotDisturb && <Badge variant="outline">DND</Badge>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
