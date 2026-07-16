import { and, eq, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

export async function notifyTasksGenerated(
  companyId: number,
  companyName: string,
  count: number,
  runDate: string,
): Promise<void> {
  if (count <= 0) return;
  await db.insert(notificationsTable).values({
    type: "ai_tasks",
    title: "AI Tasks Generated",
    message: `${count} new task${count === 1 ? "" : "s"} generated for ${runDate}.`,
    severity: "info",
    companyId,
    companyName,
    actionUrl: "/ai-tasks",
    isRead: false,
  });
}

export async function notifyTasksPendingApproval(
  companyId: number,
  companyName: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  await db.insert(notificationsTable).values({
    type: "ai_tasks",
    title: "Tasks Pending Approval",
    message: `${count} generated task${count === 1 ? "" : "s"} awaiting manager approval.`,
    severity: "warning",
    companyId,
    companyName,
    actionUrl: "/ai-tasks",
    isRead: false,
  });
}

export async function getUnreadAiTasksCount(companyId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.companyId, companyId),
        eq(notificationsTable.type, "ai_tasks"),
        eq(notificationsTable.isRead, false),
      ),
    );
  return Number(row?.count ?? 0);
}
