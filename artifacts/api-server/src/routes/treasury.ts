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
import { eq, and, ne, desc, sql, inArray } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";
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

/** Sum of all completed income transactions for a set of company IDs.
 *  Returns a map from companyId → total income. */
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
      ),
    )
    .groupBy(transactionsTable.companyId);
  return Object.fromEntries(rows.map(r => [r.companyId, Number(r.total)]));
}

/* ─────────────────────────────────────────────
   GET /treasury/summary
   Returns:
     • totalRaised      — capital in treasury_entries (approved, not reversed)
     • allocated        — capital sent out to subsidiaries (executed fund_allocations)
     • available        — totalRaised − allocated
     • groupRevenue     — operational income across all subsidiaries (from finance txns)
     • netGroupPosition — totalRaised + groupRevenue − allocated
     • allocationsBySubsidiary[]  — per-company {allocated, income, color}
     • revenueBySubsidiary[]      — per-company income from operations
     • monthlyInflow[]   — capital raised per month (last 6 months)
     • monthlyRevenue[]  — subsidiary income per month (last 6 months)
   ─────────────────────────────────────────────── */
router.get("/treasury/summary", requireSuperAdmin, async (req, res) => {
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

    // ── Allocations from parent → subsidiaries ─────────────────────────────
    let allocated = 0;
    let allocationsBySubsidiary: {
      companyId: number; companyName: string; color: string;
      allocated: number; income: number; netPosition: number;
    }[] = [];

    if (parent) {
      const allocRows = await db
        .select({ companyId: fundAllocationsTable.toCompanyId, total: sql<number>`coalesce(sum(amount), 0)` })
        .from(fundAllocationsTable)
        .where(and(eq(fundAllocationsTable.fromCompanyId, parent.id), eq(fundAllocationsTable.status, "executed")))
        .groupBy(fundAllocationsTable.toCompanyId);
      allocated = allocRows.reduce((s, r) => s + Number(r.total), 0);

      // Per-subsidiary income from their finance module
      const subIds = subsidiaries.map(s => s.id);
      const incomeMap = await subsidiaryIncomeMap(subIds);

      allocationsBySubsidiary = allocRows.map(r => {
        const co = cm[r.companyId];
        const inc = incomeMap[r.companyId] ?? 0;
        const alloc = Number(r.total);
        return {
          companyId: r.companyId,
          companyName: co?.name ?? "Unknown",
          color: co?.color ?? "#6366f1",
          allocated: alloc,
          income: inc,
          netPosition: alloc + inc,
        };
      });
    }

    const totalRaised = Number(raised?.total ?? 0);
    const available = totalRaised - allocated;

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
      allocated,
      available,
      groupRevenue,
      netGroupPosition: totalRaised + groupRevenue - allocated,
      utilizationPercent: totalRaised > 0 ? (allocated / totalRaised) * 100 : 0,
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
   Shape: { totalCapital, allocated, available, utilizationPercent,
            groupRevenue, byCompany[] }
   ─────────────────────────────────────────────── */
router.get("/treasury/working-capital", requireSuperAdmin, async (req, res) => {
  try {
    const [raised] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)));

    const { rows: allCompanies, map: cm } = await companyMap();
    const parent = allCompanies.find(c => c.type === "parent") ?? null;
    const subsidiaries = allCompanies.filter(c => c.type !== "parent");
    const subIds = subsidiaries.map(s => s.id);

    let allocated = 0;
    const allocMap: Record<number, number> = {};

    if (parent) {
      const allocRows = await db
        .select({ companyId: fundAllocationsTable.toCompanyId, total: sql<number>`coalesce(sum(amount), 0)` })
        .from(fundAllocationsTable)
        .where(and(eq(fundAllocationsTable.fromCompanyId, parent.id), eq(fundAllocationsTable.status, "executed")))
        .groupBy(fundAllocationsTable.toCompanyId);
      for (const r of allocRows) { allocMap[r.companyId] = Number(r.total); allocated += Number(r.total); }
    }

    const incomeMap = await subsidiaryIncomeMap(subIds);
    const groupRevenue = Object.values(incomeMap).reduce((s, v) => s + v, 0);
    const totalCapital = Number(raised?.total ?? 0);

    const byCompany = subsidiaries
      .filter(c => (allocMap[c.id] ?? 0) > 0 || (incomeMap[c.id] ?? 0) > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        color: c.color ?? "#6366f1",
        allocated: allocMap[c.id] ?? 0,
        income: incomeMap[c.id] ?? 0,
      }))
      .sort((a, b) => b.allocated - a.allocated);

    res.json({
      totalCapital,
      allocated,
      available: totalCapital - allocated,
      utilizationPercent: totalCapital > 0 ? Math.round((allocated / totalCapital) * 100) : 0,
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
router.get("/treasury/entries", requireSuperAdmin, async (req, res) => {
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
router.post("/treasury/entries", requireSuperAdmin, async (req, res) => {
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
router.patch("/treasury/entries/:id", requireSuperAdmin, async (req, res) => {
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
router.post("/treasury/entries/:id/reverse", requireSuperAdmin, async (req, res) => {
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
