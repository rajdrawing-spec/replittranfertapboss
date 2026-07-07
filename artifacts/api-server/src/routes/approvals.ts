import { Router } from "express";
import { db } from "@workspace/db";
import { approvalsTable, companiesTable, fundAllocationsTable, insertApprovalSchema } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { executeFundAllocation } from "../lib/fund-allocation";
import { canAccessCompany } from "../lib/company-scope";

const router = Router();

router.get("/approvals", async (req, res) => {
  try {
    const { status, companyId, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (status) conditions.push(eq(approvalsTable.status, status));
    if (companyId) conditions.push(eq(approvalsTable.companyId, parseInt(companyId)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(approvalsTable).where(where);
    const items = await db.select().from(approvalsTable).where(where).orderBy(desc(approvalsTable.createdAt)).limit(limitNum).offset(offset);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    res.json({ items: items.map(a => fmtApproval(a, companyMap)), total: Number(count), page: pageNum, limit: limitNum });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list approvals" });
  }
});

router.post("/approvals", async (req, res) => {
  try {
    const parsed = insertApprovalSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [a] = await db.insert(approvalsTable).values(parsed.data).returning();
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, a.companyId));
    res.status(201).json(fmtApproval(a, { [a.companyId]: co?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create approval" });
  }
});

router.patch("/approvals/:approvalId/action", async (req, res) => {
  try {
    const id = parseInt(req.params.approvalId);
    const { action, note } = req.body as { action: "approve" | "reject"; note?: string };
    const newStatus = action === "approve" ? "approved" : "rejected";

    const [existing] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Fund allocations move real money + equity, so only a Super Admin or a
    // Company Admin may action them.
    if (existing.type === "fund_allocation") {
      const u = (req as any).localUser as User | undefined;
      if (!u || (u.role !== "super_admin" && u.role !== "company_admin")) {
        res.status(403).json({ error: "Only a Super Admin or Company Admin can approve fund allocations" });
        return;
      }
      // A Company Admin may only action allocations for a company they belong to.
      if (!canAccessCompany(req, existing.companyId)) {
        res.status(403).json({ error: "You are not authorized to action this allocation" });
        return;
      }
    }

    const [a] = await db
      .update(approvalsTable)
      .set({ status: newStatus, approverNote: note ?? null, updatedAt: new Date() })
      .where(eq(approvalsTable.id, id))
      .returning();

    // Propagate the decision to any linked fund allocation.
    if (a.type === "fund_allocation") {
      const [alloc] = await db.select().from(fundAllocationsTable).where(eq(fundAllocationsTable.approvalId, a.id)).limit(1);
      if (alloc && alloc.status === "pending_approval") {
        const u = (req as any).localUser as User | undefined;
        if (newStatus === "approved") {
          await executeFundAllocation(alloc.id, { id: u?.id ?? null, email: u?.email ?? null });
        } else {
          await db.update(fundAllocationsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(fundAllocationsTable.id, alloc.id));
        }
      }
    }

    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, a.companyId));
    res.json(fmtApproval(a, { [a.companyId]: co?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to process approval" });
  }
});

function fmtApproval(a: typeof approvalsTable.$inferSelect, m: Record<number, string>) {
  return {
    id: a.id,
    companyId: a.companyId,
    companyName: m[a.companyId] ?? "Unknown",
    type: a.type,
    title: a.title,
    description: a.description,
    requestedBy: a.requestedBy,
    currentStep: a.currentStep,
    totalSteps: a.totalSteps,
    status: a.status,
    amount: a.amount,
    approverNote: a.approverNote,
    dueDate: a.dueDate,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export default router;
