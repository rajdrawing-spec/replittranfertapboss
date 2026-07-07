import * as React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, act, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getListOrdersQueryKey } from "@workspace/api-client-react"

/**
 * Security regression test — company scoping in the UI.
 *
 * A signed-in staff user must only ever see records for the company they are
 * viewing. This suite exercises the real client machinery that enforces that:
 *   1. Company-scoped list views (Orders) send the active companyId with every
 *      request and render only that company's rows — switching companies never
 *      leaves the previous company's rows on screen.
 *   2. Company-scoped detail views (CompanyDetail) render only the requested
 *      company's data.
 *   3. The session query is keyed by the Clerk userId, so which companies a
 *      user may access can never be read from a previous account's cache.
 *   4. On a Clerk identity change, all react-query caches (including
 *      company-scoped lists) are cleared, so the next user can never read the
 *      previous user's cached company data.
 */

// ---- Clerk mock backed by a tiny external store -----------------------------
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

// wouter is only used by the detail view for useParams()/Link. Stub it so the
// page can render standalone for a chosen company id.
vi.mock("wouter", () => ({
  useParams: () => ({ id: mockRouteId }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
let mockRouteId = "1"

import Orders from "@/pages/orders"
import CompanyDetail from "@/pages/company-detail"
import { CompanyProvider, useCompany } from "@/contexts/company-context"
import { AuthProvider } from "@/contexts/auth-context"
import { ClerkQueryClientCacheInvalidator } from "@/components/clerk-cache-invalidator"

// ---- Fixtures ---------------------------------------------------------------
const COMPANY_A = {
  id: 1, name: "Acme Foods", slug: "acme", type: "subsidiary", industry: "Food",
  brandColor: "#ef4444", archived: false, status: "active", ownershipPercent: 100,
  logoUrl: null, gstNumber: "GST-A", panNumber: "PAN-A", address: "1 Acme Rd",
}
const COMPANY_B = {
  id: 2, name: "Brava Textiles", slug: "brava", type: "subsidiary", industry: "Textiles",
  brandColor: "#3b82f6", archived: false, status: "active", ownershipPercent: 60,
  logoUrl: null, gstNumber: "GST-B", panNumber: "PAN-B", address: "2 Brava St",
}

const ordersByCompany: Record<string, any[]> = {
  "1": [{
    id: 101, orderNumber: "ORD-A-1", companyId: 1, companyName: "Acme Foods",
    customerName: "Alice Buyer", customerEmail: "alice@acme.test", customerPhone: null,
    totalAmount: 1200, itemCount: 2, status: "pending", channel: "direct",
    shippingAddress: null, notes: null, createdAt: "2026-01-01T00:00:00.000Z",
  }],
  "2": [{
    id: 201, orderNumber: "ORD-B-1", companyId: 2, companyName: "Brava Textiles",
    customerName: "Bob Buyer", customerEmail: "bob@brava.test", customerPhone: null,
    totalAmount: 3400, itemCount: 5, status: "confirmed", channel: "shopify",
    shippingAddress: null, notes: null, createdAt: "2026-01-02T00:00:00.000Z",
  }],
}

const PROFILES: Record<string, any> = {
  clerk_A: {
    id: 1, name: "Alice QA", email: "alice.qa@example.com", role: "operations_manager",
    department: null, companyIds: [1], avatarUrl: null, status: "active",
    permissions: ["orders.view"], isSuperAdmin: false,
  },
  clerk_B: {
    id: 2, name: "Bob QA", email: "bob.qa@example.com", role: "finance_manager",
    department: null, companyIds: [2], avatarUrl: null, status: "active",
    permissions: ["finance.view"], isSuperAdmin: false,
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  store.reset()
  mockRouteId = "1"
  fetchSpy = vi.fn(async (input: any) => {
    const url = String(input)

    if (url.includes("/api/auth/me")) {
      const uid = store.get().userId
      const profile = uid ? PROFILES[uid] : null
      if (!profile) return jsonResponse({ error: "not_invited" }, 403)
      return jsonResponse({ user: profile })
    }

    if (url.match(/\/api\/companies\/(\d+)\/summary/)) {
      return jsonResponse({ revenue: 500000, orders: 42, employees: 12, profit: 90000 })
    }
    if (url.match(/\/api\/companies\/(\d+)$/)) {
      const id = url.match(/\/api\/companies\/(\d+)$/)![1]
      const c = id === "1" ? COMPANY_A : COMPANY_B
      return jsonResponse(c)
    }
    if (url.includes("/api/companies")) {
      return jsonResponse([COMPANY_A, COMPANY_B])
    }

    if (url.includes("/api/orders")) {
      const companyId = new URL(url, "http://x").searchParams.get("companyId")
      const items = companyId ? ordersByCompany[companyId] ?? [] : Object.values(ordersByCompany).flat()
      return jsonResponse({ items, total: items.length, page: 1, limit: 20 })
    }

    return jsonResponse({}, 404)
  })
  globalThis.fetch = fetchSpy as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
}

// Small harness that lets a test drive the active company like the real
// company switcher does.
function CompanySwitcher() {
  const { setActiveCompanyId } = useCompany()
  return (
    <div>
      <button data-testid="pick-a" onClick={() => setActiveCompanyId(1)}>A</button>
      <button data-testid="pick-b" onClick={() => setActiveCompanyId(2)}>B</button>
    </div>
  )
}

describe("company-scoped list view (Orders)", () => {
  it("renders only the active company's orders and sends its companyId", async () => {
    const qc = newClient()
    render(
      <QueryClientProvider client={qc}>
        <CompanyProvider>
          <CompanySwitcher />
          <Orders />
        </CompanyProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByTestId("pick-a"))

    await waitFor(() => expect(screen.getByText("Alice Buyer")).toBeInTheDocument())
    // Company B's order must never appear while A is active.
    expect(screen.queryByText("Bob Buyer")).not.toBeInTheDocument()

    // Every orders request carried companyId=1 and none carried companyId=2.
    const orderUrls = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/orders"))
    expect(orderUrls.some((u) => u.includes("companyId=1"))).toBe(true)
    expect(orderUrls.every((u) => !u.includes("companyId=2"))).toBe(true)
  })

  it("switching companies never leaves the previous company's rows on screen", async () => {
    const qc = newClient()
    render(
      <QueryClientProvider client={qc}>
        <CompanyProvider>
          <CompanySwitcher />
          <Orders />
        </CompanyProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByTestId("pick-a"))
    await waitFor(() => expect(screen.getByText("Alice Buyer")).toBeInTheDocument())

    fireEvent.click(screen.getByTestId("pick-b"))
    await waitFor(() => expect(screen.getByText("Bob Buyer")).toBeInTheDocument())

    // A's row is gone the moment B is shown — no cross-company bleed.
    expect(screen.queryByText("Alice Buyer")).not.toBeInTheDocument()
  })

  it("scopes the react-query cache key by companyId", () => {
    // Distinct companies produce distinct cache keys, so one company's cached
    // list can never satisfy another company's query.
    const keyA = JSON.stringify(getListOrdersQueryKey({ page: 1, limit: 20, companyId: 1 }))
    const keyB = JSON.stringify(getListOrdersQueryKey({ page: 1, limit: 20, companyId: 2 }))
    expect(keyA).toContain("\"companyId\":1")
    expect(keyB).toContain("\"companyId\":2")
    expect(keyA).not.toBe(keyB)
  })
})

describe("company-scoped detail view (CompanyDetail)", () => {
  it("renders only the requested company's data", async () => {
    mockRouteId = "2"
    const qc = newClient()
    render(
      <QueryClientProvider client={qc}>
        <CompanyDetail />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Brava Textiles/ })).toBeInTheDocument(),
    )
    // The other company's identifying data never renders on B's page.
    expect(screen.queryByText(/Acme Foods/)).not.toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.textContent === "Textiles • 60% Ownership"),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Acme|Food/)).not.toBeInTheDocument()

    // Detail requests only ever asked for company 2.
    const detailUrls = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => /\/api\/companies\/\d+/.test(u))
    expect(detailUrls.length).toBeGreaterThan(0)
    expect(detailUrls.every((u) => u.includes("/api/companies/2"))).toBe(true)
  })
})

describe("cross-user isolation of company access", () => {
  it("keys the session (which companies a user may access) by Clerk userId", async () => {
    const qc = newClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await act(async () => store.set({ isLoaded: true, isSignedIn: true, userId: "clerk_A" }))

    await waitFor(() => expect(qc.getQueryData(["auth", "me", "clerk_A"])).toBeTruthy())
    // A's company scope is cached only under A's key, never under B's.
    const cachedA: any = qc.getQueryData(["auth", "me", "clerk_A"])
    expect(cachedA.user.companyIds).toEqual([1])
    expect(qc.getQueryData(["auth", "me", "clerk_B"])).toBeUndefined()
  })

  it("clears cached company-scoped lists when the Clerk identity changes", async () => {
    const qc = newClient()
    render(
      <QueryClientProvider client={qc}>
        <ClerkQueryClientCacheInvalidator />
        <div />
      </QueryClientProvider>,
    )

    // Prime the cache as if user A had loaded company 1's orders.
    const ordersKey = getListOrdersQueryKey({ page: 1, limit: 20, companyId: 1 })
    await act(async () => {
      store.set({ isLoaded: true, isSignedIn: true, userId: "clerk_A" })
      qc.setQueryData(ordersKey, { items: ordersByCompany["1"], total: 1, page: 1, limit: 20 })
    })
    expect(qc.getQueryData(ordersKey)).toBeTruthy()

    // Switching to user B must wipe A's company-scoped list from the cache.
    await act(async () => store.set({ userId: "clerk_B" }))
    await waitFor(() => expect(qc.getQueryData(ordersKey)).toBeUndefined())
  })
})
