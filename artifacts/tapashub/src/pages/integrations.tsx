import * as React from "react"
import {
  ExternalLink, Globe, Plug, PlugZap, RefreshCw, ChevronDown,
  AlertCircle, CheckCircle2, Clock, ShieldAlert, KeyRound, Webhook,
  History, XCircle, Loader2, Building2, Monitor, Wifi, WifiOff,
  RotateCcw, Eye, EyeOff, Settings2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCompany } from "@/contexts/company-context"
import { useToast } from "@/hooks/use-toast"
import {
  useCatalog, useConnections, useConnect, useDisconnect, useUpdateConnection,
  useSyncNow, useSyncHistory, useErrorLogs, useEmbedCheck,
  useSaveCredentials, useRetestConnection,
  type CatalogPlatform, type Connection, type AuthType,
} from "@/lib/integrations-api"

/* ── helpers ── */

function fmtDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}

const STATUS_META: Record<Connection["status"], { label: string; dot: string; text: string; icon: React.ElementType }> = {
  connected: { label: "Live", dot: "bg-green-400 animate-pulse", text: "text-green-400", icon: CheckCircle2 },
  pending: { label: "Awaiting Credentials", dot: "bg-amber-400", text: "text-amber-400", icon: Clock },
  error: { label: "Error", dot: "bg-red-400", text: "text-red-400", icon: XCircle },
  disconnected: { label: "Not Connected", dot: "bg-muted-foreground/40", text: "text-muted-foreground", icon: WifiOff },
}

/* ── External Portal Launcher ── */

/**
 * Opens the platform's admin URL in a named browser window dedicated to
 * this company+platform combo. The browser naturally maintains session cookies
 * in that window across navigations. Clicking "Open" again focuses the same
 * window rather than opening a duplicate.
 *
 * Note: if two companies use the same platform, they share one browser session
 * for that platform's domain. True per-company session isolation requires an
 * Electron desktop build with partitioned WebContentsView sessions.
 */
function openPortalWindow(platform: CatalogPlatform, companyId: number) {
  const windowName = `tapashub-portal-${platform.key}-company-${companyId}`
  // noopener,noreferrer prevents reverse-tabnabbing. Note: noopener means we
  // cannot read window.opener from the child, so named-window refocus is not
  // possible — each click opens/re-navigates the named window fresh.
  window.open(platform.url, windowName, "width=1400,height=900,noopener,noreferrer")
}

/* ── Credential Input Form ── */

function CredentialForm({
  platform,
  companyId,
  connectionId,
  onSaved,
}: {
  platform: CatalogPlatform
  companyId: number
  connectionId: number | null
  onSaved: (conn: Connection) => void
}) {
  const { toast } = useToast()
  const connect = useConnect()
  const saveCredentials = useSaveCredentials()

  const [fields, setFields] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(platform.secretKeys.map((k) => [k, ""]))
  )
  const [showValues, setShowValues] = React.useState<Record<string, boolean>>({})

  const hasAllRequired = platform.secretKeys.every((k) => fields[k]?.trim())
  const isPending = connect.isPending || saveCredentials.isPending

  async function submit() {
    const creds = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])
    )

    try {
      let conn: Connection
      if (connectionId) {
        conn = await saveCredentials.mutateAsync({ id: connectionId, credentials: creds })
      } else {
        conn = await connect.mutateAsync({
          companyId,
          platformKey: platform.key,
          authType: "api_key",
          credentials: creds,
        })
      }
      onSaved(conn)
      toast({
        title: conn.status === "connected" ? "Connected!" : "Credentials saved",
        description: conn.status === "connected"
          ? `${platform.name} is now live.`
          : (conn.lastError ?? "Add credentials to activate."),
      })
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message ?? "Could not save credentials", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
        <ShieldAlert className="w-3.5 h-3.5" />
        Enter your {platform.name} credentials
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Credentials are encrypted with AES-256 and stored securely. They are never sent to third parties.
      </p>

      {platform.secretKeys.map((key) => (
        <div key={key} className="space-y-1">
          <Label className="text-[11px] font-mono text-muted-foreground">{key}</Label>
          <div className="relative">
            <Input
              type={showValues[key] ? "text" : "password"}
              placeholder={`Enter ${key}`}
              value={fields[key] ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
              className="h-8 text-xs font-mono pr-8 bg-background/60"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowValues((s) => ({ ...s, [key]: !s[key] }))}
            >
              {showValues[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      ))}

      {(connect.isError || saveCredentials.isError) && (
        <div className="text-xs text-red-400">
          {(connect.error as Error)?.message ?? (saveCredentials.error as Error)?.message ?? "Failed to save"}
        </div>
      )}

      <Button size="sm" className="w-full" disabled={!hasAllRequired || isPending} onClick={submit}>
        {isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Verifying…</> : <><PlugZap className="w-3.5 h-3.5 mr-1.5" />Connect & Verify</>}
      </Button>
    </div>
  )
}

/* ── Embed / Portal Workspace Panel ── */

function WorkspacePanel({ platform, companyId, onClose }: { platform: CatalogPlatform; companyId: number; onClose: () => void }) {
  const check = useEmbedCheck(platform.url)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-card/80 backdrop-blur-md shrink-0">
        <div className={`w-7 h-7 rounded-lg ${platform.logoColor} flex items-center justify-center text-white font-bold text-[10px]`}>
          {platform.logo}
        </div>
        <span className="font-semibold text-sm">{platform.name}</span>
        {check.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {check.data && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${check.data.embeddable ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-amber-500/30 text-amber-400 bg-amber-500/10"}`}>
            {check.data.embeddable ? "Embedded" : "External Window"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => openPortalWindow(platform, companyId)}>
            <ExternalLink className="w-3.5 h-3.5" /> Open in Window
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>✕ Close</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative overflow-hidden">
        {check.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Checking embedding support…</p>
            </div>
          </div>
        )}

        {check.data?.embeddable && (
          <iframe
            src={platform.url}
            className="w-full h-full border-none"
            title={platform.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        )}

        {check.data && !check.data.embeddable && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md w-full text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
                <Monitor className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold">{platform.name} blocks embedding</h2>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {platform.name} has set <code className="text-xs bg-muted px-1 py-0.5 rounded">{check.data.xFrameOptions ?? "Content-Security-Policy"}</code> which prevents browser embedding. This is a security policy enforced by {platform.name} — it cannot be overridden in a web app.
                </p>
              </div>

              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-left space-y-3">
                <div className="text-xs font-semibold text-blue-300 uppercase tracking-wider">What you can do</div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                    <span><strong className="text-foreground">Open in external window</strong> — {platform.name} opens in a dedicated browser window. Your session is preserved for the duration of that window.</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                    <span><strong className="text-foreground">API data sync</strong> — Connect your credentials above and TapasHub automatically syncs orders, products, and analytics in the background.</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <span><strong className="text-foreground">True multi-account isolation</strong> (e.g. two companies on Shopify simultaneously) requires the TapasHub Desktop app built on Electron with partitioned browser sessions.</span>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={() => openPortalWindow(platform, companyId)}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open {platform.name} in Dedicated Window
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Connect / Edit Modal ── */

function ConnectModal({
  platform, companyId, existing, onClose,
}: {
  platform: CatalogPlatform
  companyId: number
  existing?: Connection
  onClose: () => void
}) {
  const connect = useConnect()
  const retest = useRetestConnection()
  const [savedConn, setSavedConn] = React.useState<Connection | undefined>(existing)
  const conn = savedConn ?? existing

  function handleSaved(c: Connection) {
    setSavedConn(c)
  }

  // For platforms with no API credentials (OAuth-only or no secretKeys)
  const isOAuthOnly = platform.capabilities.oauth && !platform.capabilities.apiKey && platform.secretKeys.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
            {platform.logo}
          </div>
          <div>
            <div className="font-bold text-base">Connect {platform.name}</div>
            <div className="text-xs text-muted-foreground capitalize">{platform.category}</div>
          </div>
        </div>

        {/* Current status banner */}
        {conn && conn.status !== "disconnected" && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${
            conn.status === "connected" ? "bg-green-500/10 border-green-500/20 text-green-300" :
            conn.status === "error" ? "bg-red-500/10 border-red-500/20 text-red-300" :
            "bg-amber-500/10 border-amber-500/20 text-amber-300"
          }`}>
            {conn.status === "connected" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> :
             conn.status === "error" ? <XCircle className="w-3.5 h-3.5 shrink-0" /> :
             <Clock className="w-3.5 h-3.5 shrink-0" />}
            <span className="flex-1">{conn.status === "connected" ? "Connected and live" : (conn.lastError ?? STATUS_META[conn.status].label)}</span>
            {conn.id && (
              <button
                className="underline opacity-70 hover:opacity-100 shrink-0"
                onClick={() => retest.mutate(conn.id)}
                disabled={retest.isPending}
              >
                {retest.isPending ? "Testing…" : "Re-test"}
              </button>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground leading-relaxed">{platform.description}</p>

        {/* Credential form */}
        {platform.secretKeys.length > 0 && (
          <CredentialForm
            platform={platform}
            companyId={companyId}
            connectionId={conn?.id ?? null}
            onSaved={handleSaved}
          />
        )}

        {/* OAuth-only platforms */}
        {isOAuthOnly && (
          <div className="space-y-3">
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
              <p className="font-semibold text-blue-300 mb-1">OAuth Authorization Required</p>
              <p>{platform.name} uses OAuth. You need to register TapasHub as an authorized app in your {platform.name} developer account, then enter the resulting CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN above.</p>
            </div>
            <a href={platform.url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> Open {platform.name} Developer Console
              </Button>
            </a>
          </div>
        )}

        {/* Quick links */}
        {platform.quickLinks.length > 0 && (
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
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {conn?.status === "connected" ? "Done" : "Cancel"}
          </Button>
          {conn?.status === "connected" && (
            <Button variant="outline" className="flex-1 gap-1.5 text-xs" onClick={() => openPortalWindow(platform, companyId)}>
              <Monitor className="w-3.5 h-3.5" /> Open Portal
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Activity Drawer ── */

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
          {(["history", "errors"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 -mb-px capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
              {t === "history" ? "Sync History" : "Error Log"}
            </button>
          ))}
        </div>

        {tab === "history" && (
          <div className="space-y-2">
            {history.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {history.data?.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No sync runs yet.</p>}
            {history.data?.map((h) => (
              <div key={h.id} className="flex items-start justify-between gap-3 text-xs bg-background/40 rounded-lg p-2.5 border border-white/5">
                <div className="flex items-start gap-2">
                  {h.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5" />
                    : h.status === "failed" ? <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5" />
                    : <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />}
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

/* ── Platform Card ── */

function PlatformCard({ platform, companyId, connection }: { platform: CatalogPlatform; companyId: number; connection?: Connection }) {
  const { toast } = useToast()
  const [showConnect, setShowConnect] = React.useState(false)
  const [showActivity, setShowActivity] = React.useState(false)
  const [showWorkspace, setShowWorkspace] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)

  const disconnect = useDisconnect()
  const update = useUpdateConnection()
  const sync = useSyncNow()

  const status: Connection["status"] = connection?.status ?? "disconnected"
  const meta = STATUS_META[status]
  const isLinked = !!connection && status !== "disconnected"
  const isLive = status === "connected"

  function toggleFeature(feature: string, val: boolean) {
    if (!connection) return
    update.mutate({ id: connection.id, syncSettings: { ...connection.syncSettings, [feature]: val } })
  }

  function handleSync() {
    if (!connection) return
    sync.mutate(connection.id, {
      onSuccess: (data) => {
        toast({ title: "Sync complete", description: data.result.message })
      },
      onError: (e: any) => toast({ title: "Sync failed", description: e?.message, variant: "destructive" }),
    })
  }

  return (
    <>
      {showConnect && (
        <ConnectModal platform={platform} companyId={companyId} existing={connection} onClose={() => setShowConnect(false)} />
      )}
      {showActivity && connection && (
        <ActivityDrawer connection={connection} platform={platform} onClose={() => setShowActivity(false)} />
      )}
      {showWorkspace && (
        <WorkspacePanel platform={platform} companyId={companyId} onClose={() => setShowWorkspace(false)} />
      )}

      <Card className={`bg-card/60 border transition-all hover:shadow-lg ${isLive ? "border-green-500/20" : "border-white/10 hover:border-white/20"}`}>
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
            </div>
          </div>

          {isLinked && (
            <div className="mt-2 space-y-0.5">
              {connection!.lastSyncAt && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" /> Last sync: {fmtDate(connection!.lastSyncAt)}
                </div>
              )}
              {connection!.lastError && status !== "connected" && (
                <div className="text-[10px] text-amber-400 leading-snug mt-1">{connection!.lastError}</div>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Action buttons */}
          <div className="flex gap-2">
            {isLinked ? (
              <>
                {/* Portal / Workspace */}
                <Button size="sm" variant="outline" className="flex-1 h-8 text-xs border-white/10 gap-1" onClick={() => setShowWorkspace(true)}>
                  <Monitor className="w-3.5 h-3.5" /> Open
                </Button>
                {/* Sync */}
                <Button size="sm" variant="outline" className="h-8 text-xs border-white/10 px-2.5" disabled={sync.isPending || !isLive} onClick={handleSync} title="Sync Now">
                  {sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </Button>
                {/* Settings */}
                <Button size="sm" variant="ghost" className="h-8 text-xs px-2.5 text-muted-foreground" onClick={() => setShowConnect(true)} title="Edit credentials">
                  <Settings2 className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <Button size="sm" className="flex-1 h-8 text-xs gap-1.5" onClick={() => setShowConnect(true)}>
                <PlugZap className="w-3.5 h-3.5" /> Connect
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => setExpanded(!expanded)}>
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {/* Expanded settings */}
          {expanded && (
            <div className="border-t border-white/10 pt-3 space-y-3">
              {isLinked && (
                <>
                  {platform.syncFeatures.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Data to sync</div>
                      <div className="space-y-1.5">
                        {platform.syncFeatures.map((f) => (
                          <div key={f} className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{f}</span>
                            <Switch checked={connection!.syncSettings?.[f] ?? true} onCheckedChange={(v) => toggleFeature(f, v)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-white/10 pt-2">
                    <span className="text-xs text-muted-foreground">Auto sync (every 15 min)</span>
                    <Switch
                      checked={connection!.autoSync}
                      disabled={!isLive}
                      onCheckedChange={(v) => update.mutate({ id: connection!.id, autoSync: v })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1 h-7 text-xs text-muted-foreground" onClick={() => setShowActivity(true)}>
                      <History className="w-3.5 h-3.5 mr-1.5" /> Sync history
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={disconnect.isPending} onClick={() => disconnect.mutate(connection!.id)}>
                      Disconnect
                    </Button>
                  </div>
                </>
              )}

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Links</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {platform.quickLinks.map((link) => (
                    <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-background/30 hover:bg-background/60 px-2.5 py-1.5 rounded-md transition-all border border-transparent hover:border-white/10">
                      <ExternalLink className="w-3 h-3 shrink-0" /> {link.label}
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
              Each company maintains its own separate API connections and credentials. Choose a company to manage its integrations.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const platforms = catalog.data ?? []
  const allConns = connections.data ?? []
  const connectedCount = allConns.filter((c) => c.status === "connected").length
  const pendingCount = allConns.filter((c) => c.status === "pending" || c.status === "error").length

  const byCategory = platforms.reduce<Record<string, CatalogPlatform[]>>((acc, p) => {
    ;(acc[p.category] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{activeCompany.name} Integrations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Click <strong>Connect</strong> to enter credentials. Data syncs in the background. Click <strong>Open</strong> to access the platform's admin portal.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{connectedCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Live</div>
          </div>
          {pendingCount > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">{pendingCount}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</div>
            </div>
          )}
          <div className="text-center">
            <div className="text-2xl font-bold">{platforms.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Available</div>
          </div>
        </div>
      </div>

      {/* Multi-account notice */}
      <div className="flex items-start gap-3 bg-muted/30 border border-white/5 rounded-xl p-4">
        <Wifi className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">How it works:</strong> Credentials are encrypted per-company. Each company (HugFAB, TottoToy, TikkaTails, Pepalworks) has completely separate API connections. Click <strong>Open</strong> to access a platform's web portal — the session is maintained in a dedicated browser window per company. For true simultaneous multi-account isolation in the same window, the TapasHub Desktop app is required.
        </div>
      </div>

      {(catalog.isLoading || connections.isLoading) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      )}
      {catalog.isError && <div className="text-sm text-red-400">Failed to load platform catalog.</div>}

      {/* Categories */}
      {Object.entries(byCategory).map(([cat, ps]) => (
        <div key={cat} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{cat}</h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{ps.length} platform{ps.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {ps.map((platform) => (
              <PlatformCard
                key={platform.key}
                platform={platform}
                companyId={activeCompany.id}
                connection={byPlatform.get(platform.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
