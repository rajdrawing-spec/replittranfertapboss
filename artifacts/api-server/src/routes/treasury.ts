/**
 * Treasury routes — TapasHub main treasury management.
 *
 * All routes are super-admin only: the treasury is the parent company's
 * capital ledger and must not be writable by subsidiary staff.
 *
 * GET  /treasury/summary          Live balance (raised − allocated)
 * GET  /treasury/entries          List entries (paginated, filtered)
 * POST /treasury/entries          Create new funding entry
 * PATCH /treasury/entries/:id     Edit an entry (audit-logged)
 * POST /treasury/entries/:id/reverse  Soft-reverse an entry
 */

import { Router } from "express";
import { db, treasuryEntriesTable, fundAllocationsTable, companiesTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";
import { writeAudit } from "../lib/audit";

const router = Router();

/* ─────────────────────────────────────────────
   GET /treasury/summary
   ─────────────────────────────────────────────── */
router.get("/treasury/summary", requireSuperAdmin, async (req, res) => {
  try {
    // Total capital raised = all approved, non-reversed entries
    const [raised] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)));

    // Find parent company id
    const [parent] = await db
      .select({ id: companiesTable.id, name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.type, "parent"))
      .limit(1);

    // Total executed allocations from parent → subsidiaries
    let allocated = 0;
    if (parent) {
      const [allocStat] = await db
        .select({ total: sql<number>`coalesce(sum(amount), 0)` })
        .from(fundAllocationsTable)
        .where(and(eq(fundAllocationsTable.fromCompanyId, parent.id), eq(fundAllocationsTable.status, "executed")));
      allocated = Number(allocStat?.total ?? 0);
    }

    const totalRaised = Number(raised?.total ?? 0);
    const available   = totalRaised - allocated;

    // Breakdown by funding source
    const bySource = await db
      .select({
        fundingSource: treasuryEntriesTable.fundingSource,
        total: sql<number>`coalesce(sum(amount), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "approved"), eq(treasuryEntriesTable.isReversed, false)))
      .groupBy(treasuryEntriesTable.fundingSource);

    // Allocation breakdown by subsidiary
    let allocationsBySubsidiary: { companyId: number; companyName: string; total: number }[] = [];
    if (parent) {
      const rows = await db
        .select({
          companyId: fundAllocationsTable.toCompanyId,
          total: sql<number>`coalesce(sum(amount), 0)`,
        })
        .from(fundAllocationsTable)
        .where(and(eq(fundAllocationsTable.fromCompanyId, parent.id), eq(fundAllocationsTable.status, "executed")))
        .groupBy(fundAllocationsTable.toCompanyId);

      const allCos = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
      const cm = Object.fromEntries(allCos.map(c => [c.id, c.name]));
      allocationsBySubsidiary = rows.map(r => ({
        companyId: r.companyId,
        companyName: cm[r.companyId] ?? "Unknown",
        total: Number(r.total),
      }));
    }

    // Monthly inflow for the last 6 months
    const now = new Date();
    const monthlyInflow = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(amount), 0)` })
        .from(treasuryEntriesTable)
        .where(
          and(
            eq(treasuryEntriesTable.status, "approved"),
            eq(treasuryEntriesTable.isReversed, false),
            sql`date >= ${d.toISOString().slice(0, 10)}`,
            sql`date < ${nextD.toISOString().slice(0, 10)}`,
          ),
        );
      monthlyInflow.push({
        label: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
        amount: Number(row?.total ?? 0),
      });
    }

    // Pending entries
    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(amount), 0)` })
      .from(treasuryEntriesTable)
      .where(and(eq(treasuryEntriesTable.status, "pending"), eq(treasuryEntriesTable.isReversed, false)));

    res.json({
      totalRaised,
      allocated,
      available,
      pendingCount: Number(pendingRow?.count ?? 0),
      pendingAmount: Number(pendingRow?.total ?? 0),
      utilizationPercent: totalRaised > 0 ? (allocated / totalRaised) * 100 : 0,
      parentCompany: parent ?? null,
      bySource: bySource.map(s => ({ fundingSource: s.fundingSource, total: Number(s.total), count: Number(s.count) })),
      allocationsBySubsidiary,
      monthlyInflow,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get treasury summary" });
  }
});

/* ─────────────────────────────────────────────
   GET /treasury/entries
   ─────────────────────────────────────────────── */
router.get("/treasury/entries", requireSuperAdmin, async (req, res) => {
  try {
    const { status, fundingSource, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(treasuryEntriesTable.isReversed, false)];
    if (status && status !== "all") conditions.push(eq(treasuryEntriesTable.status, status));
    if (fundingSource && fundingSource !== "all") conditions.push(eq(treasuryEntriesTable.fundingSource, fundingSource));
    const where = and(...conditions);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(treasuryEntriesTable).where(where);
    const items = await db.select().from(treasuryEntriesTable).where(where).orderBy(desc(treasuryEntriesTable.date), desc(treasuryEntriesTable.createdAt)).limit(limitNum).offset(offset);

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

    if (!fundingSource || !fundingSource.trim()) { res.status(400).json({ error: "Funding source is required" }); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "Amount must be greater than zero" }); return; }
    if (!date || !description?.trim()) { res.status(400).json({ error: "Date and description are required" }); return; }

    const entryStatus = status === "pending" ? "pending" : "approved";

    const [entry] = await db.insert(treasuryEntriesTable).values({
      fundingSource: fundingSource.trim(),
      investorName: investorName?.trim() || null,
      amount: amt,
      date: date.trim(),
      currency: (currency?.trim()) || "INR",
      paymentMethod: paymentMethod?.trim() || null,
      referenceNumber: referenceNumber?.trim() || null,
      description: description.trim(),
      notes: notes?.trim() || null,
      status: entryStatus,
      createdById: u.id,
      createdByName: u.name,
      approvedByName: entryStatus === "approved" ? u.name : null,
      approvedAt: entryStatus === "approved" ? new Date() : null,
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
    const u = (req as any).localUser as User;

    const [existing] = await db.select().from(treasuryEntriesTable).where(eq(treasuryEntriesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Entry not found" }); return; }
    if (existing.isReversed) { res.status(400).json({ error: "Reversed entries cannot be edited" }); return; }

    const changes: Record<string, { from: unknown; to: unknown }> = {};

    // Build a typed partial update
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
    const u = (req as any).localUser as User;
    const { reason } = req.body ?? {};

    const [existing] = await db.select().from(treasuryEntriesTable).where(eq(treasuryEntriesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Entry not found" }); return; }
    if (existing.isReversed) { res.status(400).json({ error: "Entry is already reversed" }); return; }

    const [updated] = await db.update(treasuryEntriesTable).set({
      isReversed: true,
      reversedAt: new Date(),
      reversedByName: u.name,
      reversalReason: reason?.trim() || "Reversed by administrator",
      updatedAt: new Date(),
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
    fundingSource: e.fundingSource,
    investorName: e.investorName,
    amount: e.amount,
    date: e.date,
    currency: e.currency,
    paymentMethod: e.paymentMethod,
    referenceNumber: e.referenceNumber,
    description: e.description,
    notes: e.notes,
    status: e.status,
    isReversed: e.isReversed,
    reversedAt: e.reversedAt?.toISOString() ?? null,
    reversedByName: e.reversedByName,
    reversalReason: e.reversalReason,
    createdById: e.createdById,
    createdByName: e.createdByName,
    approvedByName: e.approvedByName,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export default router;
