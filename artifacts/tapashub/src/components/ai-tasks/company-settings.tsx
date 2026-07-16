import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { CalendarClock, Trash2 } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

interface CompanySettingsData {
  settings: {
    companyId: number
    timezone: string
    workWeek: number[]
    weekendGeneration: boolean
    generationTime: string | null
  }
  holidays: Array<{
    id: number
    date: string
    name: string
    isRecurringYearly: boolean
  }>
}

export function AiTaskCompanySettings({ companyId }: { companyId: number }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<CompanySettingsData>({
    queryKey: ["/api/ai-tasks/company-settings", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/company-settings?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const [form, setForm] = React.useState<Partial<CompanySettingsData["settings"]>>({})
  React.useEffect(() => {
    if (data?.settings) setForm(data.settings)
  }, [data?.settings])

  const [holidayName, setHolidayName] = React.useState("")
  const [holidayDate, setHolidayDate] = React.useState("")
  const [holidayRecurring, setHolidayRecurring] = React.useState(false)

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<CompanySettingsData["settings"]>) => {
      const res = await fetch(`${basePath}/api/ai-tasks/company-settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, companyId }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/company-settings", companyId] })
      toast({ title: "Company settings saved" })
    },
    onError: (err) => toast({ title: "Failed to save", description: String(err), variant: "destructive" }),
  })

  const createHolidayMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/holidays`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, date: holidayDate, name: holidayName, isRecurringYearly: holidayRecurring }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/company-settings", companyId] })
      setHolidayName("")
      setHolidayDate("")
      setHolidayRecurring(false)
      toast({ title: "Holiday added" })
    },
    onError: (err) => toast({ title: "Failed to add holiday", description: String(err), variant: "destructive" }),
  })

  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${basePath}/api/ai-tasks/holidays/${id}?companyId=${companyId}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/company-settings", companyId] })
      toast({ title: "Holiday removed" })
    },
    onError: (err) => toast({ title: "Failed to remove holiday", description: String(err), variant: "destructive" }),
  })

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading company settings…</div>

  function toggleWorkDay(day: number) {
    const current = form.workWeek ?? data?.settings.workWeek ?? [1, 2, 3, 4, 5]
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    setForm({ ...form, workWeek: next })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Scheduling & Time Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="timezone">Time Zone</Label>
              <Input
                id="timezone"
                value={form.timezone ?? "UTC"}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="e.g. Asia/Kolkata"
              />
              <p className="text-xs text-muted-foreground">IANA time zone (e.g. Asia/Kolkata, America/New_York).</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="genTime">Generation Time</Label>
              <Input
                id="genTime"
                type="time"
                value={form.generationTime ?? ""}
                onChange={(e) => setForm({ ...form, generationTime: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the global setting.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Work Week</Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWorkDay(day)}
                  className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                    (form.workWeek ?? data?.settings.workWeek ?? []).includes(day)
                      ? "bg-primary text-primary-foreground"
                      : "bg-card hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Generate on Weekends</div>
              <div className="text-sm text-muted-foreground">Create tasks on Saturday and Sunday too.</div>
            </div>
            <Switch
              checked={form.weekendGeneration ?? false}
              onCheckedChange={(v) => setForm({ ...form, weekendGeneration: v })}
            />
          </div>

          <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
            Save Scheduling Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Company Holidays</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="holidayName">Name</Label>
              <Input id="holidayName" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="Diwali" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="holidayDate">Date</Label>
              <Input id="holidayDate" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2 pb-2">
                <input
                  id="recurring"
                  type="checkbox"
                  checked={holidayRecurring}
                  onChange={(e) => setHolidayRecurring(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="recurring" className="font-normal">Recurring yearly</Label>
              </div>
              <Button onClick={() => createHolidayMutation.mutate()} disabled={!holidayName || !holidayDate || createHolidayMutation.isPending}>
                Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {data?.holidays.length === 0 ? (
              <div className="text-sm text-muted-foreground">No holidays configured.</div>
            ) : (
              data?.holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <div className="font-medium">{h.name}</div>
                    <div className="text-xs text-muted-foreground">{h.date} {h.isRecurringYearly && <Badge variant="outline" className="ml-1">Recurring</Badge>}</div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteHolidayMutation.mutate(h.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
