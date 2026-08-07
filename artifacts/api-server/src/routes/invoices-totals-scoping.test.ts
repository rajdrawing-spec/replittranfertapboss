import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Regression tests for the Invoice & Billing API:
 *  - totals/tax fields are recomputed and stored server-side (client-sent
 *    amounts are ignored; invalid numbers are sanitized; taxType "none" is
 *    never taxed)
 *  - company scoping: scoped staff cannot create, read, modify or delete
 *    invoices of companies they don't belong to
 *  - cross-company references: customerId/productId belonging to another
 *    company are rejected with 400
 *  - paid amounts are bounded by the invoice total
 *
 * External boundaries (Postgres via @workspace/db, Clerk, role permissions)
 * are mocked the same way as the other isolation suites in this directory.
 */

// ---- In-memory fake of @workspace/db (drizzle query builder) ----------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store: Record<string, Row[]> = {
    invoices: [], invoice_items: [], invoice_customers: [], invoice_settings: [],
    companies: [], products: [],
  };
  const seq: Record<string, number> = {};

  function reset() {
    for (const k of Object.keys(store)) store[k] = [];
    for (const k of Object.keys(seq)) delete seq[k];
  }

  function makeTable(name: string) {
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === "__table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  }
  const invoicesTable = makeTable("invoices");
  const invoiceItemsTable = makeTable("invoice_items");
  const invoiceCustomersTable = makeTable("invoice_customers");
  const invoiceSettingsTable = makeTable("invoice_settings");
  const companiesTable = makeTable("companies");
  const productsTable = makeTable("products");

  const field = (col: string) => String(col).split(".")[1];

  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    switch (cond.op) {
      case "and": return cond.conds.filter(Boolean).every((c: any) => match(row, c));
      case "or": return cond.conds.filter(Boolean).some((c: any) => match(row, c));
      case "eq": return row[field(cond.col)] === cond.val;
      case "inArray": return cond.vals.includes(row[field(cond.col)]);
      default: return true;
    }
  }

  // camelCase in code, snake_case columns don't matter here — the fake store
  // keys rows by the property names the route code uses.
  class QB {
    type: string | null = null;
    table: string | null = null;
    cols: Record<string, any> | null = null;
    cond: any = null;
    order: any = null;
    _limit: number | null = null;
    _values: Row | null = null;
    _setVals: Row | null = null;
    select(cols?: Record<string, any>) { this.type = "select"; this.cols = cols ?? null; return this; }
    insert(t: any) { this.type = "insert"; this.table = t.__table; return this; }
    update(t: any) { this.type = "update"; this.table = t.__table; return this; }
    delete(t: any) { this.type = "delete"; this.table = t.__table; return this; }
    values(v: Row) { this._values = v; return this; }
    set(v: Row) { this._setVals = v; return this; }
    returning() { return this; }
    onConflictDoNothing() { return this; }
    from(t: any) { this.table = t.__table; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy(_o: any) { return this; }
    limit(n: number) { this._limit = n; return this; }
    offset(_n: number) { return this; }
    for(_mode: string) { return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      if (this.type === "insert") {
        seq[this.table!] = (seq[this.table!] ?? 0) + 1;
        const now = new Date();
        const row = { id: seq[this.table!], createdAt: now, updatedAt: now, ...this._values };
        arr.push(row);
        return [{ ...row }];
      }
      if (this.type === "update") {
        const matched = arr.filter((r) => match(r, this.cond));
        for (const r of matched) Object.assign(r, this._setVals);
        return matched.map((r) => ({ ...r }));
      }
      if (this.type === "delete") {
        const keep = arr.filter((r) => !match(r, this.cond));
        const removed = arr.filter((r) => match(r, this.cond));
        store[this.table!] = keep;
        return removed.map((r) => ({ ...r }));
      }
      let rows = arr.filter((r) => match(r, this.cond));
      if (this.cols) {
        // aggregate selects (dashboard) — count/sum descriptors just return rows.length/0
        const keys = Object.keys(this.cols);
        if (keys.every((k) => typeof this.cols![k] === "object" && this.cols![k]?.op === "sql")) {
          const out: Row = {};
          for (const k of keys) out[k] = k === "count" ? rows.length : 0;
          return [out];
        }
        rows = rows.map((r) => {
          const out: Row = {};
          for (const [k, colRef] of Object.entries(this.cols!)) out[k] = r[field(String(colRef))];
          return out;
        });
      } else {
        rows = rows.map((r) => ({ ...r }));
      }
      if (this._limit != null) rows = rows.slice(0, this._limit);
      return rows;
    }
  }

  const db = {
    select: (cols?: Record<string, any>) => new QB().select(cols),
    insert: (t: any) => new QB().insert(t),
    update: (t: any) => new QB().update(t),
    delete: (t: any) => new QB().delete(t),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };

  return { store, reset, db, invoicesTable, invoiceItemsTable, invoiceCustomersTable, invoiceSettingsTable, companiesTable, productsTable };
});

vi.mock("@workspace/db", () => ({
  db: H.db,
  invoicesTable: H.invoicesTable,
  invoiceItemsTable: H.invoiceItemsTable,
  invoiceCustomersTable: H.invoiceCustomersTable,
  invoiceSettingsTable: H.invoiceSettingsTable,
  companiesTable: H.companiesTable,
  productsTable: H.productsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  inArray: (col: string, vals: any[]) => ({ op: "inArray", col, vals }),
  desc: (col: string) => ({ op: "desc", col }),
  sql: (() => ({ op: "sql" })) as any,
}));

// Clerk boundary pulled in transitively by auth-user via company-scope.
vi.mock("../lib/auth-user", () => ({
  isSuperAdmin: (u: any) => u?.role === "super_admin",
}));

// Role permissions come from the DB; this suite verifies scoping + math,
// so pass through any signed-in user (unauthenticated still get 401).
vi.mock("../middleware/authz", () => ({
  requirePermission: () => (req: any, res: any, next: any) => {
    if (!req.localUser) { res.status(401).json({ error: "Authentication required" }); return; }
    next();
  },
}));

import invoicesRouter from "./invoices";

const ALPHA = 1;
const BETA = 2;

const SUPER_ADMIN = { id: 1, name: "Owner", email: "owner@example.com", role: "super_admin", companyIds: [] };
const ALPHA_STAFF = { id: 2, name: "Alpha Staff", email: "staff@alpha.example.com", role: "staff", companyIds: [ALPHA] };

let currentUser: any = null;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).localUser = currentUser;
    (req as any).log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(invoicesRouter);
  return app;
}
const app = buildApp();

beforeEach(() => {
  H.reset();
  currentUser = null;
  H.store.companies.push(
    { id: ALPHA, name: "Alpha", createdAt: new Date(), updatedAt: new Date() },
    { id: BETA, name: "Beta", createdAt: new Date(), updatedAt: new Date() },
  );
});

const baseInvoice = (companyId: number, items: any[] = []) => ({
  companyId, type: "invoice", status: "draft", customerName: "ACME Traders", items,
});

// ---- Server-side totals & tax math ------------------------------------------
describe("POST /invoices totals & tax math", () => {
  it("recomputes stored totals server-side and ignores client-sent amounts", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      // client lies about amount/taxAmount/lineTotal — must be recomputed
      { description: "Widget", quantity: 2, rate: 100, discountPercent: 10, taxType: "gst", taxRate: 18, amount: 1, taxAmount: 1, lineTotal: 1 },
    ]));
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe(200);
    expect(res.body.discountTotal).toBe(20);
    expect(res.body.taxTotal).toBe(32.4); // 18% of 180
    expect(res.body.total).toBe(212.4);
    expect(res.body.items[0].amount).toBe(180);
    expect(res.body.items[0].taxAmount).toBe(32.4);
    expect(res.body.items[0].lineTotal).toBe(212.4);
  });

  it("forces zero tax when taxType is 'none' even if a tax rate is sent", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      { description: "Exempt item", quantity: 1, rate: 500, taxType: "none", taxRate: 18 },
    ]));
    expect(res.status).toBe(201);
    expect(res.body.items[0].taxRate).toBe(0);
    expect(res.body.items[0].taxAmount).toBe(0);
    expect(res.body.total).toBe(500);
  });

  it("sanitizes negative and non-numeric quantities/rates/tax rates", async () => {
    currentUser = SUPER_ADMIN;
    const res = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      { description: "Bad numbers", quantity: -5, rate: "abc", discountPercent: 400, taxType: "gst", taxRate: -18 },
    ]));
    expect(res.status).toBe(201);
    const it0 = res.body.items[0];
    expect(it0.quantity).toBe(1);       // invalid -> default 1
    expect(it0.rate).toBe(0);           // invalid -> 0
    expect(it0.discountPercent).toBe(100); // clamped to [0,100]
    expect(it0.taxRate).toBe(0);        // negative -> clamped to 0
    expect(res.body.total).toBe(0);
    expect(Number.isFinite(res.body.total)).toBe(true);
  });

  it("recomputes totals on PATCH when items are replaced", async () => {
    currentUser = SUPER_ADMIN;
    const created = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      { description: "Old", quantity: 1, rate: 100, taxType: "gst", taxRate: 18 },
    ]));
    const res = await request(app).patch(`/invoices/${created.body.id}`).send({
      items: [{ description: "New", quantity: 3, rate: 200, taxType: "igst", taxRate: 12 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.subtotal).toBe(600);
    expect(res.body.taxTotal).toBe(72);
    expect(res.body.total).toBe(672);
    expect(res.body.items).toHaveLength(1);
  });
});

// ---- Paid amount bounds ------------------------------------------------------
describe("POST /invoices/:id/status paid amounts", () => {
  it("sets paidAmount to the full total on 'paid' and caps partial payments at total", async () => {
    currentUser = SUPER_ADMIN;
    const created = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      { description: "Widget", quantity: 1, rate: 100, taxType: "gst", taxRate: 18 },
    ]));
    const id = created.body.id;

    const partial = await request(app).post(`/invoices/${id}/status`).send({ status: "partially_paid", paidAmount: 999999 });
    expect(partial.status).toBe(200);
    expect(partial.body.paidAmount).toBe(118); // capped at total

    const neg = await request(app).post(`/invoices/${id}/status`).send({ status: "partially_paid", paidAmount: -50 });
    expect(neg.body.paidAmount).toBe(0);

    const paid = await request(app).post(`/invoices/${id}/status`).send({ status: "paid" });
    expect(paid.body.paidAmount).toBe(118);
  });
});

// ---- Company scoping ---------------------------------------------------------
describe("invoice company scoping", () => {
  it("scoped staff cannot create an invoice for another company", async () => {
    currentUser = ALPHA_STAFF;
    const res = await request(app).post("/invoices").send(baseInvoice(BETA));
    expect(res.status).toBe(403);
  });

  it("scoped staff cannot read, edit, restatus or delete another company's invoice", async () => {
    currentUser = SUPER_ADMIN;
    const created = await request(app).post("/invoices").send(baseInvoice(BETA, [
      { description: "Beta thing", quantity: 1, rate: 10, taxType: "gst", taxRate: 18 },
    ]));
    const id = created.body.id;

    currentUser = ALPHA_STAFF;
    expect((await request(app).get(`/invoices/${id}`)).status).toBe(403);
    expect((await request(app).patch(`/invoices/${id}`).send({ customerName: "X" })).status).toBe(403);
    expect((await request(app).post(`/invoices/${id}/status`).send({ status: "paid" })).status).toBe(403);
    expect((await request(app).delete(`/invoices/${id}`)).status).toBe(403);
  });

  it("list endpoint only returns invoices from the caller's companies", async () => {
    currentUser = SUPER_ADMIN;
    await request(app).post("/invoices").send(baseInvoice(ALPHA));
    await request(app).post("/invoices").send(baseInvoice(BETA));

    currentUser = ALPHA_STAFF;
    const res = await request(app).get("/invoices");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].companyId).toBe(ALPHA);

    // widening via query param must fail
    expect((await request(app).get("/invoices").query({ companyId: String(BETA) })).status).toBe(403);
  });

  it("unauthenticated requests get 401", async () => {
    currentUser = null;
    expect((await request(app).get("/invoices")).status).toBe(401);
    expect((await request(app).post("/invoices").send(baseInvoice(ALPHA))).status).toBe(401);
  });
});

// ---- Cross-company references --------------------------------------------------
describe("cross-company customer/product references", () => {
  it("rejects a customerId that belongs to another company", async () => {
    currentUser = SUPER_ADMIN;
    H.store.invoice_customers.push({ id: 77, companyId: BETA, name: "Beta Customer", createdAt: new Date() });
    const res = await request(app).post("/invoices").send({ ...baseInvoice(ALPHA), customerId: 77 });
    expect(res.status).toBe(400);
  });

  it("rejects a line-item productId that belongs to another company", async () => {
    currentUser = SUPER_ADMIN;
    H.store.products.push({ id: 55, companyId: BETA, name: "Beta Product", createdAt: new Date() });
    const res = await request(app).post("/invoices").send(baseInvoice(ALPHA, [
      { description: "Sneaky", quantity: 1, rate: 10, productId: 55, taxType: "gst", taxRate: 18 },
    ]));
    expect(res.status).toBe(400);
  });

  it("accepts customer and product ids that belong to the invoice company", async () => {
    currentUser = SUPER_ADMIN;
    H.store.invoice_customers.push({ id: 10, companyId: ALPHA, name: "Alpha Customer", createdAt: new Date() });
    H.store.products.push({ id: 11, companyId: ALPHA, name: "Alpha Product", createdAt: new Date() });
    const res = await request(app).post("/invoices").send({
      ...baseInvoice(ALPHA, [{ description: "OK", quantity: 1, rate: 10, productId: 11, taxType: "gst", taxRate: 18 }]),
      customerId: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(10);
    expect(res.body.items[0].productId).toBe(11);
  });
});
