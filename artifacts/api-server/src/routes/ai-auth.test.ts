import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Authorization regression tests for AI routes.
 *
 * Verifies three invariants:
 * 1. Unauthenticated requests get 401 on all AI + Gemini routes.
 * 2. A scoped staff user WITH ai.read cannot access another company's analysis
 *    (403 from canAccessCompany).
 * 3. A super admin sees any company; a user without ai.read gets 403 from the
 *    permission gate before reaching the scope check.
 */

// ── In-memory fake of @workspace/db ──────────────────────────────────────────
const H = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const store: Record<string, Row[]> = {
    ai_analyses: [],
    ai_config:   [],
    conversations: [],
    messages:    [],
    orders:      [],
    products:    [],
    employees:   [],
    leads:       [],
    companies:   [],
    transactions:[],
    customers:   [],
    treasury_entries: [],
    finance_transactions: [],
  };

  function reset() {
    for (const k of Object.keys(store)) store[k] = [];
  }

  function makeTable(name: string) {
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === "__table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  }

  const aiAnalysesTable   = makeTable("ai_analyses");
  const aiConfigTable     = makeTable("ai_config");
  const conversations     = makeTable("conversations");
  const messages          = makeTable("messages");
  const ordersTable       = makeTable("orders");
  const productsTable     = makeTable("products");
  const employeesTable    = makeTable("employees");
  const leadsTable        = makeTable("leads");
  const companiesTable    = makeTable("companies");
  const transactionsTable = makeTable("transactions");
  const customersTable    = makeTable("customers");

  const field = (col: string) => (col.includes(".") ? col.split(".")[1] : col);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    if (typeof cond !== "object") return true;
    const { op } = cond as { op?: string };
    if (op === "eq")      return row[field(cond.col as string)] == cond.val;
    if (op === "inArray") return (cond.vals as unknown[]).includes(row[field(cond.col as string)]);
    if (op === "and")     return (cond.conds as unknown[]).filter(Boolean).every((sub) => match(row, sub));
    return true;
  }

  // These are used only in the @workspace/db re-exports; drizzle-orm itself is mocked separately below.
  const eq      = (col: unknown, val: unknown)      => ({ op: "eq",      col, val });
  const inArray = (col: unknown, vals: unknown[])   => ({ op: "inArray", col, vals });
  const and     = (...conds: unknown[])             => ({ op: "and",     conds });
  const desc    = (col: unknown)                    => ({ op: "desc",    col });
  const asc     = (col: unknown)                    => ({ op: "asc",     col });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = (s: TemplateStringsArray) => ({ op: "sql" });
  sql.raw        = (s: string) => s;

  const db = {
    select(_cols?: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { from: (t: any) => {
        const tName = (t.__table ?? "unknown") as string;
        const rows  = store[tName] ?? [];
        let _where: unknown    = undefined;
        let _limit: number | null = null;
        const q = {
          where(c: unknown)   { _where = c; return q; },
          limit(n: number)    { _limit = n; return q; },
          orderBy()           { return q; },
          then(resolve: (v: unknown) => unknown) {
            let result = rows.filter((r) => match(r, _where));
            if (_limit !== null) result = result.slice(0, _limit);
            return Promise.resolve(resolve(result));
          },
        };
        return q;
      }};
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(t: any) {
      return { values(vals: Row | Row[]) {
        return {
          returning() {
            const tName = (t.__table ?? "unknown") as string;
            const arr   = Array.isArray(vals) ? vals : [vals];
            const rows  = store[tName] ?? (store[tName] = []);
            const out   = arr.map((v, i) => ({ id: rows.length + i + 1, createdAt: new Date(), ...v }));
            out.forEach((r) => rows.push(r));
            return Promise.resolve(out);
          },
          then(resolve: (v: unknown) => unknown) {
            const tName = (t.__table ?? "unknown") as string;
            const arr   = Array.isArray(vals) ? vals : [vals];
            const rows  = store[tName] ?? (store[tName] = []);
            arr.forEach((v, i) => rows.push({ id: rows.length + i + 1, createdAt: new Date(), ...v }));
            return Promise.resolve(resolve(undefined));
          },
        };
      }};
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete(_t: any) { return { where: () => Promise.resolve() }; },
  };

  return {
    store, reset,
    db, eq, inArray, and, asc, desc, sql,
    aiAnalysesTable, aiConfigTable, conversations, messages,
    ordersTable, productsTable, employeesTable, leadsTable,
    companiesTable, transactionsTable, customersTable,
  };
});

vi.mock("@workspace/db", () => ({
  db:                H.db,
  eq:                H.eq,
  inArray:           H.inArray,
  and:               H.and,
  asc:               H.asc,
  desc:              H.desc,
  sql:               H.sql,
  aiAnalysesTable:   H.aiAnalysesTable,
  aiConfigTable:     H.aiConfigTable,
  conversations:     H.conversations,
  messages:          H.messages,
  ordersTable:       H.ordersTable,
  productsTable:     H.productsTable,
  employeesTable:    H.employeesTable,
  leadsTable:        H.leadsTable,
  companiesTable:    H.companiesTable,
  transactionsTable: H.transactionsTable,
  customersTable:    H.customersTable,
}));

vi.mock("drizzle-orm", () => ({
  eq:       (col: string, val: unknown)       => ({ op: "eq",       col, val }),
  and:      (...conds: unknown[])             => ({ op: "and",      conds }),
  inArray:  (col: string, vals: unknown[])    => ({ op: "inArray",  col, vals }),
  desc:     (col: string)                     => ({ op: "desc",     col }),
  asc:      (col: string)                     => ({ op: "asc",      col }),
  sql:      (() => ({ op: "sql" })) as unknown,
}));

// Mock auth-user so requirePermission uses the injected localUser's permissions
vi.mock("../lib/auth-user", async (importActual) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await importActual<any>();
  return {
    ...actual,
    // isSuperAdmin: check role property directly
    isSuperAdmin: (u: { role?: string }) => u?.role === "super_admin",
    // getUserPermissions: read from localUser's resolvedPermissions (Set or array)
    getUserPermissions: vi.fn(async (u: { resolvedPermissions?: Set<string> | string[] }) => {
      const rp = u?.resolvedPermissions;
      if (!rp) return [];
      if (rp instanceof Set) return Array.from(rp);
      return rp;
    }),
    // hasPermission: simple includes check
    hasPermission: (perms: string[], perm: string) =>
      perms.includes("*") || perms.includes(perm),
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Stub AI provider — never make real network calls
vi.mock("../lib/ai-provider", () => ({
  getActiveProvider: vi.fn().mockResolvedValue({
    chat: vi.fn().mockResolvedValue(
      '{"answer":"ok","reasoning":"r","supporting_data":[],"confidence":80,"priority":"medium"}',
    ),
  }),
  getActiveProviderName: vi.fn().mockResolvedValue("gemini"),
  setConfig:     vi.fn().mockResolvedValue(undefined),
  testProvider:  vi.fn().mockResolvedValue({ ok: true, latencyMs: 100 }),
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: '{}' }),
      generateContentStream: vi.fn().mockResolvedValue(
        (async function* () { yield { text: "hello" }; })()
      ),
    },
  },
}));

vi.mock("../lib/ai-context", () => ({
  buildCompanyContext:     vi.fn().mockResolvedValue(null),
  buildPortfolioContext:   vi.fn().mockResolvedValue({
    groupRevenue: 0, groupExpenses: 0, groupNetProfit: 0, activeEmployees: 0, companies: [],
  }),
  formatContextForPrompt:  vi.fn().mockReturnValue(""),
}));

// ── User fixtures ─────────────────────────────────────────────────────────────
const SCOPED_USER = {
  id: 1,
  email: "staff@example.com",
  role: "staff",
  companyIds: [10] as number[],
  resolvedPermissions: new Set(["ai.read"]),
};

const SUPER_ADMIN = {
  id: 99,
  email: "admin@example.com",
  role: "super_admin",
  companyIds: null as null,
  resolvedPermissions: new Set(["*"]),
};

const NO_PERM_USER = {
  id: 2,
  email: "noperm@example.com",
  role: "staff",
  companyIds: [10] as number[],
  resolvedPermissions: new Set<string>(), // no ai.read
};

// ── App factory ───────────────────────────────────────────────────────────────
async function makeApp(user?: typeof SCOPED_USER | typeof SUPER_ADMIN | typeof NO_PERM_USER | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    if (user !== null && user !== undefined) {
      (req as express.Request & { localUser: unknown }).localUser = user;
    }
    next();
  });

  const { default: aiRouter }     = await import("./ai");
  const { default: geminiRouter } = await import("./gemini");
  app.use(aiRouter);
  app.use(geminiRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("AI routes — authorization", () => {
  beforeEach(() => {
    H.reset();
    vi.clearAllMocks();
  });

  // ── 1. Unauthenticated → 401 ──────────────────────────────────────────────
  describe("unauthenticated requests (no localUser)", () => {
    it("POST /ai/analyse/:companyId → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).post("/ai/analyse/1");
      expect(res.status).toBe(401);
    });

    it("GET /ai/analyse/:companyId/cached → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).get("/ai/analyse/1/cached");
      expect(res.status).toBe(401);
    });

    it("POST /ai/executive → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).post("/ai/executive").send({ question: "hi" });
      expect(res.status).toBe(401);
    });

    it("POST /ai/chat → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).post("/ai/chat").send({ message: "hello" });
      expect(res.status).toBe(401);
    });

    it("GET /ai/insights → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).get("/ai/insights");
      expect(res.status).toBe(401);
    });

    it("GET /gemini/conversations → 401", async () => {
      const app = await makeApp(null);
      const res = await request(app).get("/gemini/conversations");
      expect(res.status).toBe(401);
    });
  });

  // ── 2. No ai.read permission → 403 from permission gate ──────────────────
  describe("authenticated user without ai.read permission", () => {
    it("POST /ai/chat → 403", async () => {
      const app = await makeApp(NO_PERM_USER);
      const res = await request(app).post("/ai/chat").send({ message: "hello" });
      expect(res.status).toBe(403);
    });

    it("GET /ai/insights → 403", async () => {
      const app = await makeApp(NO_PERM_USER);
      const res = await request(app).get("/ai/insights");
      expect(res.status).toBe(403);
    });

    it("GET /gemini/conversations → 403", async () => {
      const app = await makeApp(NO_PERM_USER);
      const res = await request(app).get("/gemini/conversations");
      expect(res.status).toBe(403);
    });

    it("POST /ai/analyse/10 → 403 (permission gate before scope)", async () => {
      const app = await makeApp(NO_PERM_USER);
      const res = await request(app).post("/ai/analyse/10");
      expect(res.status).toBe(403);
    });
  });

  // ── 3. Scoped user WITH ai.read — cross-company blocked ──────────────────
  describe("scoped staff user (companyIds: [10], has ai.read)", () => {
    it("POST /ai/analyse/99 → 403 (out-of-scope company)", async () => {
      const app = await makeApp(SCOPED_USER);
      const res = await request(app).post("/ai/analyse/99");
      expect(res.status).toBe(403);
    });

    it("GET /ai/analyse/99/cached → 403 (out-of-scope company)", async () => {
      const app = await makeApp(SCOPED_USER);
      const res = await request(app).get("/ai/analyse/99/cached");
      expect(res.status).toBe(403);
    });

    it("POST /ai/executive with out-of-scope companyId → 403", async () => {
      const app = await makeApp(SCOPED_USER);
      const res = await request(app)
        .post("/ai/executive")
        .send({ question: "Revenue?", companyId: 99 });
      expect(res.status).toBe(403);
    });

    it("POST /ai/executive with no companyId calls buildPortfolioContext with scoped array", async () => {
      const { buildPortfolioContext } = await import("../lib/ai-context");
      const app = await makeApp(SCOPED_USER);
      await request(app).post("/ai/executive").send({ question: "Revenue please" });
      // Must be called with [10], never with undefined (full portfolio)
      expect(buildPortfolioContext).toHaveBeenCalledWith([10]);
    });

    it("POST /ai/analyse/10 → not 403 (own company)", async () => {
      const app = await makeApp(SCOPED_USER);
      const res = await request(app).post("/ai/analyse/10");
      // 200 (from cache or analysis), 502 (AI parse fail on mock), never 403
      expect(res.status).not.toBe(403);
    });

    it("GET /gemini/conversations only returns own conversations", async () => {
      H.store.conversations = [
        { id: 1, title: "Mine",   ownerUserId: 1, createdAt: new Date() },
        { id: 2, title: "Others", ownerUserId: 2, createdAt: new Date() },
      ];
      const app = await makeApp(SCOPED_USER);
      const res = await request(app).get("/gemini/conversations");
      expect(res.status).toBe(200);
      const ids = (res.body as { id: number }[]).map((c) => c.id);
      expect(ids).toContain(1);
      expect(ids).not.toContain(2);
    });
  });

  // ── 4. Super admin — unrestricted ─────────────────────────────────────────
  describe("super admin user", () => {
    it("POST /ai/analyse/1 → not 403", async () => {
      const app = await makeApp(SUPER_ADMIN);
      const res = await request(app).post("/ai/analyse/1");
      expect(res.status).not.toBe(403);
    });

    it("POST /ai/executive with no companyId calls buildPortfolioContext with undefined (all)", async () => {
      const { buildPortfolioContext } = await import("../lib/ai-context");
      const app = await makeApp(SUPER_ADMIN);
      await request(app).post("/ai/executive").send({ question: "Portfolio summary" });
      // Super admin → callerScope null → no restriction
      expect(buildPortfolioContext).toHaveBeenCalledWith(undefined);
    });

    it("GET /gemini/conversations returns only own conversations (even for super admin)", async () => {
      H.store.conversations = [
        { id: 10, title: "AdminChat", ownerUserId: 99, createdAt: new Date() },
        { id: 11, title: "StaffChat", ownerUserId: 1,  createdAt: new Date() },
      ];
      const app = await makeApp(SUPER_ADMIN);
      const res = await request(app).get("/gemini/conversations");
      expect(res.status).toBe(200);
      const ids = (res.body as { id: number }[]).map((c) => c.id);
      expect(ids).toContain(10);
      expect(ids).not.toContain(11); // super admin still only sees own chats
    });
  });
});
