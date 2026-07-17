/**
 * Global meeting context — holds a single LiveKit connection that persists
 * across route changes, preventing audio drops when the user navigates away.
 */
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MeetingOverlay } from "@/components/meetings/livekit-room"

// Minimum meeting info the context needs
export interface ActiveCallMeeting {
  id: number
  meetingId: string
  title: string
  companyId: number
}

export interface ActiveCall {
  meeting: ActiveCallMeeting
  token: string
  serverUrl: string
}

interface MeetingContextValue {
  activeCall: ActiveCall | null
  isMinimized: boolean
  /** Fetch a token externally, then call this to start the shared connection. */
  startCall: (meeting: ActiveCallMeeting, token: string, serverUrl: string) => void
  /** Leave the call, hit the server leave endpoint, and clear state. */
  leaveCall: () => Promise<void>
  setMinimized: (v: boolean) => void
}

const MeetingContext = React.createContext<MeetingContextValue | null>(null)

export function useMeeting(): MeetingContextValue {
  const ctx = React.useContext(MeetingContext)
  if (!ctx) throw new Error("useMeeting must be used inside MeetingProvider")
  return ctx
}

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const [activeCall, setActiveCall] = React.useState<ActiveCall | null>(null)
  const [isMinimized, setIsMinimized] = React.useState(false)
  // Keep a ref so the leaveCall closure always sees the current value
  const activeCallRef = React.useRef<ActiveCall | null>(null)
  activeCallRef.current = activeCall
  const queryClient = useQueryClient()

  const startCall = React.useCallback(
    (meeting: ActiveCallMeeting, token: string, serverUrl: string) => {
      setActiveCall({ meeting, token, serverUrl })
      setIsMinimized(false)
    },
    [],
  )

  const leaveCall = React.useCallback(async () => {
    const call = activeCallRef.current
    if (call) {
      try {
        await fetch(`/api/meetings/leave/${call.meeting.meetingId}`, {
          method: "POST",
          credentials: "include",
        })
      } catch {
        // best-effort; don't block UI on network error
      }
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    }
    setActiveCall(null)
    setIsMinimized(false)
  }, [queryClient])

  return (
    <MeetingContext.Provider
      value={{ activeCall, isMinimized, startCall, leaveCall, setMinimized: setIsMinimized }}
    >
      {children}
      {/* Single LiveKitRoom mounted here — survives navigation */}
      <MeetingOverlay
        activeCall={activeCall}
        isMinimized={isMinimized}
        onLeave={leaveCall}
        onMinimize={() => setIsMinimized(true)}
        onExpand={() => setIsMinimized(false)}
      />
    </MeetingContext.Provider>
  )
}
