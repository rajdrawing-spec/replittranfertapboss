import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/empty-state"
import { CalendarDays, Loader2, Sparkles } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface PlannerEvent {
  id: number
  companyId: number
  userId: number
  type: string
  title: string
  startDate: string
  endDate?: string
  allDay: boolean
  metadata?: Record<string, any>
}

export default function PlannerPage() {
  const { activeCompany } = useCompany()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const companyId = activeCompany?.id
  const userId = user?.id
  const [view, setView] = React.useState("week")
  const [showEventDialog, setShowEventDialog] = React.useState(false)
  const [eventTitle, setEventTitle] = React.useState("")
  const [eventDate, setEventDate] = React.useState("")
  const [eventType, setEventType] = React.useState("custom")
  const [suggesting, setSuggesting] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<any>(null)

  const [year, month] = [new Date().getFullYear(), new Date().getMonth() + 1]
  const startOfMonth = `${year}-${String(month).padStart(2, "0")}-01`
  const endOfMonth = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`

  const { data: events, isLoading } = useQuery<PlannerEvent[]>({
    queryKey: ["/api/planner/events", companyId, userId, startOfMonth, endOfMonth],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/planner/events?companyId=${companyId}&userId=${userId}&start=${startOfMonth}&end=${endOfMonth}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && !!userId,
  })

  const createEventMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/planner/events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type: eventType, title: eventTitle, startDate: eventDate, allDay: true, metadata: {} }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/planner/events", companyId, userId] })
      setShowEventDialog(false)
      setEventTitle("")
      setEventDate("")
    },
  })

  const suggestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/planner/suggest`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, period: view === "month" ? "monthly" : "weekly" }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: (data) => {
      setSuggestions(data)
      setSuggesting(false)
    },
  })

  if (!companyId) {
    return (
      <div className="p-6">
        <EmptyState icon={CalendarDays} message="No company selected" hint="Select a company to view the planner." />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const grouped = (events || []).reduce((acc, e) => {
    acc[e.startDate] = acc[e.startDate] || []
    acc[e.startDate].push(e)
    return acc
  }, {} as Record<string, PlannerEvent[]>)

  const days = Object.keys(grouped).sort()

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="h-6 w-6" /> Work Planner</h1>
          <p className="text-sm text-muted-foreground">Daily, weekly, and monthly task + meeting view.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={view} onValueChange={setView}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setSuggesting(true)} disabled={suggestMutation.isPending}>
            {suggestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2">AI Suggest</span>
          </Button>
          <Button onClick={() => setShowEventDialog(true)}>Add Event</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {Array.from({ length: new Date(year, month, 0).getDate() }).map((_, i) => {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
          const dayEvents = grouped[date] || []
          return (
            <Card key={date} className="min-h-[120px]">
              <CardHeader className="pb-1"><CardTitle className="text-sm">{i + 1}</CardTitle></CardHeader>
              <CardContent className="space-y-1 p-2">
                {dayEvents.map(e => (
                  <div key={e.id} className={`text-xs rounded px-2 py-1 ${e.type === "task" ? "bg-primary/10" : e.type === "meeting" ? "bg-blue-100" : "bg-muted"}`}>
                    {e.title}
                  </div>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {suggestions && (
        <Card>
          <CardHeader><CardTitle>AI Suggestions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="font-medium text-sm">Goals</div>
              <ul className="list-disc list-inside text-sm text-muted-foreground">
                {(suggestions.goals || []).map((g: string, i: number) => <li key={i}>{g}</li>)}
              </ul>
            </div>
            <div>
              <div className="font-medium text-sm">Proposed Events</div>
              <div className="space-y-1">
                {(suggestions.events || []).map((ev: any, i: number) => (
                  <div key={i} className="text-sm text-muted-foreground">{ev.date}: {ev.title}</div>
                ))}
              </div>
            </div>
            <Button variant="outline" onClick={() => setSuggestions(null)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Add Planner Event</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Title</Label><Input value={eventTitle} onChange={e => setEventTitle(e.target.value)} /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="deadline">Deadline</SelectItem>
                  <SelectItem value="leave">Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventDialog(false)}>Cancel</Button>
            <Button onClick={() => createEventMutation.mutate()} disabled={!eventTitle || !eventDate || createEventMutation.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
