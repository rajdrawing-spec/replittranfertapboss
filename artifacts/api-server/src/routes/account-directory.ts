import { Router } from "express";
import { db } from "@workspace/db";
import { accountDirectoryTable, usersTable, insertAccountDirectorySchema } from "@workspace/db";
import { eq, or, and, ilike, desc, inArray, isNull, type SQL } from "drizzle-orm";

const router = Router();

// Roles that can access every company's accounts (group-level).
const GROUP_ROLES = ["super_admin", "founder", "director", "finance", "ca"];

async function getUser(userId: number): Promise<{ role: string; companyIds: number[] } | null> {
  const [u] = await db
    .select({ role: usersTable.role, companyIds: usersTable.companyIds })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!u) return null;
  return { role: u.role, companyIds: (u.companyIds as number[]) ?? [] };
}

function isGroupRole(role: string) { return GROUP_ROLES.includes(role); }

/**
 * Row-level access scope. Group roles see/modify everything (undefined = no filter).
 * Other users are limited to their own companies + group-level (companyId null) rows.
 */
function accessScope(user: { role: string; companyIds: number[] }): SQL | undefined {
  if (isGroupRole(user.role)) return undefined;
  return user.companyIds.length
    ? or(inArray(accountDirectoryTable.companyId, user.companyIds), isNull(accountDirectoryTable.companyId))!
    : isNull(accountDirectoryTable.companyId);
}

// Fields the client may never set directly on update.
function sanitize(body: Record<string, unknown>) {
  const { id, createdAt, updatedAt, companyId, ...rest } = body;
  return rest;
}

router.get("/account-directory", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const { companyId, q } = req.query as Record<string, string>;
    const conditions: SQL[] = [];

    // Always enforce the caller's scope (prevents companyId query bypass).
    const scope = accessScope(user);
    if (scope) conditions.push(scope);

    if (companyId) conditions.push(eq(accountDirectoryTable.companyId, parseInt(companyId)));

    if (q) {
      const like = `%${q}%`;
      conditions.push(or(
        ilike(accountDirectoryTable.platform, like),
        ilike(accountDirectoryTable.loginEmail, like),
        ilike(accountDirectoryTable.recoveryEmail, like),
        ilike(accountDirectoryTable.phone, like),
        ilike(accountDirectoryTable.recoveryPhone, like),
        ilike(accountDirectoryTable.accountOwner, like),
        ilike(accountDirectoryTable.department, like),
        ilike(accountDirectoryTable.platformUrl, like),
      )!);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(accountDirectoryTable).where(where).orderBy(desc(accountDirectoryTable.updatedAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list accounts" }); }
});

router.post("/account-directory", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const parsed = insertAccountDirectorySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

    // Non-group users may only create entries for a company they belong to.
    if (!isGroupRole(user.role)) {
      const cid = parsed.data.companyId;
      if (cid == null || !user.companyIds.includes(cid)) {
        res.status(403).json({ error: "Cannot create an account for this company" });
        return;
      }
    }

    const [e] = await db.insert(accountDirectoryTable).values(parsed.data).returning();
    res.status(201).json(e);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create account" }); }
});

router.patch("/account-directory/:id", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const payload: Record<string, unknown> = { ...sanitize(req.body), updatedAt: new Date() };
    const scope = accessScope(user);
    const idClause = eq(accountDirectoryTable.id, parseInt(req.params.id));
    const where = scope ? and(idClause, scope) : idClause;

    const [e] = await db.update(accountDirectoryTable).set(payload).where(where).returning();
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    res.json(e);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update account" }); }
});

router.delete("/account-directory/:id", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const scope = accessScope(user);
    const idClause = eq(accountDirectoryTable.id, parseInt(req.params.id));
    const where = scope ? and(idClause, scope) : idClause;

    const [e] = await db.delete(accountDirectoryTable).where(where).returning();
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete account" }); }
});

export default router;
