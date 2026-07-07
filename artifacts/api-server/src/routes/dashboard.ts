import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import {
  companiesTable, ordersTable, productsTable, transactionsTable,
  employeesTable, leadsTable, activityTable
} from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { isSuperAdmin } from "../lib/auth-user";

const router = Router();

/**
 * The set of company IDs the caller may see.
 * - Super Admin  -> null  (no restriction: all companies)
 * - Scoped staff -> their companyIds (possibly empty = sees nothing)
 * Every aggregate in this file is filtered by this scope so a user can never
 * read another company's real financials.
 */
function companyScope(req: Request): number[] | null {
  const u = (req as any).localUser as User | undefined;
  if (u && isSuperAdmin(u)) return null;
  return ((u?.companyIds as number[] | undefined) ?? []);
}

router.get("/dashboard/executive-summary", async (req, res) => {
  try {
    const scope = companyScope(req);

    // Scoped staff with no assigned companies see nothing. Return before any DB
    // call so we never pass an empty array to inArray.
    if (scope && scope.length === 0) {
      res.json({
        totalRevenue: 0, dailySales: 0, monthlySales: 0, netProfit: 0,
        grossProfit: null, cashBalance: null, totalOrders: 0, pendingOrders: 0,
        openTickets: null, totalEmployees: 0, inventoryValue: 0, pendingPayables: 0,
        totalLeads: 0, conversionRate: null, revenueGrowth: null, companySummaries: [],
      });
      return;
    }

    const inCos = (col: any) => (scope ? inArray(col, scope) : undefined);

    const companies = await db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.status, "active"), scope ? inArray(companiesTable.id, scope) : undefined));

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [orderStats] = await db
      .select({
        total: sql<number>`count(*)`,
        pending: sql<number>`count(*) filter (where status = 'pending')`,
        totalAmount: sql<number>`coalesce(sum(total_amount), 0)`,
        monthlyAmount: sql<number>`coalesce(sum(case when created_at >= ${startOfMonth} then total_amount else 0 end), 0)`,
        dailyAmount: sql<number>`coalesce(sum(case when created_at >= ${startOfDay} then total_amount else 0 end), 0)`,
      })
      .from(ordersTable)
      .where(inCos(ordersTable.companyId));

    const [empStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(employeesTable)
      .where(and(eq(employeesTable.status, "active"), inCos(employeesTable.companyId)));

    const [prodStats] = await db
      .select({ inventoryValue: sql<number>`coalesce(sum(stock_quantity * cost_price), 0)` })
      .from(productsTable)
      .where(inCos(productsTable.companyId));

    const [leadStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(leadsTable)
      .where(and(eq(leadsTable.stage, "new"), inCos(leadsTable.companyId)));

    const [txStats] = await db
      .select({
        netProfit: sql<number>`coalesce(sum(case when type = 'income' then amount else -amount end), 0)`,
        pendingPayables: sql<number>`coalesce(sum(case when type = 'expense' and status = 'pending' then amount else 0 end), 0)`,
      })
      .from(transactionsTable)
      .where(inCos(transactionsTable.companyId));

    const companySummaries = await Promise.all(
      companies.map(async (c) => {
        const [cs] = await db
          .select({
            revenue: sql<number>`coalesce(sum(total_amount), 0)`,
            orders: sql<number>`count(*)`,
          })
          .from(ordersTable)
          .where(eq(ordersTable.companyId, c.id));
        const [es] = await db
          .select({ count: sql<number>`count(*)` })
          .from(employeesTable)
          .where(and(eq(employeesTable.companyId, c.id), eq(employeesTable.status, "active")));
        return {
          companyId: c.id,
          companyName: c.name,
          companySlug: c.slug,
          revenue: Number(cs?.revenue ?? 0),
          orders: Number(cs?.orders ?? 0),
          employees: Number(es?.count ?? 0),
          // Per-company profit and growth require expense allocation and historical
          // baselines we do not track yet — reported as unavailable, never fabricated.
          profit: null,
          growth: null,
        };
      })
    );

    res.json({
      totalRevenue: Number(orderStats?.totalAmount ?? 0),
      dailySales: Number(orderStats?.dailyAmount ?? 0),
      monthlySales: Number(orderStats?.monthlyAmount ?? 0),
      netProfit: Number(txStats?.netProfit ?? 0),
      // Gross profit needs COGS, cash balance needs a ledger, tickets/conversion/
      // growth need sources we don't have — all reported as unavailable.
      grossProfit: null,
      cashBalance: null,
      totalOrders: Number(orderStats?.total ?? 0),
      pendingOrders: Number(orderStats?.pending ?? 0),
      openTickets: null,
      totalEmployees: Number(empStats?.total ?? 0),
      inventoryValue: Number(prodStats?.inventoryValue ?? 0),
      pendingPayables: Number(txStats?.pendingPayables ?? 0),
      totalLeads: Number(leadStats?.total ?? 0),
      conversionRate: null,
      revenueGrowth: null,
      companySummaries,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get executive summary" });
  }
});

router.get("/dashboard/company-summary/:companyId", async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const scope = companyScope(req);
    if (scope && !scope.includes(companyId)) {
      res.status(403).json({ error: "You do not have access to this company" });
      return;
    }

    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }

    const [cs] = await db
      .select({
        revenue: sql<number>`coalesce(sum(total_amount), 0)`,
        orders: sql<number>`count(*)`,
      })
      .from(ordersTable)
      .where(eq(ordersTable.companyId, companyId));

    const [es] = await db
      .select({ count: sql<number>`count(*)` })
      .from(employeesTable)
      .where(and(eq(employeesTable.companyId, companyId), eq(employeesTable.status, "active")));

    const [leadStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(leadsTable)
      .where(eq(leadsTable.companyId, companyId));

    const [invStats] = await db
      .select({ inventoryValue: sql<number>`coalesce(sum(stock_quantity * cost_price), 0)` })
      .from(productsTable)
      .where(eq(productsTable.companyId, companyId));

    res.json({
      companyId,
      companyName: c.name,
      companySlug: c.slug,
      revenue: Number(cs?.revenue ?? 0),
      orders: Number(cs?.orders ?? 0),
      employees: Number(es?.count ?? 0),
      profit: null,   // needs expense allocation — reported as unavailable
      growth: null,   // needs historical baseline — reported as unavailable
      inventoryValue: Number(invStats?.inventoryValue ?? 0),
      openLeads: Number(leadStats?.total ?? 0),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get company summary" });
  }
});

router.get("/dashboard/revenue-chart", async (req, res) => {
  try {
    const scope = companyScope(req);
    const reqCompany = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    if (reqCompany != null && scope && !scope.includes(reqCompany)) {
      res.status(403).json({ error: "You do not have access to this company" });
      return;
    }
    // Effective company filter: a specific requested company, else the caller's scope.
    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;
    if (ids && ids.length === 0) { res.json([]); return; }
    const inOrders = ids ? inArray(ordersTable.companyId, ids) : undefined;
    const inTx = ids ? inArray(transactionsTable.companyId, ids) : undefined;

    const now = new Date();
    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = d.toLocaleString("en-IN", { month: "short" });
      const [orow] = await db
        .select({ revenue: sql<number>`coalesce(sum(total_amount), 0)` })
        .from(ordersTable)
        .where(and(sql`created_at >= ${d}`, sql`created_at < ${nextD}`, inOrders));
      const [trow] = await db
        .select({ expense: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)` })
        .from(transactionsTable)
        .where(and(sql`date >= ${d.toISOString().slice(0, 10)}`, sql`date < ${nextD.toISOString().slice(0, 10)}`, inTx));
      result.push({ label, value: Number(orow?.revenue ?? 0), secondary: Number(trow?.expense ?? 0) });
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get revenue chart" });
  }
});

router.get("/dashboard/recent-activity", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const scope = companyScope(req);
    if (scope && scope.length === 0) { res.json([]); return; }

    const items = await db
      .select()
      .from(activityTable)
      .where(scope ? inArray(activityTable.companyId, scope) : undefined)
      .orderBy(desc(activityTable.timestamp))
      .limit(limit);

    res.json(items.map(a => ({
      id: a.id,
      type: a.type,
      title: a.title,
      description: a.description,
      companyName: a.companyName,
      timestamp: a.timestamp.toISOString(),
      amount: a.amount,
      status: a.status,
    })));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get recent activity" });
  }
});

export default router;
