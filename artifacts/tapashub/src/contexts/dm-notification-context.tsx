/**
 * DmNotificationContext — global socket listener that shows a toast + plays a
 * notification sound whenever the logged-in user receives a new direct message
 * and is NOT currently on the /chat page viewing that channel.
 *
 * Mirrors the same pattern used by MeetingProvider for incoming-call toasts.
 */
import * as React from "react"
import { io, type Socket } from "socket.io-client"
import { useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { MessageSquare } from "lucide-react"

/* ─── Soft notification chime via Web Audio API ────────────────────────────── */

function playDmSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = "sine"
    // Two-note chime: C5 → E5
    osc.frequency.setValueAtTime(523.25, t)         // C5
    osc.frequency.setValueAtTime(659.25, t + 0.12)  // E5
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
    gain.gain.setValueAtTime(0.18, t + 0.10)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
    osc.start(t)
    osc.stop(t + 0.55)
    osc.onended = () => ctx.close()
  } catch (_) {
    // AudioContext may be blocked before a user gesture — silently skip
  }
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface DmNotificationContextValue {
  /** Set the channel the user is currently viewing so we can suppress its DMs */
  setActiveChannelId: (id: number | null) => void
}

const DmNotificationContext = React.createContext<DmNotificationContextValue>({
  setActiveChannelId: () => {},
})

export function useDmNotification() {
  return React.useContext(DmNotificationContext)
}

/* ─── Provider ────────────────────────────────────────────────────────────── */

interface IncomingMessage {
  id: number
  channelId: number
  userId: number
  displayName: string
  content: string
  channelType?: "direct" | "team" | "department" | "project"
  channelName?: string
}

export function DmNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [location] = useLocation()
  const locationRef = React.useRef(location)
  locationRef.current = location

  // The channel the user is actively reading — suppress notifications for it
  const [activeChannelId, setActiveChannelId] = React.useState<number | null>(null)
  const activeChannelRef = React.useRef(activeChannelId)
  activeChannelRef.current = activeChannelId

  React.useEffect(() => {
    if (!user?.id) return

    const s: Socket = io({
      path: "/api/socket.io",
      auth: (cb: (data: object) => void) => {
        fetch("/api/chat/token", { credentials: "include" })
          .then((r) => r.json())
          .then(({ token }) => cb({ token }))
          .catch(() => cb({}))
      },
      reconnection: true,
      reconnectionDelay: 3_000,
      reconnectionDelayMax: 60_000,
    })

    s.on("message:new", (msg: IncomingMessage) => {
      // Only react to DMs sent by someone else
      if (msg.userId === user.id) return
      // Only for direct channels
      if (msg.channelType && msg.channelType !== "direct") return

      // Suppress if the user is already on /chat and reading this channel
      const onChatPage = locationRef.current === "/chat" || locationRef.current.startsWith("/chat?")
      const viewingThisChannel = onChatPage && activeChannelRef.current === msg.channelId

      if (!viewingThisChannel) {
        playDmSound()
        toast({
          title: `💬 ${msg.displayName}`,
          description: msg.content.length > 80 ? msg.content.slice(0, 77) + "…" : msg.content,
          duration: 5000,
        })
      }

      // Always keep unread counts up-to-date (react-query invalidation)
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] })
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] })
    })

    s.on("connect_error", (err) => {
      console.debug("[dm-notification-socket] connect error:", err.message)
    })

    return () => { s.disconnect() }
  }, [user?.id, toast, queryClient])

  const value = React.useMemo(
    () => ({ setActiveChannelId }),
    []
  )

  return (
    <DmNotificationContext.Provider value={value}>
      {children}
    </DmNotificationContext.Provider>
  )
}
