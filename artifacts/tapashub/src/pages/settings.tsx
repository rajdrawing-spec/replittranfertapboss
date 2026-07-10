import { useState } from "react"
import {
  useListUsers, getListUsersQueryKey,
  useGetAiProviderConfig, useUpdateAiProviderConfig, useTestAiProvider,
  getGetAiProviderConfigQueryKey
} from "@workspace/api-client-react"
import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings2, Shield, Users, Brain, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

export default function Settings() {
  const { isSuperAdmin } = useAuth()
  const { data: users, isLoading } = useListUsers({}, {
    query: { enabled: true, queryKey: getListUsersQueryKey({}) }
  })

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex justify-between items-end border-b pb-4 border-muted">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Settings2 className="w-8 h-8 text-primary" />
            System Settings
          </h1>
          <p className="text-muted-foreground mt-1">Platform configuration and user access control</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Two-Factor Auth</div>
                  <div className="text-xs text-muted-foreground">Require 2FA for all users</div>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Session Timeout</div>
                  <div className="text-xs text-muted-foreground">Auto-logout after 30 mins</div>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">System Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Weekly Reports</div>
                  <div className="text-xs text-muted-foreground">Email portfolio summary</div>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          {/* AI Provider card — super admin only */}
          {isSuperAdmin && <AiProviderCard />}
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                User Management
              </CardTitle>
              <CardDescription>Manage platform access and roles</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="space-y-2">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    users?.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={user.avatarUrl || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {user.name.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium text-sm">{user.name}</div>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize bg-background text-[10px]">
                            {user.role.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.status === 'active' ? 'success' : 'secondary'} className="capitalize text-[10px]">
                            {user.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function AiProviderCard() {
  const qc = useQueryClient()
  const { data: config, isLoading } = useGetAiProviderConfig({
    query: { queryKey: getGetAiProviderConfigQueryKey() }
  })

  const update = useUpdateAiProviderConfig({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetAiProviderConfigQueryKey() })
    }
  })

  const testMutation = useTestAiProvider()

  const [keys, setKeys] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latencyMs: number }>>({})
  const [expanded, setExpanded] = useState(false)

  const handleSelect = (name: string) => {
    update.mutate({ data: { activeProvider: name } })
  }

  const handleSaveKey = (provider: string, keyField: string) => {
    const val = keys[keyField]
    if (!val?.trim()) return
    update.mutate({ data: { [keyField]: val.trim() } })
    setKeys(prev => ({ ...prev, [keyField]: "" }))
  }

  const handleTest = async (name: string) => {
    const result = await testMutation.mutateAsync({ data: { provider: name } })
    setTestResults(prev => ({ ...prev, [name]: { ok: result.ok, latencyMs: result.latencyMs } }))
  }

  return (
    <Card className="bg-card/50">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <CardTitle className="text-base flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> AI Provider</span>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </CardTitle>
        <CardDescription className="text-xs">Configure which AI model powers the intelligence features</CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            config?.providers?.map(p => {
              const isActive = config.activeProvider === p.name
              const keyField = p.name === "groq" ? "groqApiKey" : p.name === "openrouter" ? "openrouterApiKey" : p.name === "deepseek" ? "deepseekApiKey" : null
              const testRes = testResults[p.name]
              return (
                <div
                  key={p.name}
                  className={`border rounded-lg p-3 space-y-2 transition-colors cursor-pointer ${isActive ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                  onClick={() => !isActive && handleSelect(p.name)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                      <div className="text-sm font-medium">{p.label}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isActive && <Badge className="text-[10px]">Active</Badge>}
                      {p.hasKey && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                      {p.requiresKey && !p.hasKey && <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                      {testRes && (
                        <Badge variant={testRes.ok ? "success" : "destructive"} className="text-[10px]">
                          {testRes.ok ? `${testRes.latencyMs}ms` : "failed"}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {keyField && (
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Input
                        type="password"
                        placeholder={p.hasKey ? "••••••• (set — update)" : "Enter API key"}
                        value={keys[keyField] ?? ""}
                        onChange={e => setKeys(prev => ({ ...prev, [keyField]: e.target.value }))}
                        className="h-7 text-xs"
                      />
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleSaveKey(p.name, keyField)} disabled={!keys[keyField]?.trim()}>
                        Save
                      </Button>
                    </div>
                  )}

                  <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[11px] px-2 gap-1"
                      onClick={() => handleTest(p.name)}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Test connection
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      )}
    </Card>
  )
}
