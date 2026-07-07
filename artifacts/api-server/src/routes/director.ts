import { Router } from "express";
import { db } from "@workspace/db";
import { companiesTable, transactionsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// GET /api/director/portfolio
router.get("/director/portfolio", async (req, res) => {
  try {
    // userId is guaranteed by requireAuth middleware (applied in routes/index.ts)
    const companies = await db.select().from(companiesTable).where(eq(companiesTable.status, "active"));

    const companyData = await Promise.all(
      companies.map(async (c) => {
        const [stats] = await db
          .select({
            revenue: sql<number>`coalesce(sum(case when type = 'income' then amount else 0 end), 0)`,
            expenses: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)`,
          })
          .from(transactionsTable)
          .where(eq(transactionsTable.companyId, c.id));

        const revenue = Number(stats?.revenue ?? 0) || c.totalRevenue;
        const expenses = Number(stats?.expenses ?? 0);
        const grossProfit = revenue * 0.38;
        const netProfit = grossProfit - expenses * 0.15;
        const ownership = c.ownershipPercent ?? 30;
        const directorShare = netProfit * (ownership / 100);
        const portfolioValue = revenue * 2.8 * (ownership / 100);

        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          industry: c.industry,
          ownershipPercent: ownership,
          revenue,
          expenses,
          grossProfit,
          netProfit,
          directorShare,
          portfolioValue,
          status: c.status,
        };
      })
    );

    const totalPortfolioValue = companyData.reduce((s, c) => s + c.portfolioValue, 0);
    const totalRevenue = companyData.reduce((s, c) => s + c.revenue, 0);
    const totalNetProfit = companyData.reduce((s, c) => s + c.netProfit, 0);
    const totalDirectorShare = companyData.reduce((s, c) => s + c.directorShare, 0);

    // Monthly P&L (last 6 months from transactions)
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const [row] = await db
        .select({
          income: sql<number>`coalesce(sum(case when type = 'income' then amount else 0 end), 0)`,
          expense: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)`,
        })
        .from(transactionsTable)
        .where(and(sql`date >= ${d.toISOString().slice(0, 10)}`, sql`date < ${nextD.toISOString().slice(0, 10)}`));

      months.push({
        month: d.toLocaleString("en-IN", { month: "short" }),
        revenue: Number(row?.income ?? 0),
        expenses: Number(row?.expense ?? 0),
        profit: Number(row?.income ?? 0) - Number(row?.expense ?? 0),
      });
    }

    res.json({
      summary: { totalPortfolioValue, totalRevenue, totalNetProfit, totalDirectorShare },
      companies: companyData,
      monthlyPnl: months,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get director portfolio" });
  }
});

export default router;
