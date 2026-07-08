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
 *
 * Session isolation:
 *   companyId A → Playwright BrowserContext(userDataDir=.browser-profiles/company-A/)
 *   companyId B → Playwright BrowserContext(userDataDir=.browser-profiles/company-B/)
 *   → Completely separate cookies, localStorage, sessions — like Chrome Profiles.
 */

import * as React from "react"
import {
  RefreshCw, Home, ExternalLink, X, Globe, Loader2,
  AlertCircle, ArrowLeft, ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { CatalogPlatform } from "@/lib/integrations-api"

/* ──────────────────────────── Types ─────────────────────────────── */

type WsStatus = "idle" | "connecting" | "ready" | "error" | "closed"

interface StatusMsg { type: "status"; state: string; url?: string }
interface UrlMsg    { type: "url"; url: string }
interface ErrorMsg  { type: "error"; message: string }
type ServerMsg = StatusMsg | UrlMsg | ErrorMsg

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
  const [status, setStatus] = React.useState<WsStatus>("idle")
  const [errorMsg, setErrorMsg] = React.useState("")
  const [currentUrl, setCurrentUrl] = React.useState(platform.url)
  const [urlInput, setUrlInput] = React.useState(platform.url)
  const [frameSrc, setFrameSrc] = React.useState<string | null>(null)
  // Incremented to trigger a reconnect without a full page reload.
  const [retryKey, setRetryKey] = React.useState(0)

  const wsRef = React.useRef<WebSocket | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  const lastMoveRef = React.useRef(0)

  /* ── Connection lifecycle ── */
  React.useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null

    async function connect() {
      setStatus("connecting")
      setFrameSrc(null)

      try {
        const res = await fetch(
          `/api/browser/token?companyId=${companyId}` +
          `&platform=${encodeURIComponent(platform.key)}`,
        )
        if (!res.ok) {
          const body = await res.text().catch(() => res.statusText)
          throw new Error(body)
        }
        const { token } = (await res.json()) as { token: string }
        if (cancelled) return

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
        ws = new WebSocket(`${proto}//${window.location.host}/api/browser/ws?token=${token}`)
        ws.binaryType = "arraybuffer"
        wsRef.current = ws

        ws.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            // JPEG screenshot frame
            const blob = new Blob([e.data], { type: "image/jpeg" })
            const url = URL.createObjectURL(blob)
            setFrameSrc((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return url
            })
          } else {
            try {
              const msg = JSON.parse(e.data as string) as ServerMsg
              if (msg.type === "status") {
                if (msg.state === "ready") {
                  setStatus("ready")
                  if (msg.url) { setCurrentUrl(msg.url); setUrlInput(msg.url) }
                }
              } else if (msg.type === "url") {
                setCurrentUrl(msg.url)
                setUrlInput(msg.url)
              } else if (msg.type === "error") {
                setStatus("error")
                setErrorMsg(msg.message)
              }
            } catch { /* ignore parse errors */ }
          }
        }

        ws.onclose = () => { if (!cancelled) setStatus("closed") }
        ws.onerror = () => {
          if (!cancelled) {
            setStatus("error")
            setErrorMsg("WebSocket connection failed. The browser server may still be starting.")
          }
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error")
          setErrorMsg((e as Error).message)
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      ws?.close()
      wsRef.current = null
    }
  // retryKey is intentionally included: incrementing it re-runs this effect,
  // reconnecting the WebSocket without a full page reload.
  }, [companyId, platform.key, retryKey])

  // Non-passive wheel listener (React onWheel is passive in React 19)
  React.useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = img.getBoundingClientRect()
      send({
        type: "wheel",
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      })
    }
    img.addEventListener("wheel", onWheel, { passive: false })
    return () => img.removeEventListener("wheel", onWheel)
  })

  /* ── Helpers ── */

  const send = React.useCallback((msg: object) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const getNorm = React.useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }, [])

  /* ── Input handlers ── */

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
    // Never intercept browser tab/window shortcuts
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
  const handleHome   = React.useCallback(() => {
    setUrlInput(platform.url)
    send({ type: "navigate", url: platform.url })
  }, [send, platform.url])

  const handleRetry = React.useCallback(() => {
    // Increment retryKey to re-trigger the connection useEffect without
    // a full page reload — fetches a fresh token and reopens the WebSocket.
    setStatus("idle")
    setErrorMsg("")
    setFrameSrc(null)
    setRetryKey((k) => k + 1)
  }, [])

  /* ── Render ── */

  const isLoading = status === "idle" || status === "connecting"
  const isError = status === "error" || status === "closed"
  const showBrowser = status === "ready" && frameSrc

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-zinc-900/80 shrink-0">
        {/* Company chip */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/6 border border-white/10 shrink-0">
          <span className="text-[10px] font-semibold text-zinc-400 truncate max-w-[80px]">
            {companyName}
          </span>
        </div>

        {/* Platform icon + name */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`w-5 h-5 rounded-md ${platform.logoColor} flex items-center justify-center`}
          >
            <span className="text-white font-bold" style={{ fontSize: 8 }}>
              {platform.logo}
            </span>
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

        {/* Navigation controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={handleReload}
            title="Reload"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={handleHome}
            title="Go to platform home"
          >
            <Home className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={() => window.open(currentUrl, "_blank", "noopener")}
            title="Open in new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-red-400"
            onClick={onClose}
            title="Close workspace"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Browser view ─────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Loading state */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950 z-10">
            <div
              className={`w-12 h-12 rounded-2xl ${platform.logoColor} flex items-center justify-center shadow-lg`}
            >
              <span className="text-white font-bold text-base">{platform.logo}</span>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold">
                {status === "idle" ? "Initializing…" : "Starting browser session…"}
              </p>
              <p className="text-xs text-muted-foreground">
                Loading <span className="text-zinc-300">{companyName}</span>'s{" "}
                {platform.name} profile
              </p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        )}

        {/* Error / disconnected state */}
        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950 z-10 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                {status === "closed" ? "Session disconnected" : "Failed to start session"}
              </p>
              {errorMsg && (
                <p className="text-xs text-red-400/80 max-w-sm">{errorMsg}</p>
              )}
              {!errorMsg && status === "closed" && (
                <p className="text-xs text-muted-foreground">
                  The browser session ended. Click Retry to reconnect.
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleRetry}
              className="gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Connecting spinner overlay (while frames haven't arrived yet) */}
        {status === "ready" && !frameSrc && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
          </div>
        )}

        {/* Live browser screenshot */}
        {showBrowser && (
          <img
            ref={imgRef}
            src={frameSrc}
            alt={`${platform.name} workspace`}
            draggable={false}
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
