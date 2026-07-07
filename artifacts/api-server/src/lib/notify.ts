import { db, notificationsTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export interface EmitNotificationArgs {
  type: string; // order|payment|inventory|integration|marketing|shipping|hr|security|system
  title: string;
  message: string;
  severity?: NotificationSeverity;
  companyId?: number | null;
  companyName?: string | null;
  actionUrl?: string | null;
}

/**
 * Fire-and-forget notification emitter for real system events.
 *
 * Best-effort by design: a failure here must never break the primary operation
 * that triggered it, so all errors are swallowed (logged to stderr). When a
 * companyId is given but no companyName, the name is resolved automatically.
 */
export async function emitNotification(args: EmitNotificationArgs): Promise<void> {
  try {
    let companyName = args.companyName ?? null;
    if (args.companyId != null && !companyName) {
      const [c] = await db
        .select({ name: companiesTable.name })
        .from(companiesTable)
        .where(eq(companiesTable.id, args.companyId));
      companyName = c?.name ?? null;
    }
    await db.insert(notificationsTable).values({
      type: args.type,
      title: args.title,
      message: args.message,
      severity: args.severity ?? "info",
      companyId: args.companyId ?? null,
      companyName,
      actionUrl: args.actionUrl ?? null,
    });
  } catch (err) {
    // Never let notification failures affect the caller.
    console.error("[notify] emitNotification failed:", err);
  }
}
