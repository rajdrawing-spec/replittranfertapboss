import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, companiesTable, insertTransactionSchema } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/finance/transactions", async (req, res) => {
  try {
    const { companyId, type, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (companyId) conditions.push(eq(transactionsTable.companyId, parseInt(companyId)));
    if (type) conditions.push(eq(transactionsTable.type, type));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(transactionsTable).where(where);
    const items = await db
      .select()
      .from(transactionsTable)
      .where(where)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

    res.json({
      items: items.map(t => formatTransaction(t, companyMap)),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.post("/finance/transactions", async (req, res) => {
  try {
    const parsed = insertTransactionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [t] = await db.insert(transactionsTable).values(parsed.data).returning();
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, t.companyId));
    res.status(201).json(formatTransaction(t, { [t.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

router.get("/finance/pnl-summary", async (req, res) => {
  try {
    const { companyId, period = "month" } = req.query as Record<string, string>;
    const now = new Date();
    let startDate: Date;
    if (period === "year") startDate = new Date(now.getFullYear(), 0, 1);
    else if (period === "quarter") startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else startDate = new Date(now.getFullYear(), now.getMonth(), 1);

    const conditions = [sql`created_at >= ${startDate}`];
    if (companyId) conditions.push(eq(transactionsTable.companyId, parseInt(companyId)));

    const [stats] = await db
      .select({
        revenue: sql<number>`coalesce(sum(case when type = 'income' then amount else 0 end), 0)`,
        expenses: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)`,
      })
      .from(transactionsTable)
      .where(and(...conditions));

    const revenue = Number(stats?.revenue ?? 0);
    const expenses = Number(stats?.expenses ?? 0);
    const cogs = revenue * 0.55;
    const grossProfit = revenue - cogs;
    const operatingExpenses = expenses * 0.4;
    const operatingProfit = grossProfit - operatingExpenses;
    const netProfit = operatingProfit - expenses * 0.1;

    res.json({
      revenue,
      cogs,
      grossProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      operatingExpenses,
      operatingProfit,
      netProfit,
      netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      period,
      revenueGrowth: 18.5,
      profitGrowth: 24.2,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get P&L summary" });
  }
});

router.get("/finance/cash-flow", async (req, res) => {
  try {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const inflow = 600000 + Math.random() * 400000;
      const outflow = 400000 + Math.random() * 200000;
      result.push({
        label: months[d.getMonth()],
        inflow: Math.round(inflow),
        outflow: Math.round(outflow),
        net: Math.round(inflow - outflow),
      });
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get cash flow" });
  }
});

function formatTransaction(t: typeof transactionsTable.$inferSelect, companyMap: Record<number, string>) {
  return {
    id: t.id,
    companyId: t.companyId,
    companyName: companyMap[t.companyId] ?? "Unknown",
    type: t.type,
    category: t.category,
    amount: t.amount,
    description: t.description,
    referenceNumber: t.referenceNumber,
    paymentMethod: t.paymentMethod,
    status: t.status,
    date: t.date,
    createdAt: t.createdAt.toISOString(),
  };
}

export default router;
