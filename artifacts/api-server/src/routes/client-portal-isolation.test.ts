import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Client Marketing Portal — foundation authorization tests.
 *
 * Proves:
 *  1. Client-role users (client_admin / client_viewer) are globally blocked
 *     from every internal API route and can only reach /client/*.
 *  2. /client/marketing/context returns ONLY the projects the caller is a
 *     member of (and only active ones); a super admin sees all active projects.
 *  3. Internal users without client roles are unaffected by the guard.
 *
 * External boundaries (Postgres, Clerk) are mocked as in the other isolation
 * suites: a tiny in-memory store + fake drizzle query builder.
 */

const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store: Record<string, Row[]> = {
    marketing_projects: [],
    marketing_project_members: [],
    campaigns: [],
    campaign_creatives: [],
    campaign_leads: [],
    orders: [],
    client_visibility_settings: [],
    client_ai_plans: [],
    client_audit_logs: [],
  };
  function reset() {
    for (const k of Object.keys(store)) store[k] = [];
  }
  function makeTable(name: string) {
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === "__table") return name;
        if (prop === "$inferSelect") return undefined;
        return `${name}.${String(prop)}`;
      },
    });
  }
  const marketingProjectsTable = makeTable("marketing_projects");
  const marketingProjectMembersTable = makeTable("marketing_project_members");
  const campaignsTable = makeTable("campaigns");
  const campaignCreativesTable = makeTable("campaign_creatives");
  const campaignLeadsTable = makeTable("campaign_leads");
  const ordersTable = makeTable("orders");
  const clientVisibilitySettingsTable = makeTable("client_visibility_settings");
  const clientAiPlansTable = makeTable("client_ai_plans");
  const clientAuditLogsTable = makeTable("client_audit_logs");

  const field = (col: string) => String(col).split(".")[1];
  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    switch (cond.op) {
      case "and": return cond.conds.filter(Boolean).every((c: any) => match(row, c));
      case "or": return cond.conds.filter(Boolean).some((c: any) => match(row, c));
      case "eq": return row[field(cond.col)] === cond.val;
      case "inArray": return cond.vals.includes(row[field(cond.col)]);
      case "gte": return new Date(row[field(cond.col)]).getTime() >= new Date(cond.val).getTime();
      case "lte": return new Date(row[field(cond.col)]).getTime() <= new Date(cond.val).getTime();
      default: return true;
    }
  }

  class QB {
    type: "select" | "insert" | "update" | "delete" = "select";
    table: string | null = null;
    cols: Record<string, any> | null = null;
    cond: any = null;
    vals: Row | null = null;
    select(cols?: Record<string, any>) { this.type = "select"; this.cols = cols ?? null; return this; }
    from(t: any) { this.table = t.__table; return this; }
    insert(t: any) { this.type = "insert"; this.table = t.__table; return this; }
    update(t: any) { this.type = "update"; this.table = t.__table; return this; }
    delete(t: any) { this.type = "delete"; this.table = t.__table; return this; }
    values(v: Row) { this.vals = v; return this; }
    set(v: Row) { this.vals = v; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy() { return this; }
    limit(n: number) { this._limit = n; return this; }
    offset(n: number) { this._offset = n; return this; }
    _limit: number | null = null;
    _offset = 0;
    returning() { return this; }
    onConflictDoNothing() { return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      if (this.type === "insert") {
        // Mirror the real DB's marketing_projects_company_uniq unique index.
        if (this.table === "marketing_projects" && arr.some((r) => r.companyId === (this.vals as any)?.companyId)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint \"marketing_projects_company_uniq\""), { code: "23505" });
        }
        const row = { id: arr.length + 1, createdAt: new Date(), ...this.vals };
        arr.push(row);
        return [{ ...row }];
      }
      if (this.type === "update") {
        const hit = arr.filter((r) => match(r, this.cond));
        hit.forEach((r) => Object.assign(r, this.vals));
        return hit.map((r) => ({ ...r }));
      }
      if (this.type === "delete") {
        const hit = arr.filter((r) => match(r, this.cond));
        store[this.table!] = arr.filter((r) => !match(r, this.cond));
        return hit.map((r) => ({ ...r }));
      }
      let rows = arr.filter((r) => match(r, this.cond));
      if (this._offset) rows = rows.slice(this._offset);
      if (this._limit != null) rows = rows.slice(0, this._limit);
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

  const db = {
    select: (cols?: Record<string, any>) => new QB().select(cols),
    insert: (t: any) => new QB().insert(t),
    update: (t: any) => new QB().update(t),
    delete: (t: any) => new QB().delete(t),
  };
  // Holder for the "signed-in" user seen by the mocked Clerk/auth boundary.
  const authState = { user: null as any };
  return { store, reset, db, authState, marketingProjectsTable, marketingProjectMembersTable, campaignsTable, campaignCreativesTable, campaignLeadsTable, ordersTable, clientVisibilitySettingsTable, clientAiPlansTable, clientAuditLogsTable };
});

vi.mock("@workspace/db", () => {
  // Pass-through insert schemas: the route strips projectId/clientVisible
  // BEFORE parsing, so this lets the test observe what reaches the DB.
  const passThrough = { safeParse: (b: any) => ({ success: true, data: b }) };
  return {
  db: H.db,
  marketingProjectsTable: H.marketingProjectsTable,
  marketingProjectMembersTable: H.marketingProjectMembersTable,
  campaignsTable: H.campaignsTable,
  campaignCreativesTable: H.campaignCreativesTable,
  campaignLeadsTable: H.campaignLeadsTable,
  ordersTable: H.ordersTable,
  insertCampaignSchema: passThrough,
  insertCampaignCreativeSchema: passThrough,
  insertCampaignLeadSchema: passThrough,
  insertMarketingProjectSchema: passThrough,
  usersTable: {},
  clientVisibilitySettingsTable: H.clientVisibilitySettingsTable,
  clientAiPlansTable: H.clientAiPlansTable,
  clientAuditLogsTable: H.clientAuditLogsTable,
  DEFAULT_CLIENT_VISIBILITY: {
    revenue: true, orders: true, adSpend: true, roas: true, leads: true,
    cpa: true, conversion: true, campaigns: true, creatives: true,
    reports: true, ai: true, aiRequiresReview: false,
  },
  };
});

// AI provider boundary: capture the exact context sent to the model.
const aiCalls: { messages: any[]; system?: string }[] = [];
let aiResponse = JSON.stringify({
  observed: { working: ["Campaign A ROAS 4x"], underperforming: ["Campaign B CTR 0.2%"] },
  likely_reasons: ["Likely creative fatigue"],
  recommendations: { campaigns: ["Shift budget to A"], creatives: ["Refresh B"], budget: ["Hold spend"], lead_gen: ["Add lead form"] },
  plan_7_day: [{ day: "Day 1", focus: "Audit", actions: ["Review campaign B"] }],
  plan_30_day: [{ week: "Week 1", focus: "Optimize", actions: ["Scale winners"] }],
  summary: "Solid overall performance.",
});
vi.mock("../lib/ai-provider", () => ({
  getActiveProvider: async () => ({
    chat: async (messages: any[], system?: string) => { aiCalls.push({ messages, system }); return aiResponse; },
  }),
  getActiveProviderName: async () => "test-provider",
}));

vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));
vi.mock("../lib/url-safety", () => ({ isSafeAttachmentUrl: () => true }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: H.authState.user ? "clerk_test_user" : null }),
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  inArray: (col: string, vals: any[]) => ({ op: "inArray", col, vals }),
  gte: (col: string, val: any) => ({ op: "gte", col, val }),
  lte: (col: string, val: any) => ({ op: "lte", col, val }),
  desc: (col: string) => ({ op: "desc", col }),
  sql: Object.assign((..._a: any[]) => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));

// Auth-user boundary: pure logic, no Clerk / DB round-trips.
vi.mock("../lib/auth-user", () => ({
  getOrProvisionLocalUser: async () => ({ user: H.authState.user }),
  isSuperAdmin: (u: any) => u.role === "super_admin",
  hasPermission: (perms: string[], p: string) => perms.includes("*") || perms.includes(p),
  getUserPermissions: async (u: any) =>
    u.role === "super_admin" ? ["*"]
      : u.role === "client_admin" || u.role === "client_viewer" ? ["client_portal.view"]
      : ["dashboard.view", "marketing.view"],
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() { throw new Error("not-found"); }
    async downloadObject() { throw new Error("unreachable"); }
  },
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

import { blockClientUsersFromInternalApi, projectScope } from "../lib/project-scope";
import clientMarketingRouter from "./client-marketing";
import authRouter from "./auth";
import marketingRouter from "./marketing";
import marketingProjectsRouter from "./marketing-projects";

const SUPER_ADMIN = { id: 1, name: "Owner", email: "tapashub@gmail.com", role: "super_admin", extraRoles: [], companyIds: [] };
const CLIENT_USER = { id: 10, name: "Client", email: "client@acme.example.com", role: "client_admin", extraRoles: [], companyIds: [] };
const CLIENT_VIEWER = { id: 11, name: "Viewer", email: "viewer@acme.example.com", role: "client_viewer", extraRoles: [], companyIds: [] };
const STAFF = { id: 20, name: "Staff", email: "staff@agency.example.com", role: "marketing_manager", extraRoles: [], companyIds: [1] };
const STAFF_WITH_CLIENT_EXTRA = { id: 21, name: "Hybrid", email: "hybrid@x.example.com", role: "staff", extraRoles: ["client_viewer"], companyIds: [1] };

let currentUser: any = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).localUser = currentUser;
    (req as any).log = { error: (e: any) => { if (process.env.DBG) console.error("ROUTE ERR", e); }, warn: () => {} };
    next();
  });
  app.use(blockClientUsersFromInternalApi);
  app.use(clientMarketingRouter);
  app.use(marketingRouter);
  app.use(marketingProjectsRouter);
  // Representative hypothetical future authenticated /auth/* route the guard
  // must protect (only /auth/me is exempt).
  app.get("/auth/sessions", (_req, res) => { res.json([{ id: 1, secret: true }]); });
  return app;
}
const app = buildApp();

function seedProject(overrides: Record<string, any> = {}) {
  const id = H.store.marketing_projects.length + 1;
  H.store.marketing_projects.push({
    id, companyId: 1, name: `Project ${id}`, brandName: `Brand ${id}`,
    brandColor: "#112233", logoUrl: null, status: "active",
    createdAt: new Date(Date.now() + id * 1000), ...overrides,
  });
  return id;
}
function addMember(projectId: number, userId: number, memberType = "client") {
  H.store.marketing_project_members.push({
    id: H.store.marketing_project_members.length + 1,
    projectId, userId, memberType, createdAt: new Date(),
  });
}

beforeEach(() => {
  H.reset();
  currentUser = null;
  H.authState.user = null;
});

describe("blockClientUsersFromInternalApi", () => {
  it("blocks a client_admin from internal routes with 403", async () => {
    currentUser = CLIENT_USER;
    const res = await request(app).get("/campaigns");
    expect(res.status).toBe(403);
  });

  it("blocks a client user from non-exempt /auth/* routes", async () => {
    currentUser = CLIENT_USER;
    const res = await request(app).get("/auth/sessions");
    expect(res.status).toBe(403);
  });

  it("blocks a user whose extraRoles include a client role", async () => {
    currentUser = STAFF_WITH_CLIENT_EXTRA;
    const res = await request(app).get("/campaigns");
    expect(res.status).toBe(403);
  });

  it("lets a client user reach /client/* routes", async () => {
    currentUser = CLIENT_VIEWER;
    const res = await request(app).get("/client/marketing/context");
    expect(res.status).toBe(200);
  });

  it("does not affect internal staff", async () => {
    currentUser = STAFF;
    const res = await request(app).get("/campaigns");
    expect(res.status).toBe(200);
  });

  it("does not affect the super admin", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/campaigns");
    expect(res.status).toBe(200);
  });
});

describe("GET /client/marketing/context project isolation", () => {
  it("returns only the caller's assigned active projects", async () => {
    const mine = seedProject({ name: "Mine" });
    seedProject({ name: "Other" }); // not a member
    const paused = seedProject({ name: "Paused", status: "paused" });
    addMember(mine, CLIENT_USER.id);
    addMember(paused, CLIENT_USER.id); // member, but not active
    currentUser = CLIENT_USER;

    const res = await request(app).get("/client/marketing/context");
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p: any) => p.id)).toEqual([mine]);
    expect(res.body.projects[0].memberType).toBe("client");
    expect(res.body.user.id).toBe(CLIENT_USER.id);
  });

  it("returns an empty list for a client with no memberships", async () => {
    seedProject();
    currentUser = CLIENT_VIEWER;
    const res = await request(app).get("/client/marketing/context");
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  it("shows a super admin every active project", async () => {
    seedProject();
    seedProject();
    seedProject({ status: "archived" });
    currentUser = SUPER_ADMIN;
    const res = await request(app).get("/client/marketing/context");
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(2);
  });

  it("rejects an internal user without client_portal.view", async () => {
    currentUser = STAFF;
    const res = await request(app).get("/client/marketing/context");
    expect(res.status).toBe(403);
  });
});

// ---- Project-scoped data endpoints -------------------------------------------
describe("client project data endpoints isolation", () => {
  function seedCampaign(overrides: Record<string, any> = {}) {
    const id = H.store.campaigns.length + 1;
    H.store.campaigns.push({
      id, companyId: 1, name: `Campaign ${id}`, status: "active",
      projectId: null, clientVisible: false, createdAt: new Date(), ...overrides,
    });
    return id;
  }

  it("returns only clientVisible records of the member's project", async () => {
    const mine = seedProject();
    const other = seedProject();
    addMember(mine, CLIENT_USER.id);
    const visible = seedCampaign({ projectId: mine, clientVisible: true });
    seedCampaign({ projectId: mine, clientVisible: false }); // hidden
    seedCampaign({ projectId: other, clientVisible: true }); // other project
    seedCampaign({ clientVisible: true }); // unlinked
    currentUser = CLIENT_USER;

    const res = await request(app).get(`/client/marketing/projects/${mine}/campaigns`);
    expect(res.status).toBe(200);
    expect(res.body.campaigns.map((c: any) => c.id)).toEqual([visible]);
  });

  it("403s when requesting a project the caller is not a member of", async () => {
    const mine = seedProject();
    const other = seedProject();
    addMember(mine, CLIENT_USER.id);
    seedCampaign({ projectId: other, clientVisible: true });
    currentUser = CLIENT_USER;

    for (const kind of ["campaigns", "creatives", "leads"]) {
      const res = await request(app).get(`/client/marketing/projects/${other}/${kind}`);
      expect(res.status).toBe(403);
    }
  });

  it("403s a client with no memberships at all", async () => {
    const p = seedProject();
    seedCampaign({ projectId: p, clientVisible: true });
    currentUser = CLIENT_VIEWER;
    const res = await request(app).get(`/client/marketing/projects/${p}/campaigns`);
    expect(res.status).toBe(403);
  });

  it("rejects a non-numeric project id", async () => {
    currentUser = CLIENT_USER;
    const res = await request(app).get("/client/marketing/projects/abc/campaigns");
    expect(res.status).toBe(400);
  });

  it("lets a super admin read any project's visible records (still filtered by clientVisible)", async () => {
    const p = seedProject();
    const visible = seedCampaign({ projectId: p, clientVisible: true });
    seedCampaign({ projectId: p, clientVisible: false });
    currentUser = SUPER_ADMIN;
    const res = await request(app).get(`/client/marketing/projects/${p}/campaigns`);
    expect(res.status).toBe(200);
    expect(res.body.campaigns.map((c: any) => c.id)).toEqual([visible]);
  });

  it("staff without client_portal.view get 403 on project data routes", async () => {
    const p = seedProject();
    addMember(p, STAFF.id);
    currentUser = STAFF;
    const res = await request(app).get(`/client/marketing/projects/${p}/campaigns`);
    expect(res.status).toBe(403);
  });
});

// ---- Dashboard endpoints (overview, sales, leads, creatives, report) ---------
describe("client dashboard endpoints", () => {
  const D = (s: string) => new Date(`${s}T12:00:00`);
  function seedOrder(overrides: Record<string, any> = {}) {
    const id = H.store.orders.length + 1;
    H.store.orders.push({
      id, companyId: 1, orderNumber: `ORD-${id}`, itemCount: 1, totalAmount: 1000,
      status: "delivered", channel: "website", customerName: "Secret Customer",
      customerEmail: "secret@x.example.com", createdAt: D("2026-08-05"), ...overrides,
    });
    return id;
  }
  function seedLead(projectId: number, overrides: Record<string, any> = {}) {
    const id = H.store.campaign_leads.length + 1;
    H.store.campaign_leads.push({
      id, companyId: 1, projectId, clientVisible: true, name: `Lead ${id}`,
      email: "hidden@x.example.com", phone: "999", notes: "internal", source: "web",
      status: "new", value: 0, campaignId: null, createdAt: D("2026-08-05"), ...overrides,
    });
    return id;
  }
  function seedCreative(projectId: number, overrides: Record<string, any> = {}) {
    const id = H.store.campaign_creatives.length + 1;
    H.store.campaign_creatives.push({
      id, companyId: 1, projectId, clientVisible: true, name: `Creative ${id}`,
      type: "image", format: "square", url: "/objects/x.png", thumbnailUrl: null,
      status: "approved", createdAt: new Date(), ...overrides,
    });
    return id;
  }

  let projectId: number;
  beforeEach(() => {
    projectId = seedProject({ companyId: 1 });
    addMember(projectId, CLIENT_USER.id);
    currentUser = CLIENT_USER;
  });

  it("overview computes revenue/orders KPIs excluding cancelled & other companies", async () => {
    seedOrder({ totalAmount: 1000 });
    seedOrder({ totalAmount: 500, status: "cancelled" });
    seedOrder({ totalAmount: 700, companyId: 2 }); // other company
    seedOrder({ totalAmount: 300, createdAt: D("2026-01-01") }); // outside range
    seedLead(projectId);
    seedLead(projectId, { status: "converted" });

    const res = await request(app).get(`/client/marketing/projects/${projectId}/overview?from=2026-08-01&to=2026-08-10`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.revenue).toBe(1000);
    expect(res.body.kpis.orders).toBe(1);
    expect(res.body.kpis.leads).toBe(2);
    expect(res.body.kpis.conversionRate).toBe(50);
    expect(res.body.timeseries.length).toBeGreaterThan(0);
  });

  it("overview computes ROAS/CPL from clientVisible campaigns only", async () => {
    H.store.campaigns.push(
      { id: 1, projectId, clientVisible: true, name: "A", status: "active", spent: 200, revenue: 800, impressions: 1000, clicks: 50, leads: 4, conversions: 2, createdAt: new Date() },
      { id: 2, projectId, clientVisible: false, name: "Hidden", status: "active", spent: 999, revenue: 0, createdAt: new Date() },
    );
    seedLead(projectId); seedLead(projectId);
    const res = await request(app).get(`/client/marketing/projects/${projectId}/overview?from=2026-08-01&to=2026-08-10`);
    expect(res.body.campaignLifetime.adSpend).toBe(200);
    expect(res.body.campaignLifetime.roas).toBe(4);
    expect(res.body.campaignLifetime.cpl).toBe(50); // lifetime 200 spend / 4 lifetime campaign leads
    expect(res.body.campaignLifetime.cpa).toBe(100); // 200 / 2 conversions
  });

  it("overview 400s on an invalid date range", async () => {
    const res = await request(app).get(`/client/marketing/projects/${projectId}/overview?from=2026-08-10&to=2026-08-01`);
    expect(res.status).toBe(400);
  });

  it("sales returns only client-safe order fields and paginates", async () => {
    for (let i = 0; i < 25; i++) seedOrder();
    const res = await request(app).get(`/client/marketing/projects/${projectId}/sales?from=2026-08-01&to=2026-08-10&page=2&pageSize=20`);
    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBe(5);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.stats.totalOrders).toBe(25);
    const o = res.body.orders[0];
    expect(o.customerName).toBeUndefined();
    expect(o.customerEmail).toBeUndefined();
    expect(o.orderNumber).toBeDefined();
  });

  it("sales is scoped to the project's company", async () => {
    seedOrder({ companyId: 2, totalAmount: 9999 });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/sales?from=2026-08-01&to=2026-08-10`);
    expect(res.body.orders.length).toBe(0);
    expect(res.body.stats.revenue).toBe(0);
  });

  it("leads omit email/phone/notes and include campaign name", async () => {
    H.store.campaigns.push({ id: 7, projectId, clientVisible: true, name: "Camp X", status: "active", createdAt: new Date() });
    seedLead(projectId, { campaignId: 7 });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/leads`);
    expect(res.status).toBe(200);
    const l = res.body.leads[0];
    expect(l.email).toBeUndefined();
    expect(l.phone).toBeUndefined();
    expect(l.notes).toBeUndefined();
    expect(l.campaign).toBe("Camp X");
  });

  it("does not leak hidden or cross-project campaign names via the lead join", async () => {
    H.store.campaigns.push(
      { id: 8, projectId, clientVisible: false, name: "Hidden Camp", status: "active", createdAt: new Date() },
      { id: 9, projectId: 999, clientVisible: true, name: "Other Project Camp", status: "active", createdAt: new Date() },
    );
    seedLead(projectId, { campaignId: 8 });
    seedLead(projectId, { campaignId: 9 });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/leads`);
    expect(res.status).toBe(200);
    expect(res.body.leads.map((l: any) => l.campaign)).toEqual([null, null]);
  });

  it("creatives exclude drafts/archived even when clientVisible", async () => {
    const ok = seedCreative(projectId, { status: "approved" });
    const live = seedCreative(projectId, { status: "live" });
    seedCreative(projectId, { status: "draft" });
    seedCreative(projectId, { status: "archived" });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/creatives`);
    expect(res.body.creatives.map((c: any) => c.id).sort()).toEqual([ok, live]);
  });

  it("campaigns list computes CTR and ROAS per row", async () => {
    H.store.campaigns.push({ id: 1, projectId, clientVisible: true, name: "A", channel: "meta", status: "active", spent: 100, revenue: 250, impressions: 2000, clicks: 40, leads: 5, conversions: 1, createdAt: new Date() });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/campaigns`);
    const c = res.body.campaigns[0];
    expect(c.ctr).toBe(2);
    expect(c.roas).toBe(2.5);
  });

  it("report returns KPIs, best campaign and comparison; blocked for non-members", async () => {
    H.store.campaigns.push(
      { id: 1, projectId, clientVisible: true, name: "Good", status: "active", spent: 100, revenue: 500, createdAt: new Date() },
      { id: 2, projectId, clientVisible: true, name: "Bad", status: "active", spent: 100, revenue: 50, createdAt: new Date() },
    );
    seedOrder({ totalAmount: 2000 });
    seedOrder({ totalAmount: 1000, createdAt: D("2026-07-25") }); // previous period
    const res = await request(app).get(`/client/marketing/projects/${projectId}/report?from=2026-08-01&to=2026-08-10`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.revenue).toBe(2000);
    expect(res.body.bestCampaign.name).toBe("Good");
    expect(res.body.worstCampaign.name).toBe("Bad");
    expect(res.body.comparison.revenue.previous).toBe(1000);
    expect(res.body.comparison.revenue.change).toBe(100);

    currentUser = CLIENT_VIEWER; // not a member
    const denied = await request(app).get(`/client/marketing/projects/${projectId}/report?from=2026-08-01&to=2026-08-10`);
    expect(denied.status).toBe(403);
  });

  it("403s non-members on every dashboard endpoint", async () => {
    currentUser = CLIENT_VIEWER;
    for (const ep of ["overview", "sales", "leads", "creatives", "report"]) {
      const res = await request(app).get(`/client/marketing/projects/${projectId}/${ep}`);
      expect(res.status).toBe(403);
    }
  });
});

// ---- Creation cannot smuggle project linkage ---------------------------------
// projectId/clientVisible must be stripped from POST payloads: linking happens
// exclusively via the validated super-admin endpoint. Otherwise a staff user
// with Company A access could link a record to Company B's project.
// ---- Visibility settings, AI copilot & audit log (task: copilot phase) -------
describe("client visibility, AI plan & audit", () => {
  const flush = () => new Promise((r) => setImmediate(r));
  function setVisibility(projectId: number, overrides: Record<string, boolean>) {
    H.store.client_visibility_settings.push({
      id: H.store.client_visibility_settings.length + 1,
      projectId,
      settings: {
        revenue: true, orders: true, adSpend: true, roas: true, leads: true,
        cpa: true, conversion: true, campaigns: true, creatives: true,
        reports: true, ai: true, aiRequiresReview: false, ...overrides,
      },
      updatedAt: new Date(),
    });
  }

  let projectId: number;
  beforeEach(() => {
    aiCalls.length = 0;
    projectId = seedProject({ companyId: 1 });
    addMember(projectId, CLIENT_USER.id);
    currentUser = CLIENT_USER;
  });

  it("GET visibility returns settings without the internal aiRequiresReview flag", async () => {
    setVisibility(projectId, { revenue: false, aiRequiresReview: true });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/visibility`);
    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(false);
    expect(res.body.aiRequiresReview).toBeUndefined();
  });

  it("overview strips hidden KPIs from the payload", async () => {
    setVisibility(projectId, { revenue: false, adSpend: false });
    H.store.orders.push({ id: 1, companyId: 1, totalAmount: 1000, status: "delivered", createdAt: new Date(), itemCount: 1, orderNumber: "O1", channel: "web" });
    H.store.campaigns.push({ id: 1, projectId, clientVisible: true, name: "A", status: "active", spent: 200, revenue: 800, impressions: 100, clicks: 5, leads: 4, conversions: 2, createdAt: new Date() });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/overview`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.revenue).toBeUndefined();
    expect(res.body.kpis.aov).toBeUndefined();
    expect(res.body.kpis.orders).toBe(1);
    expect(res.body.campaignLifetime.adSpend).toBeUndefined();
    expect(res.body.campaignLifetime.cpl).toBeUndefined();
    expect(res.body.campaignLifetime.roas).toBe(4);
    expect(res.body.comparison.revenue).toBeUndefined();
    for (const t of res.body.timeseries) expect(t.revenue).toBeUndefined();
  });

  it("disabled sections return 403 (campaigns, sales, leads, creatives, report, ai)", async () => {
    setVisibility(projectId, { campaigns: false, orders: false, leads: false, creatives: false, reports: false, ai: false });
    for (const path of ["campaigns", "sales", "leads", "creatives", "report", "ai-plan"]) {
      const res = await request(app).get(`/client/marketing/projects/${projectId}/${path}`);
      expect(res.status, path).toBe(403);
    }
    const gen = await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`);
    expect(gen.status).toBe(403);
  });

  it("defaults apply when no settings row exists (everything visible)", async () => {
    const res = await request(app).get(`/client/marketing/projects/${projectId}/campaigns`);
    expect(res.status).toBe(200);
  });

  it("AI plan generation publishes immediately by default and stores the plan", async () => {
    const res = await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`);
    expect(res.status).toBe(201);
    expect(res.body.pendingReview).toBe(false);
    expect(res.body.plan.summary).toBe("Solid overall performance.");
    expect(H.store.client_ai_plans).toHaveLength(1);
    expect(H.store.client_ai_plans[0].status).toBe("published");

    const get = await request(app).get(`/client/marketing/projects/${projectId}/ai-plan`);
    expect(get.status).toBe(200);
    expect(get.body.plan.plan7).toHaveLength(1);
    // Client payload must not leak reviewer fields.
    expect(get.body.plan.requestedByUserId).toBeUndefined();
    expect(get.body.plan.provider).toBeUndefined();
  });

  it("aiRequiresReview holds the plan as pending_review and hides it from the client", async () => {
    setVisibility(projectId, { aiRequiresReview: true });
    const res = await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`);
    expect(res.status).toBe(201);
    expect(res.body.pendingReview).toBe(true);
    expect(res.body.plan).toBeNull();
    expect(H.store.client_ai_plans[0].status).toBe("pending_review");

    const get = await request(app).get(`/client/marketing/projects/${projectId}/ai-plan`);
    expect(get.body.plan).toBeNull();
    expect(get.body.pendingReview).toBe(true);
  });

  it("AI context contains only this project's client-visible data", async () => {
    const other = seedProject({ companyId: 2 });
    H.store.campaigns.push(
      { id: 1, projectId, clientVisible: true, name: "MyVisibleCampaign", status: "active", spent: 100, revenue: 400, impressions: 10, clicks: 2, leads: 1, conversions: 1, createdAt: new Date() },
      { id: 2, projectId, clientVisible: false, name: "MyHiddenCampaign", status: "active", spent: 1, revenue: 1, createdAt: new Date() },
      { id: 3, projectId: other, clientVisible: true, name: "OtherClientCampaign", status: "active", spent: 1, revenue: 1, createdAt: new Date() },
    );
    const res = await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`);
    expect(res.status).toBe(201);
    const sent = aiCalls[0].messages.map((m: any) => m.content).join("\n");
    expect(sent).toContain("MyVisibleCampaign");
    expect(sent).not.toContain("MyHiddenCampaign");
    expect(sent).not.toContain("OtherClientCampaign");
  });

  it("non-members get 403 on AI endpoints", async () => {
    currentUser = CLIENT_VIEWER; // not a member of projectId
    expect((await request(app).get(`/client/marketing/projects/${projectId}/ai-plan`)).status).toBe(403);
    expect((await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`)).status).toBe(403);
  });

  it("records audit events for dashboard view, report view, AI generation", async () => {
    await request(app).get(`/client/marketing/projects/${projectId}/overview`);
    await request(app).get(`/client/marketing/projects/${projectId}/report`);
    await request(app).post(`/client/marketing/projects/${projectId}/ai-plan/generate`);
    await flush();
    const actions = H.store.client_audit_logs.map((r) => r.action);
    expect(actions).toContain("portal.overview_viewed");
    expect(actions).toContain("portal.report_viewed");
    expect(actions).toContain("portal.ai_plan_generated");
    for (const r of H.store.client_audit_logs) {
      expect(r.projectId).toBe(projectId);
      expect(r.userId).toBe(CLIENT_USER.id);
    }
  });

  it("campaign rows omit spend/revenue/roas when those KPIs are hidden", async () => {
    setVisibility(projectId, { adSpend: false, revenue: false, roas: false });
    H.store.campaigns.push({ id: 1, projectId, clientVisible: true, name: "A", status: "active", spent: 200, revenue: 800, impressions: 100, clicks: 5, leads: 4, conversions: 2, createdAt: new Date() });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/campaigns`);
    expect(res.status).toBe(200);
    const row = res.body.campaigns[0];
    expect(row.spend).toBeUndefined();
    expect(row.revenue).toBeUndefined();
    expect(row.roas).toBeUndefined();
    expect(row.impressions).toBe(100);
  });

  it("report campaign highlights omit hidden financial fields", async () => {
    setVisibility(projectId, { adSpend: false });
    H.store.campaigns.push({ id: 1, projectId, clientVisible: true, name: "A", status: "active", spent: 200, revenue: 800, createdAt: new Date() });
    const res = await request(app).get(`/client/marketing/projects/${projectId}/report`);
    expect(res.status).toBe(200);
    expect(res.body.bestCampaign.name).toBe("A");
    expect(res.body.bestCampaign.spend).toBeUndefined();
    expect(res.body.bestCampaign.revenue).toBe(800);
    expect(res.body.campaignLifetime.adSpend).toBeUndefined();
  });

  it("creative asset endpoint enforces project scope, visibility and status", async () => {
    const other = seedProject({ companyId: 2 });
    H.store.campaign_creatives.push(
      { id: 1, companyId: 1, projectId, clientVisible: true, name: "Mine", type: "image", url: "https://cdn.example.com/a.png", status: "approved", createdAt: new Date() },
      { id: 2, companyId: 2, projectId: other, clientVisible: true, name: "Theirs", type: "image", url: "https://cdn.example.com/b.png", status: "approved", createdAt: new Date() },
      { id: 3, companyId: 1, projectId, clientVisible: true, name: "Draft", type: "image", url: "https://cdn.example.com/c.png", status: "draft", createdAt: new Date() },
    );
    // Own approved creative with external URL → redirect.
    const ok = await request(app).get(`/client/marketing/projects/${projectId}/creatives/1/asset`);
    expect(ok.status).toBe(302);
    // Cross-project and non-approved → 404.
    expect((await request(app).get(`/client/marketing/projects/${projectId}/creatives/2/asset`)).status).toBe(404);
    expect((await request(app).get(`/client/marketing/projects/${projectId}/creatives/3/asset`)).status).toBe(404);
    // Section disabled → 403.
    setVisibility(projectId, { creatives: false });
    expect((await request(app).get(`/client/marketing/projects/${projectId}/creatives/1/asset`)).status).toBe(403);
  });

  it("creative asset download=1 records an audit event", async () => {
    H.store.campaign_creatives.push(
      { id: 1, companyId: 1, projectId, clientVisible: true, name: "Mine", type: "image", url: "https://cdn.example.com/a.png", status: "approved", createdAt: new Date() },
    );
    await request(app).get(`/client/marketing/projects/${projectId}/creatives/1/asset?download=1`);
    await flush();
    const rows = H.store.client_audit_logs.filter((r) => r.action === "portal.creative_downloaded");
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.creativeId).toBe(1);
  });

  it("POST /marketing-projects rejects a second project for the same company", async () => {
    currentUser = SUPER_ADMIN;
    H.authState.user = SUPER_ADMIN;
    const res = await request(app).post("/marketing-projects")
      .send({ name: "Second", companyId: 1 });
    expect(res.status).toBe(409);
  });

  it("maps a concurrent-create unique violation (23505) to 409", async () => {
    currentUser = SUPER_ADMIN;
    H.authState.user = SUPER_ADMIN;
    // Simulate the race: the pre-check select sees no project, but the DB
    // unique index rejects the insert because another request won the race.
    const realSelect = H.db.select;
    (H.db as any).select = () => ({ from: () => ({ where: () => ({ then: (r: any) => r([]) }) }) });
    try {
      const res = await request(app).post("/marketing-projects")
        .send({ name: "Racer", companyId: 1 }); // projectId seeded for company 1 in beforeEach
      expect(res.status).toBe(409);
      expect(H.store.marketing_projects).toHaveLength(1);
    } finally {
      (H.db as any).select = realSelect;
    }
  });

  it("creative download audit rejects cross-project/hidden creatives", async () => {
    const other = seedProject({ companyId: 2 });
    H.store.campaign_creatives.push(
      { id: 1, companyId: 1, projectId, clientVisible: true, name: "Mine", type: "image", url: "/objects/a.png", status: "approved", createdAt: new Date() },
      { id: 2, companyId: 2, projectId: other, clientVisible: true, name: "Theirs", type: "image", url: "/objects/b.png", status: "approved", createdAt: new Date() },
      { id: 3, companyId: 1, projectId, clientVisible: false, name: "Hidden", type: "image", url: "/objects/c.png", status: "approved", createdAt: new Date() },
    );
    expect((await request(app).post(`/client/marketing/projects/${projectId}/creatives/1/downloaded`)).status).toBe(200);
    expect((await request(app).post(`/client/marketing/projects/${projectId}/creatives/2/downloaded`)).status).toBe(404);
    expect((await request(app).post(`/client/marketing/projects/${projectId}/creatives/3/downloaded`)).status).toBe(404);
    await flush();
    const rows = H.store.client_audit_logs.filter((r) => r.action === "portal.creative_downloaded");
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.creativeId).toBe(1);
  });
});

describe("marketing POST strips projectId/clientVisible", () => {
  it("POST /campaigns ignores projectId & clientVisible", async () => {
    currentUser = STAFF;
    const res = await request(app).post("/campaigns").send({
      companyId: 1, name: "C", status: "active", projectId: 99, clientVisible: true,
    });
    expect(res.status).toBe(201);
    const row = H.store.campaigns[0];
    expect(row.projectId).toBeUndefined();
    expect(row.clientVisible).toBeUndefined();
  });

  it("POST /marketing/creatives ignores projectId & clientVisible", async () => {
    currentUser = STAFF;
    const res = await request(app).post("/marketing/creatives").send({
      companyId: 1, name: "Cr", type: "image", url: "https://x.example.com/a.png",
      projectId: 99, clientVisible: true,
    });
    expect(res.status).toBe(201);
    const row = H.store.campaign_creatives[0];
    expect(row.projectId).toBeUndefined();
    expect(row.clientVisible).toBeUndefined();
  });

  it("POST /marketing/leads ignores projectId & clientVisible", async () => {
    currentUser = STAFF;
    const res = await request(app).post("/marketing/leads").send({
      companyId: 1, name: "L", source: "web", projectId: 99, clientVisible: true,
    });
    expect(res.status).toBe(201);
    const row = H.store.campaign_leads[0];
    expect(row.projectId).toBeUndefined();
    expect(row.clientVisible).toBeUndefined();
  });
});

// ---- Real auth-router ordering ----------------------------------------------
// The auth router is mounted publicly (before requireAuth and the global
// guard). Its internal catch-all must keep client accounts limited to exactly
// /auth/me even in that real ordering.
describe("auth router client boundary (real router)", () => {
  function buildRealApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).log = { error: (e: any) => { if (process.env.DBG) console.error("ROUTE ERR", e); }, warn: () => {} }; next(); });
    app.use(authRouter); // mounted publicly, exactly like routes/index.ts
    return app;
  }
  const realApp = buildRealApp();
  const withDates = (u: any) => ({ ...u, createdAt: new Date(), lastLoginAt: null, avatarUrl: null, department: null, status: "active" });

  it("lets a client user load /auth/me", async () => {
    H.authState.user = withDates(CLIENT_USER);
    const res = await request(realApp).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(CLIENT_USER.id);
  });

  it("rejects a client user on any other /auth/* route with 403", async () => {
    H.authState.user = withDates(CLIENT_USER);
    const res = await request(realApp).get("/auth/sessions");
    expect(res.status).toBe(403);
  });

  it("rejects a hybrid extraRoles client on other /auth/* routes", async () => {
    H.authState.user = withDates(STAFF_WITH_CLIENT_EXTRA);
    const res = await request(realApp).get("/auth/sessions");
    expect(res.status).toBe(403);
  });

  it("falls through to 404 (not 403) for internal staff on unknown /auth/* routes", async () => {
    H.authState.user = withDates(STAFF);
    const res = await request(realApp).get("/auth/sessions");
    expect(res.status).toBe(404);
  });

  it("returns 401 on unknown /auth/* routes when signed out", async () => {
    H.authState.user = null;
    const res = await request(realApp).get("/auth/sessions");
    expect(res.status).toBe(401);
  });
});

describe("projectScope", () => {
  it("is null for super admin, memberships for others, [] for none", async () => {
    const p1 = seedProject();
    addMember(p1, CLIENT_USER.id);
    const reqFor = (u: any) => ({ localUser: u } as any);
    expect(await projectScope(reqFor(SUPER_ADMIN))).toBeNull();
    expect(await projectScope(reqFor(CLIENT_USER))).toEqual([p1]);
    expect(await projectScope(reqFor(CLIENT_VIEWER))).toEqual([]);
  });
});
