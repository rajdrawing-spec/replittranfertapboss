import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, companiesTable, insertOrderSchema } from "@workspace/db";
import { eq, ilike, and, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/orders", async (req, res) => {
  try {
    const { companyId, status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (companyId) conditions.push(eq(ordersTable.companyId, parseInt(companyId)));
    if (status) conditions.push(eq(ordersTable.status, status));
    if (search) conditions.push(ilike(ordersTable.customerName, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(ordersTable).where(where);
    const items = await db
      .select()
      .from(ordersTable)
      .where(where)
      .orderBy(desc(ordersTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

    res.json({
      items: items.map(o => formatOrder(o, companyMap)),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

router.post("/orders", async (req, res) => {
  try {
    const parsed = insertOrderSchema.safeParse({
      ...req.body,
      orderNumber: `ORD-${Date.now()}`,
    });
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [o] = await db.insert(ordersTable).values(parsed.data).returning();
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, o.companyId));
    res.status(201).json(formatOrder(o, { [o.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create order" });
  }
});

router.patch("/orders/:orderId", async (req, res) => {
  try {
    const id = parseInt(req.params.orderId);
    const [o] = await db.update(ordersTable).set({ ...req.body, updatedAt: new Date() }).where(eq(ordersTable.id, id)).returning();
    if (!o) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, o.companyId));
    res.json(formatOrder(o, { [o.companyId]: c?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update order" }); }
});

router.delete("/orders/:orderId", async (req, res) => {
  try {
    const id = parseInt(req.params.orderId);
    const [o] = await db.delete(ordersTable).where(eq(ordersTable.id, id)).returning();
    if (!o) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete order" }); }
});

router.get("/orders/stats", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const condition = companyId ? eq(ordersTable.companyId, parseInt(companyId)) : undefined;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    
    const rows = await db
      .select({
        status: ordersTable.status,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(total_amount), 0)`,
      })
      .from(ordersTable)
      .where(condition)
      .groupBy(ordersTable.status);
    
    const byStatus = Object.fromEntries(rows.map(r => [r.status, { count: Number(r.count), amount: Number(r.amount) }]));
    
    const [todayStats] = await db
      .select({ amount: sql<number>`coalesce(sum(total_amount), 0)` })
      .from(ordersTable)
      .where(and(condition, sql`created_at >= ${today}`));
    
    const [yestStats] = await db
      .select({ amount: sql<number>`coalesce(sum(total_amount), 0)` })
      .from(ordersTable)
      .where(and(condition, sql`created_at >= ${yesterday} and created_at < ${today}`));
    
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    res.json({
      total,
      pending: byStatus.pending?.count ?? 0,
      processing: byStatus.processing?.count ?? 0,
      shipped: byStatus.shipped?.count ?? 0,
      delivered: byStatus.delivered?.count ?? 0,
      cancelled: byStatus.cancelled?.count ?? 0,
      returned: byStatus.returned?.count ?? 0,
      todayRevenue: Number(todayStats?.amount ?? 0),
      yesterdayRevenue: Number(yestStats?.amount ?? 0),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get order stats" });
  }
});

router.get("/orders/:orderId", async (req, res) => {
  try {
    const id = parseInt(req.params.orderId);
    const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!o) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, o.companyId));
    res.json(formatOrder(o, { [o.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get order" });
  }
});

router.patch("/orders/:orderId", async (req, res) => {
  try {
    const id = parseInt(req.params.orderId);
    const [o] = await db
      .update(ordersTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(ordersTable.id, id))
      .returning();
    if (!o) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, o.companyId));
    res.json(formatOrder(o, { [o.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update order" });
  }
});

function formatOrder(o: typeof ordersTable.$inferSelect, companyMap: Record<number, string>) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    companyId: o.companyId,
    companyName: companyMap[o.companyId] ?? "Unknown",
    customerId: o.customerId,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    customerPhone: o.customerPhone,
    status: o.status,
    totalAmount: o.totalAmount,
    itemCount: o.itemCount,
    channel: o.channel,
    shippingAddress: o.shippingAddress,
    trackingNumber: o.trackingNumber,
    courierName: o.courierName,
    notes: o.notes,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export default router;
