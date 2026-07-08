/**
 * BrowserWorkspace
 *
 * Renders a live, interactive view of a server-side Chromium browser session.
 * Each company gets its own isolated browser profile (separate cookies, localStorage,
 * sessions) — switching companies reconnects to a completely different profile.
 *
 * Architecture:
 *   1. Component fetches a short-lived token from /api/browser/token
 *   2. Upgrades to a WebSocket on /api/browser/ws?token=<TOKEN>
 *   3. Server streams JPEG frames as binary WS messages (~5 fps)
 *   4. Mouse / keyboard events are forwarded back as JSON text messages
 *   5. Server applies them to the Playwright page for the company + platform
 */

import * as React from "react"
import {
  RefreshCw, Home, ExternalLink, X, Globe, Loader2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { CatalogPlatform } from "@/lib/integrations-api"

/* ──────────────────────────── Types ─────────────────────────────── */

type WsStatus = "idle" | "connecting" | "ready" | "error" | "closed"
/** Granular loading phase shown inside the "connecting" overlay. */
type LoadPhase = "handshake" | "launching"

interface StatusMsg { type: "status"; state: string; url?: string }
interface UrlMsg    { type: "url"; url: string }
interface ErrorMsg  { type: "error"; message: string }
interface PingMsg   { type: "ping" }
type ServerMsg = StatusMsg | UrlMsg | ErrorMsg | PingMsg

/** How long we wait for the browser to become ready after WS connects. */
const READY_TIMEOUT_MS = 120_000

/* ──────────────────────────── Props ─────────────────────────────── */

export interface BrowserWorkspaceProps {
  companyId: number
  companyName: string
  platform: CatalogPlatform
  onClose: () => void
}

/* ──────────────────────────── Component ─────────────────────────── */

export function BrowserWorkspace({
  companyId,
  companyName,
  platform,
  onClose,
}: BrowserWorkspaceProps) {
  const [status, setStatus]         = React.useState<WsStatus>("idle")
  const [loadPhase, setLoadPhase]   = React.useState<LoadPhase>("handshake")
  const [errorMsg, setErrorMsg]     = React.useState("")
  const [currentUrl, setCurrentUrl] = React.useState(platform.url)
  const [urlInput, setUrlInput]     = React.useState(platform.url)
  const [frameSrc, setFrameSrc]     = React.useState<string | null>(null)
  /** Incremented by Retry — re-triggers the connection effect without page reload. */
  const [retryKey, setRetryKey]     = React.useState(0)

  const wsRef        = React.useRef<WebSocket | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const imgRef       = React.useRef<HTMLImageElement>(null)
  const lastMoveRef  = React.useRef(0)

  /* ── Stable send ref — safe to close over in non-React event listeners ── */
  const send = React.useCallback((msg: object) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])
  const sendRef = React.useRef(send)
  React.useLayoutEffect(() => { sendRef.current = send }, [send])

  /* ── Connection lifecycle ─────────────────────────────────────────── */
  React.useEffect(() => {
    let cancelled       = false
    let ws: WebSocket | null = null
    let readyTimer: ReturnType<typeof setTimeout> | null = null

    const clearReadyTimer = () => {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
    }

    async function connect() {
      setStatus("connecting")
      setLoadPhase("handshake")
      setFrameSrc(null)

      try {
        const res = await fetch(
          `/api/browser/token?companyId=${companyId}` +
          `&platform=${encodeURIComponent(platform.key)}`,
        )
        if (!res.ok) {
          const body = await res.text().catch(() => res.statusText)
          throw new Error(body || `HTTP ${res.status}`)
        }
        const { token } = (await res.json()) as { token: string }
        if (cancelled) return

        // Use the same origin as the page — Replit's proxy routes /api/browser/ws
        // to the API server's upgrade handler.  Avoid hardcoding wss:// because
        // some Replit preview environments expose the app over plain http.
        const proto = window.location.protocol === "https:" ? "wss" : "ws"
        const wsUrl = `${proto}://${window.location.host}/api/browser/ws?token=${token}`
        ws = new WebSocket(wsUrl)
        ws.binaryType = "arraybuffer"
        wsRef.current = ws

        // 120 s to become ready — surfaced as an error if exceeded.
        readyTimer = setTimeout(() => {
          if (!cancelled && status !== "ready") {
            setStatus("error")
            setErrorMsg(
              "Browser session timed out. The platform may be slow to start. Click Retry.",
            )
            ws?.close()
          }
        }, READY_TIMEOUT_MS)

        ws.onmessage = (e: MessageEvent) => {
          if (e.data instanceof ArrayBuffer) {
            // JPEG screenshot frame — first frame clears the spinner.
            const blob = new Blob([e.data], { type: "image/jpeg" })
            const url  = URL.createObjectURL(blob)
            setFrameSrc((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return url
            })
          } else {
            try {
              const msg = JSON.parse(e.data as string) as ServerMsg
              if (msg.type === "ping") {
                // Server keepalive — no UI update needed.
              } else if (msg.type === "status") {
                if (msg.state === "loading") {
                  // WS is up; Playwright is now launching / navigating.
                  setLoadPhase("launching")
                } else if (msg.state === "ready") {
                  clearReadyTimer()
                  setStatus("ready")
                  if (msg.url) { setCurrentUrl(msg.url); setUrlInput(msg.url) }
                }
              } else if (msg.type === "url") {
                setCurrentUrl(msg.url)
                setUrlInput(msg.url)
              } else if (msg.type === "error") {
                clearReadyTimer()
                setStatus("error")
                setErrorMsg(msg.message)
              }
            } catch { /* ignore JSON parse errors */ }
          }
        }

        // Use functional update so onerror's "error" status isn't overwritten.
        ws.onclose = () => {
          clearReadyTimer()
          if (!cancelled) setStatus((prev) => (prev === "error" ? "error" : "closed"))
        }

        ws.onerror = () => {
          if (!cancelled) {
            setStatus("error")
            setErrorMsg(
              "WebSocket connection failed. " +
              "Check that the API server is running, then click Retry.",
            )
          }
        }
      } catch (e) {
        clearReadyTimer()
        if (!cancelled) {
          setStatus("error")
          setErrorMsg((e as Error).message)
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      clearReadyTimer()
      ws?.close()
      wsRef.current = null
    }
  // retryKey intentionally included — incrementing it triggers a full reconnect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, platform.key, retryKey])

  /* ── Non-passive wheel listener ───────────────────────────────────── */
  // Only active when the browser view is visible (status === "ready").
  // Uses sendRef so the closure is always fresh without re-registering constantly.
  React.useEffect(() => {
    if (status !== "ready") return
    const img = imgRef.current
    if (!img) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = img.getBoundingClientRect()
      sendRef.current({
        type: "wheel",
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      })
    }

    img.addEventListener("wheel", onWheel, { passive: false })
    return () => img.removeEventListener("wheel", onWheel)
  }, [status]) // re-register only when status changes

  /* ── Revoke any remaining object URL on unmount ─────────────────── */
  React.useEffect(() => {
    return () => {
      setFrameSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [])

  /* ── Input event helpers ──────────────────────────────────────────── */

  const getNorm = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }, [])

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    containerRef.current?.focus()
    const { x, y } = getNorm(e)
    send({ type: "click", x, y, button: e.button === 2 ? "right" : "left" })
  }, [send, getNorm])

  const handleDblClick = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const { x, y } = getNorm(e)
    send({ type: "dblclick", x, y })
  }, [send, getNorm])

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const now = Date.now()
    if (now - lastMoveRef.current < 50) return
    lastMoveRef.current = now
    const { x, y } = getNorm(e)
    send({ type: "mousemove", x, y })
  }, [send, getNorm])

  const handleContextMenu = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault()
    const { x, y } = getNorm(e)
    send({ type: "rightclick", x, y })
  }, [send, getNorm])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Never intercept browser tab/window shortcuts.
    if ((e.ctrlKey || e.metaKey) && ["w", "t", "n"].includes(e.key.toLowerCase())) return
    e.preventDefault()
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      send({ type: "type", text: e.key })
    } else {
      send({ type: "keypress", key: e.key })
    }
  }, [send])

  const handleNavigate = React.useCallback(() => {
    let url = urlInput.trim()
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url
    }
    if (url) send({ type: "navigate", url })
  }, [send, urlInput])

  const handleReload = React.useCallback(() => send({ type: "reload" }), [send])

  const handleHome = React.useCallback(() => {
    setUrlInput(platform.url)
    send({ type: "navigate", url: platform.url })
  }, [send, platform.url])

  const handleRetry = React.useCallback(() => {
    setStatus("idle")
    setLoadPhase("handshake")
    setErrorMsg("")
    setFrameSrc((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setRetryKey((k) => k + 1)
  }, [])

  /* ── Derived render flags ─────────────────────────────────────────── */

  const isLoading   = status === "idle" || status === "connecting"
  const isError     = status === "error" || status === "closed"
  const showBrowser = status === "ready" && frameSrc !== null

  const loadingLabel =
    status === "idle"
      ? "Initializing…"
      : loadPhase === "handshake"
        ? "Connecting to workspace server…"
        : `Launching ${platform.name} browser…`

  const loadingSubLabel =
    loadPhase === "launching"
      ? `Opening ${companyName}'s isolated ${platform.name} profile. First launch may take ~30 s.`
      : `Authenticating and opening ${companyName}'s workspace`

  /* ── Render ───────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full bg-zinc-950">

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-zinc-900/80 shrink-0">

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
          <span className="text-xs font-semibold hidden sm:block">{platform.name}</span>
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
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={handleReload} title="Reload page"
            disabled={!showBrowser}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={handleHome} title="Go to platform home"
            disabled={!showBrowser}
          >
            <Home className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={() => window.open(currentUrl, "_blank", "noopener")}
            title="Open in new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-red-400"
            onClick={onClose} title="Close workspace"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Browser view ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Loading overlay — shown during both "handshake" and "launching" phases */}
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
                <span className="text-xs">This may take up to 30 seconds on first launch</span>
              )}
            </div>
          </div>
        )}

        {/* Error / disconnected state */}
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
                    ? "The browser session ended. Your login is still saved — click Retry to reconnect."
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

        {/* First-frame spinner — WS says "ready" but first screenshot hasn't arrived yet */}
        {status === "ready" && !frameSrc && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
            <p className="text-xs text-muted-foreground">Loading first frame…</p>
          </div>
        )}

        {/* Live browser screenshot */}
        {showBrowser && (
          <img
            ref={imgRef}
            src={frameSrc!}
            alt={`${platform.name} workspace`}
            draggable={false}
            loading="eager"
            className="w-full h-full select-none"
            style={{
              objectFit: "fill",
              cursor: "default",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            onMouseMove={handleMouseMove}
            onContextMenu={handleContextMenu}
          />
        )}

        {/* Company isolation badge */}
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
