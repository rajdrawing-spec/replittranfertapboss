import * as React from "react"
import { useAuth as useClerkAuth, useClerk } from "@clerk/react"
import { useQuery } from "@tanstack/react-query"

export interface AuthUser {
  id: number
  name: string
  email: string
  role: string
  extraRoles: string[]
  department: string | null
  companyIds: number[]
  avatarUrl: string | null
  status: string
  permissions: string[]
  isSuperAdmin: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /** null when OK, otherwise "not_invited" | "disabled" */
  accessError: string | null
  accessMessage: string | null
  /** true when signed in but the profile fetch failed for a non-access reason (401/500/network) */
  loadError: boolean
  isSuperAdmin: boolean
  hasPermission: (perm: string) => boolean
  logout: () => Promise<void>
  refetch: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  loading: true,
  accessError: null,
  accessMessage: null,
  loadError: false,
  isSuperAdmin: false,
  hasPermission: () => false,
  logout: async () => {},
  refetch: async () => {},
})

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

/** Discriminated result of the /api/auth/me probe. Access denials (403) are a
 *  valid outcome, not a thrown error — only network/5xx failures throw so that
 *  react-query treats them as retryable load errors. */
type MeResult =
  | { kind: "ok"; user: AuthUser }
  | { kind: "access"; error: string; message: string }

async function fetchMe(): Promise<MeResult> {
  const res = await fetch("/api/auth/me", {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  })
  if (res.ok) {
    const data = await res.json()
    return { kind: "ok", user: data.user as AuthUser }
  }
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}))
    return {
      kind: "access",
      error: data.error || "not_invited",
      message: data.message || "You do not have access to this workspace.",
    }
  }
  // Signed in per Clerk, but the profile fetch failed (401/500/etc.).
  throw new Error(`profile_fetch_failed_${res.status}`)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useClerkAuth()
  const { signOut } = useClerk()

  // Managed, cached session query: dedups concurrent callers, caches across
  // mounts, and only runs once Clerk confirms the user is signed in. The key is
  // scoped to the Clerk userId so a different account can never read a cached
  // profile from a previous one — cache isolation does not depend on any
  // invalidation-listener timing.
  const query = useQuery<MeResult>({
    queryKey: ["auth", "me", userId ?? null],
    queryFn: fetchMe,
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const data = query.data
  const user = data?.kind === "ok" ? data.user : null
  const accessError = data?.kind === "access" ? data.error : null
  const accessMessage = data?.kind === "access" ? data.message : null
  const loadError = query.isError
  // Loading until Clerk resolves, or (when signed in) until the first result
  // arrives. Signed-out users resolve immediately — no lingering screen.
  const loading = !isLoaded || (!!isSignedIn && data === undefined && !query.isError)

  const refetch = React.useCallback(async () => {
    await query.refetch()
  }, [query])

  const logout = React.useCallback(async () => {
    await signOut({ redirectUrl: basePath || "/" })
  }, [signOut])

  const hasPermission = React.useCallback(
    (perm: string) => {
      if (!user) return false
      if (user.isSuperAdmin) return true
      return user.permissions.includes("*") || user.permissions.includes(perm)
    },
    [user],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessError,
        accessMessage,
        loadError,
        isSuperAdmin: user?.isSuperAdmin ?? false,
        hasPermission,
        logout,
        refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return React.useContext(AuthContext)
}
