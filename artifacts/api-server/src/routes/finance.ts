import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable, companiesTable, insertTransactionSchema, fundAllocationsTable } from "@workspace/db";
import { eq, and, or, sql, desc, inArray, not, like } from "drizzle-orm";
import { emitNotification } from "../lib/notify";
import { companyScope, canAccessCompany } from "../lib/company-scope";

// NOTE: The "auto fund allocation" feature (which created phantom executed
// fund_allocation rows whenever a subsidiary recorded an expense) has been
// removed. It caused double-counting in every allocation summary because:
//   1. Treasury already tracks spend directly from expense transactions.
//   2. Real executed allocations (via approval workflow) already create
//      paired transfer transactions and a proper fund_allocation row.
//   3. Auto-rows polluted the Fund Allocations list and inflated
//      allocIn/allocOut figures in the Finance balance endpoint.
// Existing auto-rows (note LIKE '__auto_finance_%') are cleaned up by the
// startup migration.

const router = Router();

router.get("/finance/transactions", async (req, res) => {
  try {
    const { companyId, type, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const scope = companyScope(req);
    // Scoped user with no companies → empty result
    if (scope !== null && scope.length === 0) {
      res.json({ items: [], total: 0, page: pageNum, limit: limitNum });
      return;
    }

    const conditions = [];
    // Apply company filter from query, but validate caller has access
    if (companyId) {
      const cid = parseInt(companyId);
      if (!canAccessCompany(req, cid)) { res.status(403).json({ error: "Access denied" }); return; }
      conditions.push(eq(transactionsTable.companyId, cid));
    } else if (scope !== null) {
      // No specific company requested: restrict to caller's companies
      conditions.push(inArray(transactionsTable.companyId, scope));
    }
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
    if (!canAccessCompany(req, parsed.data.companyId)) { res.status(403).json({ error: "Access denied" }); return; }
    const [t] = await db.insert(transactionsTable).values(parsed.data).returning();
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, t.companyId));
    if (t.type === "income") {
      void emitNotification({
        type: "payment", severity: "success", companyId: t.companyId, companyName: c?.name ?? null,
        title: "Invoice Generated",
        message: `Payment of ₹${Math.round(t.amount).toLocaleString("en-IN")} recorded${t.referenceNumber ? ` (${t.referenceNumber})` : ""}.`,
        actionUrl: "/finance",
      });
    }
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

    // Filter by the `date` TEXT column (YYYY-MM-DD), not created_at.
    // Using created_at caused backdated transactions to fall outside the
    // period window even though their transaction date was within it.
    const startStr = startDate.toLocaleDateString("en-CA"); // YYYY-MM-DD in local tz
    const conditions = [sql`date >= ${startStr}`];
    if (companyId) conditions.push(eq(transactionsTable.companyId, parseInt(companyId)));
    // Exclude transfer transactions (fund allocation flows) from P&L —
    // they are capital movements, not operational revenue or expenses.
    conditions.push(sql`type IN ('income', 'expense')`);

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
    const [existing] = await db.select({ companyId: transactionsTable.companyId })
      .from(transactionsTable).where(eq(transactionsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Access denied" }); return; }
    const [t] = await db.update(transactionsTable).set(req.body).where(eq(transactionsTable.id, id)).returning();
    if (!t) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, t.companyId));
    res.json(formatTransaction(t, { [t.companyId]: c?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update transaction" }); }
});

// DELETE: hard-delete — the row is permanently removed from the database.
// Finance is the master ledger; removing a transaction immediately removes it
// from all balance, treasury, and working-capital calculations.
// Side-effect: if the transaction was created by a Fund Allocation (linked via
// fromTransactionId / toTransactionId), those FK columns are nulled out so the
// allocation record doesn't hold a dangling pointer to a deleted row.
router.delete("/finance/transactions/:txId", async (req, res) => {
  try {
    const id = parseInt(req.params.txId);
    const [existing] = await db.select({ companyId: transactionsTable.companyId })
      .from(transactionsTable).where(eq(transactionsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Access denied" }); return; }

    await db.transaction(async (tx) => {
      // Null out fund_allocation rows that reference this transaction as a
      // linked transfer so the allocation record doesn't hold a dangling pointer.
      await tx.update(fundAllocationsTable)
        .set({ fromTransactionId: null })
        .where(eq(fundAllocationsTable.fromTransactionId, id));
      await tx.update(fundAllocationsTable)
        .set({ toTransactionId: null })
        .where(eq(fundAllocationsTable.toTransactionId, id));
      await tx.delete(transactionsTable).where(eq(transactionsTable.id, id));
    });

    res.status(204).end();
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete transaction" }); }
});

/* ── GET /finance/balance ── */
router.get("/finance/balance", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const u = (req as any).localUser;

    // Validate and authorise. Super admins may query all companies (no cId)
    // or any specific company. Others may only query their own companies.
    let cId: number | null = null;
    if (companyId !== undefined) {
      cId = parseInt(companyId, 10);
      if (!Number.isFinite(cId) || cId <= 0) {
        res.status(400).json({ error: "Invalid companyId" }); return;
      }
      if (u?.role !== "super_admin" && !(u?.companyIds ?? []).includes(cId)) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const txConditions = cId ? [eq(transactionsTable.companyId, cId)] : [];
    const txWhere = txConditions.length > 0 ? and(...txConditions) : undefined;

    // Transaction totals
    const [stats] = await db
      .select({
        totalIncome:     sql<number>`coalesce(sum(case when type='income'  and status='completed' then amount else 0 end),0)`,
        totalExpenses:   sql<number>`coalesce(sum(case when type='expense' and status='completed' then amount else 0 end),0)`,
        pendingIncome:   sql<number>`coalesce(sum(case when type='income'  and status='pending'   then amount else 0 end),0)`,
        pendingExpenses: sql<number>`coalesce(sum(case when type='expense' and status='pending'   then amount else 0 end),0)`,
      })
      .from(transactionsTable)
      .where(txWhere);

    // ── Fund allocation totals ─────────────────────────────────────────────────
    // Only count REAL allocations — those that went through the approval workflow.
    // Auto-allocation rows (created by the old syncAutoAllocation feature, note
    // LIKE '__auto_finance_%') are excluded because they were phantom entries that
    // duplicated expense data without representing actual capital transfers.
    // The startup migration removes all legacy auto-rows from the DB.
    //
    // For a specific company: in = capital received, out = capital sent.
    // For all companies (consolidated): in = out = total executed (they net to 0
    // for the cash position, but we still display them so the balance sheet shows
    // how much capital has been deployed across the group, not just ₹0).
    let allocIn = 0, allocOut = 0;
    const realAllocWhere = not(like(fundAllocationsTable.note, "__auto_finance_%"));

    if (cId) {
      const [aStats] = await db
        .select({
          received: sql<number>`coalesce(sum(case when to_company_id=${cId}   and status='executed' then amount else 0 end),0)`,
          sent:     sql<number>`coalesce(sum(case when from_company_id=${cId} and status='executed' then amount else 0 end),0)`,
        })
        .from(fundAllocationsTable)
        .where(and(
          or(eq(fundAllocationsTable.toCompanyId, cId), eq(fundAllocationsTable.fromCompanyId, cId)),
          realAllocWhere,
        ));
      allocIn  = Number(aStats?.received ?? 0);
      allocOut = Number(aStats?.sent     ?? 0);
    } else {
      // Consolidated view: show total capital deployed (in = out, net = 0)
      const [aStats] = await db
        .select({ total: sql<number>`coalesce(sum(case when status='executed' then amount else 0 end),0)` })
        .from(fundAllocationsTable)
        .where(realAllocWhere);
      const total = Number(aStats?.total ?? 0);
      allocIn  = total;  // same value — net cash impact = 0 (internal transfer)
      allocOut = total;
    }

    const totalIncome   = Number(stats?.totalIncome   ?? 0);
    const totalExpenses = Number(stats?.totalExpenses ?? 0);

    res.json({
      totalIncome,
      totalExpenses,
      netOperating:       totalIncome - totalExpenses,
      pendingIncome:      Number(stats?.pendingIncome   ?? 0),
      pendingExpenses:    Number(stats?.pendingExpenses ?? 0),
      fundAllocationsIn:  allocIn,
      fundAllocationsOut: allocOut,
      netCashPosition:    totalIncome - totalExpenses + allocIn - allocOut,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get balance" });
  }
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
