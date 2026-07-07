import { Router } from "express";
import { db, fundAllocationsTable, companiesTable, approvalsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, or, inArray, desc, sql } from "drizzle-orm";
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
      const [appr] = await db.insert(approvalsTable).values({
        companyId: to,
        type: "fund_allocation",
        title: `Fund allocation: ₹${Math.round(amt).toLocaleString("en-IN")} to ${toCo.name}`,
        description: `${fromCo.name} → ${toCo.name}. Purpose: ${cleanPurpose}.${equity ? ` Equity change: +${equity}% stake for ${fromCo.name}.` : ""}`,
        requestedBy: u.name,
        amount: amt,
        currentStep: 1,
        totalSteps: 1,
        status: "pending",
      }).returning();
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
