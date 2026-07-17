/**
 * Floating popup shown when a colleague invites you to a meeting.
 * Rendered via ReactDOM.createPortal in MeetingProvider so it appears
 * on every page, not just the meetings page.
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Phone, PhoneOff, Video, Loader2 } from "lucide-react"

const AUTO_DISMISS_SECS = 30

export interface IncomingCallData {
  meetingId: string
  title: string
  organizerName: string
  companyId: number
}

interface Props {
  call: IncomingCallData
  onAccept: () => Promise<void>
  onDecline: () => void
}

export function IncomingCallPopup({ call, onAccept, onDecline }: Props) {
  const [accepting, setAccepting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [remaining, setRemaining] = React.useState(AUTO_DISMISS_SECS)

  // Count-down and auto-dismiss
  React.useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id)
          onDecline()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [onDecline])

  const handleAccept = async () => {
    setAccepting(true)
    setError(null)
    try {
      await onAccept()
    } catch (e) {
      setError(String(e))
      setAccepting(false)
    }
  }

  const progress = (remaining / AUTO_DISMISS_SECS) * 100

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] w-80 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
      role="alertdialog"
      aria-label="Incoming meeting invitation"
    >
      {/* Countdown progress bar at top */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* Pulsing ring icon */}
          <div className="relative shrink-0 mt-0.5">
            <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Video className="h-5 w-5 text-primary" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Incoming meeting invitation</p>
            <p className="font-semibold text-sm leading-tight truncate">{call.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              from <span className="font-medium text-foreground">{call.organizerName}</span>
            </p>
          </div>
          <button
            onClick={onDecline}
            className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onDecline}
            disabled={accepting}
          >
            <PhoneOff className="h-3.5 w-3.5" />
            Decline
          </Button>
          <Button
            size="sm"
            className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            onClick={handleAccept}
            disabled={accepting}
          >
            {accepting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
            {accepting ? "Joining…" : "Accept"}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Auto-dismissing in {remaining}s
        </p>
      </div>
    </div>
  )
}
