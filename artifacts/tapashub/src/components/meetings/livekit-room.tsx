import * as React from "react"
import {
  LiveKitRoom,
  VideoConference,
  GridLayout,
  ParticipantTile,
  useTracks,
  ControlBar,
  RoomAudioRenderer,
  ConnectionStateToast,
} from "@livekit/components-react"
import "@livekit/components-styles"
import { Track } from "livekit-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { X, Maximize2, Minimize2, Clock, Users, Loader2, AlertTriangle, MonitorSpeaker } from "lucide-react"

interface LiveKitRoomProps {
  roomName: string
  serverUrl: string
  token: string
  displayName: string
  onClose: () => void
  onMinimize?: () => void
}

// Meeting timer hook
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

function MeetingContent({ roomName, onClose, onMinimize }: { roomName: string; onClose: () => void; onMinimize?: () => void }) {
  const timer = useMeetingTimer()
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", background: "hsl(var(--background))" }}>
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
          {onMinimize && (
            <Button variant="ghost" size="icon" onClick={onMinimize} title="Minimize">
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} title="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="destructive" size="icon" onClick={() => setLeaveOpen(true)} title="Leave">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* LiveKit video conference area */}
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

export default function TapBossLiveKitRoom({ roomName, serverUrl, token, displayName, onClose, onMinimize }: LiveKitRoomProps) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "#0a0a0a" }}>
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        data-lk-theme="default"
        style={{ flex: 1, minHeight: 0 }}
        onDisconnected={onClose}
      >
        <MeetingContent roomName={roomName} onClose={onClose} onMinimize={onMinimize} />
      </LiveKitRoom>
    </div>
  )
}

// Floating mini-player shown when the user navigates away during a call
export function MeetingMiniPlayer({
  roomName,
  serverUrl,
  token,
  onExpand,
  onLeave,
}: {
  roomName: string
  serverUrl: string
  token: string
  onExpand: () => void
  onLeave: () => void
}) {
  const timer = useMeetingTimer()

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl overflow-hidden shadow-2xl border border-border bg-card">
      <LiveKitRoom
        video={false}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        data-lk-theme="default"
        onDisconnected={onLeave}
      >
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
      </LiveKitRoom>
    </div>
  )
}
