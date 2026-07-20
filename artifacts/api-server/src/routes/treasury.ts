/**
 * Treasury routes — TapasHub main treasury management.
 *
 * All routes are super-admin only: the treasury is the parent company's
 * capital ledger and must not be writable by subsidiary staff.
 *
 * GET  /treasury/summary          Live balance with group revenue
 * GET  /treasury/working-capital  Lightweight sidebar snapshot
 * GET  /treasury/entries          List entries (paginated, filtered)
 * POST /treasury/entries          Create new funding entry
 * PATCH /treasury/entries/:id     Edit an entry (audit-logged)
 * POST /treasury/entries/:id/reverse  Soft-reverse an entry
 */

import { Router } from "express";
import { db, treasuryEntriesTable, fundAllocationsTable, companiesTable, transactionsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, ne, desc, sql, inArray, not, like, isNull, or } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { writeAudit } from "../lib/audit";

const router = Router();

/* ─────────────────────────────────────────────────────
   Shared helpers
──────────────────────────────────────────────────────── */

/** Fetch all companies (id, name, color, type) keyed by id. */
async function companyMap() {
  const rows = await db
    .select({ id: companiesTable.id, name: companiesTable.name, color: companiesTable.brandColor, type: companiesTable.type })
    .from(companiesTable);
  return { rows, map: Object.fromEntries(rows.map(c => [c.id, c])) };
}

/** Sum of all completed expense transactions for a set of company IDs.
 *  Used to compute how much of the main treasury has been spent in total.
 *  In the centralized model, every subsidiary expense is effectively a
 *  draw on the main treasury — no separate manual entry needed. */
async function companyExpenseMap(companyIds: number[]): Promise<Record<number, number>> {
  if (!companyIds.length) return {};
  const rows = await db
    .select({
      companyId: transactionsTable.companyId,
      total: sql<number>`coalesce(sum(amount), 0)`,
    })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "expense"),
        eq(transactionsTable.status, "completed"),
        inArray(transactionsTable.companyId, companyIds),
      ),
    )
    .groupBy(transactionsTable.companyId);
  return Object.fromEntries(rows.map(r => [r.companyId, Number(r.total)]));
}

/** Sum of all completed operational income transactions for a set of company IDs.
 *  Excludes "Capital Injection" category — those are fund allocations from the
 *  parent treasury (type=transfer), not revenue. Belt-and-suspenders: even if
 *  legacy rows still have type=income with category=Capital Injection, they are
 *  excluded here so they never inflate group revenue figures. */
async function subsidiaryIncomeMap(subsidiaryIds: number[]): Promise<Record<number, number>> {
  if (!subsidiaryIds.length) return {};
  const rows = await db
    .select({
      companyId: transactionsTable.companyId,
      total: sql<number>`coalesce(sum(amount), 0)`,
    })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.type, "income"),
        eq(transactionsTable.status, "completed"),
        inArray(transactionsTable.companyId, subsidiaryIds),
        ne(transactionsTable.category, "Capital Injection"),
      ),
    )
    .groupBy(transactionsTable.companyId);
  return Object.fromEntries(rows.map(r => [r.companyId, Number(r.total)]));
}

/* ─────────────────────────────────────────────
   GET /treasury/summary
   Returns:
     • totalRaised      — capital in treasury_entries (approved, not reversed)
     • allocated        — capital deployed to subsidiaries via executed fund allocations
     • totalExpenses    — actual spend across all companies (for reference)
     • available        — totalRaised − allocated  (undeployed treasury balance)
     • groupRevenue     — operational income across all subsidiaries (from finance txns)
     • netGroupPosition — totalRaised + groupRevenue − totalExpenses
     • allocationsBySubsidiary[]  — per-company {allocated, spent, income, color}
     • revenueBySubsidiary[]      — per-company income from operations
     • monthlyInflow[]   — capital raised per month (last 6 months)
     • monthlyRevenue[]  — subsidiary income per month (last 6 months)
   ─────────────────────────────────────────────── */
router.get("/treasury/summary", requirePermission("treasury.view"), async (req, res) => {
  try {
    // ── Capital raised ─────────────────────────────────────────────────────
    const [raised] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)));

    // ── Company map ────────────────────────────────────────────────────────
    const { rows: allCompanies, map: cm } = await companyMap();
    const parent = allCompanies.find(c => c.type === "parent") ?? null;
    const subsidiaries = allCompanies.filter(c => c.type !== "parent");
    const allCompanyIds = allCompanies.map(c => c.id);

    // ── Total actual expenses across ALL companies (centralized treasury) ──
    // In the centralized model every expense is effectively a draw on the
    // main treasury — the treasury balance decreases automatically whenever
    // any company records a completed expense.
    const expenseByCompany = await companyExpenseMap(allCompanyIds);
    const totalExpenses = Object.values(expenseByCompany).reduce((s, v) => s + v, 0);

    // ── Allocations from parent → subsidiaries (budget reference only) ─────
    let allocated = 0;
    let allocationsBySubsidiary: {
      companyId: number; companyName: string; color: string;
      allocated: number; spent: number; income: number; netPosition: number;
    }[] = [];

    if (parent) {
      // Exclude legacy phantom auto-allocation rows. NULL-safe: use
      // OR(note IS NULL, note NOT LIKE …) so real allocations with no note
      // are never dropped (SQL NULL NOT LIKE x = NULL = falsy).
      const allocRows = await db
        .select({ companyId: fundAllocationsTable.toCompanyId, total: sql<number>`coalesce(sum(amount), 0)` })
        .from(fundAllocationsTable)
        .where(and(
          eq(fundAllocationsTable.fromCompanyId, parent.id),
          eq(fundAllocationsTable.status, "executed"),
          or(isNull(fundAllocationsTable.note), not(like(fundAllocationsTable.note, "__auto_finance_%"))),
        ))
        .groupBy(fundAllocationsTable.toCompanyId);
      allocated = allocRows.reduce((s, r) => s + Number(r.total), 0);

      // Per-subsidiary income from their finance module
      const subIds = subsidiaries.map(s => s.id);
      const incomeMap = await subsidiaryIncomeMap(subIds);

      // Build from ALL subsidiaries so every company appears in the chart,
      // even those with ₹0 allocation. Lookup allocation totals from allocRows.
      const allocByCompany: Record<number, number> = {};
      for (const r of allocRows) allocByCompany[r.companyId] = Number(r.total);

      allocationsBySubsidiary = subsidiaries.map(c => {
        const alloc = allocByCompany[c.id] ?? 0;
        const inc = incomeMap[c.id] ?? 0;
        const spent = expenseByCompany[c.id] ?? 0;
        return {
          companyId: c.id,
          companyName: c.name,
          color: c.color ?? "#6366f1",
          allocated: alloc,
          spent,
          income: inc,
          netPosition: alloc - spent,
        };
      }).sort((a, b) => (b.allocated + b.spent) - (a.allocated + a.spent));
    }

    const totalRaised = Number(raised?.total ?? 0);
    // Available = capital raised minus what has actually been spent across all companies.
    // Finance expenses are the source of truth — every completed expense is a direct draw
    // on the treasury, so the available balance decreases automatically when Finance is updated.
    // Fund Allocations are a budgeting/approval reference but do NOT drive this number.
    const available = totalRaised - totalExpenses;

    // ── Total group revenue (all subsidiary operational income) ────────────
    const subIds = subsidiaries.map(s => s.id);
    const incomeBySubsidiary = await subsidiaryIncomeMap(subIds);
    const groupRevenue = Object.values(incomeBySubsidiary).reduce((s, v) => s + v, 0);

    const revenueBySubsidiary = subsidiaries
      .map(c => ({ companyId: c.id, companyName: c.name, color: c.color ?? "#6366f1", income: incomeBySubsidiary[c.id] ?? 0 }))
      .filter(r => r.income > 0)
      .sort((a, b) => b.income - a.income);

    // ── Funding source breakdown ───────────────────────────────────────────
    const bySource = await db
      .select({
        fundingSource: treasuryEntriesTable.fundingSource,
        total: sql<number>`coalesce(sum(amount), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)))
      .groupBy(treasuryEntriesTable.fundingSource);

    // ── Monthly capital inflow (last 6 months) ─────────────────────────────
    const now = new Date();
    const monthlyInflow = [];
    const monthlyRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });

      const [inflowRow] = await db
        .select({ total: sql<number>`coalesce(sum(amount), 0)` })
        .from(treasuryEntriesTable)
        .where(and(
          eq(treasuryEntriesTable.status, "approved"),
          eq(treasuryEntriesTable.isReversed, false),
          sql`date >= ${d.toISOString().slice(0, 10)}`,
          sql`date <  ${nextD.toISOString().slice(0, 10)}`,
        ));
      monthlyInflow.push({ label, amount: Number(inflowRow?.total ?? 0) });

      // Revenue: sum income transactions for all subsidiaries in this month
      let monthRevTotal = 0;
      if (subIds.length > 0) {
        const [revRow] = await db
          .select({ total: sql<number>`coalesce(sum(amount), 0)` })
          .from(transactionsTable)
          .where(and(
            eq(transactionsTable.type, "income"),
            eq(transactionsTable.status, "completed"),
            inArray(transactionsTable.companyId, subIds),
            ne(transactionsTable.category, "Capital Injection"),
            sql`created_at >= ${d.toISOString()}`,
            sql`created_at <  ${nextD.toISOString()}`,
          ));
        monthRevTotal = Number(revRow?.total ?? 0);
      }
      monthlyRevenue.push({ label, amount: monthRevTotal });
    }

    // ── Pending entries ────────────────────────────────────────────────────
    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "pending"), eq(treasuryEntriesTable.isReversed, false)));

    res.json({
      totalRaised,
      allocated,           // formal fund-allocation budget (reference only)
      totalExpenses,       // actual Finance spend — drives available & utilization
      available,           // totalRaised − totalExpenses (live treasury balance)
      groupRevenue,
      netGroupPosition: totalRaised + groupRevenue - totalExpenses,
      utilizationPercent: totalRaised > 0 ? (totalExpenses / totalRaised) * 100 : 0,
      pendingCount: Number(pendingRow?.count ?? 0),
      pendingAmount: Number(pendingRow?.total ?? 0),
      parentCompany: parent ? { id: parent.id, name: parent.name } : null,
      bySource: bySource.map(s => ({ fundingSource: s.fundingSource, total: Number(s.total), count: Number(s.count) })),
      allocationsBySubsidiary,
      revenueBySubsidiary,
      monthlyInflow,
      monthlyRevenue,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get treasury summary" });
  }
});

/* ─────────────────────────────────────────────
   GET /treasury/working-capital
   Lightweight snapshot for the sidebar widget.
   Shape: { totalCapital, allocated, totalSpent, available,
            utilizationPercent, groupRevenue, byCompany[] }

   available      = totalCapital − totalSpent   (centralized model)
   utilizationPct = totalSpent / totalCapital
   byCompany[]    includes both allocated (budget) and spent (actual)
   ─────────────────────────────────────────────── */
router.get("/treasury/working-capital", requirePermission("treasury.view"), async (req, res) => {
  try {
    const [raised] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)));

    const { rows: allCompanies, map: cm } = await companyMap();
    const parent = allCompanies.find(c => c.type === "parent") ?? null;
    const subsidiaries = allCompanies.filter(c => c.type !== "parent");
    const allCompanyIds = allCompanies.map(c => c.id);
    const subIds = subsidiaries.map(s => s.id);

    // Budget allocations (reference only) — real allocations only, no auto-rows.
    // NULL-safe: OR(note IS NULL, note NOT LIKE …).
    const allocMap: Record<number, number> = {};
    if (parent) {
      const allocRows = await db
        .select({ companyId: fundAllocationsTable.toCompanyId, total: sql<number>`coalesce(sum(amount), 0)` })
        .from(fundAllocationsTable)
        .where(and(
          eq(fundAllocationsTable.fromCompanyId, parent.id),
          eq(fundAllocationsTable.status, "executed"),
          or(isNull(fundAllocationsTable.note), not(like(fundAllocationsTable.note, "__auto_finance_%"))),
        ))
        .groupBy(fundAllocationsTable.toCompanyId);
      for (const r of allocRows) { allocMap[r.companyId] = Number(r.total); }
    }

    // Actual spend across all companies (for reference / per-sub tracking)
    const expenseMap = await companyExpenseMap(allCompanyIds);
    const totalSpent = Object.values(expenseMap).reduce((s, v) => s + v, 0);

    const incomeMap = await subsidiaryIncomeMap(subIds);
    const groupRevenue = Object.values(incomeMap).reduce((s, v) => s + v, 0);
    const totalCapital = Number(raised?.total ?? 0);
    const totalAllocated = Object.values(allocMap).reduce((s, v) => s + v, 0);

    // Include ALL subsidiaries so every company appears in the Capital
    // Distribution grid — even ones with ₹0 allocated and ₹0 spent.
    // Sort: allocated desc, then spent desc (so active subs rise to the top).
    const byCompany: {
      id: number; name: string; color: string;
      allocated: number; spent: number; income: number; isSelf: boolean;
    }[] = subsidiaries
      .map(c => ({
        id: c.id,
        name: c.name,
        color: c.color ?? "#6366f1",
        allocated: allocMap[c.id] ?? 0,
        spent: expenseMap[c.id] ?? 0,
        income: incomeMap[c.id] ?? 0,
        isSelf: false,
      }))
      .sort((a, b) => (b.allocated + b.spent) - (a.allocated + a.spent));

    // Include the parent's own operational expenses as a "Self" entry
    if (parent && (expenseMap[parent.id] ?? 0) > 0) {
      byCompany.unshift({
        id: parent.id,
        name: parent.name,
        color: parent.color ?? "#818cf8",
        allocated: 0,          // parent doesn't receive allocations from itself
        spent: expenseMap[parent.id] ?? 0,
        income: 0,
        isSelf: true,
      });
    }

    res.json({
      totalCapital,
      allocated: totalAllocated,   // formal fund-allocation budget (reference)
      totalSpent,                  // actual Finance expenses — drives treasury available
      available: totalCapital - totalSpent,   // undeployed = raised − what has been spent
      utilizationPercent: totalCapital > 0 ? Math.round((totalSpent / totalCapital) * 100) : 0,
      groupRevenue,
      byCompany,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get working capital" });
  }
});

/* ─────────────────────────────────────────────
   GET /treasury/entries
   ─────────────────────────────────────────────── */
router.get("/treasury/entries", requirePermission("treasury.view"), async (req, res) => {
  try {
    const { status, fundingSource, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [eq(treasuryEntriesTable.isReversed, false)];
    if (status && status !== "all")         conditions.push(eq(treasuryEntriesTable.status, status));
    if (fundingSource && fundingSource !== "all") conditions.push(eq(treasuryEntriesTable.fundingSource, fundingSource));
    const where = and(...conditions);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(treasuryEntriesTable).where(where);
    const items = await db.select().from(treasuryEntriesTable).where(where)
      .orderBy(desc(treasuryEntriesTable.date), desc(treasuryEntriesTable.createdAt))
      .limit(limitNum).offset(offset);

    res.json({ items: items.map(fmt), total: Number(count), page: pageNum, limit: limitNum });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list treasury entries" });
  }
});

/* ─────────────────────────────────────────────
   POST /treasury/entries
   ─────────────────────────────────────────────── */
router.post("/treasury/entries", requirePermission("treasury.manage"), async (req, res) => {
  try {
    const u = (req as any).localUser as User;
    const { fundingSource, investorName, amount, date, currency, paymentMethod, referenceNumber, description, notes, status } = req.body ?? {};

    if (!fundingSource?.trim()) { res.status(400).json({ error: "Funding source is required" }); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "Amount must be greater than zero" }); return; }
    if (!date || !description?.trim()) { res.status(400).json({ error: "Date and description are required" }); return; }

    const entryStatus = status === "pending" ? "pending" : "approved";

    const [entry] = await db.insert(treasuryEntriesTable).values({
      fundingSource: fundingSource.trim(),
      investorName:  investorName?.trim() || null,
      amount: amt,
      date:   date.trim(),
      currency: currency?.trim() || "INR",
      paymentMethod:   paymentMethod?.trim()   || null,
      referenceNumber: referenceNumber?.trim() || null,
      description: description.trim(),
      notes:       notes?.trim() || null,
      status: entryStatus,
      createdById:     u.id,
      createdByName:   u.name,
      approvedByName:  entryStatus === "approved" ? u.name : null,
      approvedAt:      entryStatus === "approved" ? new Date() : null,
    }).returning();

    void writeAudit({
      userId: u.id, userEmail: u.email,
      action: "treasury.entry.created", targetType: "treasury_entry", targetId: String(entry.id),
      description: `Created treasury entry: ${fundingSource} ₹${Math.round(amt).toLocaleString("en-IN")} — ${description}`,
      metadata: { amount: amt, fundingSource, status: entryStatus },
    });

    res.status(201).json(fmt(entry));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create treasury entry" });
  }
});

/* ─────────────────────────────────────────────
   PATCH /treasury/entries/:id
   ─────────────────────────────────────────────── */
router.patch("/treasury/entries/:id", requirePermission("treasury.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const u  = (req as any).localUser as User;

    const [existing] = await db.select().from(treasuryEntriesTable).where(eq(treasuryEntriesTable.id, id)).limit(1);
    if (!existing)           { res.status(404).json({ error: "Entry not found" }); return; }
    if (existing.isReversed) { res.status(400).json({ error: "Reversed entries cannot be edited" }); return; }

    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const patch: {
      fundingSource?: string; investorName?: string | null; amount?: number;
      date?: string; currency?: string; paymentMethod?: string | null;
      referenceNumber?: string | null; description?: string; notes?: string | null;
      status?: string; approvedByName?: string | null; approvedAt?: Date | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    const textFields = ["fundingSource","investorName","date","currency","paymentMethod","referenceNumber","description","notes"] as const;
    for (const key of textFields) {
      if (req.body[key] !== undefined) {
        const newVal = req.body[key] === "" ? null : String(req.body[key]);
        if (existing[key] !== newVal) { changes[key] = { from: existing[key], to: newVal }; (patch as Record<string, unknown>)[key] = newVal; }
      }
    }
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "Amount must be greater than zero" }); return; }
      if (existing.amount !== amt) { changes.amount = { from: existing.amount, to: amt }; patch.amount = amt; }
    }
    if (req.body.status !== undefined) {
      const newStatus = String(req.body.status);
      if (existing.status !== newStatus) { changes.status = { from: existing.status, to: newStatus }; patch.status = newStatus; }
      if (newStatus === "approved" && existing.status !== "approved") {
        patch.approvedByName = u.name;
        patch.approvedAt = new Date();
      }
    }

    const [updated] = await db.update(treasuryEntriesTable).set(patch).where(eq(treasuryEntriesTable.id, id)).returning();

    void writeAudit({
      userId: u.id, userEmail: u.email,
      action: "treasury.entry.updated", targetType: "treasury_entry", targetId: String(id),
      description: `Edited treasury entry #${id}`,
      metadata: { changes },
    });

    res.json(fmt(updated));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update treasury entry" });
  }
});

/* ─────────────────────────────────────────────
   POST /treasury/entries/:id/reverse
   ─────────────────────────────────────────────── */
router.post("/treasury/entries/:id/reverse", requirePermission("treasury.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const u  = (req as any).localUser as User;
    const { reason } = req.body ?? {};

    const [existing] = await db.select().from(treasuryEntriesTable).where(eq(treasuryEntriesTable.id, id)).limit(1);
    if (!existing)           { res.status(404).json({ error: "Entry not found" }); return; }
    if (existing.isReversed) { res.status(400).json({ error: "Entry is already reversed" }); return; }

    const [updated] = await db.update(treasuryEntriesTable).set({
      isReversed:      true,
      reversedAt:      new Date(),
      reversedByName:  u.name,
      reversalReason:  reason?.trim() || "Reversed by administrator",
      updatedAt:       new Date(),
    }).where(eq(treasuryEntriesTable.id, id)).returning();

    void writeAudit({
      userId: u.id, userEmail: u.email,
      action: "treasury.entry.reversed", targetType: "treasury_entry", targetId: String(id),
      description: `Reversed treasury entry #${id}: ${existing.description}`,
      metadata: { amount: existing.amount, reason: reason || null },
    });

    res.json(fmt(updated));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to reverse treasury entry" });
  }
});

function fmt(e: typeof treasuryEntriesTable.$inferSelect) {
  return {
    id: e.id,
    fundingSource:   e.fundingSource,
    investorName:    e.investorName,
    amount:          e.amount,
    date:            e.date,
    currency:        e.currency,
    paymentMethod:   e.paymentMethod,
    referenceNumber: e.referenceNumber,
    description:     e.description,
    notes:           e.notes,
    status:          e.status,
    isReversed:      e.isReversed,
    reversedAt:      e.reversedAt?.toISOString() ?? null,
    reversedByName:  e.reversedByName,
    reversalReason:  e.reversalReason,
    createdById:     e.createdById,
    createdByName:   e.createdByName,
    approvedByName:  e.approvedByName,
    approvedAt:      e.approvedAt?.toISOString() ?? null,
    createdAt:       e.createdAt.toISOString(),
    updatedAt:       e.updatedAt.toISOString(),
  };
}

export default router;
