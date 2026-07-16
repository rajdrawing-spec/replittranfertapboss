import * as React from "react"
import { JitsiMeeting } from "@jitsi/react-sdk"
import { Button } from "@/components/ui/button"
import { X, Maximize2 } from "lucide-react"

interface JitsiMeetProps {
  roomName: string
  serverUrl?: string
  password?: string
  displayName: string
  email?: string
  onClose: () => void
}

export default function JitsiMeet({ roomName, serverUrl = "https://meet.jit.si", password, displayName, email = "user@tapashub.com", onClose }: JitsiMeetProps) {
  const [api, setApi] = React.useState<any>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  React.useEffect(() => {
    return () => {
      try {
        api?.dispose?.()
      } catch {
        // ignore
      }
    }
  }, [api])

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b">
        <span className="font-medium">{roomName}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="destructive" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <JitsiMeeting
          domain={serverUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          roomName={roomName}
          configOverwrite={{
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            prejoinPageEnabled: false,
          }}
          interfaceConfigOverwrite={{
            APP_NAME: "TAPBOSS",
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
          }}
          userInfo={{
            displayName,
            email,
          }}
          getIFrameRef={(iframeRef) => {
            iframeRef.style.height = "100%"
            iframeRef.style.width = "100%"
            iframeRef.style.border = "0"
          }}
          onApiReady={(externalApi) => {
            setApi(externalApi)
            if (password) {
              try {
                externalApi.executeCommand("password", password)
              } catch {
                // password may not be supported on all servers
              }
            }
          }}
          onReadyToClose={onClose}
        />
      </div>
    </div>
  )
}
