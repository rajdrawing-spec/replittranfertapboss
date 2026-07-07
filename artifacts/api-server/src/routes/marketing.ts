import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  insertCampaignSchema,
  campaignCreativesTable,
  insertCampaignCreativeSchema,
  campaignLeadsTable,
  insertCampaignLeadSchema,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { emitNotification } from "../lib/notify";
import { isSafeAttachmentUrl } from "../lib/url-safety";
import { canAccessCompany, companyScope } from "../lib/company-scope";

const router = Router();

router.get("/campaigns", async (req, res) => {
  try {
    const scope = companyScope(req);
    if (scope !== null && scope.length === 0) { res.json([]); return; }
    const { companyId, status } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) {
      const cid = parseInt(companyId);
      if (scope !== null && !scope.includes(cid)) { res.status(403).json({ error: "Forbidden" }); return; }
      conds.push(eq(campaignsTable.companyId, cid));
    }
    if (scope !== null) conds.push(inArray(campaignsTable.companyId, scope));
    if (status && status !== "all") conds.push(eq(campaignsTable.status, status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(campaignsTable).where(where).orderBy(desc(campaignsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list campaigns" }); }
});

router.get("/campaigns/summary", async (req, res) => {
  try {
    const scope = companyScope(req);
    if (scope !== null && scope.length === 0) {
      res.json({
        totalBudget: 0, totalSpent: 0, totalRevenue: 0, totalLeads: 0, totalConversions: 0,
        totalClicks: 0, totalImpressions: 0, activeCount: 0, roas: 0,
      });
      return;
    }
    const { companyId } = req.query as Record<string, string>;
    const summaryConds = [];
    if (companyId) {
      const cid = parseInt(companyId);
      if (scope !== null && !scope.includes(cid)) { res.status(403).json({ error: "Forbidden" }); return; }
      summaryConds.push(eq(campaignsTable.companyId, cid));
    }
    if (scope !== null) summaryConds.push(inArray(campaignsTable.companyId, scope));
    const where = summaryConds.length ? and(...summaryConds) : undefined;
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
    const parsed = insertCampaignSchema.safeParse(normalizeCampaignBody(req.body));
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    if (!canAccessCompany(req, parsed.data.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [c] = await db.insert(campaignsTable).values(parsed.data).returning();
    res.status(201).json(c);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create campaign" }); }
});

router.patch("/campaigns/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { id: _id, createdAt: _cr, updatedAt: _u, companyId: _cid, ...raw } = req.body ?? {};
    const body = normalizeCampaignBody(raw);
    // Load the current row so we can detect a status transition to "completed".
    const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [c] = await db.update(campaignsTable).set({ ...body, updatedAt: new Date() }).where(eq(campaignsTable.id, id)).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    if (c.status === "completed" && existing.status !== "completed") {
      void emitNotification({
        type: "marketing",
        severity: "info",
        companyId: c.companyId,
        title: "Campaign Finished",
        message: `Campaign "${c.name}" has finished.`,
        actionUrl: "/marketing",
      });
    }
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

// Convert incoming ISO date strings to Date objects so drizzle/zod accept them.
function normalizeCampaignBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const key of ["startDate", "endDate"] as const) {
    const v = out[key];
    if (v === "" || v === null || v === undefined) { out[key] = null; }
    else if (typeof v === "string") { out[key] = new Date(v); }
  }
  return out;
}

/* ----------------------------- Performance ----------------------------- */

router.get("/marketing/performance", async (req, res) => {
  try {
    const scope = companyScope(req);
    if (scope !== null && scope.length === 0) {
      res.json({
        totals: { budget: 0, spent: 0, revenue: 0, conversions: 0, leads: 0, campaignCount: 0, roi: null },
        channels: [], campaigns: [],
      });
      return;
    }
    const { companyId } = req.query as Record<string, string>;
    const perfConds = [];
    if (companyId) {
      const cid = parseInt(companyId);
      if (scope !== null && !scope.includes(cid)) { res.status(403).json({ error: "Forbidden" }); return; }
      perfConds.push(eq(campaignsTable.companyId, cid));
    }
    if (scope !== null) perfConds.push(inArray(campaignsTable.companyId, scope));
    const where = perfConds.length ? and(...perfConds) : undefined;
    const rows = await db.select().from(campaignsTable).where(where);

    let totalBudget = 0, totalSpent = 0, totalRevenue = 0, totalConversions = 0, totalLeads = 0;
    const channelMap = new Map<string, { channel: string; budget: number; spent: number; revenue: number; conversions: number; leads: number; count: number }>();

    const campaigns = rows.map((c) => {
      const spent = Number(c.spent) || 0;
      const revenue = Number(c.revenue) || 0;
      const budget = Number(c.budget) || 0;
      totalBudget += budget; totalSpent += spent; totalRevenue += revenue;
      totalConversions += Number(c.conversions) || 0; totalLeads += Number(c.leads) || 0;

      const ch = c.channel || "other";
      const agg = channelMap.get(ch) ?? { channel: ch, budget: 0, spent: 0, revenue: 0, conversions: 0, leads: 0, count: 0 };
      agg.budget += budget; agg.spent += spent; agg.revenue += revenue;
      agg.conversions += Number(c.conversions) || 0; agg.leads += Number(c.leads) || 0; agg.count += 1;
      channelMap.set(ch, agg);

      return {
        id: c.id, name: c.name, channel: c.channel, status: c.status,
        budget, spent, revenue, conversions: Number(c.conversions) || 0, leads: Number(c.leads) || 0,
        roi: spent > 0 ? (revenue - spent) / spent : null,
      };
    });

    const channels = Array.from(channelMap.values()).map((a) => ({
      ...a,
      roi: a.spent > 0 ? (a.revenue - a.spent) / a.spent : null,
    })).sort((x, y) => y.spent - x.spent);

    res.json({
      totals: {
        budget: totalBudget, spent: totalSpent, revenue: totalRevenue,
        conversions: totalConversions, leads: totalLeads,
        campaignCount: rows.length,
        roi: totalSpent > 0 ? (totalRevenue - totalSpent) / totalSpent : null,
      },
      channels,
      campaigns: campaigns.sort((x, y) => {
        if (x.roi == null && y.roi == null) return y.spent - x.spent;
        if (x.roi == null) return 1;
        if (y.roi == null) return -1;
        return y.roi - x.roi;
      }),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load performance" }); }
});

/* ----------------------------- Creatives ----------------------------- */

router.get("/marketing/creatives", async (req, res) => {
  try {
    const { companyId, campaignId, status } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(campaignCreativesTable.companyId, parseInt(companyId)));
    if (campaignId) conds.push(eq(campaignCreativesTable.campaignId, parseInt(campaignId)));
    if (status && status !== "all") conds.push(eq(campaignCreativesTable.status, status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(campaignCreativesTable).where(where).orderBy(desc(campaignCreativesTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list creatives" }); }
});

router.post("/marketing/creatives", async (req, res) => {
  try {
    const parsed = insertCampaignCreativeSchema.safeParse(normalizeCreativeBody(req.body));
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    if (!isSafeAttachmentUrl(parsed.data.url) || !isSafeAttachmentUrl(parsed.data.thumbnailUrl)) {
      res.status(400).json({ error: "Unsafe URL: only http(s) links or uploaded files are allowed" }); return;
    }
    const [row] = await db.insert(campaignCreativesTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create creative" }); }
});

router.patch("/marketing/creatives/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _cr, updatedAt: _u, companyId: _cid, ...raw } = req.body ?? {};
    const body = normalizeCreativeBody(raw);
    if (!isSafeAttachmentUrl(body.url) || !isSafeAttachmentUrl(body.thumbnailUrl)) {
      res.status(400).json({ error: "Unsafe URL: only http(s) links or uploaded files are allowed" }); return;
    }
    const [row] = await db.update(campaignCreativesTable).set({ ...body, updatedAt: new Date() }).where(eq(campaignCreativesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update creative" }); }
});

router.delete("/marketing/creatives/:id", async (req, res) => {
  try {
    const [row] = await db.delete(campaignCreativesTable).where(eq(campaignCreativesTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete creative" }); }
});

function normalizeCreativeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  const cid = out.campaignId;
  if (cid === "" || cid === null || cid === undefined || cid === "none") out.campaignId = null;
  else if (typeof cid === "string") out.campaignId = parseInt(cid);
  for (const key of ["format", "url", "thumbnailUrl", "notes"] as const) {
    if (out[key] === "") out[key] = null;
  }
  return out;
}

/* ----------------------------- Leads ----------------------------- */

router.get("/marketing/leads", async (req, res) => {
  try {
    const { companyId, campaignId, status } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(campaignLeadsTable.companyId, parseInt(companyId)));
    if (campaignId) conds.push(eq(campaignLeadsTable.campaignId, parseInt(campaignId)));
    if (status && status !== "all") conds.push(eq(campaignLeadsTable.status, status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(campaignLeadsTable).where(where).orderBy(desc(campaignLeadsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list leads" }); }
});

router.post("/marketing/leads", async (req, res) => {
  try {
    const parsed = insertCampaignLeadSchema.safeParse(normalizeLeadBody(req.body));
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [row] = await db.insert(campaignLeadsTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create lead" }); }
});

router.patch("/marketing/leads/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _cr, updatedAt: _u, companyId: _cid, ...raw } = req.body ?? {};
    const body = normalizeLeadBody(raw);
    const [row] = await db.update(campaignLeadsTable).set({ ...body, updatedAt: new Date() }).where(eq(campaignLeadsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update lead" }); }
});

router.delete("/marketing/leads/:id", async (req, res) => {
  try {
    const [row] = await db.delete(campaignLeadsTable).where(eq(campaignLeadsTable.id, parseInt(req.params.id))).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete lead" }); }
});

function normalizeLeadBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  const cid = out.campaignId;
  if (cid === "" || cid === null || cid === undefined || cid === "none") out.campaignId = null;
  else if (typeof cid === "string") out.campaignId = parseInt(cid);
  for (const key of ["email", "phone", "source", "notes"] as const) {
    if (out[key] === "") out[key] = null;
  }
  if (typeof out.value === "string") out.value = out.value === "" ? 0 : parseFloat(out.value as string);
  return out;
}

export default router;
