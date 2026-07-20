import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Backend tenant-isolation regression test for the shared treasury ledger
 * (fund allocations) and the alerts feed (notifications).
 *
 * The Fund Allocations and Notifications UI tests only prove the browser
 * faithfully renders whatever the API returns — neither page has an in-page
 * company switch, so their isolation is enforced entirely server-side. This
 * test exercises that server-side decision directly: it signs in as a
 * company-scoped staff member (NOT super admin) and asserts the list endpoints
 * only ever return records that touch a company the user belongs to, while a
 * super admin still sees the full set.
 *
 * Real sign-in is Clerk Google OAuth and cannot run headlessly, so we mock the
 * two external boundaries — Postgres (@workspace/db) with a tiny in-memory
 * store and a fake drizzle query builder, and Clerk — and inject the resolved
 * local user the way the real auth middleware would.
 */

// ---- In-memory fake of @workspace/db (drizzle query builder) ----------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store: Record<string, Row[]> = {
    fund_allocations: [],
    notifications: [],
    companies: [],
    approvals: [],
  };

  function reset() {
    store.fund_allocations = [];
    store.notifications = [];
    store.companies = [];
    store.approvals = [];
  }

  // Tables are proxies: `fundAllocationsTable.fromCompanyId` -> "fund_allocations.fromCompanyId".
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
  const fundAllocationsTable = makeTable("fund_allocations");
  const notificationsTable = makeTable("notifications");
  const companiesTable = makeTable("companies");
  const approvalsTable = makeTable("approvals");

  const field = (col: string) => col.split(".")[1];

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
    _limit: number | null = null;
    _offset = 0;
    _setVals: Row | null = null;
    select(cols?: Record<string, any>) { this.type = "select"; this.cols = cols ?? null; return this; }
    update(t: any) { this.type = "update"; this.table = t.__table; return this; }
    set(vals: Row) { this._setVals = vals; return this; }
    returning() { return this; }
    from(t: any) { this.table = t.__table; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy(o: any) { this.order = o; return this; }
    limit(n: number) { this._limit = n; return this; }
    offset(n: number) { this._offset = n; return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      // UPDATE ... SET ... WHERE ... RETURNING: mutate matching rows in place,
      // return the affected rows (what drizzle .returning() yields).
      if (this.type === "update") {
        const matched = arr.filter((r) => match(r, this.cond));
        for (const r of matched) Object.assign(r, this._setVals);
        return matched.map((r) => ({ ...r }));
      }
      let rows = arr.filter((r) => match(r, this.cond));
      // Aggregate count: db.select({ count: sql`count(*)` })
      if (this.cols && "count" in this.cols) {
        return [{ count: rows.length }];
      }
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
    update: (t: any) => new QB().update(t),
  };

  return { store, reset, db, fundAllocationsTable, notificationsTable, companiesTable, approvalsTable };
});

vi.mock("@workspace/db", () => ({
  db: H.db,
  fundAllocationsTable: H.fundAllocationsTable,
  notificationsTable: H.notificationsTable,
  companiesTable: H.companiesTable,
  approvalsTable: H.approvalsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  inArray: (col: string, vals: any[]) => ({ op: "inArray", col, vals }),
  isNull: (col: string) => ({ op: "isNull", col }),
  isNotNull: (col: string) => ({ op: "isNotNull", col }),
  // not/like/ne are used as a safety-net filter for phantom rows; in tests all
  // seeded rows are real allocations so the filter should pass everything.
  not: (_cond: any) => ({ op: "not_passthrough" }),
  like: (_col: string, _pattern: string) => ({ op: "like_passthrough" }),
  ne: (col: string, val: any) => ({ op: "ne", col, val }),
  desc: (col: string) => ({ op: "desc", col }),
  sql: (() => ({ op: "sql" })) as any,
}));

// Clerk boundary pulled in transitively by auth-user; never exercised here.
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

// Permission middleware would hit the real roles table via getUserPermissions;
// this suite verifies company scoping, not role permissions, so pass through
// any signed-in user (unauthenticated requests still get 401).
vi.mock("../middleware/authz", () => ({
  requirePermission: () => (req: any, res: any, next: any) => {
    if (!req.localUser) { res.status(401).json({ error: "Authentication required" }); return; }
    next();
  },
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (!req.localUser || req.localUser.role !== "super_admin") {
      res.status(403).json({ error: "Super Admin access required" }); return;
    }
    next();
  },
}));

// Side-effecting helpers hit by the POST path only — no-op them.
vi.mock("../lib/fund-allocation", () => ({ executeFundAllocation: vi.fn() }));
vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));
vi.mock("../lib/audit", () => ({ writeAudit: vi.fn() }));

import fundAllocationsRouter from "./fund-allocations";
import notificationsRouter from "./notifications";

// Company fixtures: staff belongs only to Alpha (1).
const ALPHA = 1;
const BETA = 2;
const GAMMA = 3;

const SUPER_ADMIN = { id: 1, name: "Owner", email: "tapashub@gmail.com", role: "super_admin", companyIds: [] };
const SCOPED_STAFF = { id: 2, name: "Alpha Finance", email: "finance@alpha.example.com", role: "finance_manager", companyIds: [ALPHA] };

// Mutable "signed-in" user injected by test middleware the way real auth would.
let currentUser: any = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).localUser = currentUser; next(); });
  app.use(fundAllocationsRouter);
  app.use(notificationsRouter);
  return app;
}
const app = buildApp();

function seedAllocation(fromCompanyId: number, toCompanyId: number, overrides: Record<string, any> = {}) {
  const id = H.store.fund_allocations.length + 1;
  const now = new Date(Date.now() + id * 1000);
  H.store.fund_allocations.push({
    id, fromCompanyId, toCompanyId, amount: 5000, purpose: "Working capital", note: null,
    equityChangePercent: null, status: "completed", approvalId: null, fromTransactionId: null,
    toTransactionId: null, requestedById: 1, requestedByName: "Owner", executedAt: now,
    createdAt: now, updatedAt: now, ...overrides,
  });
  return id;
}

function seedNotification(companyId: number | null, overrides: Record<string, any> = {}) {
  const id = H.store.notifications.length + 1;
  const now = new Date(Date.now() + id * 1000);
  H.store.notifications.push({
    id, type: "payment", title: `Alert ${id}`, message: "msg", isRead: false,
    companyId, companyName: companyId ? `Company ${companyId}` : null, actionUrl: null,
    severity: "info", createdAt: now, ...overrides,
  });
  return id;
}

beforeEach(() => {
  H.reset();
  currentUser = null;
  H.store.companies.push(
    { id: ALPHA, name: "Alpha" },
    { id: BETA, name: "Beta" },
    { id: GAMMA, name: "Gamma" },
  );
});

// ---- GET /fund-allocations --------------------------------------------------
describe("GET /fund-allocations tenant isolation", () => {
  beforeEach(() => {
    seedAllocation(ALPHA, BETA);   // #1 out of Alpha
    seedAllocation(BETA, ALPHA);   // #2 into Alpha
    seedAllocation(BETA, GAMMA);   // #3 between two OTHER companies
    seedAllocation(GAMMA, BETA);   // #4 between two OTHER companies
  });

  it("returns only allocations touching the scoped staff's company (as source or recipient)", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/fund-allocations");
    expect(res.status).toBe(200);

    const ids = res.body.items.map((a: any) => a.id).sort();
    expect(ids).toEqual([1, 2]);
    expect(res.body.total).toBe(2);

    // Every returned allocation must have Alpha as source or recipient.
    for (const a of res.body.items) {
      expect([a.fromCompanyId, a.toCompanyId]).toContain(ALPHA);
    }
    // The transfer between two other companies must never appear.
    const seen = res.body.items.map((a: any) => `${a.fromCompanyId}->${a.toCompanyId}`);
    expect(seen).not.toContain(`${BETA}->${GAMMA}`);
    expect(seen).not.toContain(`${GAMMA}->${BETA}`);
  });

  it("does not let a scoped staff member widen scope via the companyId query param", async () => {
    currentUser = SCOPED_STAFF;
    // Ask explicitly for company Beta; the Alpha-scope filter must still win.
    const res = await request(app).get("/fund-allocations").query({ companyId: String(BETA) });
    expect(res.status).toBe(200);
    // Both Alpha<->Beta allocations (#1 Alpha->Beta, #2 Beta->Alpha) satisfy
    // companyId=Beta AND Alpha-scope — each still legitimately touches Alpha.
    const ids = res.body.items.map((a: any) => a.id).sort();
    expect(ids).toEqual([1, 2]);
    // Every result still touches Alpha; the Beta->Gamma / Gamma->Beta transfers
    // between two other companies stay hidden despite the Beta query param.
    expect(res.body.items.every((a: any) => [a.fromCompanyId, a.toCompanyId].includes(ALPHA))).toBe(true);
  });

  it("shows a super admin the full ledger", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/fund-allocations");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.items.map((a: any) => a.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

// ---- GET /notifications -----------------------------------------------------
describe("GET /notifications tenant isolation", () => {
  beforeEach(() => {
    seedNotification(ALPHA);  // #1 Alpha's alert
    seedNotification(BETA);   // #2 another company's alert
    seedNotification(GAMMA);  // #3 another company's alert
    seedNotification(null);   // #4 global/system alert (visible to everyone)
  });

  it("returns only the scoped staff's company alerts plus global alerts", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).get("/notifications").query({ limit: "50" });
    expect(res.status).toBe(200);

    const ids = res.body.map((n: any) => n.id).sort();
    expect(ids).toEqual([1, 4]);
    // No other company's alert may leak.
    const companyIds = res.body.map((n: any) => n.companyId);
    expect(companyIds).not.toContain(BETA);
    expect(companyIds).not.toContain(GAMMA);
  });

  it("shows a super admin every alert", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/notifications").query({ limit: "50" });
    expect(res.status).toBe(200);
    expect(res.body.map((n: any) => n.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

// ---- PATCH /notifications write scoping --------------------------------------
describe("PATCH /notifications write tenant isolation", () => {
  // #1 Alpha, #2 Beta, #3 Gamma, #4 global(null) — all start unread.
  beforeEach(() => {
    seedNotification(ALPHA); // #1
    seedNotification(BETA);  // #2 another company's alert
    seedNotification(GAMMA); // #3 another company's alert
    seedNotification(null);  // #4 global alert
  });

  const read = (id: number) => H.store.notifications.find((n) => n.id === id)!.isRead;

  it("lets scoped staff mark their own company's alert read", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).patch("/notifications/1/read");
    expect(res.status).toBe(200);
    expect(read(1)).toBe(true);
  });

  it("lets scoped staff mark a global alert read", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).patch("/notifications/4/read");
    expect(res.status).toBe(200);
    expect(read(4)).toBe(true);
  });

  it("does NOT let scoped staff mark another company's alert read", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).patch("/notifications/2/read"); // Beta's alert
    expect(res.status).toBe(404);
    // The other company's notification must remain untouched.
    expect(read(2)).toBe(false);
  });

  it("lets a super admin mark any company's alert read", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).patch("/notifications/3/read"); // Gamma's alert
    expect(res.status).toBe(200);
    expect(read(3)).toBe(true);
  });

  it("mark-all-read only clears the scoped staff's own + global alerts", async () => {
    currentUser = SCOPED_STAFF;
    const res = await request(app).patch("/notifications/mark-all-read");
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(2); // Alpha (#1) + global (#4) only
    expect(read(1)).toBe(true);
    expect(read(4)).toBe(true);
    // Other companies' alerts stay unread.
    expect(read(2)).toBe(false);
    expect(read(3)).toBe(false);
  });

  it("mark-all-read clears every company's alerts for a super admin", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).patch("/notifications/mark-all-read");
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(4);
    expect([read(1), read(2), read(3), read(4)]).toEqual([true, true, true, true]);
  });
});
