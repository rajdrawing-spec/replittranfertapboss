import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/empty-state"
import { FileCode2 } from "lucide-react"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface AiPrompt {
  id: number
  name: string
  version: string
  content: string
  isActive: boolean
  isSystem: boolean
  createdAt: string
}

export function AiTaskPrompts() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: prompts, isLoading } = useQuery<AiPrompt[]>({
    queryKey: ["/api/ai-tasks/prompts"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/prompts`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const [version, setVersion] = React.useState("")
  const [content, setContent] = React.useState("")

  const { data: activePrompt } = useQuery<{ content: string }>({
    queryKey: ["/api/ai-tasks/prompts/active"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/prompts/active`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  React.useEffect(() => {
    if (activePrompt && !content) setContent(activePrompt.content)
  }, [activePrompt, content])

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/prompts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, content }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/prompts"] })
      setVersion("")
      setContent("")
      toast({ title: "Prompt version created and activated" })
    },
    onError: (err) => toast({ title: "Failed to create prompt", description: String(err), variant: "destructive" }),
  })

  const activateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${basePath}/api/ai-tasks/prompts/${id}/activate`, {
        method: "PATCH",
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/prompts"] })
      toast({ title: "Prompt activated" })
    },
    onError: (err) => toast({ title: "Failed to activate prompt", description: String(err), variant: "destructive" }),
  })

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading prompts…</div>

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" /> Active Prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="version">New Version</Label>
            <Input
              id="version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Prompt Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={18}
              placeholder="System prompt for the AI task generator."
            />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!version || !content || createMutation.isPending}>
            Save as New Active Version
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Version History</CardTitle>
        </CardHeader>
        <CardContent>
          {prompts?.length === 0 ? (
            <EmptyState icon={FileCode2} message="No prompt versions" hint="Create a version above." />
          ) : (
            <div className="space-y-2">
              {prompts?.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="font-medium">
                      Version {p.version}
                      {p.isActive && <Badge className="ml-2">Active</Badge>}
                      {p.isSystem && <Badge variant="outline" className="ml-2">System</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div>
                  </div>
                  {!p.isActive && (
                    <Button size="sm" onClick={() => activateMutation.mutate(p.id)} disabled={activateMutation.isPending}>
                      Activate
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
