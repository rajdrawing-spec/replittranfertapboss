/**
 * TAPBOSS — Business Workspace (Hybrid Architecture)
 *
 * Two modes based on the platform's `browserWorkspace` flag:
 *
 * BROWSER WORKSPACE (Amazon, Google, Meta, Flipkart, etc.)
 *   Each company gets a dedicated server-side Chromium profile —
 *   completely isolated cookies, localStorage, and sessions.
 *   Staff interact with the live browser stream directly inside TAPBOSS.
 *   Switching companies reconnects to that company's isolated profile.
 *
 * API CONNECTION (Shopify, Shiprocket, Razorpay, etc.)
 *   OAuth credentials or API keys are stored per company in the DB.
 *   TAPBOSS makes API calls on behalf of the company to sync data.
 *   Clicking opens the platform's website in a new browser tab.
 */

import * as React from "react"
import {
  ExternalLink, LogOut, Loader2, Search, Monitor,
  ChevronDown, Globe, Link2, X as XIcon, CheckCircle2,
  Info, AlertCircle, RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { useCompany } from "@/contexts/company-context"
import { useCatalog } from "@/lib/integrations-api"
import type { CatalogPlatform } from "@/lib/integrations-api"
import { BrowserWorkspace } from "@/components/browser-workspace"

/* ──────────────────────────── Constants ─────────────────────────── */

const CATEGORY_ORDER = [
  "storefront", "marketplace", "ads", "social",
  "analytics", "logistics", "payments", "accounting", "messaging", "tools",
]
const CATEGORY_LABEL: Record<string, string> = {
  storefront:  "Storefronts",
  marketplace: "Marketplaces",
  ads:         "Advertising",
  social:      "Social Media",
  analytics:   "Analytics",
  logistics:   "Logistics & Shipping",
  shipping:    "Logistics & Shipping",
  payments:    "Payments",
  accounting:  "Accounting",
  messaging:   "Messaging",
  tools:       "Tools",
}

/* ──────────────────────────── PlatformIcon ──────────────────────── */

function PlatformIcon({
  platform, size = "md",
}: { platform: CatalogPlatform; size?: "sm" | "md" | "lg" }) {
  const [loaded, setLoaded] = React.useState(false)
  const [err, setErr] = React.useState(false)
  const fav = React.useMemo(() => {
    try {
      const domain = new URL(platform.url).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    } catch { return "" }
  }, [platform.url])

  const dim    = size === "sm" ? "w-8 h-8"   : size === "lg" ? "w-14 h-14" : "w-10 h-10"
  const imgDim = size === "sm" ? "w-4 h-4"   : size === "lg" ? "w-8 h-8"   : "w-5 h-5"

  return (
    <div className={`${dim} rounded-xl ${platform.logoColor} flex items-center justify-center shrink-0 relative overflow-hidden shadow-md`}>
      {fav && !err && (
        <img
          src={fav} alt={platform.name}
          className={`${imgDim} object-contain transition-opacity ${loaded ? "opacity-100" : "opacity-0"} absolute`}
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
        />
      )}
      <span
        className={`text-white font-bold select-none transition-opacity ${loaded && !err ? "opacity-0" : "opacity-100"}`}
        style={{ fontSize: size === "lg" ? 16 : size === "sm" ? 10 : 11 }}
      >
        {platform.logo}
      </span>
    </div>
  )
}

/* ──────────────────────────── TopBar ────────────────────────────── */

function TopBar({ companyName }: { companyName: string | null }) {
  const { user, logout } = useAuth()
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-white/8 bg-card/80 backdrop-blur-md shrink-0 z-30">
      <div className="flex items-center gap-3">
        <div className="bg-white rounded-lg p-0.5 shadow-sm shrink-0">
          <img src="/tapashub-logo.png" alt="TAPBOSS" className="w-7 h-7 object-contain" />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">TAPBOSS</div>
          <div className="text-[10px] text-muted-foreground leading-tight">Business Workspace</div>
        </div>
        {companyName && (
          <div className="ml-4 hidden sm:flex items-center gap-2 text-xs text-muted-foreground border-l border-white/10 pl-4">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-zinc-300 font-medium">{companyName}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block text-right mr-1">
          <div className="text-xs font-semibold leading-tight">{user?.name || "User"}</div>
          <div className="text-[10px] text-muted-foreground leading-tight capitalize">
            {user?.role?.replace(/_/g, " ") || ""}
          </div>
        </div>
        <Avatar className="w-8 h-8 ring-2 ring-white/10">
          <AvatarFallback className="text-xs font-bold bg-primary text-primary-foreground">
            {user?.name?.substring(0, 2)?.toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
        <Button
          variant="ghost" size="icon" aria-label="Sign out"
          className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
          onClick={() => logout()}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}

/* ──────────────────────────── PlatformRow ───────────────────────── */

function PlatformRow({
  platform, isSelected, onSelect,
}: {
  platform: CatalogPlatform
  isSelected: boolean
  onSelect: () => void
}) {
  const mode = platform.browserWorkspace ? "browser" : "api"

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all text-left ${
        isSelected
          ? "bg-primary/15 border border-primary/30"
          : "border border-transparent hover:bg-white/5 hover:border-white/8"
      }`}
    >
      <div className="relative shrink-0">
        <PlatformIcon platform={platform} size="sm" />
        {/* Mode indicator dot */}
        <span
          className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
            mode === "browser" ? "bg-violet-500" : "bg-sky-500"
          }`}
          title={mode === "browser" ? "Browser Workspace" : "API Integration"}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold leading-tight truncate">{platform.name}</div>
        <div className={`text-[9px] font-medium mt-0.5 flex items-center gap-1 ${
          isSelected ? "text-primary" : "text-zinc-600"
        }`}>
          {mode === "browser"
            ? <><Globe className="w-2.5 h-2.5" />Browser</>
            : <><Link2 className="w-2.5 h-2.5" />API</>
          }
        </div>
      </div>

      {isSelected && (
        <span className="text-[9px] text-primary font-semibold shrink-0">Open</span>
      )}
    </button>
  )
}

/* ──────────────────────────── Welcome panel ─────────────────────── */

function WelcomePanel({
  platforms,
  companyName,
  onSelect,
}: {
  platforms: CatalogPlatform[]
  companyName: string | null
  onSelect: (p: CatalogPlatform) => void
}) {
  const browserPlatforms = platforms.filter((p) => p.browserWorkspace)
  const apiPlatforms     = platforms.filter((p) => !p.browserWorkspace)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="space-y-2">
          <h2 className="text-xl font-bold">
            {companyName ? `${companyName} Workspace` : "Business Workspace"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select a platform from the sidebar. Browser platforms open with a dedicated,
            isolated profile. API platforms sync data automatically via stored credentials.
          </p>
        </div>

        {/* Architecture explainer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-violet-500/8 border border-violet-500/20 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Globe className="w-3.5 h-3.5 text-violet-400" />
              </div>
              <span className="text-sm font-semibold text-violet-300">Browser Workspace</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each company gets an isolated Chrome-like profile. Log in once — sessions
              persist. Switching companies loads a completely separate profile with
              different cookies and logins.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {browserPlatforms.slice(0, 6).map((p) => (
                <button
                  key={p.key}
                  onClick={() => onSelect(p)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-violet-500/15 border border-white/8 hover:border-violet-500/30 transition-all"
                >
                  <div className={`w-3 h-3 rounded ${p.logoColor} flex items-center justify-center shrink-0`}>
                    <span className="text-white font-bold" style={{ fontSize: 5 }}>{p.logo}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400">{p.shortName}</span>
                </button>
              ))}
              {browserPlatforms.length > 6 && (
                <span className="text-[10px] text-zinc-600 py-1">+{browserPlatforms.length - 6} more</span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-sky-500/8 border border-sky-500/20 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Link2 className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <span className="text-sm font-semibold text-sky-300">API Integration</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Platforms with full APIs are connected via OAuth or API keys stored per
              company. TAPBOSS syncs orders, inventory, and analytics automatically.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {apiPlatforms.slice(0, 6).map((p) => (
                <div key={p.key} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/8">
                  <div className={`w-3 h-3 rounded ${p.logoColor} flex items-center justify-center shrink-0`}>
                    <span className="text-white font-bold" style={{ fontSize: 5 }}>{p.logo}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400">{p.shortName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Company isolation — how it works
          </p>
          {[
            ["Each company → its own browser profile",
             "Company A's Amazon login never bleeds into Company B. Like Chrome Profiles, but managed centrally."],
            ["Staff only access their company",
             "Team members can only open workspaces for companies they're assigned to. Super Admin sees all."],
            ["Sessions persist until logout",
             "Close the workspace panel — your logins stay. Reopen and you're still logged in."],
            ["Switch companies instantly",
             "The active company selector at the top routes you to the right isolated profile automatically."],
          ].map(([title, desc]) => (
            <div key={title as string} className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-zinc-200">{title} — </span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────── ApiPlatformPanel ──────────────────── */

function ApiPlatformPanel({
  platform,
  onClose,
}: {
  platform: CatalogPlatform
  onClose: () => void
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <PlatformIcon platform={platform} size="lg" />
            <div>
              <h2 className="text-lg font-bold">{platform.name}</h2>
              <p className="text-xs text-muted-foreground">{platform.description}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Sync features */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Sync features
          </p>
          <div className="flex flex-wrap gap-2">
            {platform.syncFeatures.map((f) => (
              <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
            ))}
          </div>
        </div>

        {/* Quick links */}
        {platform.quickLinks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Quick links
            </p>
            <div className="flex flex-wrap gap-2">
              {platform.quickLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 hover:border-white/15 transition-all text-zinc-300 hover:text-white"
                >
                  <ExternalLink className="w-3 h-3" />
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 p-3.5 bg-sky-500/8 border border-sky-500/20 rounded-xl">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs text-sky-300/80 leading-relaxed space-y-1">
            <p>
              <strong>{platform.name}</strong> is connected via{" "}
              {platform.capabilities.oauth ? "OAuth" : "API key"}.
              Use the Integrations settings to add or manage credentials for each company.
            </p>
          </div>
        </div>

        <Button
          className="w-full gap-2"
          onClick={() => window.open(platform.url, "_blank", "noopener")}
        >
          <ExternalLink className="w-4 h-4" />
          Open {platform.name}
        </Button>
      </div>
    </div>
  )
}

/* ──────────────────────────── Main page ─────────────────────────── */

export default function Integrations() {
  const catalog = useCatalog()
  const platforms = catalog.data ?? []
  const { activeCompany } = useCompany()

  const [selectedPlatform, setSelectedPlatform] = React.useState<CatalogPlatform | null>(null)
  const [search, setSearch] = React.useState("")
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(new Set())

  // When company changes, close any open browser workspace
  // (will reconnect to new company's profile on next open).
  // Use a ref to avoid resetting the selection on the initial render/hydration,
  // which was causing integrations to appear not to load after a page reload.
  const prevCompanyIdRef = React.useRef<number | undefined>(undefined)
  React.useEffect(() => {
    const current = activeCompany?.id
    const previous = prevCompanyIdRef.current
    prevCompanyIdRef.current = current
    if (previous !== undefined && previous !== current && selectedPlatform?.browserWorkspace) {
      setSelectedPlatform(null)
    }
  }, [activeCompany?.id])

  /* ── Derived ── */

  const filteredPlatforms = React.useMemo(() => {
    if (!search.trim()) return platforms
    const q = search.toLowerCase()
    return platforms.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.shortName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    )
  }, [platforms, search])

  const grouped = React.useMemo(() => {
    const m = new Map<string, CatalogPlatform[]>()
    if (search.trim()) {
      m.set("results", filteredPlatforms)
      return m
    }
    for (const cat of CATEGORY_ORDER) {
      const ps = platforms.filter((p) => p.category === cat)
      if (ps.length > 0) m.set(cat, ps)
    }
    for (const p of platforms) {
      if (!CATEGORY_ORDER.includes(p.category)) {
        const arr = m.get(p.category) ?? []
        arr.push(p)
        m.set(p.category, arr)
      }
    }
    return m
  }, [platforms, filteredPlatforms, search])

  function toggleCat(cat: string) {
    setCollapsedCats((prev) => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  /* ── Render ── */

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <TopBar companyName={activeCompany?.name ?? null} />

      <div className="flex flex-1 overflow-hidden">
        {/* ════════════ Sidebar ════════════ */}
        <aside className="w-60 shrink-0 border-r border-white/8 bg-card/20 flex flex-col overflow-hidden">
          {/* Sidebar header */}
          <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs pl-7 bg-zinc-900/60 border-white/8 placeholder:text-zinc-600"
              />
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 px-1">
              <span className="flex items-center gap-1 text-[9px] text-zinc-600">
                <span className="w-2 h-2 rounded-full bg-violet-500" />Browser
              </span>
              <span className="flex items-center gap-1 text-[9px] text-zinc-600">
                <span className="w-2 h-2 rounded-full bg-sky-500" />API
              </span>
            </div>
          </div>

          {/* Platform list */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-4">
            {catalog.isLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
              </div>
            )}

            {Array.from(grouped.entries()).map(([cat, ps]) => {
              const collapsed = collapsedCats.has(cat)
              const label = search.trim()
                ? `${filteredPlatforms.length} result${filteredPlatforms.length !== 1 ? "s" : ""}`
                : (CATEGORY_LABEL[cat] ?? cat)

              return (
                <div key={cat} className="mb-1">
                  {!search.trim() && (
                    <button
                      onClick={() => toggleCat(cat)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-widest hover:text-zinc-400 transition-colors"
                    >
                      <span className="flex-1 text-left">{label}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                    </button>
                  )}
                  {search.trim() && (
                    <div className="px-2 py-1.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-widest">
                      {label}
                    </div>
                  )}
                  {!collapsed && ps.map((p) => (
                    <PlatformRow
                      key={p.key}
                      platform={p}
                      isSelected={selectedPlatform?.key === p.key}
                      onSelect={() => setSelectedPlatform(p)}
                    />
                  ))}
                </div>
              )
            })}

            {!catalog.isLoading && search.trim() && filteredPlatforms.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-6">
                No platforms match "{search}"
              </p>
            )}
          </div>
        </aside>

        {/* ════════════ Main panel ════════════ */}
        <main className="flex-1 overflow-hidden bg-zinc-950/50">
          {!selectedPlatform && (
            <WelcomePanel
              platforms={platforms}
              companyName={activeCompany?.name ?? null}
              onSelect={setSelectedPlatform}
            />
          )}

          {selectedPlatform?.browserWorkspace && activeCompany && (
            <BrowserWorkspace
              key={`${activeCompany.id}-${selectedPlatform.key}`}
              companyId={activeCompany.id}
              companyName={activeCompany.name}
              platform={selectedPlatform}
              onClose={() => setSelectedPlatform(null)}
            />
          )}

          {selectedPlatform?.browserWorkspace && !activeCompany && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">No company selected</p>
                <p className="text-xs text-muted-foreground">
                  Select a company from the top navigation to open the browser workspace.
                </p>
              </div>
            </div>
          )}

          {selectedPlatform && !selectedPlatform.browserWorkspace && (
            <ApiPlatformPanel
              platform={selectedPlatform}
              onClose={() => setSelectedPlatform(null)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
