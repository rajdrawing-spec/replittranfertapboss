import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Backend WRITE-side tenant-isolation regression test.
 *
 * The company-isolation UI tests only prove list views rescope when the active
 * company changes — a read concern. This test exercises the create/edit paths
 * for shareholders, documents, shipments, and marketing campaigns, where the
 * authorization actually lives: a company-scoped staff member (NOT super admin)
 * must never be able to POST a record tagged with a company they don't belong
 * to, nor PATCH a record owned by another company. Both are rejected with 403,
 * while an in-scope companyId succeeds.
 *
 * Real sign-in is Clerk Google OAuth and can't run headlessly, so we mock the
 * two external boundaries — Postgres (@workspace/db) with a tiny in-memory store
 * plus a fake drizzle query builder, and Clerk — and inject the resolved local
 * user the way the real auth middleware would. The insert schemas are stubbed
 * as pass-throughs so the test focuses purely on the authorization decision.
 */

// ---- In-memory fake of @workspace/db (drizzle query builder) ----------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const TABLES = [
    "shareholders",
    "share_transactions",
    "companies",
    "documents",
    "shipments",
    "campaigns",
    "campaign_creatives",
    "campaign_leads",
    "integration_connections",
  ];
  const store: Record<string, Row[]> = {};

  function reset() {
    for (const t of TABLES) store[t] = [];
  }
  reset();

  // Tables are proxies: `documentsTable.companyId` -> "documents.companyId".
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
  const tables = Object.fromEntries(TABLES.map((n) => [n, makeTable(n)]));

  const field = (col: string) => String(col).split(".")[1];

  // Evaluate a condition descriptor produced by our mocked drizzle operators.
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
      case "isNull":
        return row[field(cond.col)] == null;
      case "isNotNull":
        return row[field(cond.col)] != null;
      case "ilike": {
        const v = row[field(cond.col)];
        if (v == null) return false;
        return String(v).toLowerCase().includes(String(cond.val).replace(/%/g, "").toLowerCase());
      }
      default:
        return true;
    }
  }

  class QB {
    op: string | null = null;
    table: string | null = null;
    cols: Record<string, any> | null = null;
    cond: any = null;
    order: any = null;
    _limit: number | null = null;
    _offset = 0;
    _values: any = null;
    _set: any = null;
    _returning = false;
    select(cols?: Record<string, any>) { this.op = "select"; this.cols = cols ?? null; return this; }
    insert(t: any) { this.op = "insert"; this.table = t.__table; return this; }
    update(t: any) { this.op = "update"; this.table = t.__table; return this; }
    delete(t: any) { this.op = "delete"; this.table = t.__table; return this; }
    from(t: any) { this.table = t.__table; return this; }
    values(v: any) { this._values = v; return this; }
    set(v: any) { this._set = v; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy(o: any) { this.order = o; return this; }
    limit(n: number) { this._limit = n; return this; }
    offset(n: number) { this._offset = n; return this; }
    for() { return this; }
    returning() { this._returning = true; return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      if (this.op === "insert") {
        const rows = Array.isArray(this._values) ? this._values : [this._values];
        const inserted = rows.map((v: Row) => {
          const now = new Date();
          const id = (arr.reduce((m, r) => Math.max(m, r.id ?? 0), 0)) + 1;
          const row = { id, createdAt: now, updatedAt: now, ...v };
          arr.push(row);
          return { ...row };
        });
        return inserted;
      }
      if (this.op === "update") {
        const affected = arr.filter((r) => match(r, this.cond));
        for (const r of affected) Object.assign(r, this._set);
        return affected.map((r) => ({ ...r }));
      }
      if (this.op === "delete") {
        const kept: Row[] = [];
        const removed: Row[] = [];
        for (const r of arr) (match(r, this.cond) ? removed : kept).push(r);
        store[this.table!] = kept;
        return removed.map((r) => ({ ...r }));
      }
      // select
      let rows = arr.filter((r) => match(r, this.cond));
      if (this.order && this.order.op === "desc") {
        const f = field(this.order.col);
        rows = [...rows].sort((a, b) => (a[f] < b[f] ? 1 : a[f] > b[f] ? -1 : 0));
      }
      rows = rows.slice(this._offset);
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this.cols) {
        return rows.map((r) => {
          const out: Row = {};
          for (const [k, colRef] of Object.entries(this.cols!)) out[k] = r[field(String(colRef))];
          return out;
        });
      }
      return rows.map((r) => ({ ...r }));
    }
  }

  const db = {
    select: (cols?: Record<string, any>) => new QB().select(cols),
    insert: (t: any) => new QB().insert(t),
    update: (t: any) => new QB().update(t),
    delete: (t: any) => new QB().delete(t),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };

  // Pass-through insert schema: keeps the body as-is so the test isolates the
  // authorization decision from field-level validation.
  const passSchema = { safeParse: (b: any) => ({ success: true, data: { ...(b ?? {}) } }) };

  return { store, reset, db, tables, passSchema };
});

vi.mock("@workspace/db", () => ({
  db: H.db,
  shareholdersTable: H.tables.shareholders,
  shareTransactionsTable: H.tables.share_transactions,
  companiesTable: H.tables.companies,
  documentsTable: H.tables.documents,
  shipmentsTable: H.tables.shipments,
  campaignsTable: H.tables.campaigns,
  campaignCreativesTable: H.tables.campaign_creatives,
  campaignLeadsTable: H.tables.campaign_leads,
  integrationConnectionsTable: H.tables.integration_connections,
  insertShareholderSchema: H.passSchema,
  insertShareTransactionSchema: H.passSchema,
  insertDocumentSchema: H.passSchema,
  insertShipmentSchema: H.passSchema,
  insertCampaignSchema: H.passSchema,
  insertCampaignCreativeSchema: H.passSchema,
  insertCampaignLeadSchema: H.passSchema,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  inArray: (col: string, vals: any[]) => ({ op: "inArray", col, vals }),
  isNull: (col: string) => ({ op: "isNull", col }),
  isNotNull: (col: string) => ({ op: "isNotNull", col }),
  ilike: (col: string, val: any) => ({ op: "ilike", col, val }),
  desc: (col: string) => ({ op: "desc", col }),
  sql: (() => ({ op: "sql" })) as any,
}));

// Clerk boundary pulled in transitively by auth-user; never exercised here.
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

// Side-effecting helpers hit by the write paths only — no-op them.
vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));
vi.mock("../lib/audit", () => ({ writeAudit: vi.fn() }));

import shareholdersRouter from "./shareholders";
import documentsRouter from "./documents";
import shippingRouter from "./shipping";
import marketingRouter from "./marketing";

// Company fixtures: staff belongs only to Alpha (1). Beta (2) is off-limits.
const ALPHA = 1;
const BETA = 2;

const SUPER_ADMIN = { id: 1, name: "Owner", email: "tapashub@gmail.com", role: "super_admin", companyIds: [] };
const SCOPED_STAFF = { id: 2, name: "Alpha Staff", email: "staff@alpha.example.com", role: "operations_manager", companyIds: [ALPHA] };

// The write endpoints under test are guarded by requirePermission(...) for
// shareholders. Grant the scoped staff every permission so the ONLY thing that
// can reject a cross-company write is the company-scope check itself.
vi.mock("../lib/auth-user", async (importActual) => {
  const actual = await importActual<typeof import("../lib/auth-user")>();
  return {
    ...actual,
    getUserPermissions: vi.fn(async () => new Set(["*"])),
    hasPermission: vi.fn(() => true),
  };
});

let currentUser: any = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).localUser = currentUser;
    (req as any).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(shareholdersRouter);
  app.use(documentsRouter);
  app.use(shippingRouter);
  app.use(marketingRouter);
  return app;
}
const app = buildApp();

// Seed one record owned by the given company; returns its id.
function seed(table: string, companyId: number, extra: Record<string, any> = {}) {
  const arr = H.store[table];
  const id = arr.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;
  const now = new Date();
  arr.push({ id, companyId, createdAt: now, updatedAt: now, ...extra });
  return id;
}

beforeEach(() => {
  H.reset();
  currentUser = SCOPED_STAFF;
  H.store.companies.push({ id: ALPHA, name: "Alpha" }, { id: BETA, name: "Beta" });
});

// Each entry describes one write surface: a valid create body and a seeded row
// to edit, per company.
const CASES = [
  {
    name: "shareholder",
    table: "shareholders",
    createPath: "/shareholders",
    editPath: (id: number) => `/shareholders/${id}`,
    body: (companyId: number) => ({ companyId, name: "New Holder", shares: 100 }),
    editBody: { notes: "edited" },
    seedExtra: { name: "Existing", shares: 50, sharePrice: 1, investmentAmount: 50, ownershipPercent: 100 },
  },
  {
    name: "document",
    table: "documents",
    createPath: "/documents",
    editPath: (id: number) => `/documents/${id}`,
    body: (companyId: number) => ({ companyId, name: "Contract", category: "other" }),
    editBody: { name: "Renamed" },
    seedExtra: { name: "Existing Doc", category: "other" },
  },
  {
    name: "shipment",
    table: "shipments",
    createPath: "/shipments",
    editPath: (id: number) => `/shipments/${id}`,
    body: (companyId: number) => ({ companyId, customerName: "Jane", courier: "Shiprocket", status: "processing" }),
    editBody: { status: "in_transit" },
    seedExtra: { customerName: "John", courier: "Shiprocket", status: "processing" },
  },
  {
    name: "campaign",
    table: "campaigns",
    createPath: "/campaigns",
    editPath: (id: number) => `/campaigns/${id}`,
    body: (companyId: number) => ({ companyId, name: "Summer Sale", channel: "meta", status: "active" }),
    editBody: { status: "paused" },
    seedExtra: { name: "Existing Campaign", channel: "meta", status: "active" },
  },
  {
    name: "creative",
    table: "campaign_creatives",
    createPath: "/marketing/creatives",
    editPath: (id: number) => `/marketing/creatives/${id}`,
    body: (companyId: number) => ({ companyId, name: "Hero Banner", format: "image", status: "active" }),
    editBody: { status: "paused" },
    seedExtra: { name: "Existing Creative", format: "image", status: "active" },
  },
  {
    name: "lead",
    table: "campaign_leads",
    createPath: "/marketing/leads",
    editPath: (id: number) => `/marketing/leads/${id}`,
    body: (companyId: number) => ({ companyId, name: "Jane Prospect", status: "new" }),
    editBody: { status: "qualified" },
    seedExtra: { name: "Existing Lead", status: "new" },
  },
] as const;

for (const c of CASES) {
  describe(`${c.name} write isolation`, () => {
    it(`rejects creating a ${c.name} under another company (403)`, async () => {
      const res = await request(app).post(c.createPath).send(c.body(BETA));
      expect(res.status).toBe(403);
      // Nothing may be written to the other company's records.
      expect(H.store[c.table].some((r) => r.companyId === BETA)).toBe(false);
    });

    it(`allows creating a ${c.name} under the caller's own company`, async () => {
      const res = await request(app).post(c.createPath).send(c.body(ALPHA));
      expect(res.status).toBe(201);
      expect(res.body.companyId).toBe(ALPHA);
      expect(H.store[c.table].some((r) => r.companyId === ALPHA)).toBe(true);
    });

    it(`rejects editing another company's ${c.name} (403)`, async () => {
      const id = seed(c.table, BETA, c.seedExtra);
      const res = await request(app).patch(c.editPath(id)).send(c.editBody);
      expect(res.status).toBe(403);
      // The other company's row must be untouched.
      const row = H.store[c.table].find((r) => r.id === id)!;
      for (const [k, v] of Object.entries(c.editBody)) expect(row[k]).not.toBe(v);
    });

    it(`allows editing the caller's own ${c.name}`, async () => {
      const id = seed(c.table, ALPHA, c.seedExtra);
      const res = await request(app).patch(c.editPath(id)).send(c.editBody);
      expect(res.status).toBe(200);
    });
  });

  describe(`${c.name} super admin`, () => {
    it(`lets a super admin create a ${c.name} under any company`, async () => {
      currentUser = SUPER_ADMIN;
      const res = await request(app).post(c.createPath).send(c.body(BETA));
      expect(res.status).toBe(201);
      expect(res.body.companyId).toBe(BETA);
    });
  });
}

// A creative/lead may reference a campaign, but only one that belongs to the
// same (accessible) company. Cross-linking to another tenant's campaign — even
// while tagging the record with your own company — must be rejected.
describe("marketing campaign-link isolation", () => {
  const LINKABLE = [
    { name: "creative", table: "campaign_creatives", createPath: "/marketing/creatives", editPath: (id: number) => `/marketing/creatives/${id}`, body: { name: "Hero Banner", format: "image", status: "active" }, seedExtra: { name: "Existing Creative", format: "image", status: "active" } },
    { name: "lead", table: "campaign_leads", createPath: "/marketing/leads", editPath: (id: number) => `/marketing/leads/${id}`, body: { name: "Jane Prospect", status: "new" }, seedExtra: { name: "Existing Lead", status: "new" } },
  ] as const;

  for (const c of LINKABLE) {
    it(`allows linking a ${c.name} to a same-company campaign`, async () => {
      const campId = seed("campaigns", ALPHA, { name: "Alpha Camp" });
      const res = await request(app).post(c.createPath).send({ companyId: ALPHA, campaignId: campId, ...c.body });
      expect(res.status).toBe(201);
      expect(res.body.campaignId).toBe(campId);
    });

    it(`rejects linking a ${c.name} to another company's campaign (403)`, async () => {
      const campId = seed("campaigns", BETA, { name: "Beta Camp" });
      const res = await request(app).post(c.createPath).send({ companyId: ALPHA, campaignId: campId, ...c.body });
      expect(res.status).toBe(403);
      expect(H.store[c.table].length).toBe(0);
    });

    it(`rejects linking a ${c.name} to a non-existent campaign (400)`, async () => {
      const res = await request(app).post(c.createPath).send({ companyId: ALPHA, campaignId: 9999, ...c.body });
      expect(res.status).toBe(400);
      expect(H.store[c.table].length).toBe(0);
    });

    it(`rejects a super admin linking a ${c.name} to a campaign from a different company than the record (400)`, async () => {
      currentUser = SUPER_ADMIN;
      const campId = seed("campaigns", BETA, { name: "Beta Camp" });
      const res = await request(app).post(c.createPath).send({ companyId: ALPHA, campaignId: campId, ...c.body });
      expect(res.status).toBe(400);
      expect(H.store[c.table].length).toBe(0);
    });

    it(`rejects editing a ${c.name} to link another company's campaign (403)`, async () => {
      const recordId = seed(c.table, ALPHA, c.seedExtra);
      const campId = seed("campaigns", BETA, { name: "Beta Camp" });
      const res = await request(app).patch(c.editPath(recordId)).send({ campaignId: campId });
      expect(res.status).toBe(403);
      expect(H.store[c.table].find((r) => r.id === recordId)!.campaignId).not.toBe(campId);
    });

    it(`allows editing a ${c.name} to link a same-company campaign`, async () => {
      const recordId = seed(c.table, ALPHA, c.seedExtra);
      const campId = seed("campaigns", ALPHA, { name: "Alpha Camp" });
      const res = await request(app).patch(c.editPath(recordId)).send({ campaignId: campId });
      expect(res.status).toBe(200);
      expect(res.body.campaignId).toBe(campId);
    });

    it(`rejects editing a ${c.name} with a malformed campaignId (400)`, async () => {
      const recordId = seed(c.table, ALPHA, c.seedExtra);
      const res = await request(app).patch(c.editPath(recordId)).send({ campaignId: "not-a-number" });
      expect(res.status).toBe(400);
    });

    it(`allows unlinking a ${c.name} campaign on edit`, async () => {
      const campId = seed("campaigns", ALPHA, { name: "Alpha Camp" });
      const recordId = seed(c.table, ALPHA, { ...c.seedExtra, campaignId: campId });
      const res = await request(app).patch(c.editPath(recordId)).send({ campaignId: null });
      expect(res.status).toBe(200);
      expect(res.body.campaignId).toBe(null);
    });
  }
});
