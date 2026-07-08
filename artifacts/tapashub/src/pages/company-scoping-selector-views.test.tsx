import * as React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * Security regression test — company scoping for the views that carry their own
 * in-page company selector (Shareholders, Analytics) plus the two group / user
 * scoped ledgers that have no per-company switch (Fund Allocations,
 * Notifications).
 *
 * Shareholders and Analytics send the selected companyId with every request and
 * key their react-query caches by it, so switching the selector must:
 *   1. Render only the selected company's rows (Shareholders).
 *   2. Drop the previous company's rows on switch — no cross-company bleed.
 *   3. Carry the selected companyId on every scoped request, never the other's.
 *
 * Fund Allocations (a group treasury ledger of inter-company transfers) and
 * Notifications (per-recipient) have no in-page company switch — their
 * isolation is enforced server-side. For those we prove the client renders only
 * the rows the already-scoped API returns and never fabricates another
 * company's record.
 */

vi.mock("wouter", () => ({
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useLocation: () => ["/", () => {}],
}))

// Give every test a logged-in admin user so the Shareholders page shows the
// admin/manage view rather than the shareholder self-service view.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Admin", email: "admin@test.com", role: "company_admin", companyIds: [], permissions: ["shareholders.manage", "shareholders.view"] },
    hasPermission: () => true,
    isSuperAdmin: false,
    loading: false,
    accessError: null,
    accessMessage: null,
    loadError: false,
    logout: async () => {},
    refetch: async () => {},
  }),
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}))

// Radix Select can't be opened in jsdom (needs pointer capture). Swap it for a
// native <select> that preserves the same props so the in-page company selector
// can be driven with a change event.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  const h = React.createElement
  return {
    Select: ({ value, onValueChange, children }: any) =>
      h("select", { value: value ?? "", onChange: (e: any) => onValueChange?.(e.target.value) }, children),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => h(React.Fragment, null, children),
    SelectItem: ({ value, children }: any) => h("option", { value }, children),
  }
})

import Shareholders from "@/pages/shareholders"
import Analytics from "@/pages/analytics"
import FundAllocations from "@/pages/fund-allocations"
import Notifications from "@/pages/notifications"

// ---- Fixtures ---------------------------------------------------------------
const COMPANY_A = { id: 1, name: "Acme Foods", type: "subsidiary", ownershipPercent: 100 }
const COMPANY_B = { id: 2, name: "Brava Textiles", type: "subsidiary", ownershipPercent: 60 }

const shareholdersByCompany: Record<string, any[]> = {
  "1": [{ id: 11, companyId: 1, companyName: "Acme Foods", name: "Acme Holder", email: null, type: "individual", role: "founder", shares: 100, sharePrice: 10, investmentAmount: 1000, ownershipPercent: 100, status: "active", joinedDate: null, notes: null, createdAt: "2026-01-01" }],
  "2": [{ id: 21, companyId: 2, companyName: "Brava Textiles", name: "Brava Holder", email: null, type: "individual", role: "investor", shares: 60, sharePrice: 10, investmentAmount: 600, ownershipPercent: 60, status: "active", joinedDate: null, notes: null, createdAt: "2026-01-02" }],
}
const capByCompany: Record<string, any> = {
  "1": { companyId: 1, companyName: "Acme Foods", totalShares: 100, pricePerShare: 10, valuation: 1000, totalInvested: 1000, shareholderCount: 1, holders: [] },
  "2": { companyId: 2, companyName: "Brava Textiles", totalShares: 60, pricePerShare: 10, valuation: 600, totalInvested: 600, shareholderCount: 1, holders: [] },
}
const analyticsSummary = {
  empty: false, period: "month", companyId: null,
  current: { revenue: 1000, expenses: 400, netProfit: 600, netMargin: 60, cogs: null, grossMargin: null, revenueGrowth: 5, profitGrowth: 5, marketShare: 10 },
  totals: { revenue: 1000, expenses: 400, profit: 600 },
  equity: { valuation: 1000, capitalInvested: 500, shareholderCount: 2 },
  series: [{ label: "Jan", revenue: 1000, expenses: 400, profit: 600 }],
  insights: ["Revenue is up"],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async (input: any) => {
    const url = String(input)
    const companyId = new URL(url, "http://x").searchParams.get("companyId")

    if (url.includes("/api/shareholders/cap-table")) return jsonResponse(capByCompany[companyId ?? "1"] ?? null)
    if (url.includes("/api/shareholders")) return jsonResponse(companyId ? shareholdersByCompany[companyId] ?? [] : [])
    if (url.includes("/api/analytics/summary")) return jsonResponse(analyticsSummary)
    if (url.includes("/api/analytics/reports")) return jsonResponse({ rows: [] })
    if (url.includes("/api/fund-allocations/threshold")) return jsonResponse({ threshold: 100000 })
    if (url.includes("/api/fund-allocations")) {
      return jsonResponse({
        items: [{ id: 31, fromCompanyId: 1, fromCompanyName: "Acme Foods", toCompanyId: 2, toCompanyName: "Brava Textiles", amount: 5000, purpose: "Working capital", note: null, equityChangePercent: null, status: "executed", approvalId: null, requestedByName: "Ops", executedAt: "2026-01-03", createdAt: "2026-01-03" }],
        total: 1, page: 1, limit: 20, threshold: 100000,
      })
    }
    if (url.includes("/api/notifications")) {
      return jsonResponse([
        { id: 41, title: "Acme low stock", message: "Reorder soon", severity: "warning", isRead: false, createdAt: "2026-01-04T00:00:00.000Z", type: "inventory", companyName: "Acme Foods" },
      ])
    }
    if (url.includes("/api/companies")) return jsonResponse([COMPANY_A, COMPANY_B])

    return jsonResponse({}, 404)
  })
  globalThis.fetch = fetchSpy as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

function renderPage(Page: React.ComponentType) {
  const qc = newClient()
  render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  )
}

function scopedUrls(pathFragment: string) {
  return fetchSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes(pathFragment))
}

describe("company scoping — in-page selector views", () => {
  it("Shareholders renders only the selected company's holders and rescopes on switch", async () => {
    renderPage(Shareholders)

    // Defaults to the first company (Acme).
    await waitFor(() => expect(screen.getByText("Acme Holder")).toBeInTheDocument())
    expect(screen.queryByText("Brava Holder")).not.toBeInTheDocument()

    let urls = scopedUrls("/api/shareholders")
    expect(urls.some((u) => u.includes("companyId=1"))).toBe(true)
    expect(urls.every((u) => !u.includes("companyId=2"))).toBe(true)

    // Switch the in-page company selector to Brava.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } })
    await waitFor(() => expect(screen.getByText("Brava Holder")).toBeInTheDocument())
    expect(screen.queryByText("Acme Holder")).not.toBeInTheDocument()

    urls = scopedUrls("/api/shareholders")
    expect(urls.some((u) => u.includes("companyId=2"))).toBe(true)
  })

  it("Analytics scopes every request to the selected company and never leaks the other", async () => {
    renderPage(Analytics)

    // Default is "all companies" (aggregate) — no companyId on the request.
    await waitFor(() => expect(scopedUrls("/api/analytics/summary").length).toBeGreaterThan(0))
    // Wait until the company options have loaded into the selector.
    await waitFor(() => expect(screen.getByRole("option", { name: "Acme Foods" })).toBeInTheDocument())

    // Select Acme → requests must carry companyId=1 and never companyId=2.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } })
    await waitFor(() => expect(scopedUrls("/api/analytics/summary").some((u) => u.includes("companyId=1"))).toBe(true))
    expect(scopedUrls("/api/analytics").every((u) => !u.includes("companyId=2"))).toBe(true)

    // Switch to Brava → requests now carry companyId=2.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } })
    await waitFor(() => expect(scopedUrls("/api/analytics/summary").some((u) => u.includes("companyId=2"))).toBe(true))
  })

  it("Fund Allocations renders only the allocations the scoped API returns", async () => {
    renderPage(FundAllocations)

    await waitFor(() => expect(screen.getByText("Working capital")).toBeInTheDocument())
    // The group ledger shows exactly the server-scoped transfer (Acme → Brava)
    // and never an allocation the API did not return.
    expect(screen.getAllByText("Acme Foods").length).toBeGreaterThan(0)
    expect(screen.getByText("Brava Textiles")).toBeInTheDocument()
    expect(screen.queryByText("Cygnus Labs")).not.toBeInTheDocument()
  })

  it("Notifications renders only the recipient-scoped notifications the API returns", async () => {
    renderPage(Notifications)

    await waitFor(() => expect(screen.getByText("Acme low stock")).toBeInTheDocument())
    // A notification the API did not return for this recipient must never appear.
    expect(screen.queryByText("Brava payroll due")).not.toBeInTheDocument()
  })
})
