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
import { Video, Calendar, Clock, Users, Copy, Plus, Phone, MonitorPlay, History } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const JitsiMeet = React.lazy(() => import("@/components/meetings/jitsi-meet"))

interface Meeting {
  id: number
  title: string
  agenda?: string
  meetingId: string
  provider: string
  roomUrl: string
  password?: string
  scheduledAt: string | null
  duration: number
  organizerId: number
  status: string
  participants: Array<{ userId: number; status: string }>
  myStatus?: string
}

interface MeetingSettings {
  defaultProvider: string
  jitsiServerUrl: string
  defaultDuration: number
  waitingRoomEnabled: boolean
  passwordRequired: boolean
  maxParticipants: number
  screenShareEnabled: boolean
  recordingEnabled: boolean
  lobbyEnabled: boolean
}

interface User {
  id: number
  name: string
  email: string
}

export default function MeetingsPage() {
  const { activeCompany } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const companyId = activeCompany?.id
  const userId = user?.id

  const [activeMeeting, setActiveMeeting] = React.useState<Meeting | null>(null)
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
      const res = await fetch(`${basePath}/api/meetings/settings?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/chat/users", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/chat/users?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && scheduleOpen,
  })

  const { data: meetings } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings", selectedTab, companyId],
    queryFn: async () => {
      const endpoint = selectedTab === "my" ? "my" : selectedTab === "upcoming" ? "upcoming" : ""
      const res = await fetch(`${basePath}/api/meetings${endpoint ? `/${endpoint}` : ""}?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const createMeeting = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch(`${basePath}/api/meetings`, {
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
      const res = await fetch(`${basePath}/api/meetings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          title: "Instant Meeting",
          duration: settings?.defaultDuration ?? 30,
          provider: settings?.defaultProvider ?? "jitsi",
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      setActiveMeeting(meeting)
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  const cancelMeeting = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${basePath}/api/meetings/${id}/cancel`, {
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

  const copyLink = (url: string) => {
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

  if (activeMeeting) {
    return (
      <React.Suspense fallback={<div className="p-6">Loading meeting room...</div>}>
        <JitsiMeet
          roomName={activeMeeting.meetingId}
          serverUrl={settings?.jitsiServerUrl}
          password={activeMeeting.password}
          displayName={user?.name || "Guest"}
          onClose={() => setActiveMeeting(null)}
        />
      </React.Suspense>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6" /> Meetings</h1>
        <div className="flex gap-2">
          <Button onClick={() => startInstantMeeting.mutate()} disabled={startInstantMeeting.isPending}>
            <Phone className="mr-2 h-4 w-4" /> Start Instant
          </Button>
          <Button onClick={() => setScheduleOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Schedule
          </Button>
        </div>
      </div>

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
                    <Badge variant={m.status === "ongoing" ? "default" : "secondary"}>{m.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {m.scheduledAt && <span className="flex items-center gap-1"><Calendar className="h-4 w-4" /> {new Date(m.scheduledAt).toLocaleString()}</span>}
                    <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {m.duration} min</span>
                    <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {m.participants.length}</span>
                  </div>
                  {m.agenda && <p className="text-sm text-muted-foreground">{m.agenda}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setActiveMeeting(m)}><MonitorPlay className="mr-2 h-4 w-4" /> Join</Button>
                    <Button size="sm" variant="outline" onClick={() => copyLink(m.roomUrl)}><Copy className="mr-2 h-4 w-4" /> Copy Link</Button>
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

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Schedule Meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            <Input type="number" placeholder="Duration (min)" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 30)} />
            <div className="max-h-[200px] overflow-y-auto space-y-1 border rounded-md p-2">
              {users?.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUser(u.id)} />
                  <span>{u.name}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMeeting.mutate({ title, agenda, scheduledAt, duration, participantIds: selectedUsers })}
              disabled={!title}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
