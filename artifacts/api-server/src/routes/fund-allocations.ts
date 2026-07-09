import { Router } from "express";
import { db, fundAllocationsTable, companiesTable, approvalsTable, usersTable, shareholdersTable, transactionsTable } from "@workspace/db";
import type { User, RequiredApprover } from "@workspace/db";
import { eq, and, or, inArray, desc, sql, isNotNull, ne } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";
import { companyScope } from "../lib/company-scope";
import { executeFundAllocation } from "../lib/fund-allocation";
import { FUND_APPROVAL_THRESHOLD } from "../lib/finance-config";
import { emitNotification } from "../lib/notify";
import { writeAudit } from "../lib/audit";

const router = Router();

router.get("/fund-allocations", async (req, res) => {
  try {
    const { status, companyId, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Tenant scoping: Super Admin sees all; scoped staff only see allocations
    // that touch one of their companies (as source or recipient).
    const scope = companyScope(req);
    if (scope !== null && scope.length === 0) {
      res.json({ items: [], total: 0, page: pageNum, limit: limitNum, threshold: FUND_APPROVAL_THRESHOLD });
      return;
    }

    const conditions = [];
    if (status) conditions.push(eq(fundAllocationsTable.status, status));
    if (companyId) {
      const cid = parseInt(companyId);
      conditions.push(or(eq(fundAllocationsTable.fromCompanyId, cid), eq(fundAllocationsTable.toCompanyId, cid)));
    }
    if (scope !== null) {
      conditions.push(or(inArray(fundAllocationsTable.fromCompanyId, scope), inArray(fundAllocationsTable.toCompanyId, scope)));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(fundAllocationsTable).where(where);
    const items = await db.select().from(fundAllocationsTable).where(where).orderBy(desc(fundAllocationsTable.createdAt)).limit(limitNum).offset(offset);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const m = Object.fromEntries(companies.map(c => [c.id, c.name]));

    res.json({ items: items.map(a => fmt(a, m)), total: Number(count), page: pageNum, limit: limitNum, threshold: FUND_APPROVAL_THRESHOLD });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list fund allocations" });
  }
});

router.get("/fund-allocations/threshold", (_req, res) => {
  res.json({ threshold: FUND_APPROVAL_THRESHOLD });
});

router.post("/fund-allocations", requireSuperAdmin, async (req, res) => {
  try {
    const u = (req as any).localUser as User;
    const { fromCompanyId, toCompanyId, amount, purpose, note, equityChangePercent } = req.body ?? {};
    const from = parseInt(fromCompanyId);
    const to = parseInt(toCompanyId);
    const amt = Number(amount);

    if (!Number.isFinite(from) || !Number.isFinite(to)) { res.status(400).json({ error: "Source and recipient companies are required" }); return; }
    if (from === to) { res.status(400).json({ error: "Source and recipient must be different companies" }); return; }
    if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "Amount must be greater than zero" }); return; }

    const rawEquity = equityChangePercent;
    const equity = rawEquity === undefined || rawEquity === null || rawEquity === "" ? null : Number(rawEquity);
    if (equity !== null && (!Number.isFinite(equity) || equity < 0 || equity > 100)) { res.status(400).json({ error: "Equity change must be between 0 and 100" }); return; }

    const [fromCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, from)).limit(1);
    const [toCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, to)).limit(1);
    if (!fromCo || !toCo) { res.status(404).json({ error: "Company not found" }); return; }

    const cleanPurpose = (purpose?.toString().trim()) || "Working capital";
    const requiresApproval = amt >= FUND_APPROVAL_THRESHOLD || (equity !== null && equity > 0);

    const [alloc] = await db.insert(fundAllocationsTable).values({
      fromCompanyId: from,
      toCompanyId: to,
      amount: amt,
      purpose: cleanPurpose,
      note: (note?.toString().trim()) || null,
      equityChangePercent: equity,
      status: "pending_approval",
      requestedById: u.id,
      requestedByName: u.name,
    }).returning();

    const nameMap = { [from]: fromCo.name, [to]: toCo.name };

    if (requiresApproval) {
      // Build required-approver list: ALL directors with access to the recipient
      // company + ALL active shareholders of that company who have an email.
      // Every person in this list must approve before the allocation is executed.
      const [directors, rawShareholders] = await Promise.all([
        db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.status, "active"),
              // Primary role OR extra_roles contains "director"
              or(
                eq(usersTable.role, "director"),
                sql`${usersTable.extraRoles}::jsonb @> '["director"]'::jsonb`,
              ),
              // Must have access to the recipient company
              sql`${usersTable.companyIds}::jsonb @> ${JSON.stringify([to])}::jsonb`,
            ),
          ),
        db.select({ name: shareholdersTable.name, email: shareholdersTable.email })
          .from(shareholdersTable)
          .where(
            and(
              eq(shareholdersTable.companyId, to),
              eq(shareholdersTable.status, "active"),
              isNotNull(shareholdersTable.email),
            ),
          ),
      ]);

      // Normalize emails (lowercase + trim) before deduplicating so that
      // "User@Co.com" and "user@co.com" are treated as the same approver.
      const seen = new Set<string>();
      const requiredApprovers: RequiredApprover[] = [];
      for (const d of directors) {
        const email = d.email?.trim().toLowerCase();
        if (email && !seen.has(email)) {
          seen.add(email);
          requiredApprovers.push({ name: d.name, email, role: "director" });
        }
      }
      for (const s of rawShareholders) {
        const email = s.email?.trim().toLowerCase();
        if (email && !seen.has(email)) {
          seen.add(email);
          requiredApprovers.push({ name: s.name, email, role: "shareholder" });
        }
      }

      const [appr] = await db.insert(approvalsTable).values({
        companyId: to,
        type: "fund_allocation",
        title: `Fund allocation: ₹${Math.round(amt).toLocaleString("en-IN")} to ${toCo.name}`,
        description: `${fromCo.name} → ${toCo.name}. Purpose: ${cleanPurpose}.${equity ? ` Equity change: +${equity}% stake for ${fromCo.name}.` : ""}`,
        requestedBy: u.name,
        amount: amt,
        currentStep: 1,
        totalSteps: requiredApprovers.length || 1,
        status: "pending",
        requiredApprovers,
      }).returning();

      // Seed individual vote rows so the UI can show who is pending/approved.
      if (requiredApprovers.length > 0) {
        await db.execute(sql`
          INSERT INTO approval_votes (approval_id, voter_name, voter_email, voter_role, decision)
          SELECT ${appr.id}, v.name, v.email, v.role, 'pending'
          FROM jsonb_to_recordset(${JSON.stringify(requiredApprovers)}::jsonb)
            AS v(name text, email text, role text)
          ON CONFLICT (approval_id, voter_email) DO NOTHING
        `);
      }

      const [updated] = await db.update(fundAllocationsTable).set({ approvalId: appr.id, updatedAt: new Date() }).where(eq(fundAllocationsTable.id, alloc.id)).returning();

      void writeAudit({
        userId: u.id, userEmail: u.email, action: "fund_allocation.requested", targetType: "fund_allocation", targetId: String(alloc.id),
        description: `Requested allocation of ₹${Math.round(amt).toLocaleString("en-IN")} from ${fromCo.name} to ${toCo.name} (pending approval)`,
        metadata: { amount: amt, equityChangePercent: equity },
      });
      void emitNotification({
        type: "payment", severity: "warning", companyId: to, companyName: toCo.name,
        title: "Fund Allocation Awaiting Approval",
        message: `₹${Math.round(amt).toLocaleString("en-IN")} to ${toCo.name} needs director approval before release.`,
        actionUrl: "/approvals",
      });
      res.status(201).json(fmt(updated, nameMap));
      return;
    }

    // Under threshold, no equity change → execute immediately.
    const executed = await executeFundAllocation(alloc.id, { id: u.id, email: u.email });
    res.status(201).json(fmt(executed ?? alloc, nameMap));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create fund allocation" });
  }
});

// PATCH /fund-allocations/:id — edit a pending allocation (super admin only).
// Only pending_approval records may be changed; executed/rejected/cancelled are immutable.
// Allowed fields: amount, purpose, note, equityChangePercent.
// The linked approval record (if any) is kept in sync.
router.patch("/fund-allocations/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const u = (req as any).localUser as User;
    const { amount, purpose, note, equityChangePercent } = req.body ?? {};

    const [existing] = await db.select().from(fundAllocationsTable).where(eq(fundAllocationsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "pending_approval") {
      res.status(400).json({ error: "Only pending allocations can be edited" }); return;
    }

    const updates: Partial<typeof fundAllocationsTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };

    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: "Amount must be greater than zero" }); return; }
      updates.amount = amt;
    }
    if (purpose !== undefined) updates.purpose = (purpose?.toString().trim()) || "Working capital";
    if (note !== undefined) updates.note = (note?.toString().trim()) || null;
    if (equityChangePercent !== undefined) {
      const pct = equityChangePercent === null || equityChangePercent === "" ? null : Number(equityChangePercent);
      if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
        res.status(400).json({ error: "Equity change must be between 0 and 100" }); return;
      }
      updates.equityChangePercent = pct;
    }

    const [updated] = await db.update(fundAllocationsTable).set(updates).where(eq(fundAllocationsTable.id, id)).returning();

    // Keep the linked approval record in sync — best-effort: a sync failure must
    // not roll back the already-committed allocation update or return 500 to the client.
    if (existing.approvalId) {
      try {
        const coRows = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable)
          .where(inArray(companiesTable.id, [updated.fromCompanyId, updated.toCompanyId]));
        const cm = Object.fromEntries(coRows.map(c => [c.id, c.name]));
        const fromName = cm[updated.fromCompanyId] ?? "Unknown";
        const toName = cm[updated.toCompanyId] ?? "Unknown";
        const pct = updated.equityChangePercent;
        await db.update(approvalsTable)
          .set({
            title: `Fund allocation: ₹${Math.round(updated.amount).toLocaleString("en-IN")} to ${toName}`,
            description: `${fromName} → ${toName}. Purpose: ${updated.purpose}.${pct ? ` Equity change: +${pct}% stake for ${fromName}.` : ""}`,
            updatedAt: new Date(),
          })
          .where(eq(approvalsTable.id, existing.approvalId));
      } catch (syncErr) {
        req.log.warn({ err: syncErr, approvalId: existing.approvalId }, "Fund allocation updated but approval record sync failed");
      }
    }

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const m = Object.fromEntries(companies.map(c => [c.id, c.name]));

    void writeAudit({
      userId: u.id, userEmail: u.email,
      action: "fund_allocation.updated", targetType: "fund_allocation", targetId: String(id),
      description: `Updated pending allocation #${id}`,
      metadata: updates as Record<string, unknown>,
    });

    res.json(fmt(updated, m));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update fund allocation" });
  }
});

// POST /fund-allocations/:id/cancel
// Atomic soft-cancel of a fund allocation.
//
// Uses a database transaction with SELECT ... FOR UPDATE to prevent a race
// between this cancellation and a concurrent approval-execution that might be
// populating the linked transaction IDs at the same moment.  All state changes
// (allocation status + linked transaction statuses) commit together or not at all.
router.post("/fund-allocations/:id/cancel", requireSuperAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  const u = (req as any).localUser as User;
  const { reason } = req.body ?? {};

  let cancelledRow: typeof fundAllocationsTable.$inferSelect | undefined;
  let previousStatus = "";
  let previousAmount = 0;

  try {
    await db.transaction(async (tx) => {
      // Lock the allocation row so concurrent approval-execution cannot modify it
      // between our read and our write.
      const locked = await tx.execute<{
        id: number; status: string;
        from_transaction_id: number | null;
        to_transaction_id: number | null;
        amount: number;
      }>(sql`
        SELECT id, status, from_transaction_id, to_transaction_id, amount
        FROM   fund_allocations
        WHERE  id = ${id}
        FOR UPDATE
      `);
      const existing = locked.rows[0];
      if (!existing) throw Object.assign(new Error("Not found"), { code: 404 });
      if (existing.status === "cancelled") throw Object.assign(new Error("Allocation is already cancelled"), { code: 400 });

      previousStatus = existing.status;
      previousAmount = existing.amount;

      // Atomically set status to 'cancelled' (extra guard: only if not already cancelled)
      const [cancelled] = await tx
        .update(fundAllocationsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(fundAllocationsTable.id, id), ne(fundAllocationsTable.status, "cancelled")))
        .returning();
      if (!cancelled) throw Object.assign(new Error("Allocation was already cancelled"), { code: 409 });
      cancelledRow = cancelled;

      // Re-read linked TX IDs from the locked row (they may have been set by a
      // concurrent execution that ran between our outer SELECT and this point).
      const txIds = [existing.from_transaction_id, existing.to_transaction_id]
        .filter((x): x is number => x != null);
      if (txIds.length > 0) {
        await tx
          .update(transactionsTable)
          .set({ status: "cancelled" })
          .where(inArray(transactionsTable.id, txIds));
      }
    });
  } catch (e: any) {
    const status = e?.code === 404 ? 404 : e?.code === 400 ? 400 : e?.code === 409 ? 409 : 500;
    if (status === 500) req.log.error(e);
    res.status(status).json({ error: e.message ?? "Failed to cancel fund allocation" });
    return;
  }

  void writeAudit({
    userId: u.id, userEmail: u.email,
    action: "fund_allocation.cancelled", targetType: "fund_allocation", targetId: String(id),
    description: `Cancelled fund allocation #${id}: ₹${Math.round(previousAmount).toLocaleString("en-IN")}. Reason: ${reason?.trim() || "None provided"}`,
    metadata: { amount: previousAmount, previousStatus, reason: reason || null },
  });

  const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
  const m = Object.fromEntries(companies.map(c => [c.id, c.name]));
  res.json(fmt(cancelledRow!, m));
});

function fmt(a: typeof fundAllocationsTable.$inferSelect, m: Record<number, string>) {
  return {
    id: a.id,
    fromCompanyId: a.fromCompanyId,
    fromCompanyName: m[a.fromCompanyId] ?? "Unknown",
    toCompanyId: a.toCompanyId,
    toCompanyName: m[a.toCompanyId] ?? "Unknown",
    amount: a.amount,
    purpose: a.purpose,
    note: a.note,
    equityChangePercent: a.equityChangePercent,
    status: a.status,
    approvalId: a.approvalId,
    fromTransactionId: a.fromTransactionId,
    toTransactionId: a.toTransactionId,
    requestedById: a.requestedById,
    requestedByName: a.requestedByName,
    executedAt: a.executedAt ? a.executedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export default router;
