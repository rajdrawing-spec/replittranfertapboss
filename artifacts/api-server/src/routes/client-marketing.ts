import { Router } from "express";
import type { User } from "@workspace/db";
import {
  db, marketingProjectsTable, marketingProjectMembersTable,
  campaignsTable, campaignCreativesTable, campaignLeadsTable, ordersTable,
} from "@workspace/db";
import { eq, and, inArray, desc, gte, lte } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { projectScope, requireProjectAccess } from "../lib/project-scope";

/**
 * Client Marketing Portal API — the ONLY API surface reachable by client-role
 * users (enforced globally by blockClientUsersFromInternalApi). Everything is
 * scoped to the caller's project memberships; no companyId trust anywhere.
 */
const router = Router();

router.use("/client/marketing", requirePermission("client_portal.view"));

/** Portal context: the caller's assigned projects with brand identity. */
router.get("/client/marketing/context", async (req, res) => {
  try {
    const scope = await projectScope(req);
    let projects: (typeof marketingProjectsTable.$inferSelect)[];
    if (scope === null) {
      projects = await db.select().from(marketingProjectsTable).orderBy(desc(marketingProjectsTable.createdAt));
    } else if (scope.length === 0) {
      projects = [];
    } else {
      projects = await db.select().from(marketingProjectsTable)
        .where(inArray(marketingProjectsTable.id, scope))
        .orderBy(desc(marketingProjectsTable.createdAt));
    }
    const u = (req as any).localUser as User;
    // Only expose active projects to clients.
    const visible = projects.filter((p) => p.status === "active");
    const memberRows = visible.length
      ? await db.select().from(marketingProjectMembersTable)
          .where(and(
            eq(marketingProjectMembersTable.userId, u.id),
            inArray(marketingProjectMembersTable.projectId, visible.map((p) => p.id)),
          ))
      : [];
    const memberTypeByProject = new Map(memberRows.map((m) => [m.projectId, m.memberType]));
    res.json({
      user: { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatarUrl },
      projects: visible.map((p) => ({
        id: p.id,
        name: p.name,
        brandName: p.brandName ?? p.name,
        brandColor: p.brandColor,
        logoUrl: p.logoUrl,
        status: p.status,
        memberType: memberTypeByProject.get(p.id) ?? "internal",
      })),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load portal context" }); }
});

// ---- Project-scoped, client-visible marketing data --------------------------
// Every route below resolves :projectId through requireProjectAccess (member
// or super admin only) and filters records by BOTH projectId AND
// clientVisible=true. Records are linked/exposed exclusively via the
// super-admin linking endpoint, so nothing internal can leak here.
// Orders have no projectId; they are scoped to the project's company (one
// brand per company) and reduced to client-safe fields only.

/* ------------------------------ helpers ------------------------------ */

interface DateRange { from: Date; to: Date; prevFrom: Date; prevTo: Date }

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults: last 30 days) and derive the equal-length previous period. */
function parseRange(req: import("express").Request): DateRange | null {
  const q = req.query as Record<string, string>;
  const to = q.to ? new Date(`${q.to}T23:59:59.999`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00`) : new Date(to.getTime() - 29 * 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return null;
  const len = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - len - 1), prevTo: new Date(from.getTime() - 1) };
}

function parsePagination(req: import("express").Request): { page: number; pageSize: number } {
  const q = req.query as Record<string, string>;
  const page = Math.max(1, parseInt(q.page || "1") || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || "20") || 20));
  return { page, pageSize };
}

/** Local-time bucket key for a date (day | week | month). */
function bucketKey(d: Date, group: string): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (group === "month") return `${y}-${pad(m)}`;
  if (group === "week") {
    const monday = new Date(d);
    monday.setDate(day - ((d.getDay() + 6) % 7));
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  }
  return `${y}-${pad(m)}-${pad(day)}`;
}

const CANCELLED_STATUSES = ["cancelled", "returned", "refunded"];

/** Orders in a range for a company (client-safe aggregation source). */
async function fetchOrders(companyId: number, from: Date, to: Date) {
  return db.select().from(ordersTable)
    .where(and(eq(ordersTable.companyId, companyId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)))
    .orderBy(desc(ordersTable.createdAt));
}

/**
 * Order stats policy: "net" orders/revenue = every order that has not been
 * cancelled, returned or refunded (pending/confirmed/processing/shipped/
 * delivered all count — the business books an order at placement, and
 * reversals are removed). Field names + UI labels say "net" explicitly.
 */
function orderStats(orders: { status: string; totalAmount: number; itemCount: number }[]) {
  const cancelled = orders.filter((o) => o.status === "cancelled").length;
  const returned = orders.filter((o) => o.status === "returned" || o.status === "refunded").length;
  const counted = orders.filter((o) => !CANCELLED_STATUSES.includes(o.status));
  const revenue = counted.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
  return {
    totalOrders: orders.length,
    netOrders: counted.length,
    cancelledOrders: cancelled,
    returnedOrders: returned,
    revenue,
    aov: counted.length > 0 ? revenue / counted.length : 0,
  };
}

/** Client-visible campaigns of the project (KPI + list source). */
async function fetchProjectCampaigns(projectId: number) {
  return db.select().from(campaignsTable)
    .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.clientVisible, true)))
    .orderBy(desc(campaignsTable.createdAt));
}

function campaignTotals(rows: any[]) {
  const t = { spend: 0, revenue: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 };
  for (const c of rows) {
    t.spend += Number(c.spent) || 0;
    t.revenue += Number(c.revenue) || 0;
    t.impressions += Number(c.impressions) || 0;
    t.clicks += Number(c.clicks) || 0;
    t.leads += Number(c.leads) || 0;
    t.conversions += Number(c.conversions) || 0;
  }
  return t;
}

const pctChange = (cur: number, prev: number): number | null =>
  prev > 0 ? ((cur - prev) / prev) * 100 : null;

/* ------------------------------ overview ------------------------------ */

router.get("/client/marketing/projects/:projectId/overview", requireProjectAccess(), async (req, res) => {
  try {
    const project = (req as any).project;
    const range = parseRange(req);
    if (!range) { res.status(400).json({ error: "Invalid date range" }); return; }
    const group = ["day", "week", "month"].includes(String(req.query.group)) ? String(req.query.group) : "day";

    const [orders, prevOrders, campaigns, leadRows, prevLeadRows] = await Promise.all([
      fetchOrders(project.companyId, range.from, range.to),
      fetchOrders(project.companyId, range.prevFrom, range.prevTo),
      fetchProjectCampaigns(project.id),
      db.select().from(campaignLeadsTable).where(and(
        eq(campaignLeadsTable.projectId, project.id), eq(campaignLeadsTable.clientVisible, true),
        gte(campaignLeadsTable.createdAt, range.from), lte(campaignLeadsTable.createdAt, range.to),
      )),
      db.select().from(campaignLeadsTable).where(and(
        eq(campaignLeadsTable.projectId, project.id), eq(campaignLeadsTable.clientVisible, true),
        gte(campaignLeadsTable.createdAt, range.prevFrom), lte(campaignLeadsTable.createdAt, range.prevTo),
      )),
    ]);

    const cur = orderStats(orders);
    const prev = orderStats(prevOrders);
    const ct = campaignTotals(campaigns);
    const leads = leadRows.length;
    const prevLeads = prevLeadRows.length;
    const convertedLeads = leadRows.filter((l: any) => l.status === "converted").length;

    // Timeseries: orders revenue/count + leads per bucket.
    const buckets = new Map<string, { period: string; revenue: number; orders: number; leads: number }>();
    const bump = (key: string, patch: Partial<{ revenue: number; orders: number; leads: number }>) => {
      const b = buckets.get(key) ?? { period: key, revenue: 0, orders: 0, leads: 0 };
      b.revenue += patch.revenue ?? 0; b.orders += patch.orders ?? 0; b.leads += patch.leads ?? 0;
      buckets.set(key, b);
    };
    for (const o of orders) {
      if (CANCELLED_STATUSES.includes(o.status)) continue;
      bump(bucketKey(new Date(o.createdAt), group), { revenue: Number(o.totalAmount) || 0, orders: 1 });
    }
    for (const l of leadRows) bump(bucketKey(new Date((l as any).createdAt), group), { leads: 1 });

    res.json({
      range: { from: range.from.toISOString(), to: range.to.toISOString(), group },
      // Range-scoped KPIs (computed from dated orders/leads rows).
      kpis: {
        revenue: cur.revenue,
        orders: cur.netOrders,
        leads,
        conversionRate: leads > 0 ? (convertedLeads / leads) * 100 : null,
        aov: cur.aov,
      },
      // Campaign metrics are LIFETIME totals — campaigns only store running
      // aggregates (no dated snapshots), so these are deliberately reported
      // in a separate block and labeled "lifetime" in the UI. CPL/CPA use the
      // campaigns' own lifetime lead/conversion counters for consistency.
      campaignLifetime: {
        adSpend: ct.spend,
        roas: ct.spend > 0 ? ct.revenue / ct.spend : null,
        cpl: ct.leads > 0 && ct.spend > 0 ? ct.spend / ct.leads : null,
        cpa: ct.conversions > 0 && ct.spend > 0 ? ct.spend / ct.conversions : null,
      },
      comparison: {
        revenue: pctChange(cur.revenue, prev.revenue),
        orders: pctChange(cur.netOrders, prev.netOrders),
        leads: pctChange(leads, prevLeads),
      },
      timeseries: Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period)),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load overview" }); }
});

/* ------------------------------ sales ------------------------------ */

router.get("/client/marketing/projects/:projectId/sales", requireProjectAccess(), async (req, res) => {
  try {
    const project = (req as any).project;
    const range = parseRange(req);
    if (!range) { res.status(400).json({ error: "Invalid date range" }); return; }
    const { page, pageSize } = parsePagination(req);

    const orders = await fetchOrders(project.companyId, range.from, range.to);
    const stats = orderStats(orders);
    const start = (page - 1) * pageSize;
    res.json({
      stats,
      orders: orders.slice(start, start + pageSize).map((o) => ({
        // Client-safe subset ONLY — no customer contact info, costs or notes.
        id: o.id,
        orderNumber: o.orderNumber,
        date: o.createdAt,
        itemCount: o.itemCount,
        totalAmount: o.totalAmount,
        status: o.status,
        channel: o.channel,
      })),
      pagination: { page, pageSize, total: orders.length, totalPages: Math.max(1, Math.ceil(orders.length / pageSize)) },
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load sales" }); }
});

/* ------------------------------ campaigns ------------------------------ */

router.get("/client/marketing/projects/:projectId/campaigns", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = (req as any).project.id as number;
    const { page, pageSize } = parsePagination(req);
    const rows = await fetchProjectCampaigns(projectId);
    const start = (page - 1) * pageSize;
    res.json({
      campaigns: rows.slice(start, start + pageSize).map((c) => {
        const spent = Number(c.spent) || 0, revenue = Number(c.revenue) || 0;
        const impressions = Number(c.impressions) || 0, clicks = Number(c.clicks) || 0;
        return {
          id: c.id, name: c.name, channel: c.channel, status: c.status,
          startDate: c.startDate, endDate: c.endDate,
          spend: spent, impressions, clicks,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
          leads: Number(c.leads) || 0, conversions: Number(c.conversions) || 0,
          revenue, roas: spent > 0 ? revenue / spent : null,
        };
      }),
      pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load campaigns" }); }
});

/* ------------------------------ creatives ------------------------------ */

const CLIENT_CREATIVE_STATUSES = ["approved", "live"];

router.get("/client/marketing/projects/:projectId/creatives", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = (req as any).project.id as number;
    const { page, pageSize } = parsePagination(req);
    const rows = await db.select().from(campaignCreativesTable)
      .where(and(
        eq(campaignCreativesTable.projectId, projectId),
        eq(campaignCreativesTable.clientVisible, true),
        inArray(campaignCreativesTable.status, CLIENT_CREATIVE_STATUSES),
      ))
      .orderBy(desc(campaignCreativesTable.createdAt));
    const start = (page - 1) * pageSize;
    res.json({
      creatives: rows.slice(start, start + pageSize).map((c) => ({
        id: c.id, name: c.name, type: c.type, format: c.format,
        url: c.url, thumbnailUrl: c.thumbnailUrl, status: c.status, createdAt: c.createdAt,
      })),
      pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load creatives" }); }
});

/* ------------------------------ leads ------------------------------ */

router.get("/client/marketing/projects/:projectId/leads", requireProjectAccess(), async (req, res) => {
  try {
    const project = (req as any).project;
    const { page, pageSize } = parsePagination(req);
    const rows = await db.select().from(campaignLeadsTable)
      .where(and(eq(campaignLeadsTable.projectId, project.id), eq(campaignLeadsTable.clientVisible, true)))
      .orderBy(desc(campaignLeadsTable.createdAt));
    const campaignIds = Array.from(new Set(rows.map((l) => l.campaignId).filter((v): v is number => v != null)));
    // Resolve names ONLY from this project's client-visible campaigns — a lead
    // may reference a hidden or cross-project campaign whose name must not leak.
    const campaignRows = campaignIds.length
      ? await db.select().from(campaignsTable).where(and(
          inArray(campaignsTable.id, campaignIds),
          eq(campaignsTable.projectId, project.id),
          eq(campaignsTable.clientVisible, true),
        ))
      : [];
    const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
    const start = (page - 1) * pageSize;
    res.json({
      leads: rows.slice(start, start + pageSize).map((l) => ({
        // Contact details (email/phone) and internal notes are never exposed.
        id: l.id, name: l.name, source: l.source, status: l.status,
        value: l.value, createdAt: l.createdAt,
        campaign: l.campaignId != null ? campaignName.get(l.campaignId) ?? null : null,
      })),
      pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load leads" }); }
});

/* ------------------------------ reports ------------------------------ */

router.get("/client/marketing/projects/:projectId/report", requireProjectAccess(), async (req, res) => {
  try {
    const project = (req as any).project;
    const range = parseRange(req);
    if (!range) { res.status(400).json({ error: "Invalid date range" }); return; }

    const [orders, prevOrders, campaigns, leadRows] = await Promise.all([
      fetchOrders(project.companyId, range.from, range.to),
      fetchOrders(project.companyId, range.prevFrom, range.prevTo),
      fetchProjectCampaigns(project.id),
      db.select().from(campaignLeadsTable).where(and(
        eq(campaignLeadsTable.projectId, project.id), eq(campaignLeadsTable.clientVisible, true),
        gte(campaignLeadsTable.createdAt, range.from), lte(campaignLeadsTable.createdAt, range.to),
      )),
    ]);

    const cur = orderStats(orders);
    const prev = orderStats(prevOrders);
    const ct = campaignTotals(campaigns);

    const ranked = campaigns
      .map((c) => {
        const spent = Number(c.spent) || 0, revenue = Number(c.revenue) || 0;
        return { id: c.id, name: c.name, channel: c.channel, spend: spent, revenue, roas: spent > 0 ? revenue / spent : null };
      })
      .filter((c) => c.spend > 0 || c.revenue > 0)
      .sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));

    res.json({
      project: { id: project.id, name: project.name, brandName: project.brandName ?? project.name },
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      // Range-scoped (dated orders/leads rows).
      kpis: {
        revenue: cur.revenue, orders: cur.netOrders, aov: cur.aov,
        leads: leadRows.length,
      },
      // Campaign metrics are lifetime running totals (no dated snapshots exist);
      // reported separately and labeled "lifetime" in the UI/report.
      campaignLifetime: {
        adSpend: ct.spend, roas: ct.spend > 0 ? ct.revenue / ct.spend : null,
        impressions: ct.impressions, clicks: ct.clicks,
        ctr: ct.impressions > 0 ? (ct.clicks / ct.impressions) * 100 : null,
      },
      bestCampaign: ranked[0] ?? null,
      worstCampaign: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      comparison: {
        revenue: { current: cur.revenue, previous: prev.revenue, change: pctChange(cur.revenue, prev.revenue) },
        orders: { current: cur.netOrders, previous: prev.netOrders, change: pctChange(cur.netOrders, prev.netOrders) },
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to build report" }); }
});

export default router;
