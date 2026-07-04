import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, insertUserSchema } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/users", async (req, res) => {
  try {
    const { companyId, role } = req.query as Record<string, string>;
    const conditions = [];
    if (role) conditions.push(eq(usersTable.role, role));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const users = await db.select().from(usersTable).where(where).orderBy(usersTable.id);
    let result = users.map(fmtUser);
    // filter by companyId if provided
    if (companyId) {
      const cid = parseInt(companyId);
      result = result.filter(u => u.companyIds.includes(cid));
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

router.post("/users", async (req, res) => {
  try {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [u] = await db.insert(usersTable).values(parsed.data).returning();
    res.status(201).json(fmtUser(u));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.get("/users/me", async (req, res) => {
  try {
    // Return the first super_admin as the "current" user
    const [u] = await db.select().from(usersTable).where(eq(usersTable.role, "super_admin")).limit(1);
    if (!u) { res.status(404).json({ error: "Not found" }); return; }
    res.json(fmtUser(u));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get current user" });
  }
});

function fmtUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    companyIds: u.companyIds as number[],
    avatarUrl: u.avatarUrl,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export default router;
