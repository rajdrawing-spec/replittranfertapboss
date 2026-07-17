import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { EmptyState } from "@/components/empty-state"
import { MeetingSkeleton } from "@/components/skeletons"
import { Video, Calendar, Clock, Users, Copy, Plus, Phone, MonitorPlay, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react"

const LiveKitRoomComponent = React.lazy(() => import("@/components/meetings/livekit-room"))
import type { MeetingMiniPlayer as MeetingMiniPlayerType } from "@/components/meetings/livekit-room"
const MeetingMiniPlayer = React.lazy(() =>
  import("@/components/meetings/livekit-room").then((m) => ({ default: m.MeetingMiniPlayer }))
)

interface Meeting {
  id: number
  title: string
  agenda?: string
  meetingId: string
  provider: string
  roomUrl: string
  scheduledAt: string | null
  duration: number
  organizerId: number
  status: string
  participants: Array<{ userId: number; status: string }>
  myStatus?: string
}

interface MeetingSettings {
  defaultProvider: string
  defaultDuration: number
  waitingRoomEnabled: boolean
  passwordRequired: boolean
  maxParticipants: number
  screenShareEnabled: boolean
  recordingEnabled: boolean
  lobbyEnabled: boolean
  livekitConfigured: boolean
}

interface User {
  id: number
  name: string
  email: string
}

interface ActiveCall {
  meeting: Meeting
  token: string
  serverUrl: string
}

export default function MeetingsPage() {
  const { activeCompany } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const companyId = activeCompany?.id

  const [activeCall, setActiveCall] = React.useState<ActiveCall | null>(null)
  const [miniPlayer, setMiniPlayer] = React.useState(false)
  const [joiningId, setJoiningId] = React.useState<number | null>(null)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [selectedTab, setSelectedTab] = React.useState("upcoming")
  const [title, setTitle] = React.useState("")
  const [agenda, setAgenda] = React.useState("")
  const [scheduledAt, setScheduledAt] = React.useState("")
  const [duration, setDuration] = React.useState(30)
  const [selectedUsers, setSelectedUsers] = React.useState<number[]>([])

  const { data: settings } = useQuery<MeetingSettings>({
    queryKey: ["/api/meetings/settings", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/meetings/settings?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/chat/users", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/users?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && scheduleOpen,
  })

  const { data: meetings, isLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings", selectedTab, companyId],
    queryFn: async () => {
      const endpoint = selectedTab === "my" ? "my" : selectedTab === "upcoming" ? "upcoming" : ""
      const res = await fetch(`/api/meetings${endpoint ? `/${endpoint}` : ""}?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const fetchToken = async (roomName: string): Promise<{ token: string; serverUrl: string }> => {
    const res = await fetch(`/api/meetings/token?roomName=${encodeURIComponent(roomName)}&companyId=${companyId}`, {
      credentials: "include",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to get call token" }))
      throw new Error(err.error || "Failed to get call token")
    }
    return res.json()
  }

  const joinCall = async (meeting: Meeting) => {
    setJoiningId(meeting.id)
    try {
      const { token, serverUrl } = await fetchToken(meeting.meetingId)
      await fetch(`/api/meetings/join/${meeting.meetingId}`, { method: "POST", credentials: "include" })
      setActiveCall({ meeting, token, serverUrl })
      setMiniPlayer(false)
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    } catch (e) {
      toast({ title: "Failed to join", description: String(e), variant: "destructive" })
    } finally {
      setJoiningId(null)
    }
  }

  const handleLeave = async () => {
    if (activeCall) {
      await fetch(`/api/meetings/leave/${activeCall.meeting.meetingId}`, { method: "POST", credentials: "include" })
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    }
    setActiveCall(null)
    setMiniPlayer(false)
  }

  const createMeetingMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch(`/api/meetings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      setScheduleOpen(false)
      toast({ title: "Meeting scheduled" })
      resetForm()
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const startInstantMeeting = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/meetings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          title: "Instant Meeting",
          duration: settings?.defaultDuration ?? 30,
          provider: "livekit",
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: async (meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      await joinCall(meeting)
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const cancelMeeting = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/meetings/${id}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      toast({ title: "Meeting cancelled" })
    },
  })

  const resetForm = () => {
    setTitle("")
    setAgenda("")
    setScheduledAt("")
    setDuration(settings?.defaultDuration ?? 30)
    setSelectedUsers([])
  }

  const copyLink = (meetingId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?join=${meetingId}`
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link copied" }))
  }

  const toggleUser = (id: number) => {
    setSelectedUsers((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]))
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <EmptyState icon={Video} message="No company selected" hint="Select a company to manage meetings." />
      </div>
    )
  }

  if (isLoading) return <MeetingSkeleton />

  // Full-screen call view
  if (activeCall && !miniPlayer) {
    return (
      <React.Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
        <LiveKitRoomComponent
          roomName={activeCall.meeting.meetingId}
          serverUrl={activeCall.serverUrl}
          token={activeCall.token}
          displayName={user?.name || "Guest"}
          onClose={handleLeave}
          onMinimize={() => setMiniPlayer(true)}
        />
      </React.Suspense>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Mini-player overlay when navigated away from call */}
      {activeCall && miniPlayer && (
        <React.Suspense fallback={null}>
          <MeetingMiniPlayer
            roomName={activeCall.meeting.meetingId}
            serverUrl={activeCall.serverUrl}
            token={activeCall.token}
            onExpand={() => setMiniPlayer(false)}
            onLeave={handleLeave}
          />
        </React.Suspense>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6" /> Meetings</h1>
        <div className="flex gap-2">
          {settings?.livekitConfigured === false && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />
              LiveKit not configured
            </Badge>
          )}
          <Button
            onClick={() => startInstantMeeting.mutate()}
            disabled={startInstantMeeting.isPending || !settings?.livekitConfigured}
          >
            {startInstantMeeting.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}
            Start Instant
          </Button>
          <Button onClick={() => setScheduleOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Schedule
          </Button>
        </div>
      </div>

      {/* LiveKit not configured banner */}
      {settings && !settings.livekitConfigured && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">LiveKit server not connected</p>
                <p className="text-xs text-muted-foreground">
                  Set <code className="bg-muted px-1 rounded">LIVEKIT_URL</code>, <code className="bg-muted px-1 rounded">LIVEKIT_API_KEY</code>, and <code className="bg-muted px-1 rounded">LIVEKIT_API_SECRET</code> in your Replit secrets to enable video calling.
                  See <code className="bg-muted px-1 rounded">LIVEKIT_MIGRATION.md</code> for setup instructions.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="my">My Meetings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value={selectedTab}>
          <div className="grid gap-4">
            {meetings?.length === 0 && (
              <EmptyState icon={Calendar} message="No meetings" hint="Schedule or start an instant meeting." />
            )}
            {meetings?.map((m) => (
              <Card key={m.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{m.title}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">LiveKit</Badge>
                      <Badge variant={m.status === "ongoing" ? "default" : "secondary"}>{m.status}</Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {m.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" /> {new Date(m.scheduledAt).toLocaleString()}
                      </span>
                    )}
                    <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {m.duration} min</span>
                    <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {m.participants.length}</span>
                  </div>
                  {m.agenda && <p className="text-sm text-muted-foreground">{m.agenda}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => joinCall(m)}
                      disabled={joiningId === m.id || !settings?.livekitConfigured}
                    >
                      {joiningId === m.id
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Joining...</>
                        : <><MonitorPlay className="mr-2 h-4 w-4" /> Join</>
                      }
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => copyLink(m.meetingId)}>
                      <Copy className="mr-2 h-4 w-4" /> Copy Link
                    </Button>
                    {m.status !== "cancelled" && m.status !== "ended" && (
                      <Button size="sm" variant="destructive" onClick={() => cancelMeeting.mutate(m.id)}>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Schedule Meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            <Input
              type="number"
              placeholder="Duration (min)"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
            />
            {users && users.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto space-y-1 border rounded-md p-2">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 px-1 py-0.5 rounded">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      className="rounded"
                    />
                    <span>{u.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMeetingMutation.mutate({ title, agenda, scheduledAt, duration, participantIds: selectedUsers })}
              disabled={!title || createMeetingMutation.isPending}
            >
              {createMeetingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
