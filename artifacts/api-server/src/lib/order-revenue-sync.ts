import { db, transactionsTable } from "@workspace/db";
import type { Order } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { emitNotification } from "./notify";

// A sale's revenue is recognised once the order is delivered; a refund/return
// reverses previously-recognised revenue. Both bookings are keyed by a
// deterministic reference so the sync is idempotent no matter how many times an
// order is updated.
const REVENUE_STATUSES = new Set(["delivered"]);
const REVERSAL_STATUSES = new Set(["refunded", "returned"]);

async function txExists(referenceNumber: string, category: string): Promise<boolean> {
  const rows = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.referenceNumber, referenceNumber), eq(transactionsTable.category, category)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Keep finance in sync with an order's lifecycle. Best-effort: a failure here
 * must never break the order write that triggered it.
 */
export async function syncOrderRevenue(order: Order): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const revRef = `ORDER-${order.orderNumber}`;

    if (REVENUE_STATUSES.has(order.status)) {
      if (await txExists(revRef, "Sales Revenue")) return;
      // onConflictDoNothing + the partial unique index on (reference_number,
      // category) makes this safe against concurrent order updates: a duplicate
      // simply inserts nothing, and we only notify when a row was created.
      const inserted = await db.insert(transactionsTable).values({
        companyId: order.companyId,
        type: "income",
        category: "Sales Revenue",
        amount: order.totalAmount,
        description: `Revenue from order ${order.orderNumber} (${order.customerName})`,
        referenceNumber: revRef,
        paymentMethod: "bank_transfer",
        status: "completed",
        date: today,
      }).onConflictDoNothing().returning({ id: transactionsTable.id });
      if (inserted.length === 0) return;
      void emitNotification({
        type: "payment", severity: "success", companyId: order.companyId,
        title: "Sales Revenue Recorded",
        message: `₹${Math.round(order.totalAmount).toLocaleString("en-IN")} from order ${order.orderNumber} added to finance.`,
        actionUrl: "/finance",
      });
      return;
    }

    if (REVERSAL_STATUSES.has(order.status)) {
      // Only reverse if revenue was actually recognised, and only once.
      if (!(await txExists(revRef, "Sales Revenue"))) return;
      const refundRef = `REFUND-${order.orderNumber}`;
      if (await txExists(refundRef, "Refund")) return;
      await db.insert(transactionsTable).values({
        companyId: order.companyId,
        type: "expense",
        category: "Refund",
        amount: order.totalAmount,
        description: `Refund/return reversal for order ${order.orderNumber}`,
        referenceNumber: refundRef,
        paymentMethod: "bank_transfer",
        status: "completed",
        date: today,
      }).onConflictDoNothing();
    }
  } catch (e) {
    console.error("[order-sync] syncOrderRevenue failed:", e);
  }
}
