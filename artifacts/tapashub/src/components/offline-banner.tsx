import * as React from "react"
import { WifiOff } from "lucide-react"

/**
 * Thin banner pinned to the bottom of the viewport whenever the browser reports
 * it's offline. On flaky/low-bandwidth connections this tells the user why data
 * isn't updating, instead of leaving them staring at stale content or spinners.
 */
export function OfflineBanner() {
  const [online, setOnline] = React.useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  )

  React.useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black shadow-lg"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>You're offline — showing saved data. Changes will sync when you reconnect.</span>
    </div>
  )
}
