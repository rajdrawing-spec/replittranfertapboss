import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Video } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")
const providers = [
  { value: "jitsi", label: "Jitsi" },
  { value: "google_meet", label: "Google Meet" },
  { value: "microsoft_teams", label: "Microsoft Teams" },
  { value: "zoom", label: "Zoom" },
  { value: "livekit", label: "LiveKit" },
]

interface MeetingSettingsData {
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

export function MeetingSettings() {
  const { activeCompany } = useCompany()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const companyId = activeCompany?.id
  const canManage = hasPermission("meetings.manage")

  const { data: settings } = useQuery<MeetingSettingsData>({
    queryKey: ["/api/meetings/settings", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/meetings/settings?companyId=${companyId}`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId,
  })

  const [values, setValues] = React.useState<Partial<MeetingSettingsData>>({})

  React.useEffect(() => {
    if (settings) setValues(settings)
  }, [settings])

  const update = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/meetings/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...values }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/settings", companyId] })
      toast({ title: "Meeting settings saved" })
    },
    onError: (err) => toast({ title: "Failed", description: String(err), variant: "destructive" }),
  })

  if (!companyId) return null
  if (!canManage) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Video className="h-4 w-4" /> Meeting Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Default Provider</Label>
          <Select value={values.defaultProvider} onValueChange={(v) => setValues({ ...values, defaultProvider: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Jitsi Server URL</Label>
          <Input value={values.jitsiServerUrl} onChange={(e) => setValues({ ...values, jitsiServerUrl: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Default Duration (min)</Label>
          <Input type="number" value={values.defaultDuration} onChange={(e) => setValues({ ...values, defaultDuration: parseInt(e.target.value) || 30 })} />
        </div>
        <div className="space-y-2">
          <Label>Max Participants</Label>
          <Input type="number" value={values.maxParticipants} onChange={(e) => setValues({ ...values, maxParticipants: parseInt(e.target.value) || 50 })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between"><Label>Waiting Room</Label><Switch checked={values.waitingRoomEnabled} onCheckedChange={(v) => setValues({ ...values, waitingRoomEnabled: v })} /></div>
          <div className="flex items-center justify-between"><Label>Password Required</Label><Switch checked={values.passwordRequired} onCheckedChange={(v) => setValues({ ...values, passwordRequired: v })} /></div>
          <div className="flex items-center justify-between"><Label>Screen Sharing</Label><Switch checked={values.screenShareEnabled} onCheckedChange={(v) => setValues({ ...values, screenShareEnabled: v })} /></div>
          <div className="flex items-center justify-between"><Label>Recording</Label><Switch checked={values.recordingEnabled} onCheckedChange={(v) => setValues({ ...values, recordingEnabled: v })} /></div>
          <div className="flex items-center justify-between"><Label>Lobby</Label><Switch checked={values.lobbyEnabled} onCheckedChange={(v) => setValues({ ...values, lobbyEnabled: v })} /></div>
        </div>
        <Button onClick={() => update.mutate()} disabled={update.isPending}>Save</Button>
      </CardContent>
    </Card>
  )
}
