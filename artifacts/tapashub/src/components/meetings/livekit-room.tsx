/**
 * LiveKit meeting UI components.
 *
 * Architecture: MeetingOverlay owns the SINGLE LiveKitRoom for the entire app.
 * It is mounted inside MeetingProvider (at the root level) so the connection
 * persists across page navigation. FullScreenCallUI and MiniPlayerUI render
 * *inside* that shared room — they never create their own connection.
 */
import * as React from "react"
import * as ReactDOM from "react-dom"
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ConnectionStateToast,
} from "@livekit/components-react"
import "@livekit/components-styles"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { X, Maximize2, Minimize2, Clock, Users, MonitorSpeaker } from "lucide-react"
import type { ActiveCall } from "@/contexts/meeting-context"
import type { DisconnectReason } from "livekit-client"
import { MeetingRecorder } from "@/components/meetings/meeting-recorder"

// ── Timer ─────────────────────────────────────────────────────────────────────

function useMeetingTimer() {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// ── Full-screen UI ────────────────────────────────────────────────────────────
// Renders inside the shared LiveKitRoom context — no connection management here.

function FullScreenCallUI({
  roomName,
  onClose,
  onMinimize,
}: {
  roomName: string
  onClose: () => void
  onMinimize: () => void
}) {
  const timer = useMeetingTimer()
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", height: "100%", background: "hsl(var(--background))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b z-10 shrink-0">
        <div className="flex items-center gap-3">
          <MonitorSpeaker className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm truncate max-w-[200px]">{roomName}</span>
          <Badge variant="default" className="text-xs gap-1">
            <Clock className="h-3 w-3" />
            {timer}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onMinimize} title="Minimize">
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} title="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="destructive" size="icon" onClick={() => setLeaveOpen(true)} title="Leave">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Video area */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <VideoConference />
      </div>

      <RoomAudioRenderer />
      <ConnectionStateToast />

      {/* Leave confirmation */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Leave the meeting?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Other participants will remain in the room.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>Stay</Button>
            <Button variant="destructive" onClick={onClose}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Mini-player UI ────────────────────────────────────────────────────────────
// Renders inside the shared LiveKitRoom context — audio stays connected.

function MiniPlayerUI({
  roomName,
  onExpand,
  onLeave,
}: {
  roomName: string
  onExpand: () => void
  onLeave: () => void
}) {
  const timer = useMeetingTimer()

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl overflow-hidden shadow-2xl border border-border bg-card">
      <RoomAudioRenderer />
      <div className="flex items-center justify-between px-3 py-2 bg-card border-b">
        <div className="flex items-center gap-2 min-w-0">
          <MonitorSpeaker className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium truncate">{roomName}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">{timer}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onExpand} title="Expand">
            <Maximize2 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onLeave} title="Leave">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
        <Users className="h-3 w-3" />
        <span>Audio active · click to expand</span>
      </div>
    </div>
  )
}

// ── Overlay — the single LiveKitRoom for the whole app ────────────────────────

interface MeetingOverlayProps {
  activeCall: ActiveCall | null
  isMinimized: boolean
  onLeave: () => void
  /** Fired when the room disconnects for ANY reason (network, token expiry,
   * server close, or the user clicking LiveKit's built-in Leave button). The
   * provider inspects the reason to decide whether to auto-rejoin or end. */
  onDisconnected: (reason?: DisconnectReason) => void
  onMinimize: () => void
  onExpand: () => void
}

export function MeetingOverlay({
  activeCall,
  isMinimized,
  onLeave,
  onDisconnected,
  onMinimize,
  onExpand,
}: MeetingOverlayProps) {
  if (!activeCall) return null

  const roomName = activeCall.meeting.title || activeCall.meeting.meetingId

  return (
    <>
      {/*
       * Single LiveKitRoom — never remounts regardless of minimized state,
       * so the WebRTC connection and audio track persist across navigation.
       *
       * When minimized: the wrapper is collapsed to 0×0 with overflow:hidden
       * so it's invisible. RoomAudioRenderer keeps audio playing inside it.
       *
       * When full-screen: it covers the viewport at z-index 50.
       */}
      <LiveKitRoom
        // Key on the token: when the provider issues a fresh token after an
        // unexpected disconnect, the room remounts and connects with the new
        // credential (LiveKit ignores token prop changes while connected).
        key={activeCall.token}
        token={activeCall.token}
        serverUrl={activeCall.serverUrl}
        audio={true}
        // Voice calls start with the camera off; users can turn it on from the
        // control bar at any time (it's still a full LiveKit room).
        video={activeCall.video !== false}
        data-lk-theme="default"
        style={
          isMinimized
            ? {
                position: "fixed",
                top: 0,
                left: 0,
                width: 0,
                height: 0,
                overflow: "hidden",
                // No pointerEvents style here — the container is 0×0 so it
                // can't intercept clicks anyway, and descendants rendered via
                // portal (below) are outside this element in the DOM.
              }
            : {
                position: "fixed",
                inset: 0,
                zIndex: 50,
                display: "flex",
                flexDirection: "column",
                background: "#0a0a0a",
              }
        }
        onDisconnected={onDisconnected}
      >
        {/* AI Meeting Assistant — records mixed audio for post-call notes */}
        <MeetingRecorder meetingId={activeCall.meeting.meetingId} />
        {isMinimized ? (
          // Keep audio alive. Video publication is paused by ControlBar state;
          // no video UI is rendered here.
          <RoomAudioRenderer />
        ) : (
          <FullScreenCallUI roomName={roomName} onClose={onLeave} onMinimize={onMinimize} />
        )}
      </LiveKitRoom>

      {/*
       * Mini-player: rendered via portal directly into document.body so it sits
       * OUTSIDE the collapsed 0×0 LiveKitRoom container. This guarantees that
       * expand/leave buttons receive pointer events on every page, not just
       * the meetings page.
       */}
      {isMinimized &&
        ReactDOM.createPortal(
          <MiniPlayerUI roomName={roomName} onExpand={onExpand} onLeave={onLeave} />,
          document.body,
        )}
    </>
  )
}
