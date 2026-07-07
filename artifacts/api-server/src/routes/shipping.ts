import { Router } from "express";
import { db } from "@workspace/db";
import { shipmentsTable, insertShipmentSchema } from "@workspace/db";
import { eq, and, desc, or, ilike } from "drizzle-orm";

const router = Router();

router.get("/shipments", async (req, res) => {
  try {
    const { companyId, status, q } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(shipmentsTable.companyId, parseInt(companyId)));
    if (status && status !== "all") conds.push(eq(shipmentsTable.status, status));
    if (q) {
      const like = `%${q}%`;
      conds.push(or(ilike(shipmentsTable.trackingNumber, like), ilike(shipmentsTable.customerName, like), ilike(shipmentsTable.orderNumber, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(shipmentsTable).where(where).orderBy(desc(shipmentsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list shipments" }); }
});

router.post("/shipments", async (req, res) => {
  try {
    const parsed = insertShipmentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [s] = await db.insert(shipmentsTable).values(parsed.data).returning();
    res.status(201).json(s);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create shipment" }); }
});

router.patch("/shipments/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const [s] = await db.update(shipmentsTable).set({ ...body, updatedAt: new Date() }).where(eq(shipmentsTable.id, parseInt(req.params.id))).returning();
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    res.json(s);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update shipment" }); }
});

router.delete("/shipments/:id", async (req, res) => {
  try {
    const [s] = await db.delete(shipmentsTable).where(eq(shipmentsTable.id, parseInt(req.params.id))).returning();
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete shipment" }); }
});

export default router;
