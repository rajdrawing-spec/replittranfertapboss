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
import { Badge } from "@/components/ui/badge"
import { Video, CheckCircle2, AlertTriangle } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface MeetingSettingsData {
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

  if (!companyId || !canManage) return null

  const isConfigured = settings?.livekitConfigured ?? false

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Video className="h-4 w-4" /> Meeting Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* LiveKit connection status */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">LiveKit Server</p>
            <p className="text-xs text-muted-foreground">
              {isConfigured
                ? "Connected and ready for video calls"
                : "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in Replit secrets"}
            </p>
          </div>
          {isConfigured ? (
            <Badge variant="default" className="gap-1 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1 shrink-0">
              <AlertTriangle className="h-3 w-3" /> Not configured
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <Label>Default Duration (min)</Label>
          <Input
            type="number"
            value={values.defaultDuration ?? 30}
            onChange={(e) => setValues({ ...values, defaultDuration: parseInt(e.target.value) || 30 })}
          />
        </div>
        <div className="space-y-2">
          <Label>Max Participants</Label>
          <Input
            type="number"
            value={values.maxParticipants ?? 50}
            onChange={(e) => setValues({ ...values, maxParticipants: parseInt(e.target.value) || 50 })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <Label>Waiting Room</Label>
            <Switch
              checked={values.waitingRoomEnabled ?? false}
              onCheckedChange={(v) => setValues({ ...values, waitingRoomEnabled: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Password Required</Label>
            <Switch
              checked={values.passwordRequired ?? false}
              onCheckedChange={(v) => setValues({ ...values, passwordRequired: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Screen Sharing</Label>
            <Switch
              checked={values.screenShareEnabled ?? true}
              onCheckedChange={(v) => setValues({ ...values, screenShareEnabled: v })}
            />
          </div>
          {/* Recording disabled until recording infrastructure is ready (Task 11). */}
        </div>
        <Button onClick={() => update.mutate()} disabled={update.isPending}>
          Save
        </Button>
      </CardContent>
    </Card>
  )
}
