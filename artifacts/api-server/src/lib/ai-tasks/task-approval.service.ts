import { db, generatedTasksTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { generateDailyTasks } from "./ai-task.service";

export async function approveTask(
  taskId: number,
  companyId: number,
  managerId: number,
): Promise<{ ok: boolean }> {
  const [task] = await db
    .update(generatedTasksTable)
    .set({ status: "approved", approvedBy: managerId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(generatedTasksTable.id, taskId), eq(generatedTasksTable.companyId, companyId)))
    .returning();
  return { ok: !!task };
}

export async function rejectTask(
  taskId: number,
  companyId: number,
): Promise<{ ok: boolean }> {
  const [task] = await db
    .update(generatedTasksTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(generatedTasksTable.id, taskId), eq(generatedTasksTable.companyId, companyId)))
    .returning();
  return { ok: !!task };
}

export async function completeTask(
  taskId: number,
  companyId: number,
  employeeId: number,
): Promise<{ ok: boolean }> {
  const [task] = await db
    .update(generatedTasksTable)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(generatedTasksTable.id, taskId),
        eq(generatedTasksTable.companyId, companyId),
        eq(generatedTasksTable.employeeId, employeeId),
      ),
    )
    .returning();
  return { ok: !!task };
}

export async function approveAll(
  companyId: number,
  runDate: string,
  managerId: number,
): Promise<{ count: number }> {
  const result = await db
    .update(generatedTasksTable)
    .set({ status: "approved", approvedBy: managerId, approvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(generatedTasksTable.companyId, companyId),
        eq(generatedTasksTable.generatedDate, runDate),
        eq(generatedTasksTable.status, "draft"),
      ),
    );
  return { count: Number(result.rowCount ?? 0) };
}

export async function rejectAll(
  companyId: number,
  runDate: string,
): Promise<{ count: number }> {
  const result = await db
    .update(generatedTasksTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(generatedTasksTable.companyId, companyId),
        eq(generatedTasksTable.generatedDate, runDate),
        eq(generatedTasksTable.status, "draft"),
      ),
    );
  return { count: Number(result.rowCount ?? 0) };
}

export async function regenerateTasks(
  companyId: number,
  managerId: number,
): Promise<import("./ai-task.service").GenerateResult> {
  return generateDailyTasks(companyId, managerId, "manager", true);
}

export async function getTaskStats(companyId: number, employeeId: number, runDate: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where status = 'draft')`,
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
      overdue: sql<number>`count(*) filter (where status != 'completed' and due_date < ${runDate})`,
      dueToday: sql<number>`count(*) filter (where due_date = ${runDate} and status != 'completed')`,
      highPriority: sql<number>`count(*) filter (where priority = 'high' and status != 'completed')`,
    })
    .from(generatedTasksTable)
    .where(and(eq(generatedTasksTable.companyId, companyId), eq(generatedTasksTable.employeeId, employeeId)));

  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    completed: Number(row?.completed ?? 0),
    rejected: Number(row?.rejected ?? 0),
    overdue: Number(row?.overdue ?? 0),
    dueToday: Number(row?.dueToday ?? 0),
    highPriority: Number(row?.highPriority ?? 0),
  };
}
