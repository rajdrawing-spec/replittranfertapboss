/**
 * Global meeting context — holds a single LiveKit connection that persists
 * across route changes, and listens for incoming call notifications via
 * Socket.IO so the popup appears on every page.
 */
import * as React from "react"
import * as ReactDOM from "react-dom"
import { useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { useAuth } from "@/contexts/auth-context"
import { MeetingOverlay } from "@/components/meetings/livekit-room"
import { IncomingCallPopup, type IncomingCallData } from "@/components/meetings/incoming-call-popup"

// Minimum meeting info the context needs
export interface ActiveCallMeeting {
  /** DB row id — optional when joining from an incoming-call notification */
  id?: number
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
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [activeCall, setActiveCall] = React.useState<ActiveCall | null>(null)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [incomingCall, setIncomingCall] = React.useState<IncomingCallData | null>(null)

  // Keep a ref so the leaveCall closure always sees the current value
  const activeCallRef = React.useRef<ActiveCall | null>(null)
  activeCallRef.current = activeCall

  // ── Call management ────────────────────────────────────────────────────────

  const startCall = React.useCallback(
    (meeting: ActiveCallMeeting, token: string, serverUrl: string) => {
      setActiveCall({ meeting, token, serverUrl })
      setIsMinimized(false)
      // Dismiss any pending incoming call popup when user starts/joins a call
      setIncomingCall(null)
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

  // ── Incoming call socket listener ──────────────────────────────────────────
  // This socket is separate from the one in chat.tsx so that meeting
  // notifications arrive on every page, not only when Chat is open.
  //
  // Reconnection strategy: Socket.IO's `auth` option accepts a *function*
  // that is called fresh before every connection attempt, including automatic
  // reconnects. Each call fetches a new one-time token from the server so
  // reconnects always authenticate with a valid credential. No server changes
  // are required — `createSocketToken` already generates a fresh token on
  // each GET /api/chat/token request.

  React.useEffect(() => {
    if (!user?.id) return

    const s: Socket = io({
      path: "/socket.io",
      // auth as a function — invoked by socket.io-client before each
      // connection/reconnection handshake, so every attempt gets a fresh token
      auth: (cb: (data: object) => void) => {
        fetch("/api/chat/token", { credentials: "include" })
          .then((r) => r.json())
          .then(({ token }) => cb({ token }))
          .catch(() => cb({})) // empty object → server rejects → connect_error
      },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
      // Cap retries: if the server keeps rejecting (e.g. session expired /
      // server never comes back) we stop after 10 attempts rather than forever
      reconnectionAttempts: 10,
    })

    s.on("meeting:ringing", (data: IncomingCallData) => {
      // Ignore the event if the user is already in a call
      if (activeCallRef.current) return
      setIncomingCall(data)
    })

    s.on("connect_error", (err) => {
      // Non-fatal — meeting notifications are best-effort. Socket.IO will
      // fetch a new token and retry automatically up to reconnectionAttempts.
      console.debug("[meeting-socket] connect error:", err.message)
    })

    return () => {
      s.disconnect()
    }
  }, [user?.id])

  // ── Accept incoming call ───────────────────────────────────────────────────

  const handleAcceptCall = React.useCallback(async () => {
    if (!incomingCall) return
    const res = await fetch(
      `/api/meetings/token?roomName=${encodeURIComponent(incomingCall.meetingId)}&companyId=${incomingCall.companyId}`,
      { credentials: "include" },
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to get token" }))
      throw new Error(err.error || "Failed to get call token")
    }
    const { token, serverUrl } = await res.json()
    startCall(
      { meetingId: incomingCall.meetingId, title: incomingCall.title, companyId: incomingCall.companyId },
      token,
      serverUrl,
    )
    // Mark joined server-side (best-effort)
    fetch(`/api/meetings/join/${incomingCall.meetingId}`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {})
    queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
    setIncomingCall(null)
  }, [incomingCall, startCall, queryClient])

  const handleDeclineCall = React.useCallback(() => {
    setIncomingCall(null)
  }, [])

  return (
    <MeetingContext.Provider
      value={{ activeCall, isMinimized, startCall, leaveCall, setMinimized: setIsMinimized }}
    >
      {children}

      {/* Single LiveKitRoom — persists across navigation */}
      <MeetingOverlay
        activeCall={activeCall}
        isMinimized={isMinimized}
        onLeave={leaveCall}
        onMinimize={() => setIsMinimized(true)}
        onExpand={() => setIsMinimized(false)}
      />

      {/* Incoming call popup — portal to body so it floats above everything */}
      {incomingCall &&
        ReactDOM.createPortal(
          <IncomingCallPopup
            call={incomingCall}
            onAccept={handleAcceptCall}
            onDecline={handleDeclineCall}
          />,
          document.body,
        )}
    </MeetingContext.Provider>
  )
}
