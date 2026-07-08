/**
 * TAPBOSS — Business Workspace
 *
 * Left sidebar: all 17 platforms with icon, status, Login / Logout.
 * Right panel: embedded browser (iframe) that loads the platform's
 * official website. Sessions live in browser cookies (per-domain) and
 * are NOT cleared when you switch platforms, so logging in once keeps
 * you in until you click Logout or the site itself expires the session.
 *
 * Browser controls (Back / Forward / Refresh / Home) are implemented
 * via a manual per-platform URL-history stack because cross-origin
 * iframes cannot expose their internal navigation to the parent frame.
 *
 * When a platform sets X-Frame-Options / CSP frame-ancestors, the
 * embed-check endpoint detects it and a fallback card replaces the
 * iframe — the user can then pop it into a separate window (which
 * still counts as a "connected" session for the workspace).
 */

import * as React from "react"
import {
  ArrowLeft, ArrowRight, RefreshCw, Home, ExternalLink,
  LogOut, Globe, Loader2, Search, Monitor, Wifi, WifiOff,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useAuth } from "@/contexts/auth-context"
import { useCatalog, useEmbedCheck } from "@/lib/integrations-api"
import type { CatalogPlatform } from "@/lib/integrations-api"

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

function faviconUrl(platformUrl: string): string {
  try {
    const { hostname } = new URL(platformUrl)
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return ""
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  storefront: "Storefronts",
  marketplace: "Marketplaces",
  social: "Social",
  ads: "Advertising",
  analytics: "Analytics",
  payments: "Payments",
  shipping: "Logistics",
  accounting: "Accounting",
  messaging: "Messaging",
}
const CATEGORY_ORDER = [
  "storefront","marketplace","social","ads",
  "analytics","payments","shipping","accounting","messaging",
]

/* ─────────────────────────── PlatformIcon ─────────────────────── */

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
  const imgDim = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-8 h-8" : "w-5 h-5"

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

/* ─────────────────────────── TopBar ───────────────────────────── */

function TopBar({
  connectedCount,
  totalCount,
}: {
  connectedCount: number
  totalCount: number
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
        <div className="ml-4 hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground border-l border-white/10 pl-4">
          <span
            className={`w-1.5 h-1.5 rounded-full ${connectedCount > 0 ? "bg-green-500" : "bg-zinc-600"}`}
          />
          {connectedCount} / {totalCount} platforms connected
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
  active,
  connected,
  onOpen,
  onLogout,
}: {
  platform: CatalogPlatform
  active: boolean
  connected: boolean
  onOpen: () => void
  onLogout: (e: React.MouseEvent) => void
}) {
  // Use a div + two independent buttons so we never have a button inside a button.
  return (
    <div
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all group ${
        active
          ? "bg-white/10 border border-white/15"
          : "hover:bg-white/5 border border-transparent"
      }`}
    >
      {/* Clicking the icon/name area opens the platform */}
      <button
        onClick={onOpen}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        aria-label={`Open ${platform.name}`}
      >
        <PlatformIcon platform={platform} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-tight truncate">
            {platform.name}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                connected ? "bg-green-500" : "bg-zinc-600"
              }`}
            />
            <span
              className={`text-[9px] font-medium ${
                connected ? "text-green-400" : "text-zinc-500"
              }`}
            >
              {connected ? "Connected" : "Login"}
            </span>
          </div>
        </div>
      </button>

      {/* Logout — separate button, only visible on hover when connected */}
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
          Login
        </span>
      )}
    </div>
  )
}

/* ─────────────────────────── Browser panel ───────────────────── */

function EmbedBlockedCard({
  platform,
  url,
  reason,
}: {
  platform: CatalogPlatform
  url: string
  reason: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
      <PlatformIcon platform={platform} size="lg" />
      <div className="space-y-2 max-w-md">
        <h3 className="text-xl font-bold">{platform.name}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {platform.name} blocks embedding inside other applications for
          security reasons.
        </p>
        <p className="text-xs text-muted-foreground/50">{reason}</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Button
          className="gap-2"
          onClick={() =>
            window.open(
              url,
              `tapboss-${platform.key}`,
              "width=1400,height=900,noopener",
            )
          }
        >
          <ExternalLink className="w-4 h-4" />
          Open {platform.name} in new window
        </Button>
        <p className="text-[11px] text-muted-foreground/40">
          Your session will remain connected in this workspace
        </p>
      </div>
    </div>
  )
}

function BrowserPanel({
  platform,
  iframeRef,
  iframeKey,
  currentUrl,
  urlInput,
  canGoBack,
  canGoForward,
  onUrlChange,
  onUrlSubmit,
  onBack,
  onForward,
  onRefresh,
  onHome,
}: {
  platform: CatalogPlatform
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>
  iframeKey: number
  currentUrl: string
  urlInput: string
  canGoBack: boolean
  canGoForward: boolean
  onUrlChange: (v: string) => void
  onUrlSubmit: () => void
  onBack: () => void
  onForward: () => void
  onRefresh: () => void
  onHome: () => void
}) {
  // Only check the platform home URL — not every URL the user navigates to.
  const embedCheck = useEmbedCheck(platform.url)
  const blocked =
    embedCheck.data != null && !embedCheck.data.embeddable

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* ── Browser toolbar ── */}
      <div className="h-12 border-b border-white/8 bg-zinc-900/80 flex items-center gap-1.5 px-3 shrink-0">
        {/* Nav buttons */}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          disabled={!canGoBack}
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          disabled={!canGoForward}
          onClick={onForward}
          aria-label="Forward"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          aria-label="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onHome}
          aria-label="Home"
        >
          <Home className="w-3.5 h-3.5" />
        </Button>

        {/* Address bar */}
        <div className="flex-1 flex items-center gap-2 bg-zinc-800/70 hover:bg-zinc-800 border border-white/8 rounded-lg h-8 px-3 transition-colors">
          <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onUrlSubmit()}
            onFocus={(e) => e.target.select()}
            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none font-mono placeholder:text-zinc-600 min-w-0"
            placeholder="https://…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Platform badge */}
        <div className="flex items-center gap-1.5 border border-white/8 rounded-lg px-2.5 h-8 shrink-0">
          <PlatformIcon platform={platform} size="sm" />
          <span className="text-xs font-medium text-zinc-300 hidden sm:block">
            {platform.shortName}
          </span>
        </div>

        {/* Open externally */}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
          onClick={() =>
            window.open(
              currentUrl || platform.url,
              `tapboss-ext-${platform.key}`,
              "noopener",
            )
          }
          aria-label="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Loading overlay while embed check runs */}
        {embedCheck.isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950">
            <PlatformIcon platform={platform} size="lg" />
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading {platform.name}…
            </div>
          </div>
        )}

        {/* Blocked fallback */}
        {blocked && (
          <EmbedBlockedCard
            platform={platform}
            url={currentUrl || platform.url}
            reason={embedCheck.data?.reason ?? "X-Frame-Options or CSP restriction"}
          />
        )}

        {/* Iframe — rendered (but hidden) even during loading so it starts preloading */}
        {!blocked && (
          <iframe
            key={iframeKey}
            ref={iframeRef as React.RefObject<HTMLIFrameElement>}
            src={currentUrl || platform.url}
            title={platform.name}
            className={`w-full h-full border-none ${embedCheck.isLoading ? "opacity-0" : "opacity-100"} transition-opacity duration-300`}
          />
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── Empty state ──────────────────────── */

function EmptyState({
  platforms,
  sessions,
  onOpen,
}: {
  platforms: CatalogPlatform[]
  sessions: Record<string, boolean>
  onOpen: (p: CatalogPlatform) => void
}) {
  const connected = platforms.filter((p) => sessions[p.key])
  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <Monitor className="w-7 h-7 text-zinc-600" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-xl font-bold">Business Workspace</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Select any platform from the sidebar to open its website here.
          Log in once and your session stays active — no separate browser tabs needed.
        </p>
      </div>

      {/* Connected platforms quick launch */}
      {connected.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-semibold">
            Your sessions
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {connected.map((p) => (
              <button
                key={p.key}
                onClick={() => onOpen(p)}
                className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all"
              >
                <PlatformIcon platform={p} size="sm" />
                <span className="text-xs font-medium">{p.shortName}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All platforms quick grid */}
      {connected.length === 0 && (
        <div className="grid grid-cols-4 gap-2 max-w-xs">
          {platforms.slice(0, 8).map((p) => (
            <button
              key={p.key}
              onClick={() => onOpen(p)}
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/5 transition-colors group"
            >
              <PlatformIcon platform={p} size="sm" />
              <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate w-full text-center">
                {p.shortName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── Main page ────────────────────────── */

export default function Integrations() {
  const catalog = useCatalog()
  const platforms = catalog.data ?? []

  // Which platform is open in the workspace
  const [activePlatformKey, setActivePlatformKey] = React.useState<
    string | null
  >(null)

  // Per-platform "logged in" flag — persisted in localStorage
  const [sessions, setSessions] = useLocalStorage<Record<string, boolean>>(
    "tapboss-ws-sessions-v2",
    {},
  )

  // Sidebar search
  const [search, setSearch] = React.useState("")
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(
    new Set(),
  )

  // Per-platform URL history  
  // stacks[key] = [url0, url1, …], pointers[key] = current index
  const [stacks, setStacks] = React.useState<Record<string, string[]>>({})
  const [pointers, setPointers] = React.useState<Record<string, number>>({})
  const [urlInput, setUrlInput] = React.useState("")
  const [iframeKey, setIframeKey] = React.useState(0)
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)

  /* ── Derived ── */
  const activePlatform =
    platforms.find((p) => p.key === activePlatformKey) ?? null

  const currentUrl = React.useMemo(() => {
    if (!activePlatformKey) return ""
    const s = stacks[activePlatformKey] ?? []
    const p = pointers[activePlatformKey] ?? -1
    return p >= 0 ? (s[p] ?? "") : (activePlatform?.url ?? "")
  }, [activePlatformKey, stacks, pointers, activePlatform])

  const canGoBack = React.useMemo(
    () => (activePlatformKey ? (pointers[activePlatformKey] ?? 0) > 0 : false),
    [activePlatformKey, pointers],
  )
  const canGoForward = React.useMemo(() => {
    if (!activePlatformKey) return false
    const s = stacks[activePlatformKey] ?? []
    const p = pointers[activePlatformKey] ?? -1
    return p < s.length - 1
  }, [activePlatformKey, stacks, pointers])

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
    // Unknown categories at end
    for (const p of platforms) {
      if (!CATEGORY_ORDER.includes(p.category)) {
        const arr = m.get(p.category) ?? []
        arr.push(p)
        m.set(p.category, arr)
      }
    }
    return m
  }, [platforms, filteredPlatforms, search])

  const connectedCount = platforms.filter((p) => sessions[p.key]).length

  /* ── Navigation helpers ── */

  function pushUrl(key: string, url: string) {
    const s = stacks[key] ?? []
    const p = pointers[key] ?? -1
    const newStack = [...s.slice(0, p + 1), url]
    setStacks((prev) => ({ ...prev, [key]: newStack }))
    setPointers((prev) => ({ ...prev, [key]: newStack.length - 1 }))
  }

  function openPlatform(platform: CatalogPlatform) {
    const key = platform.key
    const existing = stacks[key] ?? []
    const url =
      existing.length > 0
        ? existing[pointers[key] ?? existing.length - 1] ?? platform.url
        : platform.url

    setActivePlatformKey(key)
    setUrlInput(url)

    if (existing.length === 0) {
      setStacks((prev) => ({ ...prev, [key]: [platform.url] }))
      setPointers((prev) => ({ ...prev, [key]: 0 }))
    }

    // Force iframe reload when switching platforms so the correct session loads
    setIframeKey((k) => k + 1)
  }

  function handleLogin(platform: CatalogPlatform) {
    setSessions((prev) => ({ ...prev, [platform.key]: true }))
    openPlatform(platform)
  }

  function handleLogout(e: React.MouseEvent, platformKey: string) {
    e.stopPropagation()
    setSessions((prev) => ({ ...prev, [platformKey]: false }))

    const homeUrl =
      platforms.find((x) => x.key === platformKey)?.url ?? ""
    const isActive = activePlatformKey === platformKey

    // Single atomic update per store: if this is the active platform reset
    // history to the home URL; otherwise wipe the stored history entirely.
    setStacks((prev) => {
      const n = { ...prev }
      if (isActive && homeUrl) {
        n[platformKey] = [homeUrl]
      } else {
        delete n[platformKey]
      }
      return n
    })
    setPointers((prev) => {
      const n = { ...prev }
      if (isActive) {
        n[platformKey] = 0
      } else {
        delete n[platformKey]
      }
      return n
    })

    if (isActive && homeUrl) {
      setUrlInput(homeUrl)
      setIframeKey((k) => k + 1)
    }
  }

  function handleUrlSubmit() {
    if (!activePlatformKey) return
    let url = urlInput.trim()
    if (!url) return
    if (!url.startsWith("http://") && !url.startsWith("https://"))
      url = "https://" + url
    pushUrl(activePlatformKey, url)
    setUrlInput(url)
    if (iframeRef.current) iframeRef.current.src = url
  }

  function handleBack() {
    if (!activePlatformKey) return
    const p = pointers[activePlatformKey] ?? 0
    if (p > 0) {
      const newP = p - 1
      setPointers((prev) => ({ ...prev, [activePlatformKey]: newP }))
      const url = stacks[activePlatformKey]?.[newP] ?? activePlatform?.url ?? ""
      setUrlInput(url)
      if (iframeRef.current) iframeRef.current.src = url
    }
  }

  function handleForward() {
    if (!activePlatformKey) return
    const s = stacks[activePlatformKey] ?? []
    const p = pointers[activePlatformKey] ?? 0
    if (p < s.length - 1) {
      const newP = p + 1
      setPointers((prev) => ({ ...prev, [activePlatformKey]: newP }))
      const url = s[newP] ?? activePlatform?.url ?? ""
      setUrlInput(url)
      if (iframeRef.current) iframeRef.current.src = url
    }
  }

  function handleRefresh() {
    setIframeKey((k) => k + 1)
  }

  function handleHome() {
    if (!activePlatform || !activePlatformKey) return
    const url = activePlatform.url
    pushUrl(activePlatformKey, url)
    setUrlInput(url)
    setIframeKey((k) => k + 1)
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
      <TopBar connectedCount={connectedCount} totalCount={platforms.length} />

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
                  {/* Category header (not shown for search results) */}
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
                        active={activePlatformKey === p.key}
                        connected={!!sessions[p.key]}
                        onOpen={() => handleLogin(p)}
                        onLogout={(e) => handleLogout(e, p.key)}
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
        <main className="flex-1 overflow-hidden">
          {activePlatform ? (
            <BrowserPanel
              platform={activePlatform}
              iframeRef={iframeRef}
              iframeKey={iframeKey}
              currentUrl={currentUrl}
              urlInput={urlInput}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onUrlChange={setUrlInput}
              onUrlSubmit={handleUrlSubmit}
              onBack={handleBack}
              onForward={handleForward}
              onRefresh={handleRefresh}
              onHome={handleHome}
            />
          ) : (
            <EmptyState
              platforms={platforms}
              sessions={sessions}
              onOpen={handleLogin}
            />
          )}
        </main>
      </div>
    </div>
  )
}
