import { Router } from "express";
import { db } from "@workspace/db";
import { vaultEntriesTable, usersTable, insertVaultEntrySchema } from "@workspace/db";
import { eq, or, and, ilike, desc, type SQL } from "drizzle-orm";

const router = Router();

// Roles that are NEVER allowed to reveal passwords
const RESTRICTED_ROLES = ["investor"];
// Roles that can access every company's data (group-level)
const GROUP_ROLES = ["super_admin", "founder", "director", "finance", "ca"];

function maskEntry(e: typeof vaultEntriesTable.$inferSelect) {
  return { ...e, password: "••••••••••", passwordMasked: true };
}

async function getUser(userId: number): Promise<{ role: string; companyIds: number[] } | null> {
  const [u] = await db.select({ role: usersTable.role, companyIds: usersTable.companyIds }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!u) return null;
  return { role: u.role, companyIds: (u.companyIds as number[]) ?? [] };
}

// Fields the client is never allowed to set directly on update
function sanitize(body: Record<string, unknown>) {
  const { id, createdAt, updatedAt, companyId, ...rest } = body;
  return rest;
}

router.get("/vault", async (req, res) => {
  try {
    const { companyId, q } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (companyId) conditions.push(eq(vaultEntriesTable.companyId, parseInt(companyId)));
    if (q) {
      const like = `%${q}%`;
      conditions.push(or(
        ilike(vaultEntriesTable.platform, like),
        ilike(vaultEntriesTable.username, like),
        ilike(vaultEntriesTable.email, like),
        ilike(vaultEntriesTable.phone, like),
        ilike(vaultEntriesTable.recoveryPhone, like),
        ilike(vaultEntriesTable.owner, like),
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(vaultEntriesTable).where(where).orderBy(desc(vaultEntriesTable.updatedAt));
    res.json(rows.map(maskEntry));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list vault" }); }
});

// Reveal a single password — gated by role AND company access
router.get("/vault/:id/reveal", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user || RESTRICTED_ROLES.includes(user.role)) {
      res.status(403).json({ error: "You are not authorized to view passwords" });
      return;
    }
    const [e] = await db.select().from(vaultEntriesTable).where(eq(vaultEntriesTable.id, parseInt(req.params.id))).limit(1);
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    // Non-group roles may only reveal entries for companies they belong to
    if (!GROUP_ROLES.includes(user.role) && e.companyId != null && !user.companyIds.includes(e.companyId)) {
      res.status(403).json({ error: "You are not authorized to view this password" });
      return;
    }
    res.json({ id: e.id, password: e.password });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to reveal password" }); }
});

router.post("/vault", async (req, res) => {
  try {
    const parsed = insertVaultEntrySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [e] = await db.insert(vaultEntriesTable).values(parsed.data).returning();
    res.status(201).json(maskEntry(e));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create entry" }); }
});

router.patch("/vault/:id", async (req, res) => {
  try {
    const payload: Record<string, unknown> = { ...sanitize(req.body), updatedAt: new Date() };
    // If password is empty/undefined, don't overwrite it
    if (!payload.password) delete payload.password;
    const [e] = await db.update(vaultEntriesTable).set(payload).where(eq(vaultEntriesTable.id, parseInt(req.params.id))).returning();
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    res.json(maskEntry(e));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update entry" }); }
});

router.delete("/vault/:id", async (req, res) => {
  try {
    const [e] = await db.delete(vaultEntriesTable).where(eq(vaultEntriesTable.id, parseInt(req.params.id))).returning();
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete entry" }); }
});

export default router;
