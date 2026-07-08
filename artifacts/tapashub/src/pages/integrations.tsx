import * as React from "react"
import {
  ExternalLink, RefreshCw, PlugZap, Eye, EyeOff, ShieldAlert,
  CheckCircle2, XCircle, Clock, AlertCircle, Loader2, History,
  Settings2, LogOut, ChevronDown, Globe,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/auth-context"
import { useCompany } from "@/contexts/company-context"
import type { ActiveCompany } from "@/contexts/company-context"
import {
  useCatalog, useConnections, useConnect, useSaveCredentials,
  useRetestConnection, useDisconnect, useUpdateConnection,
  useSyncNow, useSyncHistory, useErrorLogs,
} from "@/lib/integrations-api"
import type { CatalogPlatform, Connection, AuthType } from "@/lib/integrations-api"

/* ── helpers ── */

function fmtDate(s: string | null | undefined) {
  if (!s) return "—"
  const d = new Date(s)
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

const STATUS_META: Record<Connection["status"], { label: string; dot: string; text: string; ring: string }> = {
  connected:    { label: "Live",         dot: "bg-green-500",  text: "text-green-400",  ring: "ring-green-500/40" },
  pending:      { label: "Pending",      dot: "bg-amber-400",  text: "text-amber-400",  ring: "ring-amber-400/40" },
  error:        { label: "Error",        dot: "bg-red-500",    text: "text-red-400",    ring: "ring-red-500/40"   },
  disconnected: { label: "Disconnected", dot: "bg-zinc-600",   text: "text-zinc-500",   ring: "ring-zinc-600/30"  },
}

const CATEGORY_ORDER = ["storefront", "marketplace", "social", "ads", "analytics", "payments", "shipping", "accounting", "messaging"]
const CATEGORY_LABEL: Record<string, string> = {
  storefront: "Storefronts", marketplace: "Marketplaces", social: "Social", ads: "Advertising",
  analytics: "Analytics", payments: "Payments", shipping: "Logistics", accounting: "Accounting", messaging: "Messaging",
}

function openPortalWindow(platform: CatalogPlatform, companyId: number) {
  window.open(platform.url, `tapashub-portal-${platform.key}-c${companyId}`, "width=1400,height=900,noopener,noreferrer")
}

/* ── Credential form (per-company, inside panel) ── */

function CredentialForm({
  platform, company, connectionId, onSaved,
}: {
  platform: CatalogPlatform
  company: ActiveCompany
  connectionId: number | null
  onSaved: (conn: Connection) => void
}) {
  const { toast } = useToast()
  const connect = useConnect()
  const save = useSaveCredentials()
  const [fields, setFields] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(platform.secretKeys.map((k) => [k, ""]))
  )
  const [show, setShow] = React.useState<Record<string, boolean>>({})
  const ok = platform.secretKeys.every((k) => fields[k]?.trim())
  const busy = connect.isPending || save.isPending

  async function submit() {
    const creds = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
    try {
      const conn = connectionId
        ? await save.mutateAsync({ id: connectionId, credentials: creds })
        : await connect.mutateAsync({ companyId: company.id, platformKey: platform.key, authType: "api_key", credentials: creds })
      onSaved(conn)
      toast({ title: conn.status === "connected" ? "Connected!" : "Credentials saved", description: conn.status === "connected" ? `${platform.name} is now live for ${company.name}.` : (conn.lastError ?? "Saved.") })
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message ?? "Could not save", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
        <ShieldAlert className="w-3.5 h-3.5" /> Enter {platform.name} credentials for {company.name}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Encrypted with AES-256. Stored per-company and never shared.
      </p>
      {platform.secretKeys.map((key) => (
        <div key={key} className="space-y-1">
          <Label className="text-[11px] font-mono text-muted-foreground">{key}</Label>
          <div className="relative">
            <Input
              type={show[key] ? "text" : "password"}
              placeholder={`Enter ${key}`}
              value={fields[key] ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
              className="h-8 text-xs font-mono pr-8 bg-background/60"
            />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}>
              {show[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      ))}
      <Button size="sm" className="w-full gap-1.5" disabled={!ok || busy} onClick={submit}>
        {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Verifying…</> : <><PlugZap className="w-3.5 h-3.5" />Connect & Verify</>}
      </Button>
    </div>
  )
}

/* ── Activity drawer ── */

function ActivityDrawer({ connection, platform, onClose }: { connection: Connection; platform: CatalogPlatform; onClose: () => void }) {
  const [tab, setTab] = React.useState<"history" | "errors">("history")
  const history = useSyncHistory(connection.id)
  const errors = useErrorLogs(connection.id)

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto z-10">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${platform.logoColor} flex items-center justify-center text-white font-bold text-xs shrink-0`}>{platform.logo}</div>
          <div className="font-semibold">{platform.name} — Activity</div>
          <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClose}><XCircle className="w-5 h-5" /></button>
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
      </div>
    </div>
  )
}

/* ── Portal side panel (multi-company) ── */

function WorkspacePanel({
  platform, companies, connByCompany, onClose, onConnect,
}: {
  platform: CatalogPlatform
  companies: ActiveCompany[]
  connByCompany: Map<number, Connection>
  onClose: () => void
  onConnect: (companyId: number, conn: Connection) => void
}) {
  const { toast } = useToast()
  const sync = useSyncNow()
  const retest = useRetestConnection()
  const disconnect = useDisconnect()
  const update = useUpdateConnection()

  const [selId, setSelId] = React.useState<number>(() => {
    const first = companies.find((c) => connByCompany.get(c.id)?.status === "connected")
    return first?.id ?? companies[0]?.id ?? 0
  })
  const [showActivity, setShowActivity] = React.useState(false)
  const [showCred, setShowCred] = React.useState(false)

  const selCompany = companies.find((c) => c.id === selId)
  const conn = selId ? connByCompany.get(selId) : undefined
  const isLive = conn?.status === "connected"
  const history = useSyncHistory(conn?.id ?? null)
  const recentRuns = (history.data ?? []).slice(0, 3)

  React.useEffect(() => { setShowCred(false) }, [selId])

  function handleSync() {
    if (!conn) return
    sync.mutate(conn.id, {
      onSuccess: (d) => toast({ title: "Sync complete", description: d.result.message }),
      onError: (e: any) => toast({ title: "Sync failed", description: e?.message, variant: "destructive" }),
    })
  }

  function handleDisconnect() {
    if (!conn) return
    disconnect.mutate(conn.id, {
      onSuccess: () => toast({ title: "Disconnected", description: `${platform.name} disconnected from ${selCompany?.name}.` }),
    })
  }

  if (showActivity && conn && selCompany) {
    return <ActivityDrawer connection={conn} platform={platform} onClose={() => setShowActivity(false)} />
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-4 top-20 z-50 w-80 bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col shadow-2xl animate-in slide-in-from-right-4 fade-in duration-200 max-h-[calc(100vh-6rem)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10 shrink-0">
          <div className={`w-9 h-9 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-xs shadow-lg shrink-0`}>
            {platform.logo}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{platform.name}</div>
            <div className="text-[10px] text-muted-foreground capitalize">{platform.category}</div>
          </div>
          <button className="text-muted-foreground hover:text-foreground transition-colors shrink-0" onClick={onClose}>
            <XCircle className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Company tabs */}
        <div className="flex gap-1 px-3 pt-3 pb-1 shrink-0 overflow-x-auto scrollbar-none">
          {companies.map((c) => {
            const co = connByCompany.get(c.id)
            const st = co?.status ?? "disconnected"
            const meta = STATUS_META[st]
            const active = selId === c.id
            return (
              <button
                key={c.id}
                onClick={() => setSelId(c.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 border ${
                  active
                    ? "bg-white/10 border-white/20 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                {c.name.length > 8 ? c.name.split(" ")[0] : c.name}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Status banner */}
          {conn ? (
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs border ${
              isLive ? "bg-green-500/8 border-green-500/20 text-green-300"
              : conn.status === "error" ? "bg-red-500/8 border-red-500/20 text-red-300"
              : "bg-amber-500/8 border-amber-500/20 text-amber-300"
            }`}>
              {isLive ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : conn.status === "error" ? <XCircle className="w-3.5 h-3.5 shrink-0" /> : <Clock className="w-3.5 h-3.5 shrink-0" />}
              <span className="flex-1">{isLive ? `Connected · ${selCompany?.name}` : (conn.lastError ?? STATUS_META[conn.status].label)}</span>
              <button className="underline opacity-60 hover:opacity-100 shrink-0" onClick={() => retest.mutate(conn!.id)} disabled={retest.isPending}>
                {retest.isPending ? "Testing…" : "Re-test"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs border border-white/8 bg-white/3 text-muted-foreground">
              <Globe className="w-3.5 h-3.5 shrink-0" />
              {selCompany?.name} is not connected to {platform.name}
            </div>
          )}

          {/* Connect form toggle */}
          {(!conn || conn.status !== "connected") && platform.secretKeys.length > 0 && (
            <div>
              <button
                onClick={() => setShowCred((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
              >
                <PlugZap className="w-3.5 h-3.5" />
                {conn ? "Update credentials" : `Connect ${selCompany?.name}`}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCred ? "rotate-180" : ""}`} />
              </button>
              {showCred && selCompany && (
                <div className="mt-3 p-3 bg-background/50 rounded-xl border border-white/8 space-y-3">
                  <CredentialForm
                    platform={platform}
                    company={selCompany}
                    connectionId={conn?.id ?? null}
                    onSaved={(c) => { onConnect(selCompany.id, c); setShowCred(false) }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Open portal CTA */}
          {isLive && (
            <Button className="w-full h-9 gap-2 font-semibold" onClick={() => openPortalWindow(platform, selId)}>
              <ExternalLink className="w-4 h-4" />
              Open {platform.name}
            </Button>
          )}

          {/* Quick links */}
          {platform.quickLinks.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Quick Links</div>
              <div className="grid grid-cols-2 gap-1.5">
                {platform.quickLinks.map((link) => (
                  <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-background/40 hover:bg-background/70 px-2.5 py-2 rounded-lg transition-all border border-white/5 hover:border-white/15">
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />{link.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Sync status */}
          {isLive && conn && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sync</div>
              <div className="bg-background/40 rounded-xl border border-white/5 divide-y divide-white/5 text-xs">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-muted-foreground">Last synced</span>
                  <span>{fmtDate(conn.lastSyncAt)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-muted-foreground">Auto sync</span>
                  <Switch checked={conn.autoSync} onCheckedChange={(v) => update.mutate({ id: conn!.id, autoSync: v })} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1.5 border-white/10" disabled={sync.isPending} onClick={handleSync}>
                  {sync.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Syncing…</> : <><RefreshCw className="w-3.5 h-3.5" />Sync now</>}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2.5 text-muted-foreground" onClick={() => setShowActivity(true)}>
                  <History className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Recent runs */}
          {recentRuns.length > 0 && (
            <div className="space-y-1.5">
              {recentRuns.map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-xs bg-background/30 rounded-lg px-2.5 py-2 border border-white/5">
                  {h.status === "success" ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> : h.status === "failed" ? <XCircle className="w-3 h-3 text-red-500 shrink-0" /> : <Clock className="w-3 h-3 text-muted-foreground shrink-0" />}
                  <span className="flex-1 truncate capitalize">{h.status}{h.recordsSynced > 0 ? ` · ${h.recordsSynced}` : ""}</span>
                  <span className="text-muted-foreground text-[10px] shrink-0">{fmtDate(h.createdAt)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Settings (for connected) */}
          {isLive && conn && platform.syncFeatures.length > 0 && (
            <details className="group">
              <summary className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer list-none">
                <Settings2 className="w-3.5 h-3.5" />
                Sync settings
                <ChevronDown className="w-3.5 h-3.5 ml-auto group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-2 space-y-1.5">
                {platform.syncFeatures.map((f) => (
                  <div key={f} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{f}</span>
                    <Switch checked={conn.syncSettings?.[f] ?? true} onCheckedChange={(v) => update.mutate({ id: conn!.id, syncSettings: { ...conn!.syncSettings, [f]: v } })} />
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Disconnect */}
          {conn && conn.status !== "disconnected" && (
            <button onClick={handleDisconnect} disabled={disconnect.isPending} className="w-full text-xs text-muted-foreground hover:text-red-400 transition-colors text-left py-1">
              {disconnect.isPending ? "Disconnecting…" : `Disconnect ${selCompany?.name}`}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/* ── Platform card ── */

function PlatformCard({
  platform, companies, connByCompany, onClick,
}: {
  platform: CatalogPlatform
  companies: ActiveCompany[]
  connByCompany: Map<number, Connection>
  onClick: () => void
}) {
  const liveCount = companies.filter((c) => connByCompany.get(c.id)?.status === "connected").length
  const anyConnected = liveCount > 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left group bg-card/50 hover:bg-card/80 border rounded-2xl p-4 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${
        anyConnected ? "border-white/15 hover:border-white/25" : "border-white/8 hover:border-white/15"
      }`}
    >
      {/* Top row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-sm shadow-lg shrink-0`}>
          {platform.logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight truncate">{platform.name}</div>
          <div className="text-[10px] text-muted-foreground capitalize mt-0.5">{platform.category}</div>
        </div>
        {anyConnected && (
          <span className="text-[10px] font-medium text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full shrink-0">
            {liveCount}/{companies.length}
          </span>
        )}
      </div>

      {/* Company status dots */}
      <div className="flex items-center gap-2 flex-wrap">
        {companies.map((c) => {
          const co = connByCompany.get(c.id)
          const st = co?.status ?? "disconnected"
          const meta = STATUS_META[st]
          return (
            <div key={c.id} className="flex items-center gap-1.5" title={`${c.name}: ${meta.label}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${st === "disconnected" ? "bg-transparent border border-zinc-600" : meta.dot}`} />
              <span className={`text-[10px] font-medium ${st === "disconnected" ? "text-zinc-600" : meta.text}`}>
                {c.name.split(" ")[0]}
              </span>
            </div>
          )
        })}
      </div>
    </button>
  )
}

/* ── Minimal top bar ── */

function IntegrationsTopBar() {
  const { user: authUser, logout } = useAuth()
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-white/8 bg-card/80 backdrop-blur-md shrink-0 z-30">
      <div className="flex items-center gap-2.5">
        <div className="bg-white rounded-lg p-0.5 shadow-sm shrink-0">
          <img src="/tapashub-logo.png" alt="TAPBOSS" className="w-7 h-7 object-contain" />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">TAPBOSS</div>
          <div className="text-[10px] text-muted-foreground leading-tight">Platform Integrations</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block text-right mr-1">
          <div className="text-xs font-semibold leading-tight">{authUser?.name || "User"}</div>
          <div className="text-[10px] text-muted-foreground leading-tight capitalize">{authUser?.role?.replace(/_/g, " ") || ""}</div>
        </div>
        <Avatar className="w-8 h-8 ring-2 ring-white/10">
          <AvatarFallback className="text-xs font-bold bg-primary text-primary-foreground">
            {authUser?.name?.substring(0, 2)?.toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10" onClick={() => logout()} title="Sign out">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}

/* ── Main page ── */

export default function Integrations() {
  const { companies } = useCompany()
  const catalog = useCatalog()
  const allConnections = useConnections(null)

  // Only subsidiaries matter for integrations
  const subsidiaries = React.useMemo(
    () => companies.filter((c) => c.mode === "subsidiary"),
    [companies]
  )

  // Map: platformKey → Map<companyId, Connection>
  const connMap = React.useMemo(() => {
    const m = new Map<string, Map<number, Connection>>()
    for (const conn of allConnections.data ?? []) {
      if (!m.has(conn.platformKey)) m.set(conn.platformKey, new Map())
      m.get(conn.platformKey)!.set(conn.companyId, conn)
    }
    return m
  }, [allConnections.data])

  const [openPlatformKey, setOpenPlatformKey] = React.useState<string | null>(null)
  const openPlatform = catalog.data?.find((p) => p.key === openPlatformKey)

  // Handle a newly saved connection coming back from the panel
  function handleConnect(_companyId: number, _conn: Connection) {
    // react-query invalidation via useSaveCredentials/useConnect handles refetch
  }

  const platforms = catalog.data ?? []
  const totalConnected = (allConnections.data ?? []).filter((c) => c.status === "connected").length
  const totalPlatforms = platforms.length

  // Group by category in order
  const byCategory = React.useMemo(() => {
    const m = new Map<string, CatalogPlatform[]>()
    for (const cat of CATEGORY_ORDER) {
      const ps = platforms.filter((p) => p.category === cat)
      if (ps.length > 0) m.set(cat, ps)
    }
    // Add any uncategorised ones at end
    for (const p of platforms) {
      if (!CATEGORY_ORDER.includes(p.category)) {
        const arr = m.get(p.category) ?? []
        arr.push(p)
        m.set(p.category, arr)
      }
    }
    return m
  }, [platforms])

  const isLoading = catalog.isLoading || allConnections.isLoading

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <IntegrationsTopBar />

      {/* Stats bar */}
      <div className="border-b border-white/8 bg-card/30 px-6 py-3 flex items-center gap-6 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl font-bold text-green-400">{totalConnected}</span>
          <span className="text-muted-foreground text-xs">live connections</span>
        </div>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl font-bold">{totalPlatforms}</span>
          <span className="text-muted-foreground text-xs">platforms</span>
        </div>
        <div className="w-px h-5 bg-white/10" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl font-bold">{subsidiaries.length}</span>
          <span className="text-muted-foreground text-xs">businesses</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {subsidiaries.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: c.color ?? "#64748B" }} />
              <span className="text-[11px] text-muted-foreground hidden sm:block">{c.name.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-8">

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading platforms…
            </div>
          )}

          {catalog.isError && (
            <div className="text-sm text-red-400 py-8 text-center">Failed to load platforms.</div>
          )}

          {!isLoading && subsidiaries.length === 0 && (
            <div className="py-16 text-center space-y-2">
              <div className="text-muted-foreground text-sm">No subsidiary companies found.</div>
              <div className="text-xs text-muted-foreground/60">Add subsidiary companies in the main dashboard first.</div>
            </div>
          )}

          {Array.from(byCategory.entries()).map(([cat, ps]) => (
            <section key={cat}>
              {/* Category header */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {CATEGORY_LABEL[cat] ?? cat}
                </h2>
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-[10px] text-muted-foreground/50">{ps.length}</span>
              </div>

              {/* Platform grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {ps.map((platform) => (
                  <PlatformCard
                    key={platform.key}
                    platform={platform}
                    companies={subsidiaries}
                    connByCompany={connMap.get(platform.key) ?? new Map()}
                    onClick={() => setOpenPlatformKey(platform.key)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* Side panel */}
      {openPlatformKey && openPlatform && (
        <WorkspacePanel
          platform={openPlatform}
          companies={subsidiaries}
          connByCompany={connMap.get(openPlatformKey) ?? new Map()}
          onClose={() => setOpenPlatformKey(null)}
          onConnect={handleConnect}
        />
      )}
    </div>
  )
}
