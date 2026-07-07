import * as React from "react"
import { useAuth as useClerkAuth, useClerk } from "@clerk/react"

export interface AuthUser {
  id: number
  name: string
  email: string
  role: string
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth()
  const { signOut } = useClerk()
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [accessError, setAccessError] = React.useState<string | null>(null)
  const [accessMessage, setAccessMessage] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState(false)

  const fetchMe = React.useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setAccessError(null)
        setAccessMessage(null)
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        setUser(null)
        setAccessError(data.error || "not_invited")
        setAccessMessage(data.message || "You do not have access to this workspace.")
      } else {
        // Signed in per Clerk, but the profile fetch failed (401/500/etc.).
        // Surface an error instead of leaving the app stuck on a loading screen.
        setUser(null)
        setAccessError(null)
        setAccessMessage(null)
        setLoadError(true)
      }
    } catch {
      setUser(null)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setUser(null)
      setAccessError(null)
      setAccessMessage(null)
      setLoading(false)
      return
    }
    void fetchMe()
  }, [isLoaded, isSignedIn, fetchMe])

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
        refetch: fetchMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return React.useContext(AuthContext)
}
