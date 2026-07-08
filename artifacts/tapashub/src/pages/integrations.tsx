/**
 * TAPBOSS — Business Workspace
 *
 * Architecture: managed popup windows (not iframes).
 *
 * WHY POPUPS NOT IFRAMES:
 *   Every major platform (Google, Amazon, Shopify, Facebook, etc.) sets
 *   X-Frame-Options: SAMEORIGIN or CSP frame-ancestors: 'self', which is a
 *   browser security feature that cannot be bypassed in a web app.
 *   Popups open in a real browser window — no framing restrictions, cookies
 *   set normally, sessions persist identically to a regular browser tab.
 *
 * HOW SESSIONS PERSIST:
 *   When the user logs in to Shopify inside the popup, Shopify sets a cookie
 *   in the browser for `admin.shopify.com`. That cookie survives TAPBOSS
 *   page refreshes, browser restarts (if not ephemeral/incognito), and
 *   even closing the popup — it is a normal browser cookie stored by the OS.
 *   Next time the user clicks Open for Shopify, the popup opens and they are
 *   already logged in. The only way to lose the session is to click Logout
 *   (which clears the TAPBOSS flag and closes/refocuses to the logout URL),
 *   or for the platform itself to expire the cookie.
 *
 * POPUP TRACKING:
 *   We keep a Map<key, Window> in a ref (not state) so it never triggers
 *   re-renders. A 1-second interval polls `window.closed` on each tracked
 *   popup and syncs that into React state for the sidebar indicators.
 */

import * as React from "react"
import {
  ExternalLink, LogOut, Loader2, Search, Monitor, Wifi,
  ChevronDown, LayoutGrid, RefreshCw, Info, CheckCircle2,
  X as XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { useCatalog } from "@/lib/integrations-api"
import type { CatalogPlatform } from "@/lib/integrations-api"

/* ─────────────────────────── constants ──────────────────────── */

const CATEGORY_ORDER = [
  "storefront", "marketplace", "advertising", "social", "logistics",
  "payments", "analytics", "tools",
]
const CATEGORY_LABEL: Record<string, string> = {
  storefront: "Storefronts",
  marketplace: "Marketplaces",
  advertising: "Advertising",
  social: "Social Media",
  logistics: "Logistics & Shipping",
  payments: "Payments",
  analytics: "Analytics",
  tools: "Tools",
}

const POPUP_SPEC = "width=1400,height=900,left=60,top=60,noopener,noreferrer"
const SESSION_KEY = "tapboss-ws-sessions-v3"

/* ─────────────────────────── helpers ─────────────────────────── */

function useLocalStorage<T>(
  key: string,
  init: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = React.useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch {
      return init
    }
  })
  const set: React.Dispatch<React.SetStateAction<T>> = React.useCallback(
    (action) =>
      setVal((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: T) => T)(prev)
            : action
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {}
        return next
      }),
    [key],
  )
  return [val, set]
}

function faviconUrl(siteUrl: string): string {
  try {
    const domain = new URL(siteUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch {
    return ""
  }
}

/* ─────────────────────────── PlatformIcon ───────────────────── */

function PlatformIcon({
  platform,
  size = "md",
}: {
  platform: CatalogPlatform
  size?: "sm" | "md" | "lg"
}) {
  const [loaded, setLoaded] = React.useState(false)
  const [err, setErr] = React.useState(false)
  const fav = React.useMemo(() => faviconUrl(platform.url), [platform.url])
  const dim =
    size === "sm" ? "w-8 h-8" : size === "lg" ? "w-14 h-14" : "w-10 h-10"
  const imgDim =
    size === "sm" ? "w-4 h-4" : size === "lg" ? "w-8 h-8" : "w-5 h-5"

  return (
    <div
      className={`${dim} rounded-xl ${platform.logoColor} flex items-center justify-center shrink-0 relative overflow-hidden shadow-md`}
    >
      {fav && !err && (
        <img
          src={fav}
          alt={platform.name}
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

/* ─────────────────────────── TopBar ─────────────────────────── */

function TopBar({
  connectedCount,
  totalCount,
  openCount,
}: {
  connectedCount: number
  totalCount: number
  openCount: number
}) {
  const { user, logout } = useAuth()
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-white/8 bg-card/80 backdrop-blur-md shrink-0 z-30">
      <div className="flex items-center gap-3">
        <div className="bg-white rounded-lg p-0.5 shadow-sm shrink-0">
          <img
            src="/tapashub-logo.png"
            alt="TAPBOSS"
            className="w-7 h-7 object-contain"
          />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">TAPBOSS</div>
          <div className="text-[10px] text-muted-foreground leading-tight">
            Business Workspace
          </div>
        </div>
        <div className="ml-4 hidden sm:flex items-center gap-3 text-xs text-muted-foreground border-l border-white/10 pl-4">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${connectedCount > 0 ? "bg-green-500" : "bg-zinc-600"}`}
            />
            {connectedCount} connected
          </span>
          {openCount > 0 && (
            <span className="flex items-center gap-1.5 text-blue-400">
              <LayoutGrid className="w-3 h-3" />
              {openCount} open
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block text-right mr-1">
          <div className="text-xs font-semibold leading-tight">
            {user?.name || "User"}
          </div>
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
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
          onClick={() => logout()}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}

/* ─────────────────────────── Sidebar row ──────────────────────── */

function PlatformRow({
  platform,
  connected,
  windowOpen,
  onOpen,
  onLogout,
}: {
  platform: CatalogPlatform
  connected: boolean
  windowOpen: boolean
  onOpen: () => void
  onLogout: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all group ${
        windowOpen
          ? "bg-blue-500/10 border border-blue-500/20"
          : connected
          ? "bg-green-500/5 border border-green-500/10"
          : "border border-transparent hover:bg-white/5"
      }`}
    >
      {/* Click name/icon area to open */}
      <button
        onClick={onOpen}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        aria-label={`Open ${platform.name}`}
      >
        <div className="relative shrink-0">
          <PlatformIcon platform={platform} size="sm" />
          {windowOpen && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-background" />
          )}
          {!windowOpen && connected && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-tight truncate">
            {platform.name}
          </div>
          <div
            className={`text-[9px] font-medium mt-0.5 ${
              windowOpen ? "text-blue-400" : connected ? "text-green-400" : "text-zinc-600"
            }`}
          >
            {windowOpen ? "Open ↗" : connected ? "Session active" : "Not connected"}
          </div>
        </div>
      </button>

      {/* Logout — separate button, only when connected */}
      {connected ? (
        <button
          aria-label={`Logout from ${platform.name}`}
          onClick={onLogout}
          className="text-[9px] text-muted-foreground hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-all font-medium opacity-0 group-hover:opacity-100 shrink-0"
        >
          Logout
        </button>
      ) : (
        <span className="text-[9px] text-primary border border-primary/30 px-1.5 py-0.5 rounded font-medium shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Open
        </span>
      )}
    </div>
  )
}

/* ─────────────────────────── Workspace panel ─────────────────── */

function SessionCard({
  platform,
  windowOpen,
  onFocus,
  onLogout,
}: {
  platform: CatalogPlatform
  windowOpen: boolean
  onFocus: () => void
  onLogout: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/4 border border-white/8 hover:border-white/15 transition-all group">
      <div className="relative shrink-0">
        <PlatformIcon platform={platform} size="md" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
            windowOpen ? "bg-blue-500" : "bg-green-500"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{platform.name}</div>
        <div
          className={`text-xs mt-0.5 ${
            windowOpen ? "text-blue-400" : "text-green-400"
          }`}
        >
          {windowOpen ? "Window open" : "Session active"}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant={windowOpen ? "default" : "secondary"}
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={onFocus}
        >
          <ExternalLink className="w-3 h-3" />
          {windowOpen ? "Focus" : "Open"}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={`Logout from ${platform.name}`}
          onClick={onLogout}
        >
          <XIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}

function WorkspacePanel({
  platforms,
  sessions,
  windowStates,
  onOpen,
  onLogout,
}: {
  platforms: CatalogPlatform[]
  sessions: Record<string, boolean>
  windowStates: Record<string, boolean>
  onOpen: (p: CatalogPlatform) => void
  onLogout: (key: string) => void
}) {
  const connected = platforms.filter((p) => sessions[p.key])
  const disconnected = platforms.filter((p) => !sessions[p.key])

  if (connected.length === 0) {
    // Empty state — guide the user
    return (
      <div className="flex flex-col items-center justify-center h-full gap-8 px-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
          <Monitor className="w-7 h-7 text-zinc-600" />
        </div>
        <div className="space-y-2 max-w-md">
          <h3 className="text-xl font-bold">Business Workspace</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Click any platform on the left to open it in a popup window.
            Log in once — your session stays active in the browser until the
            platform expires it or you click Logout.
          </p>
        </div>

        {/* How it works */}
        <div className="w-full max-w-md bg-white/3 border border-white/8 rounded-2xl p-4 text-left space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            How sessions work
          </p>
          {[
            ["Click any platform", "A popup window opens with the official login page."],
            ["Log in normally", "Use your username + password, Google SSO, or 2FA — exactly like a browser tab."],
            ["Close the popup", "Your session cookie is saved in the browser. TAPBOSS marks you as connected."],
            ["Next visit", "Click the platform again — you're already logged in. No password needed."],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-zinc-200">{title} — </span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Quick-launch grid */}
        <div className="grid grid-cols-5 gap-2 max-w-md">
          {disconnected.slice(0, 10).map((p) => (
            <button
              key={p.key}
              onClick={() => onOpen(p)}
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
            >
              <PlatformIcon platform={p} size="sm" />
              <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate w-full text-center">
                {p.shortName}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        {/* Active sessions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300">
              Active sessions
            </h2>
            <Badge variant="secondary" className="text-xs">
              {connected.length} connected
            </Badge>
          </div>
          <div className="space-y-2">
            {connected.map((p) => (
              <SessionCard
                key={p.key}
                platform={p}
                windowOpen={!!windowStates[p.key]}
                onFocus={() => onOpen(p)}
                onLogout={() => onLogout(p.key)}
              />
            ))}
          </div>
        </section>

        {/* Session info card */}
        <div className="flex gap-3 p-3.5 bg-blue-500/8 border border-blue-500/20 rounded-xl">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300/80 leading-relaxed">
            Sessions are stored as cookies in your browser — they survive
            page refreshes and browser restarts. A green dot means you've
            logged in before; a blue dot means the window is currently open.
            Click <strong>Focus</strong> to bring an open window to the front,
            or <strong>Open</strong> to relaunch a closed session.
          </p>
        </div>

        {/* Not-yet-connected */}
        {disconnected.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 mb-3">
              More platforms
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {disconnected.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onOpen(p)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                >
                  <PlatformIcon platform={p} size="sm" />
                  <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate w-full text-center">
                    {p.shortName}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── Main page ────────────────────────── */

export default function Integrations() {
  const catalog = useCatalog()
  const platforms = catalog.data ?? []

  // "Connected" = user has logged in at least once (session cookie in browser)
  const [sessions, setSessions] = useLocalStorage<Record<string, boolean>>(
    SESSION_KEY,
    {},
  )

  // Track which popup windows are currently open (for the blue "Open ↗" indicator)
  // Stored in a ref (Map) so window-handle comparisons don't trigger renders.
  const popupRefs = React.useRef<Map<string, Window>>(new Map())
  const [windowStates, setWindowStates] = React.useState<
    Record<string, boolean>
  >({})

  // Poll every 1 s to sync popup open/closed state into React state.
  // Only include windows that are still open in `next` so that closing the
  // last popup immediately produces an empty object (key-count 1 → 0).
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const next: Record<string, boolean> = {}
      popupRefs.current.forEach((win, key) => {
        if (!win.closed) {
          next[key] = true
        } else {
          popupRefs.current.delete(key)
        }
      })
      // Only trigger a re-render when the set of open windows actually changed.
      const prevKeys = Object.keys(windowStates).sort().join(",")
      const nextKeys = Object.keys(next).sort().join(",")
      if (prevKeys !== nextKeys) setWindowStates(next)
    }, 1000)
    return () => window.clearInterval(id)
  }, [windowStates])

  // Sidebar state
  const [search, setSearch] = React.useState("")
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(
    new Set(),
  )

  /* ── Derived ── */
  const connectedCount = platforms.filter((p) => sessions[p.key]).length
  const openCount = Object.values(windowStates).filter(Boolean).length

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

  /* ── Popup actions ── */

  function openPlatform(platform: CatalogPlatform) {
    const existing = popupRefs.current.get(platform.key)
    if (existing && !existing.closed) {
      // Window already open — bring it to the front
      existing.focus()
      return
    }
    // Open new popup
    const popup = window.open(
      platform.url,
      `tapboss-${platform.key}`,
      POPUP_SPEC,
    )
    if (popup) {
      popupRefs.current.set(platform.key, popup)
      setWindowStates((prev) => ({ ...prev, [platform.key]: true }))
      setSessions((prev) => ({ ...prev, [platform.key]: true }))
    } else {
      // Popup was blocked by the browser — fall back to a new tab.
      // Capture the handle so focus/close tracking still works if the browser
      // returns a Window object (some browsers do even for tabs).
      const tab = window.open(platform.url, `tapboss-${platform.key}`)
      if (tab) {
        popupRefs.current.set(platform.key, tab)
        setWindowStates((prev) => ({ ...prev, [platform.key]: true }))
      }
      // Mark connected regardless — the user will log in there.
      setSessions((prev) => ({ ...prev, [platform.key]: true }))
    }
  }

  function handleLogout(platformKey: string) {
    // Close the popup if open
    const win = popupRefs.current.get(platformKey)
    if (win && !win.closed) {
      win.close()
    }
    popupRefs.current.delete(platformKey)
    setWindowStates((prev) => {
      const n = { ...prev }
      delete n[platformKey]
      return n
    })
    setSessions((prev) => ({ ...prev, [platformKey]: false }))
  }

  function toggleCat(cat: string) {
    setCollapsedCats((prev) => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  /* ─── Render ─── */
  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <TopBar
        connectedCount={connectedCount}
        totalCount={platforms.length}
        openCount={openCount}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ════════════════════════ Sidebar ════════════════════════ */}
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
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                      />
                    </button>
                  )}
                  {search.trim() && (
                    <div className="px-2 py-1.5 text-[9px] font-semibold text-zinc-600 uppercase tracking-widest">
                      {label}
                    </div>
                  )}

                  {!collapsed &&
                    ps.map((p) => (
                      <PlatformRow
                        key={p.key}
                        platform={p}
                        connected={!!sessions[p.key]}
                        windowOpen={!!windowStates[p.key]}
                        onOpen={() => openPlatform(p)}
                        onLogout={(e) => {
                          e.stopPropagation()
                          handleLogout(p.key)
                        }}
                      />
                    ))}
                </div>
              )
            })}

            {!catalog.isLoading &&
              search.trim() &&
              filteredPlatforms.length === 0 && (
                <p className="text-xs text-zinc-600 text-center py-6">
                  No platforms match "{search}"
                </p>
              )}
          </div>
        </aside>

        {/* ════════════════════════ Workspace ══════════════════════ */}
        <main className="flex-1 overflow-hidden bg-zinc-950/50">
          <WorkspacePanel
            platforms={platforms}
            sessions={sessions}
            windowStates={windowStates}
            onOpen={openPlatform}
            onLogout={handleLogout}
          />
        </main>
      </div>
    </div>
  )
}
