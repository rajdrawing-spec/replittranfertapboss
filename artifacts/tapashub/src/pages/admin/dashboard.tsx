import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "wouter"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Activity, Users, MessageSquare, Video, CheckSquare, Bot, AlertCircle, Server, Phone, MessageCircle, ArrowRight } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

interface AdminMetrics {
  activeUsers: number
  activeChats: number
  activeMeetings: number
  tasksToday: number
  schedulerStatus: string
  aiProviderStatus: string
  recentErrors: number
  recentJobs: number
}

function MetricCard({ label, value, icon: Icon, status }: { label: string; value?: number | string; icon: any; status?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="text-2xl font-bold">{value ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {status && <Badge variant="outline" className="text-[10px] mt-1">{status}</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation()
  const { activeCompany, companies, isParentView, setActiveCompanyId } = useCompany()
  const { toast } = useToast()
  const [selectedCompanyId, setSelectedCompanyId] = React.useState<string>(activeCompany?.id?.toString() ?? "")
  const companyId = selectedCompanyId ? Number(selectedCompanyId) : activeCompany?.id

  React.useEffect(() => {
    if (activeCompany?.id && !selectedCompanyId) {
      setSelectedCompanyId(activeCompany.id.toString())
    }
  }, [activeCompany?.id])

  const selectedCompany = companies.find((c) => c.id === companyId)

  const startInstantMeeting = async () => {
    if (!companyId) {
      toast({ title: "Select a company", description: "Choose a workspace from the dropdown above, or switch to a subsidiary first.", variant: "destructive" })
      return
    }
    const res = await fetch("/api/meetings", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, title: `${selectedCompany?.name ?? "Admin"} Instant Meeting`, duration: 30 }),
    })
    if (!res.ok) {
      toast({ title: "Failed to start meeting", description: await res.text(), variant: "destructive" })
      return
    }
    const meeting = await res.json()
    window.open(meeting.roomUrl + (meeting.jwt ? `?jwt=${encodeURIComponent(meeting.jwt)}` : ""), "_blank", "noopener,noreferrer")
  }

  const openChat = () => {
    if (selectedCompanyId) {
      setActiveCompanyId(Number(selectedCompanyId))
    }
    setLocation("/chat")
  }

  const { data: metrics, isLoading } = useQuery<AdminMetrics>({
    queryKey: ["/api/admin/metrics", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/metrics${companyId ? `?companyId=${companyId}` : ""}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> Admin Dashboard</h1>
        <p className="text-muted-foreground">Real-time platform health and activity overview.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Active Users" value={metrics?.activeUsers} icon={Users} />
          <MetricCard label="Active Chats" value={metrics?.activeChats} icon={MessageSquare} />
          <MetricCard label="Active Meetings" value={metrics?.activeMeetings} icon={Video} />
          <MetricCard label="Tasks Today" value={metrics?.tasksToday} icon={CheckSquare} />
          <MetricCard label="Scheduler" value={metrics?.schedulerStatus} icon={Server} status={metrics?.schedulerStatus} />
          <MetricCard label="AI Provider" value={metrics?.aiProviderStatus} icon={Bot} status={metrics?.aiProviderStatus} />
          <MetricCard label="Recent Errors" value={metrics?.recentErrors} icon={AlertCircle} />
          <MetricCard label="Recent Jobs" value={metrics?.recentJobs} icon={CheckSquare} />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Quick Actions</h2>
          {isParentView && companies.length > 0 && (
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Choose a workspace/company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.name} {c.mode === "parent" ? "(Parent)" : "(Subsidiary)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2 rounded-lg bg-primary/10 w-fit"><MessageCircle className="h-5 w-5 text-primary" /></div>
              <div className="font-medium">Open Chat</div>
              <p className="text-xs text-muted-foreground">{selectedCompany ? `Open ${selectedCompany.name} chat.` : "Choose a workspace above, or switch to a subsidiary first."}</p>
              <Button size="sm" onClick={openChat} className="w-full">Open Chat <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="p-2 rounded-lg bg-primary/10 w-fit"><Phone className="h-5 w-5 text-primary" /></div>
              <div className="font-medium">Instant Meeting</div>
              <p className="text-xs text-muted-foreground">Start a Jitsi video call for the selected company.</p>
              <Button size="sm" onClick={startInstantMeeting} className="w-full">Start Instant <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
