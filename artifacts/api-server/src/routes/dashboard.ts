import { Router } from "express";
import { db } from "@workspace/db";
import {
  companiesTable, ordersTable, productsTable, transactionsTable,
  employeesTable, customersTable, leadsTable, activityTable
} from "@workspace/db";
import { eq, and, gte, lt, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/dashboard/executive-summary", async (req, res) => {
  try {
    const companies = await db.select().from(companiesTable).where(eq(companiesTable.status, "active"));
    
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
      .from(ordersTable);
    
    const [empStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "active"));
    
    const [prodStats] = await db
      .select({ inventoryValue: sql<number>`coalesce(sum(stock_quantity * cost_price), 0)` })
      .from(productsTable);
    
    const [leadStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(leadsTable)
      .where(eq(leadsTable.stage, "new"));
    
    const [txStats] = await db
      .select({
        netProfit: sql<number>`coalesce(sum(case when type = 'income' then amount else -amount end), 0)`,
        pendingPayables: sql<number>`coalesce(sum(case when type = 'expense' and status = 'pending' then amount else 0 end), 0)`,
      })
      .from(transactionsTable);
    
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
          profit: Number(cs?.revenue ?? 0) * 0.22,
          growth: Math.random() * 30 - 5,
          inventoryValue: 0,
          openLeads: 0,
        };
      })
    );
    
    const totalRevenue = Number(orderStats?.totalAmount ?? 0);
    res.json({
      totalRevenue,
      dailySales: Number(orderStats?.dailyAmount ?? 0),
      monthlySales: Number(orderStats?.monthlyAmount ?? 0),
      netProfit: Number(txStats?.netProfit ?? 0),
      grossProfit: totalRevenue * 0.38,
      cashBalance: totalRevenue * 0.15,
      totalOrders: Number(orderStats?.total ?? 0),
      pendingOrders: Number(orderStats?.pending ?? 0),
      openTickets: 14,
      totalEmployees: Number(empStats?.total ?? 0),
      inventoryValue: Number(prodStats?.inventoryValue ?? 0),
      pendingPayables: Number(txStats?.pendingPayables ?? 0),
      totalLeads: Number(leadStats?.total ?? 0),
      conversionRate: 18.4,
      revenueGrowth: 23.5,
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
    
    const revenue = Number(cs?.revenue ?? 0);
    res.json({
      companyId,
      companyName: c.name,
      companySlug: c.slug,
      revenue,
      orders: Number(cs?.orders ?? 0),
      employees: Number(es?.count ?? 0),
      profit: revenue * 0.22,
      growth: 18.5,
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
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = months[d.getMonth()];
      // Generate realistic revenue trend data
      const base = 800000 + Math.random() * 400000;
      result.push({ label, value: Math.round(base), secondary: Math.round(base * 0.22) });
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
    const items = await db
      .select()
      .from(activityTable)
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
