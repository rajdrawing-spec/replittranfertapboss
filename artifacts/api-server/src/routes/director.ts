import { Router } from "express";
import type { Request } from "express";
import { db } from "@workspace/db";
import { companiesTable, transactionsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { isSuperAdmin } from "../lib/auth-user";
import { requirePermission } from "../middleware/authz";

const router = Router();

/** Company IDs the caller may see: null = all (Super Admin), else their scope. */
function companyScope(req: Request): number[] | null {
  const u = (req as any).localUser as User | undefined;
  if (u && isSuperAdmin(u)) return null;
  return ((u?.companyIds as number[] | undefined) ?? []);
}

// GET /api/director/portfolio
// All figures are derived strictly from real transaction data, scoped to the
// companies the caller is authorized to see. Valuations that require inputs we
// do not have (portfolio market value, gross profit / COGS) are omitted rather
// than fabricated.
router.get("/director/portfolio", requirePermission("director.view"), async (req, res) => {
  try {
    const scope = companyScope(req);
    if (scope && scope.length === 0) {
      res.json({
        summary: { totalRevenue: 0, totalExpenses: 0, totalNetProfit: 0, totalDirectorShare: 0 },
        companies: [],
        monthlyPnl: [],
      });
      return;
    }

    const companies = await db
      .select()
      .from(companiesTable)
      .where(and(eq(companiesTable.status, "active"), scope ? inArray(companiesTable.id, scope) : undefined));

    const companyData = await Promise.all(
      companies.map(async (c) => {
        const [stats] = await db
          .select({
            revenue: sql<number>`coalesce(sum(case when type = 'income' then amount else 0 end), 0)`,
            expenses: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)`,
          })
          .from(transactionsTable)
          .where(eq(transactionsTable.companyId, c.id));

        const revenue = Number(stats?.revenue ?? 0);
        const expenses = Number(stats?.expenses ?? 0);
        const netProfit = revenue - expenses;
        const ownership = c.ownershipPercent; // real, may be null
        const directorShare = ownership != null ? netProfit * (ownership / 100) : null;

        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          industry: c.industry,
          ownershipPercent: ownership,
          revenue,
          expenses,
          netProfit,
          directorShare,
          status: c.status,
        };
      })
    );

    const totalRevenue = companyData.reduce((s, c) => s + c.revenue, 0);
    const totalExpenses = companyData.reduce((s, c) => s + c.expenses, 0);
    const totalNetProfit = companyData.reduce((s, c) => s + c.netProfit, 0);
    const totalDirectorShare = companyData.reduce((s, c) => s + (c.directorShare ?? 0), 0);

    const scopeIds = scope ? scope : companyData.map((c) => c.id);
    const inTx = scopeIds.length ? inArray(transactionsTable.companyId, scopeIds) : sql`false`;

    // Monthly P&L (last 6 months from transactions, scoped)
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
        .where(and(
          sql`date >= ${d.toISOString().slice(0, 10)}`,
          sql`date < ${nextD.toISOString().slice(0, 10)}`,
          inTx,
        ));

      months.push({
        month: d.toLocaleString("en-IN", { month: "short" }),
        revenue: Number(row?.income ?? 0),
        expenses: Number(row?.expense ?? 0),
        profit: Number(row?.income ?? 0) - Number(row?.expense ?? 0),
      });
    }

    res.json({
      summary: { totalRevenue, totalExpenses, totalNetProfit, totalDirectorShare },
      companies: companyData,
      monthlyPnl: months,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get director portfolio" });
  }
});

export default router;
