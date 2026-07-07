import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Backend tenant-isolation regression test for the READ-side (GET list)
 * endpoints of documents, shipments, and marketing campaigns.
 *
 * Write-side isolation for these resources is enforced elsewhere; this test
 * proves the list endpoints cannot be used by a company-scoped staff member to
 * read another company's records — either by omitting `companyId` (which must
 * fall back to their own scope, NOT "all companies") or by passing a
 * `companyId` outside their scope (which must be rejected with 403). A super
 * admin still sees every company's records.
 *
 * As with treasury-isolation.test.ts we mock the two external boundaries —
 * Postgres (@workspace/db) with a tiny in-memory store + fake drizzle query
 * builder, and Clerk — and inject the resolved local user the way the real
 * auth middleware would.
 */

// ---- In-memory fake of @workspace/db (drizzle query builder) ----------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store: Record<string, Row[]> = {
    documents: [],
    shipments: [],
    campaigns: [],
  };

  function reset() {
    store.documents = [];
    store.shipments = [];
    store.campaigns = [];
  }

  function makeTable(name: string) {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "__table") return name;
          return `${name}.${String(prop)}`;
        },
      },
    );
  }
  const documentsTable = makeTable("documents");
  const shipmentsTable = makeTable("shipments");
  const campaignsTable = makeTable("campaigns");

  const field = (col: string) => col.split(".")[1];

  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    switch (cond.op) {
      case "and":
        return cond.conds.filter(Boolean).every((c: any) => match(row, c));
      case "or":
        return cond.conds.filter(Boolean).some((c: any) => match(row, c));
      case "eq":
        return row[field(cond.col)] === cond.val;
      case "inArray":
        return cond.vals.includes(row[field(cond.col)]);
      case "ilike":
        return true;
      case "isNotNull":
        return row[field(cond.col)] != null;
      default:
        return true;
    }
  }

  class QB {
    type: string | null = null;
    table: string | null = null;
    cols: Record<string, any> | null = null;
    cond: any = null;
    order: any = null;
    select(cols?: Record<string, any>) { this.type = "select"; this.cols = cols ?? null; return this; }
    from(t: any) { this.table = t.__table; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy(o: any) { this.order = o; return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      let rows = arr.filter((r) => match(r, this.cond));
      // Aggregate: db.select({ totalBudget: sql`...`, ... }) — the summary path.
      // Every requested column is a sql<number> aggregate over the matched set.
      if (this.cols && Object.values(this.cols).some((v) => v && (v as any).op === "sql")) {
        const out: Row = {};
        for (const k of Object.keys(this.cols)) {
          if (k === "activeCount") out[k] = rows.filter((r) => r.status === "active").length;
          else if (k.startsWith("total")) {
            const f = k.replace(/^total/, "").toLowerCase();
            out[k] = rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
          } else out[k] = 0;
        }
        return [out];
      }
      if (this.order && this.order.op === "desc") {
        const f = field(this.order.col);
        rows = [...rows].sort((a, b) => (a[f] < b[f] ? 1 : a[f] > b[f] ? -1 : 0));
      }
      if (this.cols) {
        return rows.map((r) => {
          const o: Row = {};
          for (const [k, colRef] of Object.entries(this.cols!)) o[k] = r[field(String(colRef))];
          return o;
        });
      }
      return rows.map((r) => ({ ...r }));
    }
  }

  const db = { select: (cols?: Record<string, any>) => new QB().select(cols) };

  return { store, reset, db, documentsTable, shipmentsTable, campaignsTable };
});

vi.mock("@workspace/db", () => ({
  db: H.db,
  documentsTable: H.documentsTable,
  insertDocumentSchema: { safeParse: () => ({ success: false }) },
  shipmentsTable: H.shipmentsTable,
  insertShipmentSchema: { safeParse: () => ({ success: false }) },
  integrationConnectionsTable: {},
  campaignsTable: H.campaignsTable,
  insertCampaignSchema: { safeParse: () => ({ success: false }) },
  campaignCreativesTable: {},
  insertCampaignCreativeSchema: { safeParse: () => ({ success: false }) },
  campaignLeadsTable: {},
  insertCampaignLeadSchema: { safeParse: () => ({ success: false }) },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  inArray: (col: string, vals: any[]) => ({ op: "inArray", col, vals }),
  ilike: (col: string, val: any) => ({ op: "ilike", col, val }),
  isNotNull: (col: string) => ({ op: "isNotNull", col }),
  desc: (col: string) => ({ op: "desc", col }),
  sql: (() => ({ op: "sql" })) as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

// Side-effecting helpers touched only by non-list paths — no-op them.
vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));
vi.mock("../lib/url-safety", () => ({ isSafeAttachmentUrl: () => true }));
vi.mock("../lib/integration-adapters", () => ({ getAdapter: vi.fn() }));
vi.mock("../lib/integration-catalog", () => ({ getCatalogPlatform: vi.fn() }));

import documentsRouter from "./documents";
import shippingRouter from "./shipping";
import marketingRouter from "./marketing";

const ALPHA = 1;
const BETA = 2;
const GAMMA = 3;

const SUPER_ADMIN = { id: 1, name: "Owner", email: "tapashub@gmail.com", role: "super_admin", companyIds: [] };
const SCOPED_STAFF = { id: 2, name: "Alpha Staff", email: "staff@alpha.example.com", role: "manager", companyIds: [ALPHA] };

let currentUser: any = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).localUser = currentUser;
    (req as any).log = { error: () => {} };
    next();
  });
  app.use(documentsRouter);
  app.use(shippingRouter);
  app.use(marketingRouter);
  return app;
}
const app = buildApp();

function seedDocument(companyId: number | null) {
  const id = H.store.documents.length + 1;
  H.store.documents.push({ id, companyId, name: `Doc ${id}`, category: "other", issuer: null, referenceNumber: null, createdAt: new Date(Date.now() + id * 1000) });
  return id;
}
function seedShipment(companyId: number) {
  const id = H.store.shipments.length + 1;
  H.store.shipments.push({ id, companyId, status: "in_transit", trackingNumber: `T${id}`, customerName: `C${id}`, orderNumber: `O${id}`, returnedAt: null, createdAt: new Date(Date.now() + id * 1000) });
  return id;
}
function seedCampaign(companyId: number, overrides: Record<string, any> = {}) {
  const id = H.store.campaigns.length + 1;
  H.store.campaigns.push({ id, companyId, name: `Camp ${id}`, status: "active", channel: "meta", budget: 100, spent: 50, revenue: 200, leads: 5, conversions: 2, clicks: 10, impressions: 100, createdAt: new Date(Date.now() + id * 1000), ...overrides });
  return id;
}

beforeEach(() => {
  H.reset();
  currentUser = null;
});

// ---- GET /documents ---------------------------------------------------------
describe("GET /documents tenant isolation", () => {
  beforeEach(() => {
    seedDocument(ALPHA);
    seedDocument(BETA);
    seedDocument(GAMMA);
  });

  it("returns only the scoped staff's own company documents when companyId is omitted", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/documents");
    expect(res.status).toBe(200);
    expect(res.body.map((d: any) => d.companyId)).toEqual([ALPHA]);
  });

  it("rejects a companyId outside the scoped staff's scope with 403", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/documents").query({ companyId: String(BETA) });
    expect(res.status).toBe(403);
  });

  it("shows a super admin every company's documents", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/documents");
    expect(res.status).toBe(200);
    expect(res.body.map((d: any) => d.companyId).sort()).toEqual([ALPHA, BETA, GAMMA]);
  });
});

// ---- GET /shipments ---------------------------------------------------------
describe("GET /shipments tenant isolation", () => {
  beforeEach(() => {
    seedShipment(ALPHA);
    seedShipment(BETA);
    seedShipment(GAMMA);
  });

  it("returns only the scoped staff's own company shipments when companyId is omitted", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/shipments");
    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.companyId)).toEqual([ALPHA]);
  });

  it("rejects a companyId outside the scoped staff's scope with 403", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/shipments").query({ companyId: String(GAMMA) });
    expect(res.status).toBe(403);
  });

  it("shows a super admin every company's shipments", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/shipments");
    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.companyId).sort()).toEqual([ALPHA, BETA, GAMMA]);
  });
});

// ---- GET /campaigns + summary + performance ---------------------------------
describe("GET /campaigns tenant isolation", () => {
  beforeEach(() => {
    seedCampaign(ALPHA, { budget: 100, spent: 50, revenue: 200 });
    seedCampaign(BETA, { budget: 999, spent: 999, revenue: 999 });
    seedCampaign(GAMMA, { budget: 777, spent: 777, revenue: 777 });
  });

  it("lists only the scoped staff's own company campaigns when companyId is omitted", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/campaigns");
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.companyId)).toEqual([ALPHA]);
  });

  it("rejects a campaigns companyId outside scope with 403", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/campaigns").query({ companyId: String(BETA) });
    expect(res.status).toBe(403);
  });

  it("summary only aggregates the scoped staff's own company, not others", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/campaigns/summary");
    expect(res.status).toBe(200);
    // Only Alpha's numbers — Beta/Gamma's larger budgets must not leak in.
    expect(res.body.totalBudget).toBe(100);
    expect(res.body.totalSpent).toBe(50);
    expect(res.body.totalRevenue).toBe(200);
  });

  it("summary rejects a companyId outside scope with 403", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/campaigns/summary").query({ companyId: String(BETA) });
    expect(res.status).toBe(403);
  });

  it("performance only reflects the scoped staff's own company campaigns", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/marketing/performance");
    expect(res.status).toBe(200);
    expect(res.body.totals.campaignCount).toBe(1);
    expect(res.body.campaigns.map((c: any) => c.id)).toEqual([1]);
  });

  it("performance rejects a companyId outside scope with 403", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/marketing/performance").query({ companyId: String(GAMMA) });
    expect(res.status).toBe(403);
  });

  it("shows a super admin every company's campaigns and full performance", async () => {
    currentUser = SUPER_ADMIN;
    const list = await request(app).get("/campaigns");
    expect(list.body.map((c: any) => c.companyId).sort()).toEqual([ALPHA, BETA, GAMMA]);
    const perf = await request(app).get("/marketing/performance");
    expect(perf.body.totals.campaignCount).toBe(3);
  });
});
