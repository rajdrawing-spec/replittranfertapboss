import * as React from "react"
import { ExternalLink, Globe, Plug, PlugZap, RefreshCw, ToggleLeft, ToggleRight, ChevronDown, AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCompany } from "@/contexts/company-context"
import {
  getPlatformsForCompany,
  getIntegrationState,
  saveIntegrationState,
  type Platform,
  type IntegrationState,
} from "@/lib/platforms"

/* ─── Connect modal ─── */
function ConnectModal({ platform, companySlug, onDone }: { platform: Platform; companySlug: string; onDone: () => void }) {
  const [step, setStep] = React.useState<"idle" | "connecting" | "done">("idle")
  const current = getIntegrationState(companySlug, platform.id)

  function connect() {
    setStep("connecting")
    setTimeout(() => {
      const next: IntegrationState = {
        ...current,
        connected: true,
        lastSync: new Date().toLocaleString("en-IN"),
        autoSync: true,
      }
      saveIntegrationState(companySlug, platform.id, next)
      setStep("done")
      setTimeout(onDone, 800)
    }, 1800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDone} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
            {platform.logo}
          </div>
          <div>
            <div className="font-bold text-base">Connect {platform.name}</div>
            <div className={`text-xs px-2 py-0.5 rounded-full border font-medium inline-block mt-0.5 ${platform.colorClass.badge}`}>
              {platform.category}
            </div>
          </div>
        </div>

        {step === "idle" && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connecting will allow TAPBOSS to automatically sync your {platform.syncFeatures.join(", ")} data from {platform.name} into this workspace.
            </p>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1">
              {platform.syncFeatures.map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  Sync {f}
                </div>
              ))}
              {platform.syncFeatures.length === 0 && (
                <div className="text-xs text-muted-foreground">Direct portal access — no data sync available.</div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
              <Button className="flex-1" onClick={connect}>
                <Plug className="w-4 h-4 mr-1.5" /> Connect
              </Button>
            </div>
          </>
        )}
        {step === "connecting" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Establishing secure connection…</p>
          </div>
        )}
        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm font-medium text-green-400">Connected successfully!</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Sync toggle row ─── */
function SyncRow({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <button
        onClick={() => onChange(!enabled)}
        className={`flex items-center gap-1 text-xs font-medium transition-colors ${enabled ? "text-green-400" : "text-muted-foreground"}`}
      >
        {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
        {enabled ? "On" : "Off"}
      </button>
    </div>
  )
}

/* ─── Platform card ─── */
function PlatformCard({
  platform,
  companySlug,
  onStateChange,
}: {
  platform: Platform
  companySlug: string
  onStateChange: () => void
}) {
  const [state, setState] = React.useState<IntegrationState>(() =>
    getIntegrationState(companySlug, platform.id)
  )
  const [showModal, setShowModal] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)

  function save(next: IntegrationState) {
    saveIntegrationState(companySlug, platform.id, next)
    setState(next)
    onStateChange()
  }

  function disconnect() {
    save({ ...state, connected: false, lastSync: null, autoSync: false })
  }

  function syncNow() {
    setSyncing(true)
    setTimeout(() => {
      save({ ...state, lastSync: new Date().toLocaleString("en-IN") })
      setSyncing(false)
    }, 1400)
  }

  function toggle<K extends keyof IntegrationState>(key: K, val: IntegrationState[K]) {
    save({ ...state, [key]: val })
  }

  return (
    <>
      {showModal && (
        <ConnectModal
          platform={platform}
          companySlug={companySlug}
          onDone={() => {
            setShowModal(false)
            setState(getIntegrationState(companySlug, platform.id))
            onStateChange()
          }}
        />
      )}

      <Card className={`bg-gradient-to-br ${platform.colorClass.bg} border ${platform.colorClass.border} transition-all duration-300 hover:shadow-lg`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-xs shadow-lg shrink-0`}>
                {platform.logo}
              </div>
              <div>
                <CardTitle className="text-sm leading-tight">{platform.name}</CardTitle>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${platform.colorClass.badge}`}>
                  {platform.category}
                </span>
              </div>
            </div>

            {/* Status + external link */}
            <div className="flex items-center gap-1.5 shrink-0">
              {state.connected ? (
                <span className="flex items-center gap-1 text-[10px] text-green-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                  Disconnected
                </span>
              )}
              <a href={platform.url} target="_blank" rel="noopener noreferrer">
                <Button size="icon" variant="ghost" className="w-7 h-7 opacity-50 hover:opacity-100">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </a>
            </div>
          </div>

          {/* Last sync */}
          {state.connected && state.lastSync && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
              <Clock className="w-3 h-3" />
              Last sync: {state.lastSync}
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Primary action */}
          <div className="flex gap-2">
            {state.connected ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs border-white/10"
                  onClick={syncNow}
                  disabled={syncing}
                >
                  {syncing
                    ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />Syncing…</>
                    : <><RefreshCw className="w-3.5 h-3.5 mr-1" />Sync Now</>
                  }
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => setShowModal(true)}>
                <PlugZap className="w-3.5 h-3.5 mr-1.5" />
                Connect Account
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
              title="Settings"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {/* Expanded settings */}
          {expanded && (
            <div className="border-t border-white/10 pt-3 space-y-1">
              {state.connected && (
                <>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sync Settings</div>
                  {platform.syncFeatures.includes("Products") && (
                    <SyncRow label="Sync Products" enabled={state.syncProducts} onChange={v => toggle("syncProducts", v)} />
                  )}
                  {platform.syncFeatures.includes("Orders") && (
                    <SyncRow label="Sync Orders" enabled={state.syncOrders} onChange={v => toggle("syncOrders", v)} />
                  )}
                  {platform.syncFeatures.includes("Inventory") && (
                    <SyncRow label="Sync Inventory" enabled={state.syncInventory} onChange={v => toggle("syncInventory", v)} />
                  )}
                  {platform.syncFeatures.includes("Customers") && (
                    <SyncRow label="Sync Customers" enabled={state.syncCustomers} onChange={v => toggle("syncCustomers", v)} />
                  )}
                  {platform.syncFeatures.includes("Finance") && (
                    <SyncRow label="Sync Finance" enabled={state.syncFinance} onChange={v => toggle("syncFinance", v)} />
                  )}
                  <div className="border-t border-white/10 mt-2 pt-2">
                    <SyncRow label="Auto Sync (every 15 min)" enabled={state.autoSync} onChange={v => toggle("autoSync", v)} />
                  </div>
                </>
              )}

              {/* Quick links always shown in expanded */}
              <div className="mt-3">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Links</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {platform.quickLinks.map(link => (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-background/30 hover:bg-background/60 px-2.5 py-1.5 rounded-md transition-all border border-transparent hover:border-white/10"
                    >
                      <Globe className="w-3 h-3 shrink-0" />
                      {link.label}
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

/* ─── Main page ─── */
export default function Integrations() {
  const { activeCompany, isParentView } = useCompany()
  const companySlug = activeCompany?.slug ?? "tapashub"
  const platforms = getPlatformsForCompany(companySlug)

  // re-render when state changes
  const [tick, setTick] = React.useState(0)
  const refresh = () => setTick(t => t + 1)

  const connectedPlatforms = platforms.filter(
    p => getIntegrationState(companySlug, p.id).connected
  )

  // group by category
  const byCategory = platforms.reduce<Record<string, Platform[]>>((acc, p) => {
    ;(acc[p.category] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isParentView ? "Group Integrations" : `${activeCompany?.name} Integrations`}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isParentView
              ? "Compliance and accounting platforms for TapasHub Holdings"
              : `Connect sales channels, payment gateways and marketing platforms for ${activeCompany?.name}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{connectedPlatforms.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Connected</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-2xl font-bold">{platforms.length - connectedPlatforms.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Available</div>
          </div>
        </div>
      </div>

      {/* Connected pill strip */}
      {connectedPlatforms.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">Live:</span>
          {connectedPlatforms.map(p => (
            <span
              key={p.id}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${p.colorClass.pill}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {p.shortName}
            </span>
          ))}
        </div>
      )}

      {/* Parent view info banner */}
      {isParentView && (
        <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-blue-300">Viewing TapasHub Holdings</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Switch to a subsidiary workspace to manage that company's sales channels, social media, and payment integrations. Each company maintains its own separate connections.
            </p>
          </div>
        </div>
      )}

      {/* Platform cards grouped by category */}
      {Object.entries(byCategory).map(([cat, ps]) => (
        <div key={cat} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{cat}</h2>
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{ps.length} platform{ps.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {ps.map(platform => (
              <PlatformCard
                key={`${companySlug}-${platform.id}-${tick}`}
                platform={platform}
                companySlug={companySlug}
                onStateChange={refresh}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
