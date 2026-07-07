import * as React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * Security regression test — company scoping across the workspace module views
 * that read the active company from CompanyProvider (Documents, Shipping,
 * Marketing / Campaigns).
 *
 * Companion to company-scoping-modules.test.tsx. These pages differ from the
 * react-query list pages in that they load with a raw fetch keyed on
 * `activeCompany`, so this suite proves the same guarantees hold for them:
 *   1. Each page renders only the active company's rows.
 *   2. Switching the active company drops the previous company's rows — no
 *      cross-company bleed is ever left on screen.
 *   3. Every scoped request carries the active companyId, and never the other
 *      company's id.
 */

vi.mock("wouter", () => ({
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useLocation: () => ["/", () => {}],
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}))

// Documents pulls in the object-storage upload hook; stub it so the page renders
// without the real storage client.
vi.mock("@workspace/object-storage-web", () => ({
  useUpload: () => ({ uploadFile: async () => null, isUploading: false }),
}))

import Documents from "@/pages/documents"
import Shipping from "@/pages/shipping"
import Marketing from "@/pages/marketing"
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

// These endpoints return a bare array (not a paged envelope).
const docsByCompany: Record<string, any[]> = {
  "1": [{ id: 11, companyId: 1, name: "Acme GST Certificate", category: "gst", issuer: "GSTN", referenceNumber: "A-GST", expiresAt: null, owner: null, notes: null, fileUrl: null, fileType: null }],
  "2": [{ id: 21, companyId: 2, name: "Brava Trademark Filing", category: "trademark", issuer: "IPO", referenceNumber: "B-TM", expiresAt: null, owner: null, notes: null, fileUrl: null, fileType: null }],
}
const shipmentsByCompany: Record<string, any[]> = {
  "1": [{ id: 12, companyId: 1, orderNumber: "ORD-A-1", courier: "Delhivery", trackingNumber: "TA1", status: "in_transit", customerName: "Acme Shipper", destination: "Pune", shippingCost: 100, returnReason: null, returnedAt: null, lastSyncedAt: null }],
  "2": [{ id: 22, companyId: 2, orderNumber: "ORD-B-1", courier: "Blue Dart", trackingNumber: "TB1", status: "delivered", customerName: "Brava Shipper", destination: "Surat", shippingCost: 200, returnReason: null, returnedAt: null, lastSyncedAt: null }],
}
const campaignsByCompany: Record<string, any[]> = {
  "1": [{ id: 13, companyId: 1, name: "Acme Diwali Push", channel: "meta", objective: "conversions", status: "active", budget: 10000, spent: 4000, leads: 20, conversions: 5, revenue: 20000, impressions: 1000, clicks: 100, startDate: null, endDate: null }],
  "2": [{ id: 23, companyId: 2, name: "Brava Festive Blast", channel: "google", objective: "leads", status: "active", budget: 20000, spent: 8000, leads: 40, conversions: 10, revenue: 40000, impressions: 2000, clicks: 200, startDate: null, endDate: null }],
}
const emptyPerformance = {
  totals: { budget: 0, spent: 0, revenue: 0, roi: 0, conversions: 0, leads: 0, campaignCount: 0 },
  channels: [],
  campaigns: [],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function arrFor(map: Record<string, any[]>, companyId: string | null) {
  return companyId ? map[companyId] ?? [] : Object.values(map).flat()
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async (input: any) => {
    const url = String(input)
    const companyId = new URL(url, "http://x").searchParams.get("companyId")

    if (url.includes("/api/documents")) return jsonResponse(arrFor(docsByCompany, companyId))
    if (url.includes("/api/shipments")) return jsonResponse(arrFor(shipmentsByCompany, companyId))
    if (url.includes("/api/campaigns")) return jsonResponse(arrFor(campaignsByCompany, companyId))
    if (url.includes("/api/marketing/performance")) return jsonResponse(emptyPerformance)
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
  return fetchSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes(pathFragment))
}

async function assertScoped(opts: {
  pathFragment: string
  aText: RegExp | string
  bText: RegExp | string
}) {
  fireEvent.click(screen.getByTestId("pick-a"))
  await waitFor(() => expect(screen.getByText(opts.aText)).toBeInTheDocument(), { timeout: 3000 })
  expect(screen.queryByText(opts.bText)).not.toBeInTheDocument()

  let urls = scopedUrls(opts.pathFragment)
  expect(urls.some((u) => u.includes("companyId=1"))).toBe(true)
  expect(urls.every((u) => !u.includes("companyId=2"))).toBe(true)

  fireEvent.click(screen.getByTestId("pick-b"))
  await waitFor(() => expect(screen.getByText(opts.bText)).toBeInTheDocument(), { timeout: 3000 })
  // The previous company's row must be gone the moment B is shown.
  expect(screen.queryByText(opts.aText)).not.toBeInTheDocument()

  urls = scopedUrls(opts.pathFragment)
  expect(urls.some((u) => u.includes("companyId=2"))).toBe(true)
}

describe("company scoping — workspace module views", () => {
  it("Documents renders only the active company's documents and rescopes on switch", async () => {
    renderPage(Documents)
    await assertScoped({ pathFragment: "/api/documents", aText: "Acme GST Certificate", bText: "Brava Trademark Filing" })
  })

  it("Shipping renders only the active company's shipments and rescopes on switch", async () => {
    renderPage(Shipping)
    await assertScoped({ pathFragment: "/api/shipments", aText: "Acme Shipper", bText: "Brava Shipper" })
  })

  it("Marketing Campaigns renders only the active company's campaigns and rescopes on switch", async () => {
    renderPage(Marketing)
    // Move off the default Performance tab into Campaigns so the campaign cards
    // are the mounted, visible view. Radix Tabs activate on focus.
    const campaignsTab = screen.getByRole("tab", { name: /campaigns/i })
    fireEvent.mouseDown(campaignsTab)
    campaignsTab.focus()
    fireEvent.focus(campaignsTab)
    await assertScoped({ pathFragment: "/api/campaigns", aText: "Acme Diwali Push", bText: "Brava Festive Blast" })
  })
})
