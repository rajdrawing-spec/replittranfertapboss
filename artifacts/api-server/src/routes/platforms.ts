import { Router } from "express";
import { db } from "@workspace/db";
import { platformsTable, insertPlatformSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/platforms", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const rows = companyId
      ? await db.select().from(platformsTable).where(eq(platformsTable.companyId, parseInt(companyId))).orderBy(desc(platformsTable.updatedAt))
      : await db.select().from(platformsTable).orderBy(desc(platformsTable.updatedAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list platforms" }); }
});

router.post("/platforms", async (req, res) => {
  try {
    const parsed = insertPlatformSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [p] = await db.insert(platformsTable).values(parsed.data).returning();
    res.status(201).json(p);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create platform" }); }
});

router.patch("/platforms/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const [p] = await db.update(platformsTable).set({ ...body, updatedAt: new Date() }).where(eq(platformsTable.id, parseInt(req.params.id))).returning();
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    res.json(p);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update platform" }); }
});

router.delete("/platforms/:id", async (req, res) => {
  try {
    const [p] = await db.delete(platformsTable).where(eq(platformsTable.id, parseInt(req.params.id))).returning();
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete platform" }); }
});

export default router;
