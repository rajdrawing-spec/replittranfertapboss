/**
 * Global meeting context — holds a single LiveKit connection that persists
 * across route changes, and listens for incoming call notifications via
 * Socket.IO so the popup appears on every page.
 */
import * as React from "react"
import * as ReactDOM from "react-dom"
import { useQueryClient } from "@tanstack/react-query"
import { io, type Socket } from "socket.io-client"
import { DisconnectReason } from "livekit-client"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { MeetingOverlay } from "@/components/meetings/livekit-room"
import { IncomingCallPopup, type IncomingCallData } from "@/components/meetings/incoming-call-popup"
import { finishRecording } from "@/components/meetings/meeting-recorder"

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
  /** false = voice call (camera starts off). Defaults to video. */
  video?: boolean
}

interface MeetingContextValue {
  activeCall: ActiveCall | null
  isMinimized: boolean
  /** Fetch a token externally, then call this to start the shared connection. */
  startCall: (meeting: ActiveCallMeeting, token: string, serverUrl: string, opts?: { video?: boolean }) => void
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
  const { toast } = useToast()

  const [activeCall, setActiveCall] = React.useState<ActiveCall | null>(null)
  const [isMinimized, setIsMinimized] = React.useState(false)
  const [incomingCall, setIncomingCall] = React.useState<IncomingCallData | null>(null)

  // Keep a ref so the leaveCall closure always sees the current value
  const activeCallRef = React.useRef<ActiveCall | null>(null)
  activeCallRef.current = activeCall

  // Ref to the shared socket so event handlers and decline can access it
  const socketRef = React.useRef<ReturnType<typeof io> | null>(null)

  // ── Call management ────────────────────────────────────────────────────────

  const startCall = React.useCallback(
    (meeting: ActiveCallMeeting, token: string, serverUrl: string, opts?: { video?: boolean }) => {
      leavingRef.current = false
      setActiveCall({ meeting, token, serverUrl, video: opts?.video })
      setIsMinimized(false)
      // Dismiss any pending incoming call popup when user starts/joins a call
      setIncomingCall(null)
    },
    [],
  )

  // Set when the user explicitly leaves so the onDisconnected handler does
  // not try to auto-rejoin a call the user intentionally ended.
  const leavingRef = React.useRef(false)

  const leaveCall = React.useCallback(async () => {
    leavingRef.current = true
    const call = activeCallRef.current
    if (call) {
      // Hand the captured audio to the AI Meeting Assistant (best-effort)
      void finishRecording(call.meeting.meetingId)
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
      // /api/socket.io so the connection follows the same routing as all API
      // calls (works in dev AND in the deployed app, where only /api/* is
      // forwarded to the backend).
      path: "/api/socket.io",
      // auth as a function — invoked by socket.io-client before each
      // connection/reconnection handshake, so every attempt gets a fresh token
      auth: (cb: (data: object) => void) => {
        fetch("/api/chat/token", { credentials: "include" })
          .then((r) => r.json())
          .then(({ token }) => cb({ token }))
          .catch(() => cb({})) // empty object → server rejects → connect_error
      },
      // Default transports: polling first (works through any proxy), then
      // upgrade to WebSocket when possible.
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
    })

    socketRef.current = s

    s.on("meeting:ringing", (data: IncomingCallData) => {
      // Ignore the event if the user is already in a call
      if (activeCallRef.current) return
      setIncomingCall(data)
    })

    s.on("meeting:declined", (data: { meetingId: string; title: string; declinedByName: string }) => {
      toast({
        title: "Meeting declined",
        description: `${data.declinedByName} declined to join ${data.title}`,
      })
    })

    s.on("connect_error", (err) => {
      // Non-fatal — meeting notifications are best-effort. Socket.IO will
      // fetch a new token and retry automatically up to reconnectionAttempts.
      console.debug("[meeting-socket] connect error:", err.message)
    })

    return () => {
      socketRef.current = null
      s.disconnect()
    }
  }, [user?.id, toast])

  // ── Accept incoming call ───────────────────────────────────────────────────

  const handleAcceptCall = React.useCallback(async () => {
    if (!incomingCall) return
    try {
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
    } catch (e: any) {
      // A rejected accept must never crash the app — surface the reason
      // (meeting ended/cancelled, not a participant, LiveKit down, ...)
      toast({
        title: "Could not join the call",
        description: e?.message || "The meeting may have ended or been cancelled.",
        variant: "destructive",
      })
    } finally {
      setIncomingCall(null)
    }
  }, [incomingCall, startCall, queryClient, toast])

  // ── Unexpected-disconnect recovery ─────────────────────────────────────────
  // LiveKit tokens have a 4h TTL and connections can drop (network blip,
  // sleep/wake, server restart). When the room disconnects and the user did
  // NOT click Leave, fetch a fresh token and rejoin automatically. The
  // LiveKitRoom is keyed on the token, so a new token forces a clean
  // reconnect with a valid credential.
  const handleRoomDisconnected = React.useCallback(async (reason?: DisconnectReason) => {
    const call = activeCallRef.current
    if (!call) return
    if (leavingRef.current) {
      // User-initiated leave — leaveCall already handles cleanup
      leavingRef.current = false
      return
    }
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      // The user clicked LiveKit's built-in Leave button in the control bar.
      // That disconnects the room directly, bypassing our leaveCall(), so do
      // the same cleanup here instead of treating it as a dropped connection
      // (which would silently auto-rejoin them).
      leavingRef.current = false
      setActiveCall(null)
      setIsMinimized(false)
      void finishRecording(call.meeting.meetingId)
      fetch(`/api/meetings/leave/${call.meeting.meetingId}`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
      return
    }
    const MAX_ATTEMPTS = 4
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Bail if the user left / call changed while we were retrying
      const current = activeCallRef.current
      if (!current || current.meeting.meetingId !== call.meeting.meetingId || leavingRef.current) return
      try {
        const res = await fetch(
          `/api/meetings/token?roomName=${encodeURIComponent(call.meeting.meetingId)}&companyId=${call.meeting.companyId}`,
          { credentials: "include" },
        )
        if (res.ok) {
          const { token, serverUrl } = await res.json()
          if (attempt === 1) toast({ title: "Reconnecting to call…" })
          setActiveCall((prev) =>
            prev && prev.meeting.meetingId === call.meeting.meetingId
              ? { ...prev, token, serverUrl }
              : prev,
          )
          return
        }
        if (res.status >= 400 && res.status < 500) {
          // Meeting ended/cancelled or access revoked — end the call cleanly
          const err = await res.json().catch(() => ({}))
          toast({
            title: "Call ended",
            description: (err as any).error || "The meeting is no longer available.",
          })
          void finishRecording(call.meeting.meetingId)
          setActiveCall(null)
          setIsMinimized(false)
          queryClient.invalidateQueries({ queryKey: ["/api/meetings"] })
          return
        }
        // 5xx — transient backend trouble; fall through to retry
      } catch {
        // network failure — fall through to retry
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 2_000)) // 2s, 4s, 6s backoff
      }
    }
    toast({
      title: "Call disconnected",
      description: "Could not reconnect. Please rejoin from the Team page.",
      variant: "destructive",
    })
    void finishRecording(call.meeting.meetingId)
    setActiveCall(null)
    setIsMinimized(false)
  }, [queryClient, toast])

  const handleDeclineCall = React.useCallback(() => {
    if (incomingCall && socketRef.current) {
      socketRef.current.emit("meeting:declined", { meetingId: incomingCall.meetingId })
    }
    setIncomingCall(null)
  }, [incomingCall])

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
        onDisconnected={handleRoomDisconnected}
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
