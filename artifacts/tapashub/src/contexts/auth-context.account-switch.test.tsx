import * as React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, act, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * Security regression test — switching Clerk accounts must never surface the
 * previous account's cached profile (name / role / permissions / access state).
 *
 * Real sign-in here is Clerk Google OAuth (invite-only), which cannot be driven
 * from a headless test. So we mock the Clerk identity boundary and the
 * /api/auth/me endpoint, then exercise the exact client-side machinery that
 * enforces isolation:
 *   1. AuthProvider's session query is keyed by the Clerk userId
 *      (["auth","me",userId]) — a new identity is a new cache key, so it can
 *      never read the previous account's cached result.
 *   2. ClerkQueryClientCacheInvalidator wipes all react-query caches the moment
 *      the Clerk identity changes (defense in depth).
 */

// ---- Clerk mock backed by a tiny external store -----------------------------
// useSyncExternalStore lets an identity change re-render every consumer, exactly
// like the real @clerk/react hooks do.
const store = vi.hoisted(() => {
  type ClerkState = { isLoaded: boolean; isSignedIn: boolean; userId: string | null }
  let state: ClerkState = { isLoaded: true, isSignedIn: false, userId: null }
  const snapListeners = new Set<() => void>()
  const clerkListeners = new Set<(p: { user: { id: string } | null }) => void>()
  return {
    get: (): ClerkState => state,
    subscribe(cb: () => void) {
      snapListeners.add(cb)
      return () => void snapListeners.delete(cb)
    },
    addClerkListener(cb: (p: { user: { id: string } | null }) => void) {
      clerkListeners.add(cb)
      return () => void clerkListeners.delete(cb)
    },
    set(next: Partial<ClerkState>) {
      const prev = state
      state = { ...state, ...next }
      // Fire the Clerk identity listener first (mirrors the invalidator clearing
      // caches before the new identity's query starts), then re-render.
      if (prev.userId !== state.userId) {
        clerkListeners.forEach((l) => l({ user: state.userId ? { id: state.userId } : null }))
      }
      snapListeners.forEach((l) => l())
    },
    reset() {
      state = { isLoaded: true, isSignedIn: false, userId: null }
      snapListeners.clear()
      clerkListeners.clear()
    },
  }
})

vi.mock("@clerk/react", async () => {
  const React = await import("react")
  return {
    useAuth: () => React.useSyncExternalStore(store.subscribe, store.get, store.get),
    useClerk: () =>
      React.useMemo(
        () => ({
          signOut: async () => store.set({ isSignedIn: false, userId: null }),
          addListener: (cb: (p: { user: { id: string } | null }) => void) =>
            store.addClerkListener(cb),
        }),
        [],
      ),
  }
})

import { AuthProvider, useAuth } from "@/contexts/auth-context"
import { ClerkQueryClientCacheInvalidator } from "@/components/clerk-cache-invalidator"

// Two authorized accounts + one that is not invited.
const PROFILES: Record<string, any> = {
  clerk_A: {
    id: 1, name: "Alice QA", email: "alice.qa@example.com", role: "operations_manager",
    department: null, companyIds: [], avatarUrl: null, status: "active",
    permissions: ["orders.view"], isSuperAdmin: false,
  },
  clerk_B: {
    id: 2, name: "Bob QA", email: "bob.qa@example.com", role: "finance_manager",
    department: null, companyIds: [], avatarUrl: null, status: "active",
    permissions: ["finance.view"], isSuperAdmin: false,
  },
}

// Records every name AuthProvider renders, so we can prove no previous-user
// value ever appears after an account switch.
const renderLog: string[] = []

function Identity() {
  const { user, loading, accessError } = useAuth()
  renderLog.push(user?.name ?? "")
  const state = loading ? "loading" : accessError ? `denied:${accessError}` : user ? "authed" : "anon"
  return (
    <div>
      <div data-testid="state">{state}</div>
      <div data-testid="name">{user?.name ?? ""}</div>
      <div data-testid="role">{user?.role ?? ""}</div>
      <div data-testid="perms">{(user?.permissions ?? []).join(",")}</div>
    </div>
  )
}

function renderApp() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const utils = render(
    <QueryClientProvider client={qc}>
      <ClerkQueryClientCacheInvalidator />
      <AuthProvider>
        <Identity />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { qc, ...utils }
}

async function signInAs(userId: string) {
  await act(async () => {
    store.set({ isLoaded: true, isSignedIn: true, userId })
  })
}

beforeEach(() => {
  store.reset()
  renderLog.length = 0
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = String(input)
    if (url.includes("/api/auth/me")) {
      const uid = store.get().userId
      const profile = uid ? PROFILES[uid] : null
      if (!profile) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: "not_invited",
            message: "You have not been invited to this workspace.",
          }),
        } as any
      }
      return { ok: true, status: 200, json: async () => ({ user: profile }) } as any
    }
    return { ok: false, status: 404, json: async () => ({}) } as any
  }) as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("account switch isolation", () => {
  it("mounts signed-out cleanly with no user data", async () => {
    renderApp()
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("anon"))
    expect(screen.getByTestId("name").textContent).toBe("")
  })

  it("after logging out of A and into B, shows only B — never A's data", async () => {
    renderApp()

    // Sign in as A.
    await signInAs("clerk_A")
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Alice QA"))
    expect(screen.getByTestId("perms").textContent).toBe("orders.view")

    // Log out (clears identity), then sign in as B.
    await act(async () => store.set({ isSignedIn: false, userId: null }))
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("anon"))

    const switchIdx = renderLog.length
    await signInAs("clerk_B")
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Bob QA"))

    // B's identity and permissions are shown...
    expect(screen.getByTestId("role").textContent).toBe("finance_manager")
    expect(screen.getByTestId("perms").textContent).toBe("finance.view")
    // ...and A's name never rendered once we started switching to B.
    expect(renderLog.slice(switchIdx).every((n) => n !== "Alice QA")).toBe(true)
  })

  it("direct account switch (A -> B, no intermediate logout) never flashes A", async () => {
    renderApp()

    await signInAs("clerk_A")
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Alice QA"))

    const switchIdx = renderLog.length
    await act(async () => store.set({ userId: "clerk_B" }))
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Bob QA"))

    expect(renderLog.slice(switchIdx).every((n) => n !== "Alice QA")).toBe(true)
    expect(screen.getByTestId("perms").textContent).toBe("finance.view")
  })

  it("clears the previous account's cached profile on switch (invalidator)", async () => {
    const { qc } = renderApp()

    await signInAs("clerk_A")
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Alice QA"))
    expect(qc.getQueryData(["auth", "me", "clerk_A"])).toBeTruthy()

    await act(async () => store.set({ userId: "clerk_B" }))
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Bob QA"))

    // A's cached result must be gone — the identity-change listener wiped it.
    expect(qc.getQueryData(["auth", "me", "clerk_A"])).toBeUndefined()
    expect(qc.getQueryData(["auth", "me", "clerk_B"])).toBeTruthy()
  })

  it("a not-invited account after A sees Access-restricted, not A's authorized view", async () => {
    renderApp()

    await signInAs("clerk_A")
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Alice QA"))

    const switchIdx = renderLog.length
    await act(async () => store.set({ userId: "clerk_denied" }))
    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("denied:not_invited"),
    )

    // No leftover identity from A.
    expect(screen.getByTestId("name").textContent).toBe("")
    expect(screen.getByTestId("perms").textContent).toBe("")
    expect(renderLog.slice(switchIdx).every((n) => n !== "Alice QA")).toBe(true)
  })
})
