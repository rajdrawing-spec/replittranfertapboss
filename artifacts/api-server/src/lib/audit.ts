import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditEntry {
  userId?: number | null;
  userEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Best-effort audit log write; never throws into the request path. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: entry.userId ?? null,
      userEmail: entry.userEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      description: entry.description ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (e) {
    logger.error({ err: e, action: entry.action }, "Failed to write audit log");
  }
}
