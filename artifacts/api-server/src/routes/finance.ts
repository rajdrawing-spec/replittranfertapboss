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
    // Net profit = real income − real expenses. COGS / gross profit / operating
    // profit require expense categorisation we do not track, so they are reported
    // as unavailable rather than fabricated with fixed multipliers.
    const netProfit = revenue - expenses;

    res.json({
      revenue,
      cogs: null,
      grossProfit: null,
      grossMargin: null,
      operatingExpenses: expenses,
      operatingProfit: null,
      netProfit,
      netMargin: revenue > 0 ? (netProfit / revenue) * 100 : null,
      period,
      revenueGrowth: null,
      profitGrowth: null,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get P&L summary" });
  }
});

router.patch("/finance/transactions/:txId", async (req, res) => {
  try {
    const id = parseInt(req.params.txId);
    const [t] = await db.update(transactionsTable).set(req.body).where(eq(transactionsTable.id, id)).returning();
    if (!t) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, t.companyId));
    res.json(formatTransaction(t, { [t.companyId]: c?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update transaction" }); }
});

router.delete("/finance/transactions/:txId", async (req, res) => {
  try {
    const id = parseInt(req.params.txId);
    const [t] = await db.delete(transactionsTable).where(eq(transactionsTable.id, id)).returning();
    if (!t) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete transaction" }); }
});

router.get("/finance/cash-flow", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const now = new Date();
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const companyCondition = companyId ? eq(transactionsTable.companyId, parseInt(companyId)) : undefined;
      const dateFrom = sql`date >= ${d.toISOString().slice(0, 10)}`;
      const dateTo = sql`date < ${nextD.toISOString().slice(0, 10)}`;
      const whereClause = companyCondition
        ? and(companyCondition, dateFrom, dateTo)
        : and(dateFrom, dateTo);
      const [row] = await db
        .select({
          inflow: sql<number>`coalesce(sum(case when type = 'income' then amount else 0 end), 0)`,
          outflow: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)`,
        })
        .from(transactionsTable)
        .where(whereClause);
      const inflow = Number(row?.inflow ?? 0);
      const outflow = Number(row?.outflow ?? 0);
      result.push({
        label: d.toLocaleString("en-IN", { month: "short" }),
        inflow,
        outflow,
        net: inflow - outflow,
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
