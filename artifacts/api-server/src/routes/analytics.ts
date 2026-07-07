import { Router } from "express";
import { db } from "@workspace/db";
import { ordersTable, transactionsTable, shareholdersTable, companiesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { companyScope, canAccessCompany } from "../lib/company-scope";

const router = Router();

type Bucket = { label: string; start: Date; end: Date };

/** Build the trailing time buckets for a reporting period. */
function buildBuckets(period: string, now: Date): Bucket[] {
  const buckets: Bucket[] = [];
  if (period === "year") {
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ label: String(y), start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) });
    }
  } else if (period === "quarter") {
    const curQ = Math.floor(now.getMonth() / 3);
    for (let i = 7; i >= 0; i--) {
      const totalQ = now.getFullYear() * 4 + curQ - i;
      const y = Math.floor(totalQ / 4);
      const q = ((totalQ % 4) + 4) % 4;
      buckets.push({
        label: `Q${q + 1} '${String(y).slice(2)}`,
        start: new Date(y, q * 3, 1),
        end: new Date(y, q * 3 + 3, 1),
      });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ label: d.toLocaleString("en-IN", { month: "short" }), start: d, end: next });
    }
  }
  return buckets;
}

/** Format a bucket boundary as YYYY-MM-DD from its LOCAL components. Buckets are
 * built with `new Date(y, m, d)` (local), so formatting with local getters keeps
 * the intended calendar date regardless of server timezone — unlike toISOString,
 * which can shift the date across the UTC boundary. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse & validate common analytics query params. Returns null on bad input
 * (the caller has already sent a 400). */
function parseParams(req: any, res: any): { period: string; reqCompany: number | null } | null {
  const period = (req.query.period as string) || "month";
  if (!["month", "quarter", "year"].includes(period)) { res.status(400).json({ error: "Invalid period" }); return null; }
  let reqCompany: number | null = null;
  if (req.query.companyId !== undefined && req.query.companyId !== "") {
    const n = Number(req.query.companyId);
    if (!Number.isInteger(n) || n <= 0) { res.status(400).json({ error: "Invalid companyId" }); return null; }
    reqCompany = n;
  }
  return { period, reqCompany };
}

/** Revenue (from orders) and expenses (from ledger) for a company set + date window. */
async function revenueExpenses(ids: number[] | null, start: Date, end: Date) {
  const startIso = ymd(start);
  const endIso = ymd(end);
  const [orow] = await db
    .select({ revenue: sql<number>`coalesce(sum(total_amount), 0)` })
    .from(ordersTable)
    .where(and(sql`created_at >= ${start}`, sql`created_at < ${end}`, ids ? inArray(ordersTable.companyId, ids) : undefined));
  const [trow] = await db
    .select({ expense: sql<number>`coalesce(sum(case when type = 'expense' then amount else 0 end), 0)` })
    .from(transactionsTable)
    .where(and(sql`date >= ${startIso}`, sql`date < ${endIso}`, ids ? inArray(transactionsTable.companyId, ids) : undefined));
  const revenue = Number(orow?.revenue ?? 0);
  const expenses = Number(trow?.expense ?? 0);
  return { revenue, expenses, profit: revenue - expenses };
}

/** Equity snapshot (valuation, capital invested, holder count) for a company set. */
async function equitySnapshot(ids: number[] | null) {
  const grouped = await db
    .select({
      companyId: shareholdersTable.companyId,
      totalShares: sql<number>`coalesce(sum(shares), 0)`,
      maxPrice: sql<number>`coalesce(max(share_price), 0)`,
      invested: sql<number>`coalesce(sum(investment_amount), 0)`,
      holders: sql<number>`count(*)`,
    })
    .from(shareholdersTable)
    .where(and(eq(shareholdersTable.status, "active"), ids ? inArray(shareholdersTable.companyId, ids) : undefined))
    .groupBy(shareholdersTable.companyId);

  let valuation = 0, capitalInvested = 0, shareholderCount = 0;
  for (const g of grouped) {
    valuation += Number(g.totalShares) * Number(g.maxPrice);
    capitalInvested += Number(g.invested);
    shareholderCount += Number(g.holders);
  }
  return { valuation, capitalInvested, shareholderCount };
}

const pct = (cur: number, prev: number): number | null =>
  prev > 0 ? ((cur - prev) / prev) * 100 : null;

/**
 * Comprehensive financial analytics for one company or the caller's portfolio.
 * Every figure is computed from real data; anything we cannot derive (e.g. COGS
 * / gross margin, which needs expense categorisation we do not track) is returned
 * as null rather than fabricated.
 */
router.get("/analytics/summary", requirePermission("finance.view"), async (req, res) => {
  try {
    const params = parseParams(req, res);
    if (!params) return;
    const { period, reqCompany } = params;

    const scope = companyScope(req);
    if (reqCompany != null && !canAccessCompany(req, reqCompany)) {
      res.status(403).json({ error: "You do not have access to this company" });
      return;
    }
    // Scoped user with no companies sees nothing.
    if (scope && scope.length === 0) {
      res.json({ empty: true, series: [], insights: [] });
      return;
    }

    // Effective company filter for the caller's own figures.
    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;

    const now = new Date();
    const buckets = buildBuckets(period, now);

    const series = [];
    for (const b of buckets) {
      const re = await revenueExpenses(ids, b.start, b.end);
      series.push({ label: b.label, revenue: re.revenue, expenses: re.expenses, profit: re.profit });
    }

    const cur = series[series.length - 1] ?? { revenue: 0, expenses: 0, profit: 0 };
    const prev = series[series.length - 2] ?? { revenue: 0, expenses: 0, profit: 0 };
    const curBucket = buckets[buckets.length - 1];

    // Market share = this company's revenue as a share of the whole group's
    // revenue for the same window. Restricted to super admins (scope === null):
    // exposing it to a scoped user would let them algebraically recover the
    // group's absolute revenue (their revenue ÷ share = group total).
    let marketShare: number | null = null;
    if (reqCompany != null && scope === null) {
      const [prow] = await db
        .select({ revenue: sql<number>`coalesce(sum(total_amount), 0)` })
        .from(ordersTable)
        .where(and(sql`created_at >= ${curBucket.start}`, sql`created_at < ${curBucket.end}`));
      const portfolioRevenue = Number(prow?.revenue ?? 0);
      marketShare = portfolioRevenue > 0 ? (cur.revenue / portfolioRevenue) * 100 : null;
    }

    const equity = await equitySnapshot(ids);

    const totals = series.reduce(
      (acc, s) => ({ revenue: acc.revenue + s.revenue, expenses: acc.expenses + s.expenses, profit: acc.profit + s.profit }),
      { revenue: 0, expenses: 0, profit: 0 },
    );

    const netMargin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : null;
    const revenueGrowth = pct(cur.revenue, prev.revenue);
    const profitGrowth = prev.profit !== 0 && prev.profit > 0 ? ((cur.profit - prev.profit) / Math.abs(prev.profit)) * 100 : null;

    // Honest, computed observations — no fabricated numbers.
    const insights: string[] = [];
    const periodWord = period === "year" ? "year" : period === "quarter" ? "quarter" : "month";
    if (revenueGrowth != null) {
      insights.push(
        revenueGrowth >= 0
          ? `Revenue is up ${revenueGrowth.toFixed(1)}% versus the previous ${periodWord}.`
          : `Revenue is down ${Math.abs(revenueGrowth).toFixed(1)}% versus the previous ${periodWord}.`,
      );
    }
    if (netMargin != null) {
      insights.push(
        netMargin >= 0
          ? `Net margin this ${periodWord} is ${netMargin.toFixed(1)}%.`
          : `Operating at a loss this ${periodWord} (${netMargin.toFixed(1)}% margin).`,
      );
    }
    if (marketShare != null) insights.push(`This company holds ${marketShare.toFixed(1)}% of group revenue this ${periodWord}.`);
    if (equity.valuation > 0) insights.push(`Book valuation stands at ₹${Math.round(equity.valuation).toLocaleString("en-IN")} across ${equity.shareholderCount} shareholder(s).`);
    if (insights.length === 0) insights.push("Not enough activity yet to generate insights.");

    res.json({
      period,
      companyId: reqCompany,
      current: {
        revenue: cur.revenue,
        expenses: cur.expenses,
        netProfit: cur.profit,
        netMargin,
        // COGS / gross margin need expense categorisation we do not track.
        cogs: null,
        grossMargin: null,
        revenueGrowth,
        profitGrowth,
        marketShare,
      },
      totals,
      equity,
      series,
      insights,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to build analytics" });
  }
});

/**
 * Per-period report rows for the reporting table (revenue / expenses / profit /
 * margin per bucket), plus a period-over-period growth column.
 */
router.get("/analytics/reports", requirePermission("finance.view"), async (req, res) => {
  try {
    const params = parseParams(req, res);
    if (!params) return;
    const { period, reqCompany } = params;

    const scope = companyScope(req);
    if (reqCompany != null && !canAccessCompany(req, reqCompany)) {
      res.status(403).json({ error: "You do not have access to this company" });
      return;
    }
    if (scope && scope.length === 0) { res.json({ rows: [] }); return; }

    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;
    const buckets = buildBuckets(period, new Date());

    const rows = [];
    let prevRevenue: number | null = null;
    for (const b of buckets) {
      const re = await revenueExpenses(ids, b.start, b.end);
      rows.push({
        label: b.label,
        revenue: re.revenue,
        expenses: re.expenses,
        profit: re.profit,
        margin: re.revenue > 0 ? (re.profit / re.revenue) * 100 : null,
        growth: prevRevenue != null && prevRevenue > 0 ? ((re.revenue - prevRevenue) / prevRevenue) * 100 : null,
      });
      prevRevenue = re.revenue;
    }
    res.json({ period, rows });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to build report" });
  }
});

export default router;
