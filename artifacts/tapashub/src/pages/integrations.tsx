import * as React from "react"
import {
  ExternalLink, Globe, Plug, PlugZap, RefreshCw, ChevronDown,
  AlertCircle, CheckCircle2, Clock, ShieldAlert, KeyRound, Webhook,
  History, XCircle, Loader2, Building2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useCompany } from "@/contexts/company-context"
import {
  useCatalog, useConnections, useConnect, useDisconnect, useUpdateConnection,
  useSyncNow, useSyncHistory, useErrorLogs,
  type CatalogPlatform, type Connection, type AuthType,
} from "@/lib/integrations-api"

/* ── helpers ── */

function fmtDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

const STATUS_META: Record<Connection["status"], { label: string; dot: string; text: string }> = {
  connected: { label: "Live", dot: "bg-green-400 animate-pulse", text: "text-green-400" },
  pending: { label: "Pending", dot: "bg-amber-400", text: "text-amber-400" },
  error: { label: "Error", dot: "bg-red-400", text: "text-red-400" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
}

/* ── Connect modal ── */
function ConnectModal({
  platform, companyId, existing, onClose,
}: {
  platform: CatalogPlatform
  companyId: number
  existing?: Connection
  onClose: () => void
}) {
  const methods = React.useMemo<AuthType[]>(() => {
    const m: AuthType[] = []
    if (platform.capabilities.oauth) m.push("oauth")
    if (platform.capabilities.apiKey) m.push("api_key")
    if (platform.capabilities.webhook) m.push("webhook")
    if (m.length === 0) m.push("manual")
    return m
  }, [platform])

  const [authType, setAuthType] = React.useState<AuthType>(existing?.authType ?? methods[0])
  const connect = useConnect()

  const authLabel: Record<AuthType, string> = {
    oauth: "OAuth Login", api_key: "API Key", webhook: "Webhook", manual: "Manual",
  }
  const authIcon: Record<AuthType, React.ReactNode> = {
    oauth: <Plug className="w-4 h-4" />, api_key: <KeyRound className="w-4 h-4" />,
    webhook: <Webhook className="w-4 h-4" />, manual: <Globe className="w-4 h-4" />,
  }

  const result = connect.data

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
            {platform.logo}
          </div>
          <div>
            <div className="font-bold text-base">Connect {platform.name}</div>
            <div className="text-xs text-muted-foreground capitalize">{platform.category}</div>
          </div>
        </div>

        {!result && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">{platform.description}</p>

            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Authentication method</div>
              <div className="grid grid-cols-1 gap-2">
                {methods.map((m) => (
                  <button
                    key={m}
                    onClick={() => setAuthType(m)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                      authType === m ? "border-primary bg-primary/10 text-foreground" : "border-white/10 text-muted-foreground hover:border-white/20"
                    }`}
                  >
                    {authIcon[m]} {authLabel[m]}
                  </button>
                ))}
              </div>
            </div>

            {platform.secretKeys.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <ShieldAlert className="w-3.5 h-3.5" /> Credentials required
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Add these as Replit Secrets (never stored in the database). The connection activates automatically once they are present:
                </p>
                <div className="flex flex-wrap gap-1">
                  {platform.secretKeys.map((k) => (
                    <code key={k} className="text-[10px] bg-background/60 border border-white/10 rounded px-1.5 py-0.5 text-amber-200">
                      INTEGRATION_{platform.key.toUpperCase()}_{companyId}_{k}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {connect.isError && (
              <div className="text-xs text-red-400">{(connect.error as Error)?.message ?? "Failed to connect"}</div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={connect.isPending}
                onClick={() => connect.mutate({ companyId, platformKey: platform.key, authType })}
              >
                {connect.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Connecting…</> : <><PlugZap className="w-4 h-4 mr-1.5" />Connect</>}
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-3">
            {result.status === "connected" ? (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <p className="text-sm font-medium text-green-400">Connected successfully</p>
                <p className="text-xs text-muted-foreground">{platform.name} is live for this company.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <Clock className="w-8 h-8 text-amber-400" />
                <p className="text-sm font-medium text-amber-300">Awaiting credentials</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{result.lastError ?? "Add the required secrets to activate this connection."}</p>
              </div>
            )}
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── History / errors drawer ── */
function ActivityDrawer({ connection, platform, onClose }: { connection: Connection; platform: CatalogPlatform; onClose: () => void }) {
  const [tab, setTab] = React.useState<"history" | "errors">("history")
  const history = useSyncHistory(connection.id)
  const errors = useErrorLogs(connection.id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${platform.logoColor} flex items-center justify-center text-white font-bold text-xs`}>{platform.logo}</div>
          <div className="font-semibold">{platform.name} — Activity</div>
        </div>

        <div className="flex gap-1 border-b border-white/10">
          <button onClick={() => setTab("history")} className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>Sync History</button>
          <button onClick={() => setTab("errors")} className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === "errors" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>Error Log</button>
        </div>

        {tab === "history" && (
          <div className="space-y-2">
            {history.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {history.data?.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No sync runs yet.</p>}
            {history.data?.map((h) => (
              <div key={h.id} className="flex items-start justify-between gap-3 text-xs bg-background/40 rounded-lg p-2.5 border border-white/5">
                <div className="flex items-start gap-2">
                  {h.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5" /> : h.status === "failed" ? <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />}
                  <div>
                    <div className="font-medium capitalize">{h.status} · {h.trigger}{h.recordsSynced > 0 ? ` · ${h.recordsSynced} records` : ""}</div>
                    {h.message && <div className="text-muted-foreground mt-0.5">{h.message}</div>}
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0">{fmtDate(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "errors" && (
          <div className="space-y-2">
            {errors.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {errors.data?.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No errors logged.</p>}
            {errors.data?.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 text-xs bg-background/40 rounded-lg p-2.5 border border-white/5">
                <div className="flex items-start gap-2">
                  <AlertCircle className={`w-3.5 h-3.5 mt-0.5 ${e.level === "error" ? "text-red-500" : "text-amber-500"}`} />
                  <div>
                    <div className="font-medium">{e.message}</div>
                    {e.detail && <div className="text-muted-foreground mt-0.5">{e.detail}</div>}
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0">{fmtDate(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}

/* ── Platform card ── */
function PlatformCard({ platform, companyId, connection }: { platform: CatalogPlatform; companyId: number; connection?: Connection }) {
  const [showConnect, setShowConnect] = React.useState(false)
  const [showActivity, setShowActivity] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)

  const disconnect = useDisconnect()
  const update = useUpdateConnection()
  const sync = useSyncNow()

  const status: Connection["status"] = connection?.status ?? "disconnected"
  const meta = STATUS_META[status]
  const isLinked = !!connection && status !== "disconnected"

  function toggleFeature(feature: string, val: boolean) {
    if (!connection) return
    update.mutate({ id: connection.id, syncSettings: { ...connection.syncSettings, [feature]: val } })
  }

  return (
    <>
      {showConnect && (
        <ConnectModal platform={platform} companyId={companyId} existing={connection} onClose={() => setShowConnect(false)} />
      )}
      {showActivity && connection && (
        <ActivityDrawer connection={connection} platform={platform} onClose={() => setShowActivity(false)} />
      )}

      <Card className="bg-card/60 border border-white/10 hover:shadow-lg hover:border-white/20 transition-all">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-xs shadow-lg shrink-0`}>{platform.logo}</div>
              <div>
                <CardTitle className="text-sm leading-tight">{platform.name}</CardTitle>
                <span className="text-[10px] text-muted-foreground capitalize">{platform.category}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`flex items-center gap-1 text-[10px] font-medium ${meta.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
              <a href={platform.url} target="_blank" rel="noopener noreferrer">
                <Button size="icon" variant="ghost" className="w-7 h-7 opacity-50 hover:opacity-100"><ExternalLink className="w-3.5 h-3.5" /></Button>
              </a>
            </div>
          </div>

          {isLinked && (
            <div className="mt-2 space-y-0.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" /> Last sync: {fmtDate(connection!.lastSyncAt)}
              </div>
              {connection!.connectedUserName && (
                <div className="text-[10px] text-muted-foreground">Connected by {connection!.connectedUserName}</div>
              )}
              {connection!.lastError && status !== "connected" && (
                <div className="text-[10px] text-amber-400 leading-snug">{connection!.lastError}</div>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          <div className="flex gap-2">
            {isLinked ? (
              <>
                <Button size="sm" variant="outline" className="flex-1 h-8 text-xs border-white/10" disabled={sync.isPending} onClick={() => sync.mutate(connection!.id)}>
                  {sync.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />Syncing…</> : <><RefreshCw className="w-3.5 h-3.5 mr-1" />Sync Now</>}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connection!.id)}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => setShowConnect(true)}>
                <PlugZap className="w-3.5 h-3.5 mr-1.5" /> Connect Account
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => setExpanded(!expanded)} title="Settings">
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {expanded && (
            <div className="border-t border-white/10 pt-3 space-y-3">
              {isLinked && (
                <>
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Data to sync</div>
                    <div className="space-y-1.5">
                      {platform.syncFeatures.map((f) => (
                        <div key={f} className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{f}</span>
                          <Switch checked={connection!.syncSettings?.[f] ?? true} onCheckedChange={(v) => toggleFeature(f, v)} />
                        </div>
                      ))}
                      {platform.syncFeatures.length === 0 && <div className="text-xs text-muted-foreground">Portal access only — no data sync.</div>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 pt-2">
                    <span className="text-xs text-muted-foreground">Auto sync (every 15 min)</span>
                    <Switch
                      checked={connection!.autoSync}
                      disabled={status !== "connected"}
                      onCheckedChange={(v) => update.mutate({ id: connection!.id, autoSync: v })}
                    />
                  </div>
                  <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground" onClick={() => setShowActivity(true)}>
                    <History className="w-3.5 h-3.5 mr-1.5" /> View sync history & errors
                  </Button>
                </>
              )}

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Links</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {platform.quickLinks.map((link) => (
                    <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-background/30 hover:bg-background/60 px-2.5 py-1.5 rounded-md transition-all border border-transparent hover:border-white/10">
                      <Globe className="w-3 h-3 shrink-0" /> {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/* ── Main page ── */
export default function Integrations() {
  const { activeCompany } = useCompany()
  const catalog = useCatalog()
  const companyId = activeCompany?.id ?? null
  const connections = useConnections(companyId)

  const byPlatform = React.useMemo(() => {
    const m = new Map<string, Connection>()
    for (const c of connections.data ?? []) m.set(c.platformKey, c)
    return m
  }, [connections.data])

  if (!activeCompany) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground mt-1 text-sm">Connect sales channels, payments, logistics and marketing platforms.</p>
        </div>
        <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <Building2 className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-blue-300">Select a company</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each company maintains its own separate platform connections. Choose a company from the switcher to manage its integrations.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const platforms = catalog.data ?? []
  const connectedCount = (connections.data ?? []).filter((c) => c.status === "connected").length

  const byCategory = platforms.reduce<Record<string, CatalogPlatform[]>>((acc, p) => {
    ;(acc[p.category] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{activeCompany.name} Integrations</h1>
          <p className="text-muted-foreground mt-1 text-sm">Connect and sync sales channels, payments, logistics and marketing platforms.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{connectedCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Connected</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-2xl font-bold">{platforms.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Available</div>
          </div>
        </div>
      </div>

      {(catalog.isLoading || connections.isLoading) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading integrations…</div>
      )}

      {catalog.isError && <div className="text-sm text-red-400">Failed to load platform catalog.</div>}

      {Object.entries(byCategory).map(([cat, ps]) => (
        <div key={cat} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{cat}</h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{ps.length} platform{ps.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {ps.map((platform) => (
              <PlatformCard key={platform.key} platform={platform} companyId={activeCompany.id} connection={byPlatform.get(platform.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
