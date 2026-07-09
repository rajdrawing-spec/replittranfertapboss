/**
 * BrowserWorkspace — SSE-based remote browser viewer
 *
 * Uses Server-Sent Events (SSE) for the JPEG screenshot stream and
 * HTTP POST for input events.  This works through any HTTP proxy —
 * including Replit's dev proxy — without requiring WebSocket support.
 *
 * Architecture:
 *   1. Component opens GET /api/browser/stream?companyId=…&platform=…
 *      (long-lived HTTP connection with Content-Type: text/event-stream)
 *   2. Server streams JPEG frames as base64 data events at ~5 fps
 *   3. Mouse / keyboard events are POST-ed to /api/browser/input
 *   4. Each company gets its own isolated Playwright browser profile
 */

import * as React from "react"
import {
  RefreshCw, Home, ExternalLink, X, Globe, Loader2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { CatalogPlatform } from "@/lib/integrations-api"

/* ──────────────────────────── Types ─────────────────────────────── */

type ConnStatus = "idle" | "connecting" | "ready" | "error" | "closed"
type LoadPhase  = "handshake" | "launching"

interface StatusMsg { type: "status"; state: string; url?: string }
interface UrlMsg    { type: "url";    url: string }
interface FrameMsg  { type: "frame";  data: string }   // base64 JPEG
interface ErrorMsg  { type: "error";  message: string }
type ServerMsg = StatusMsg | UrlMsg | FrameMsg | ErrorMsg

/** How long to wait for the browser to become ready after the SSE opens. */
const READY_TIMEOUT_MS = 120_000

/* ──────────────────────────── Props ─────────────────────────────── */

export interface BrowserWorkspaceProps {
  companyId:   number
  companyName: string
  platform:    CatalogPlatform
  onClose:     () => void
}

/* ──────────────────────────── Component ─────────────────────────── */

export function BrowserWorkspace({
  companyId, companyName, platform, onClose,
}: BrowserWorkspaceProps) {
  const [status,      setStatus]      = React.useState<ConnStatus>("idle")
  const [loadPhase,   setLoadPhase]   = React.useState<LoadPhase>("handshake")
  const [errorMsg,    setErrorMsg]    = React.useState("")
  const [currentUrl,  setCurrentUrl]  = React.useState(platform.url)
  const [urlInput,    setUrlInput]    = React.useState(platform.url)
  /** True once the first screenshot frame has arrived — shows the img element. */
  const [hasFrame,    setHasFrame]    = React.useState(false)
  const [retryKey,    setRetryKey]    = React.useState(0)

  const esRef        = React.useRef<EventSource | null>(null)
  const imgRef       = React.useRef<HTMLImageElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const lastMoveRef  = React.useRef(0)
  const statusRef    = React.useRef<ConnStatus>("idle")

  // Keep statusRef in sync so the timeout closure always reads the latest value.
  React.useLayoutEffect(() => { statusRef.current = status }, [status])

  /* ── Input helper — POST to /api/browser/input ────────────────── */
  const sendInput = React.useCallback((event: object) => {
    // fire-and-forget: keepalive ensures delivery even if component unmounts
    fetch("/api/browser/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, platform: platform.key, event }),
      keepalive: true,
    }).catch(() => { /* non-fatal */ })
  }, [companyId, platform.key])

  // Stable ref so the wheel listener closure is always fresh without re-registering.
  const sendInputRef = React.useRef(sendInput)
  React.useLayoutEffect(() => { sendInputRef.current = sendInput }, [sendInput])

  /* ── SSE connection lifecycle ─────────────────────────────────── */
  React.useEffect(() => {
    let cancelled = false
    let readyTimer: ReturnType<typeof setTimeout> | null = null

    const clearReadyTimer = () => {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
    }

    setStatus("connecting")
    setLoadPhase("handshake")
    setHasFrame(false)
    // Clear the img src on reconnect so stale frames don't linger.
    if (imgRef.current) imgRef.current.src = ""

    const url = `/api/browser/stream?companyId=${companyId}&platform=${encodeURIComponent(platform.key)}`
    const es = new EventSource(url)
    esRef.current = es

    // 120 s to become ready — surfaced as an error if Playwright hangs.
    readyTimer = setTimeout(() => {
      if (!cancelled && statusRef.current !== "ready") {
        setStatus("error")
        setErrorMsg("Browser session timed out. First launch can take ~30 s — click Retry.")
        es.close()
      }
    }, READY_TIMEOUT_MS)

    es.onmessage = (e: MessageEvent<string>) => {
      if (cancelled) return
      try {
        const msg = JSON.parse(e.data) as ServerMsg
        switch (msg.type) {
          case "frame":
            // Write directly to the DOM — bypass React reconciliation for 5 fps updates.
            if (imgRef.current) {
              imgRef.current.src = `data:image/jpeg;base64,${msg.data}`
            }
            if (!hasFrame) setHasFrame(true)
            break
          case "status":
            if (msg.state === "loading") {
              setLoadPhase("launching")
            } else if (msg.state === "ready") {
              clearReadyTimer()
              setStatus("ready")
              if (msg.url) { setCurrentUrl(msg.url); setUrlInput(msg.url) }
            }
            break
          case "url":
            setCurrentUrl(msg.url)
            setUrlInput(msg.url)
            break
          case "error":
            clearReadyTimer()
            setStatus("error")
            setErrorMsg(msg.message)
            es.close()
            break
        }
      } catch { /* ignore JSON parse errors */ }
    }

    // onerror fires on connection failure or when the server closes the stream.
    es.onerror = () => {
      if (!cancelled) {
        clearReadyTimer()
        // Only show the error if we haven't already surfaced one.
        setStatus((prev) => (prev === "error" ? "error" : "closed"))
        es.close()
      }
    }

    return () => {
      cancelled = true
      clearReadyTimer()
      es.close()
      esRef.current = null
    }
  // retryKey intentionally included — incrementing it triggers a full reconnect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, platform.key, retryKey])

  /* ── Non-passive wheel listener (React's onWheel is passive) ──── */
  React.useEffect(() => {
    if (status !== "ready") return
    const img = imgRef.current
    if (!img) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = img.getBoundingClientRect()
      sendInputRef.current({
        type: "wheel",
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top)  / rect.height,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      })
    }

    img.addEventListener("wheel", onWheel, { passive: false })
    return () => img.removeEventListener("wheel", onWheel)
  }, [status])

  /* ── Input event helpers ──────────────────────────────────────── */

  const getNorm = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    }
  }, [])

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    containerRef.current?.focus()
    const { x, y } = getNorm(e)
    sendInput({ type: "click", x, y, button: e.button === 2 ? "right" : "left" })
  }, [sendInput, getNorm])

  const handleDblClick = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const { x, y } = getNorm(e)
    sendInput({ type: "dblclick", x, y })
  }, [sendInput, getNorm])

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const now = Date.now()
    if (now - lastMoveRef.current < 100) return   // throttle to 10 fps for moves
    lastMoveRef.current = now
    const { x, y } = getNorm(e)
    sendInput({ type: "mousemove", x, y })
  }, [sendInput, getNorm])

  const handleContextMenu = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault()
    const { x, y } = getNorm(e)
    sendInput({ type: "rightclick", x, y })
  }, [sendInput, getNorm])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && ["w", "t", "n"].includes(e.key.toLowerCase())) return
    e.preventDefault()
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      sendInput({ type: "type", text: e.key })
    } else {
      sendInput({ type: "keypress", key: e.key })
    }
  }, [sendInput])

  const handleNavigate = React.useCallback(() => {
    let url = urlInput.trim()
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url
    if (url) sendInput({ type: "navigate", url })
  }, [sendInput, urlInput])

  const handleReload  = React.useCallback(() => sendInput({ type: "reload" }),        [sendInput])
  const handleHome    = React.useCallback(() => {
    setUrlInput(platform.url)
    sendInput({ type: "navigate", url: platform.url })
  }, [sendInput, platform.url])

  const handleRetry = React.useCallback(() => {
    setStatus("idle")
    setLoadPhase("handshake")
    setErrorMsg("")
    setHasFrame(false)
    if (imgRef.current) imgRef.current.src = ""
    setRetryKey((k) => k + 1)
  }, [])

  /* ── Derived render flags ─────────────────────────────────────── */

  const isLoading   = status === "idle" || status === "connecting"
  const isError     = status === "error" || status === "closed"
  const showBrowser = status === "ready" && hasFrame

  const loadingLabel =
    status === "idle"         ? "Initializing…" :
    loadPhase === "handshake" ? "Connecting to workspace server…" :
                                `Launching ${platform.name} browser…`

  const loadingSubLabel =
    loadPhase === "launching"
      ? `Opening ${companyName}'s isolated ${platform.name} profile. First launch may take ~30 s.`
      : `Authenticating and opening ${companyName}'s workspace`

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full bg-zinc-950">

      {/* ══════════════════════════════════════════════════════════
          Toolbar — two rows on mobile, single row on desktop
          Mobile row 1 : [Platform icon+name] [company chip] [Close]
          Mobile row 2 : [Home] [URL bar] [Reload] [ExternalLink]
          Desktop      : all inline in one row
         ══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 border-b border-white/8 bg-zinc-900/80">

        {/* ── Desktop single-row toolbar (hidden on mobile) ──────── */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-2">

          {/* Company chip */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/6 border border-white/10 shrink-0">
            <span className="text-[10px] font-semibold text-zinc-400 truncate max-w-[80px]">
              {companyName}
            </span>
          </div>

          {/* Platform badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`w-5 h-5 rounded-md ${platform.logoColor} flex items-center justify-center`}>
              <span className="text-white font-bold" style={{ fontSize: 8 }}>{platform.logo}</span>
            </div>
            <span className="text-xs font-semibold">{platform.name}</span>
          </div>

          {/* URL bar */}
          <div className="flex-1 flex items-center gap-1 min-w-0">
            <div className="flex-1 flex items-center gap-1 bg-zinc-800/80 border border-white/8 rounded-md px-2 h-7 min-w-0">
              <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNavigate() }}
                className="h-full border-0 bg-transparent px-0 text-xs text-zinc-300 placeholder:text-zinc-600 focus-visible:ring-0 min-w-0"
                placeholder="https://"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
              onClick={handleReload} aria-label="Reload page" disabled={!showBrowser}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
              onClick={handleHome} aria-label="Go to platform home" disabled={!showBrowser}>
              <Home className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
              onClick={() => window.open(currentUrl, "_blank", "noopener")} aria-label="Open in new browser tab">
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400"
              onClick={onClose} aria-label="Close workspace">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Mobile two-row toolbar (hidden on sm+) ─────────────── */}
        <div className="flex flex-col sm:hidden">

          {/* Mobile row 1: identity + close */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
            {/* Platform icon + name */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-7 h-7 rounded-lg ${platform.logoColor} flex items-center justify-center shrink-0`}>
                <span className="text-white font-bold" style={{ fontSize: 10 }}>{platform.logo}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold leading-none truncate">{platform.name}</span>
                <span className="text-[10px] text-zinc-500 leading-none mt-0.5 truncate">{companyName}</span>
              </div>
            </div>

            {/* Close — large tap target */}
            <button
              onClick={onClose}
              className="flex items-center justify-center w-11 h-11 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-400/10 active:bg-red-400/20 transition-colors shrink-0 -mr-1"
              aria-label="Close workspace"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile row 2: navigation */}
          <div className="flex items-center gap-1.5 px-3 pb-2">
            {/* Home */}
            <button
              onClick={handleHome}
              disabled={!showBrowser}
              className="flex items-center justify-center w-11 h-11 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/6 active:bg-white/10 disabled:opacity-40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              aria-label="Go to platform home"
            >
              <Home className="w-5 h-5" />
            </button>

            {/* URL bar — full flex-1 */}
            <div className="flex-1 flex items-center gap-2 bg-zinc-800/80 border border-white/8 rounded-xl px-3 h-11 min-w-0">
              <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNavigate() }}
                className="h-full border-0 bg-transparent px-0 text-sm text-zinc-300 placeholder:text-zinc-600 focus-visible:ring-0 min-w-0"
                placeholder="https://"
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
              />
            </div>

            {/* Reload */}
            <button
              onClick={handleReload}
              disabled={!showBrowser}
              className="flex items-center justify-center w-11 h-11 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/6 active:bg-white/10 disabled:opacity-40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              aria-label="Reload page"
            >
              <RefreshCw className="w-5 h-5" />
            </button>

            {/* External link */}
            <button
              onClick={() => window.open(currentUrl, "_blank", "noopener")}
              className="flex items-center justify-center w-11 h-11 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/6 active:bg-white/10 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              aria-label="Open in new browser tab"
            >
              <ExternalLink className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Browser view ─────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950 z-10 px-8 text-center">
            <div className={`w-14 h-14 rounded-2xl ${platform.logoColor} flex items-center justify-center shadow-xl`}>
              <span className="text-white font-bold text-lg">{platform.logo}</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">{loadingLabel}</p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                {loadingSubLabel}
              </p>
            </div>
            <div className="flex items-center gap-2 text-zinc-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              {loadPhase === "launching" && (
                <span className="text-xs">This may take up to 30 s on first launch</span>
              )}
            </div>
          </div>
        )}

        {/* Error / disconnected overlay */}
        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950 z-10 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">
                {status === "closed" ? "Session disconnected" : "Connection failed"}
              </p>
              {errorMsg ? (
                <p className="text-xs text-red-400/80 max-w-sm leading-relaxed">{errorMsg}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {status === "closed"
                    ? "The stream ended. Your login is still saved — click Retry to reconnect."
                    : "Something went wrong starting the browser session."}
                </p>
              )}
            </div>
            <Button size="sm" onClick={handleRetry} className="gap-2">
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* First-frame spinner — SSE says "ready" but screenshot hasn't arrived yet */}
        {status === "ready" && !hasFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
            <p className="text-xs text-muted-foreground">Loading first frame…</p>
          </div>
        )}

        {/* Live browser screenshot — src written directly to DOM for 5 fps performance */}
        {/* Always rendered when ready so the ref is attached; hidden until hasFrame */}
        <img
          ref={imgRef}
          alt={`${platform.name} workspace`}
          draggable={false}
          loading="eager"
          className="w-full h-full select-none"
          style={{
            objectFit: "fill",
            cursor: "default",
            userSelect: "none",
            WebkitUserSelect: "none",
            display: showBrowser ? "block" : "none",
          }}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onMouseMove={handleMouseMove}
          onContextMenu={handleContextMenu}
        />

        {/* Company isolation badge — bottom-right on mobile, same on desktop */}
        <div className="absolute bottom-3 right-3 pointer-events-none">
          <Badge
            variant="secondary"
            className="text-[10px] bg-black/60 border-white/10 text-zinc-500 backdrop-blur-sm"
          >
            {companyName} · isolated profile
          </Badge>
        </div>
      </div>
    </div>
  )
}
