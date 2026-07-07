import * as React from "react"
import { useClerk } from "@clerk/react"
import { useQueryClient } from "@tanstack/react-query"

/**
 * Defense-in-depth against cross-account data bleed. The session query is
 * already keyed by the Clerk userId (see auth-context), so a new account can
 * never read a previous account's cached profile. This listener additionally
 * clears *all* react-query caches the moment the Clerk identity changes
 * (logout, login, or account switch), so no page keeps showing the previous
 * user's data after a switch.
 */
export function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk()
  const qc = useQueryClient()
  const prevUserIdRef = React.useRef<string | null | undefined>(undefined)

  React.useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear()
      }
      prevUserIdRef.current = userId
    })
    return unsubscribe
  }, [addListener, qc])

  return null
}
