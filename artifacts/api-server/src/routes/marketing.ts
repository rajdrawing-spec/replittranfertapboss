import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, insertCampaignSchema } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/campaigns", async (req, res) => {
  try {
    const { companyId, status } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(campaignsTable.companyId, parseInt(companyId)));
    if (status && status !== "all") conds.push(eq(campaignsTable.status, status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(campaignsTable).where(where).orderBy(desc(campaignsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list campaigns" }); }
});

router.get("/campaigns/summary", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const where = companyId ? eq(campaignsTable.companyId, parseInt(companyId)) : undefined;
    const [row] = await db.select({
      totalBudget: sql<number>`coalesce(sum(budget),0)`,
      totalSpent: sql<number>`coalesce(sum(spent),0)`,
      totalRevenue: sql<number>`coalesce(sum(revenue),0)`,
      totalLeads: sql<number>`coalesce(sum(leads),0)`,
      totalConversions: sql<number>`coalesce(sum(conversions),0)`,
      totalClicks: sql<number>`coalesce(sum(clicks),0)`,
      totalImpressions: sql<number>`coalesce(sum(impressions),0)`,
      activeCount: sql<number>`coalesce(sum(case when status='active' then 1 else 0 end),0)`,
    }).from(campaignsTable).where(where);
    const spent = Number(row.totalSpent), revenue = Number(row.totalRevenue);
    res.json({
      ...row,
      totalBudget: Number(row.totalBudget), totalSpent: spent, totalRevenue: revenue,
      totalLeads: Number(row.totalLeads), totalConversions: Number(row.totalConversions),
      totalClicks: Number(row.totalClicks), totalImpressions: Number(row.totalImpressions),
      activeCount: Number(row.activeCount),
      roas: spent > 0 ? revenue / spent : 0,
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to get summary" }); }
});

router.post("/campaigns", async (req, res) => {
  try {
    const parsed = insertCampaignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [c] = await db.insert(campaignsTable).values(parsed.data).returning();
    res.status(201).json(c);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create campaign" }); }
});

router.patch("/campaigns/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _cr, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const [c] = await db.update(campaignsTable).set({ ...body, updatedAt: new Date() }).where(eq(campaignsTable.id, parseInt(req.params.id))).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(c);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update campaign" }); }
});

router.delete("/campaigns/:id", async (req, res) => {
  try {
    const [c] = await db.delete(campaignsTable).where(eq(campaignsTable.id, parseInt(req.params.id))).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete campaign" }); }
});

export default router;
