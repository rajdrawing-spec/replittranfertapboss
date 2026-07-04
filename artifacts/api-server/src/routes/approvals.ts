import { Router } from "express";
import { db } from "@workspace/db";
import { approvalsTable, companiesTable, insertApprovalSchema } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

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
    const [a] = await db
      .update(approvalsTable)
      .set({ status: newStatus, approverNote: note ?? null, updatedAt: new Date() })
      .where(eq(approvalsTable.id, id))
      .returning();
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
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
