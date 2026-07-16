import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

export interface AiTasksConfig {
  enabled: boolean
  provider: "auto" | "ollama" | "gemini"
  generationTime: string
  autoApprove: boolean
  maxRegenerationsPerDay: number
  enableScheduler: boolean
  promptTemplate: string | null
  batchSize: number
}

export function AiTasksSettings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery<AiTasksConfig>({
    queryKey: ["/api/ai-tasks/config"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/config`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const [form, setForm] = React.useState<Partial<AiTasksConfig>>({})
  React.useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const mutation = useMutation({
    mutationFn: async (payload: Partial<AiTasksConfig>) => {
      const res = await fetch(`${basePath}/api/ai-tasks/config`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/config"] })
      toast({ title: "Settings saved" })
    },
    onError: (err) => toast({ title: "Failed to save", description: String(err), variant: "destructive" }),
  })

  if (isLoading) return <div className="py-8 text-center">Loading settings…</div>

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Tasks Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable AI Tasks</div>
            <div className="text-sm text-muted-foreground">Turn the module on or off.</div>
          </div>
          <Switch
            checked={form.enabled ?? true}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable Scheduler</div>
            <div className="text-sm text-muted-foreground">Run daily generation automatically.</div>
          </div>
          <Switch
            checked={form.enableScheduler ?? true}
            onCheckedChange={(v) => setForm({ ...form, enableScheduler: v })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="provider">Preferred AI Provider</Label>
            <Select
              value={form.provider ?? "auto"}
              onValueChange={(v: "auto" | "ollama" | "gemini") => setForm({ ...form, provider: v })}
            >
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (Ollama → Gemini)</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="genTime">Generation Time</Label>
            <Input
              id="genTime"
              type="time"
              value={form.generationTime ?? "08:00"}
              onChange={(e) => setForm({ ...form, generationTime: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="maxRegen">Max Regenerations per Day</Label>
            <Input
              id="maxRegen"
              type="number"
              min={1}
              value={form.maxRegenerationsPerDay ?? 3}
              onChange={(e) => setForm({ ...form, maxRegenerationsPerDay: parseInt(e.target.value) || 3 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="batchSize">Batch Size</Label>
            <Input
              id="batchSize"
              type="number"
              min={1}
              value={form.batchSize ?? 10}
              onChange={(e) => setForm({ ...form, batchSize: parseInt(e.target.value) || 10 })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto Approve</div>
            <div className="text-sm text-muted-foreground">Skip manager approval when no manager exists.</div>
          </div>
          <Switch
            checked={form.autoApprove ?? false}
            onCheckedChange={(v) => setForm({ ...form, autoApprove: v })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="promptTemplate">Custom Prompt Template</Label>
          <textarea
            id="promptTemplate"
            className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.promptTemplate ?? ""}
            onChange={(e) => setForm({ ...form, promptTemplate: e.target.value })}
            placeholder="Additional instructions for the AI when generating tasks."
          />
        </div>

        <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
          Save Settings
        </Button>
      </CardContent>
    </Card>
  )
}
