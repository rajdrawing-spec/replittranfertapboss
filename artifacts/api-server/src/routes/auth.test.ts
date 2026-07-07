import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Backend security regression test — the real server-side access gate.
 *
 * The frontend account-switch test only proves the *browser* never surfaces a
 * previous user's data; it mocks /api/auth/me and never exercises the actual
 * authorization decision. This test exercises that decision directly:
 * getOrProvisionLocalUser (invite-only provisioning) and GET /api/auth/me.
 *
 * Real sign-in is Clerk Google OAuth (invite-only) and cannot run headlessly,
 * so we mock the two external boundaries — Postgres (@workspace/db) with a tiny
 * in-memory store, and Clerk (@clerk/express) identity lookups — then assert the
 * server rejects disabled / never-invited accounts and admits valid ones.
 */

// ---- In-memory fake of @workspace/db (drizzle query builder) ----------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const store: Record<string, Row[]> = { users: [], invitations: [], roles: [] };
  const counters: Record<string, number> = { users: 0, invitations: 0, roles: 0 };

  function reset() {
    store.users = [];
    store.invitations = [];
    store.roles = [];
    counters.users = 0;
    counters.invitations = 0;
    counters.roles = 0;
  }

  // Tables are proxies: `usersTable.email` -> "users.email"; `__table` -> name.
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
  const usersTable = makeTable("users");
  const invitationsTable = makeTable("invitations");
  const rolesTable = makeTable("roles");

  // drizzle condition descriptors produced by our mocked eq/and/desc.
  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    if (cond.op === "and") return cond.conds.every((c: any) => match(row, c));
    if (cond.op === "eq") return row[cond.col.split(".")[1]] === cond.val;
    return true;
  }

  class QB {
    type: string | null = null;
    table: string | null = null;
    cond: any = null;
    order: any = null;
    _limit: number | null = null;
    _values: Row | null = null;
    _set: Row | null = null;
    _returning = false;
    select() { this.type = "select"; return this; }
    insert(t: any) { this.type = "insert"; this.table = t.__table; return this; }
    update(t: any) { this.type = "update"; this.table = t.__table; return this; }
    from(t: any) { this.table = t.__table; return this; }
    set(v: Row) { this._set = v; return this; }
    values(v: Row) { this._values = v; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy(o: any) { this.order = o; return this; }
    limit(n: number) { this._limit = n; return this; }
    returning() { this._returning = true; return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const t = this.table!;
      const arr = store[t];
      if (this.type === "select") {
        let rows = arr.filter((r) => match(r, this.cond));
        if (this.order && this.order.op === "desc") {
          const f = this.order.col.split(".")[1];
          rows = [...rows].sort((a, b) => (a[f] < b[f] ? 1 : a[f] > b[f] ? -1 : 0));
        }
        if (this._limit != null) rows = rows.slice(0, this._limit);
        return rows.map((r) => ({ ...r }));
      }
      if (this.type === "insert") {
        counters[t] += 1;
        const now = new Date();
        const row: Row = { id: counters[t], createdAt: now, updatedAt: now, companyIds: [], ...this._values };
        arr.push(row);
        return this._returning ? [{ ...row }] : undefined;
      }
      if (this.type === "update") {
        const updated: Row[] = [];
        for (const r of arr) {
          if (match(r, this.cond)) { Object.assign(r, this._set); updated.push({ ...r }); }
        }
        return this._returning ? updated : undefined;
      }
      return undefined;
    }
  }

  const db = {
    select: () => new QB().select(),
    insert: (t: any) => new QB().insert(t),
    update: (t: any) => new QB().update(t),
  };

  return { store, counters, reset, db, usersTable, invitationsTable, rolesTable };
});

// ---- Clerk identity boundary -------------------------------------------------
const clerk = vi.hoisted(() => ({ getAuth: vi.fn(), getUser: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: H.db,
  usersTable: H.usersTable,
  invitationsTable: H.invitationsTable,
  rolesTable: H.rolesTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  desc: (col: string) => ({ op: "desc", col }),
}));

vi.mock("@clerk/express", () => ({
  getAuth: clerk.getAuth,
  clerkClient: { users: { getUser: clerk.getUser } },
}));

// Side-effecting helpers that also hit the DB — no-op them in tests.
vi.mock("../lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));

import authRouter from "./auth";
import { getOrProvisionLocalUser } from "../lib/auth-user";
import { SUPER_ADMIN_EMAIL } from "../lib/permissions";

function seedUser(overrides: Record<string, any> = {}) {
  H.counters.users += 1;
  const now = new Date();
  const row = {
    id: H.counters.users,
    name: "Seed User",
    email: `user${H.counters.users}@example.com`,
    clerkUserId: null,
    role: "operations_manager",
    department: null,
    companyIds: [],
    avatarUrl: null,
    status: "active",
    lastUserAgent: null,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  H.store.users.push(row);
  return row;
}

function clerkIdentity(email: string) {
  return {
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [{ emailAddress: email }],
    firstName: "Test",
    lastName: "Person",
    username: null,
    imageUrl: null,
  };
}

const app = express();
app.use(authRouter);

beforeEach(() => {
  H.reset();
  clerk.getAuth.mockReset();
  clerk.getUser.mockReset();
});

// ---- GET /api/auth/me (route-level HTTP behavior) ---------------------------
describe("GET /api/auth/me", () => {
  it("returns 401 when there is no Clerk session", async () => {
    clerk.getAuth.mockReturnValue({ userId: null });
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 for an already-linked active user", async () => {
    seedUser({ clerkUserId: "clerk_active", email: "active@example.com", status: "active" });
    clerk.getAuth.mockReturnValue({ userId: "clerk_active" });
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("active@example.com");
    expect(res.body.user).toHaveProperty("permissions");
  });

  it("rejects a disabled account with 403 'disabled'", async () => {
    seedUser({ clerkUserId: "clerk_disabled", email: "disabled@example.com", status: "disabled" });
    clerk.getAuth.mockReturnValue({ userId: "clerk_disabled" });
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("disabled");
  });

  it("rejects an unknown, never-invited email with 403 'not_invited'", async () => {
    clerk.getAuth.mockReturnValue({ userId: "clerk_stranger" });
    clerk.getUser.mockResolvedValue(clerkIdentity("stranger@example.com"));
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_invited");
  });

  it("provisions a user who has a pending invitation (200)", async () => {
    H.store.invitations.push({
      id: 1, email: "invited@example.com", name: "Invited Person",
      role: "finance_manager", department: null, companyIds: [], status: "pending",
    });
    clerk.getAuth.mockReturnValue({ userId: "clerk_invited" });
    clerk.getUser.mockResolvedValue(clerkIdentity("invited@example.com"));
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("invited@example.com");
    expect(res.body.user.role).toBe("finance_manager");
    // Invitation is consumed.
    expect(H.store.invitations[0].status).toBe("accepted");
  });

  it("bootstraps the super admin even without an invitation (200, isSuperAdmin)", async () => {
    clerk.getAuth.mockReturnValue({ userId: "clerk_super" });
    clerk.getUser.mockResolvedValue(clerkIdentity(SUPER_ADMIN_EMAIL));
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.isSuperAdmin).toBe(true);
    expect(res.body.user.permissions).toContain("*");
  });
});

// ---- getOrProvisionLocalUser (unit-level provisioning decisions) ------------
describe("getOrProvisionLocalUser", () => {
  it("returns 'unauthenticated' when no Clerk id is supplied", async () => {
    const { error } = await getOrProvisionLocalUser(null);
    expect(error).toBe("unauthenticated");
  });

  it("returns 'disabled' for a linked disabled user", async () => {
    seedUser({ clerkUserId: "c_dis", status: "disabled" });
    const { error, user } = await getOrProvisionLocalUser("c_dis");
    expect(error).toBe("disabled");
    expect(user).toBeUndefined();
  });

  it("returns 'not_invited' for an unknown email with no invitation", async () => {
    clerk.getUser.mockResolvedValue(clerkIdentity("nobody@example.com"));
    const { error } = await getOrProvisionLocalUser("c_unknown");
    expect(error).toBe("not_invited");
  });

  it("activates a pre-provisioned (invited) user row on first sign-in", async () => {
    seedUser({ email: "pending@example.com", status: "invited", clerkUserId: null });
    clerk.getUser.mockResolvedValue(clerkIdentity("pending@example.com"));
    const { error, user } = await getOrProvisionLocalUser("c_pending");
    expect(error).toBeUndefined();
    expect(user?.status).toBe("active");
    expect(user?.clerkUserId).toBe("c_pending");
  });

  it("bootstraps the super admin with an active super_admin row", async () => {
    clerk.getUser.mockResolvedValue(clerkIdentity(SUPER_ADMIN_EMAIL));
    const { error, user } = await getOrProvisionLocalUser("c_super");
    expect(error).toBeUndefined();
    expect(user?.role).toBe("super_admin");
    expect(user?.status).toBe("active");
  });
});
