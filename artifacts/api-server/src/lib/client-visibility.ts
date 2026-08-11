import { db, clientVisibilitySettingsTable, clientAuditLogsTable, DEFAULT_CLIENT_VISIBILITY } from "@workspace/db";
import type { ClientVisibilitySettings } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { Request } from "express";

export { DEFAULT_CLIENT_VISIBILITY };
export type { ClientVisibilitySettings };

/** Load effective visibility settings for a project (defaults when unset). */
export async function getClientVisibility(projectId: number): Promise<ClientVisibilitySettings> {
  const [row] = await db.select().from(clientVisibilitySettingsTable)
    .where(eq(clientVisibilitySettingsTable.projectId, projectId));
  // Merge over defaults so newly added keys get sane values on old rows.
  return { ...DEFAULT_CLIENT_VISIBILITY, ...(row?.settings ?? {}) };
}

/**
 * Record a client-portal access event. Fire-and-forget: auditing must never
 * fail or slow down the client request itself.
 */
export function logClientEvent(
  req: Request,
  projectId: number,
  action: string,
  detail?: Record<string, unknown>,
): void {
  const user = (req as any).localUser;
  void Promise.resolve(db.insert(clientAuditLogsTable).values({
    projectId,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    action,
    detail: detail ?? null,
  })).catch((e) => req.log?.error?.(e, "client audit write failed"));
}

/** Latest audit rows for a project (super-admin viewer). */
export async function listClientEvents(projectId: number, limit = 100, offset = 0) {
  return db.select().from(clientAuditLogsTable)
    .where(eq(clientAuditLogsTable.projectId, projectId))
    .orderBy(desc(clientAuditLogsTable.createdAt))
    .limit(limit)
    .offset(offset);
}
