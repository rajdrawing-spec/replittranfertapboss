import { db, transactionsTable, companiesTable, fundAllocationsTable } from "@workspace/db";
import type { FundAllocation } from "@workspace/db";
import { eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import { emitNotification } from "./notify";

interface Actor {
  id?: number | null;
  email?: string | null;
}

/**
 * Atomically execute a pending fund allocation:
 *   - a `transfer` out of the parent company
 *   - a matching `income` (Capital Injection) into the subsidiary
 *   - an optional equity stake increase for the parent
 *
 * Idempotent: an allocation that is already executed/rejected/cancelled is a
 * no-op and returns its current row. Only a `pending_approval` row is executed.
 * Audit + notifications fire only when execution actually happens, after commit.
 */
export async function executeFundAllocation(allocationId: number, actor?: Actor): Promise<FundAllocation | null> {
  const outcome = await db.transaction(async (tx) => {
    // Lock the row for the life of the transaction so two concurrent
    // executions can't both pass the pending check and double-book funds.
    const [alloc] = await tx.select().from(fundAllocationsTable).where(eq(fundAllocationsTable.id, allocationId)).for("update").limit(1);
    if (!alloc) return { allocation: null as FundAllocation | null, executedNow: false, fromName: "", toName: "" };
    if (alloc.status !== "pending_approval") return { allocation: alloc, executedNow: false, fromName: "", toName: "" };

    const [fromCo] = await tx.select().from(companiesTable).where(eq(companiesTable.id, alloc.fromCompanyId)).limit(1);
    const [toCo] = await tx.select().from(companiesTable).where(eq(companiesTable.id, alloc.toCompanyId)).limit(1);
    const ref = `ALLOC-${alloc.id}`;
    const today = new Date().toISOString().slice(0, 10);

    const [outTx] = await tx.insert(transactionsTable).values({
      companyId: alloc.fromCompanyId,
      type: "transfer",
      category: "Fund Allocation",
      amount: alloc.amount,
      description: `Fund allocation to ${toCo?.name ?? "subsidiary"} — ${alloc.purpose}`,
      referenceNumber: ref,
      paymentMethod: "bank_transfer",
      status: "completed",
      date: today,
    }).returning();

    const [inTx] = await tx.insert(transactionsTable).values({
      companyId: alloc.toCompanyId,
      type: "income",
      category: "Capital Injection",
      amount: alloc.amount,
      description: `Capital from ${fromCo?.name ?? "parent"} — ${alloc.purpose}`,
      referenceNumber: ref,
      paymentMethod: "bank_transfer",
      status: "completed",
      date: today,
    }).returning();

    if (alloc.equityChangePercent && alloc.equityChangePercent !== 0 && toCo) {
      const next = Math.min(100, Math.max(0, (toCo.ownershipPercent ?? 0) + alloc.equityChangePercent));
      await tx.update(companiesTable).set({ ownershipPercent: next, updatedAt: new Date() }).where(eq(companiesTable.id, alloc.toCompanyId));
    }

    const [updated] = await tx.update(fundAllocationsTable).set({
      status: "executed",
      fromTransactionId: outTx.id,
      toTransactionId: inTx.id,
      executedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(fundAllocationsTable.id, alloc.id)).returning();

    return { allocation: updated, executedNow: true, fromName: fromCo?.name ?? "Parent", toName: toCo?.name ?? "Subsidiary" };
  });

  if (outcome.executedNow && outcome.allocation) {
    const a = outcome.allocation;
    void writeAudit({
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      action: "fund_allocation.executed",
      targetType: "fund_allocation",
      targetId: String(a.id),
      description: `Allocated ₹${Math.round(a.amount).toLocaleString("en-IN")} from ${outcome.fromName} to ${outcome.toName}`,
      metadata: { amount: a.amount, equityChangePercent: a.equityChangePercent ?? null },
    });
    void emitNotification({
      type: "payment", severity: "success", companyId: a.toCompanyId, companyName: outcome.toName,
      title: "Funds Received",
      message: `${outcome.toName} received ₹${Math.round(a.amount).toLocaleString("en-IN")} from ${outcome.fromName}.`,
      actionUrl: "/finance",
    });
  }

  return outcome.allocation;
}
