import * as React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * Security regression test — company scoping across the remaining module list
 * views (Inventory, Finance, HR, CRM, Approvals).
 *
 * Companion to company-scoping.test.tsx (which covers Orders + CompanyDetail).
 * Each of these pages sends the active companyId with every list request via
 * CompanyProvider. This suite proves that:
 *   1. Each page renders only the active company's rows.
 *   2. Switching the active company drops the previous company's rows — no
 *      cross-company bleed is ever left on screen.
 *   3. Every scoped request carries the active companyId, and never the other
 *      company's id.
 */

// wouter is pulled in transitively by some UI atoms; stub it so pages render
// standalone without a router.
vi.mock("wouter", () => ({
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useLocation: () => ["/", () => {}],
}))

// use-toast is used by the mutating pages; stub to a no-op.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}))

import Inventory from "@/pages/inventory"
import Finance from "@/pages/finance"
import HR from "@/pages/hr"
import CRM from "@/pages/crm"
import Approvals from "@/pages/approvals"
import { CompanyProvider, useCompany } from "@/contexts/company-context"

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

// Per-company fixtures keyed by companyId, one identifying row per company.
const productsByCompany: Record<string, any[]> = {
  "1": [{ id: 11, name: "Acme Widget", companyId: 1, companyName: "Acme Foods", sku: "A-1", category: "Food", price: 100, costPrice: 40, stockQuantity: 5, reorderLevel: 10, status: "active" }],
  "2": [{ id: 21, name: "Brava Fabric", companyId: 2, companyName: "Brava Textiles", sku: "B-1", category: "Textiles", price: 200, costPrice: 80, stockQuantity: 50, reorderLevel: 10, status: "active" }],
}
const txByCompany: Record<string, any[]> = {
  "1": [{ id: 12, description: "Acme Invoice", companyId: 1, companyName: "Acme Foods", category: "Sales Revenue", type: "income", amount: 1000, status: "completed", date: "2026-01-01", referenceNumber: "INV-A" }],
  "2": [{ id: 22, description: "Brava Invoice", companyId: 2, companyName: "Brava Textiles", category: "Sales Revenue", type: "income", amount: 2000, status: "completed", date: "2026-01-02", referenceNumber: "INV-B" }],
}
const employeesByCompany: Record<string, any[]> = {
  "1": [{ id: 13, firstName: "Aaron", lastName: "Acme", email: "aaron@acme.test", companyId: 1, companyName: "Acme Foods", department: "Sales", designation: "Rep", status: "active", joinDate: "2025-01-01", salary: 50000 }],
  "2": [{ id: 23, firstName: "Bella", lastName: "Brava", email: "bella@brava.test", companyId: 2, companyName: "Brava Textiles", department: "Design", designation: "Designer", status: "active", joinDate: "2025-01-02", salary: 60000 }],
}
const customersByCompany: Record<string, any[]> = {
  "1": [{ id: 14, name: "Acme Customer", email: "cust@acme.test", phone: null, companyId: 1, companyName: "Acme Foods", totalOrders: 3, totalSpend: 1500, status: "active" }],
  "2": [{ id: 24, name: "Brava Customer", email: "cust@brava.test", phone: null, companyId: 2, companyName: "Brava Textiles", totalOrders: 7, totalSpend: 8800, status: "vip" }],
}
const leadsByCompany: Record<string, any[]> = {
  "1": [{ id: 15, name: "Acme Lead", email: "lead@acme.test", phone: null, companyId: 1, companyName: "Acme Foods", company: "Acme Prospect Co", stage: "qualified", source: "website", value: 5000, assignedTo: null, notes: null, expectedCloseDate: null }],
  "2": [{ id: 25, name: "Brava Lead", email: "lead@brava.test", phone: null, companyId: 2, companyName: "Brava Textiles", company: "Brava Prospect Co", stage: "proposal", source: "referral", value: 9000, assignedTo: null, notes: null, expectedCloseDate: null }],
}
const approvalsByCompany: Record<string, any[]> = {
  "1": [{ id: 16, type: "expense", title: "Acme Approval", description: "Acme spend", requestedBy: "Aaron", companyId: 1, companyName: "Acme Foods", amount: 500, status: "pending" }],
  "2": [{ id: 26, type: "expense", title: "Brava Approval", description: "Brava spend", requestedBy: "Bella", companyId: 2, companyName: "Brava Textiles", amount: 900, status: "pending" }],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function listFor(map: Record<string, any[]>, companyId: string | null) {
  const items = companyId ? map[companyId] ?? [] : Object.values(map).flat()
  return { items, total: items.length, page: 1, limit: 20 }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async (input: any) => {
    const url = String(input)
    const companyId = new URL(url, "http://x").searchParams.get("companyId")

    if (url.includes("/api/finance/pnl-summary")) {
      return jsonResponse({ revenue: 1000, grossProfit: 600, grossMargin: 60, netProfit: 400, netMargin: 40, operatingExpenses: 200 })
    }
    if (url.includes("/api/finance/transactions")) return jsonResponse(listFor(txByCompany, companyId))
    if (url.includes("/api/products")) return jsonResponse(listFor(productsByCompany, companyId))
    if (url.includes("/api/employees")) return jsonResponse(listFor(employeesByCompany, companyId))
    if (url.includes("/api/customers")) return jsonResponse(listFor(customersByCompany, companyId))
    if (url.includes("/api/leads")) return jsonResponse(listFor(leadsByCompany, companyId))
    if (url.includes("/api/approvals")) return jsonResponse(listFor(approvalsByCompany, companyId))
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

// Harness that drives the active company like the real company switcher.
function CompanySwitcher() {
  const { setActiveCompanyId } = useCompany()
  return (
    <div>
      <button data-testid="pick-a" onClick={() => setActiveCompanyId(1)}>A</button>
      <button data-testid="pick-b" onClick={() => setActiveCompanyId(2)}>B</button>
    </div>
  )
}

function renderPage(Page: React.ComponentType) {
  const qc = newClient()
  render(
    <QueryClientProvider client={qc}>
      <CompanyProvider>
        <CompanySwitcher />
        <Page />
      </CompanyProvider>
    </QueryClientProvider>,
  )
}

function scopedUrls(pathFragment: string) {
  return fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(pathFragment))
}

/**
 * Shared assertions: pick A → only A's row, requests carry companyId=1 and never
 * companyId=2; switch to B → only B's row (A's row gone), requests carry
 * companyId=2.
 */
async function assertScoped(opts: {
  pathFragment: string
  aText: RegExp | string
  bText: RegExp | string
}) {
  fireEvent.click(screen.getByTestId("pick-a"))
  await waitFor(() => expect(screen.getByText(opts.aText)).toBeInTheDocument())
  expect(screen.queryByText(opts.bText)).not.toBeInTheDocument()

  let urls = scopedUrls(opts.pathFragment)
  expect(urls.some((u) => u.includes("companyId=1"))).toBe(true)
  expect(urls.every((u) => !u.includes("companyId=2"))).toBe(true)

  fireEvent.click(screen.getByTestId("pick-b"))
  await waitFor(() => expect(screen.getByText(opts.bText)).toBeInTheDocument())
  // The previous company's row must be gone the moment B is shown.
  expect(screen.queryByText(opts.aText)).not.toBeInTheDocument()

  urls = scopedUrls(opts.pathFragment)
  expect(urls.some((u) => u.includes("companyId=2"))).toBe(true)
}

describe("company scoping — module list views", () => {
  it("Inventory renders only the active company's products and rescopes on switch", async () => {
    renderPage(Inventory)
    await assertScoped({ pathFragment: "/api/products", aText: "Acme Widget", bText: "Brava Fabric" })
  })

  it("Finance renders only the active company's transactions and rescopes on switch", async () => {
    renderPage(Finance)
    await assertScoped({ pathFragment: "/api/finance/transactions", aText: "Acme Invoice", bText: "Brava Invoice" })
  })

  it("HR renders only the active company's employees and rescopes on switch", async () => {
    renderPage(HR)
    await assertScoped({ pathFragment: "/api/employees", aText: "Aaron Acme", bText: "Bella Brava" })
  })

  it("CRM renders only the active company's customers and rescopes on switch", async () => {
    renderPage(CRM)
    await assertScoped({ pathFragment: "/api/customers", aText: "Acme Customer", bText: "Brava Customer" })
  })

  it("CRM Leads pipeline renders only the active company's leads and rescopes on switch", async () => {
    renderPage(CRM)
    // Move off the default Customers tab into Leads / Pipeline so the leads
    // table is the mounted, visible view. Radix Tabs uses automatic activation,
    // which switches on focus rather than a bare click.
    const leadsTab = screen.getByRole("tab", { name: /leads \/ pipeline/i })
    fireEvent.mouseDown(leadsTab)
    leadsTab.focus()
    fireEvent.focus(leadsTab)
    await assertScoped({ pathFragment: "/api/leads", aText: "Acme Lead", bText: "Brava Lead" })
  })

  it("Approvals renders only the active company's requests and rescopes on switch", async () => {
    renderPage(Approvals)
    await assertScoped({ pathFragment: "/api/approvals", aText: "Acme Approval", bText: "Brava Approval" })
  })
})
