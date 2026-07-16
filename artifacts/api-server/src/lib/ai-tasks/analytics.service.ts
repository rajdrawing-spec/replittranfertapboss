import { db, generatedTasksTable, taskGenerationJobsTable, notificationsTable } from "@workspace/db";
import { and, eq, sql, gte, lt } from "drizzle-orm";

export interface AiTasksAnalytics {
  generatedToday: number;
  completedToday: number;
  approvalRate: number; // 0-100
  regenerationCount: number;
  aiUsage: number; // count of source = ai_customized
  templateUsage: number; // count of source = template
  averageCompletionTimeMs: number | null; // ms
  pendingApproval: number;
  rejectedToday: number;
}

export async function getAnalytics(companyId: number, dateStr: string): Promise<AiTasksAnalytics> {
  const [todayRow] = await db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      approved: sql<number>`count(*) filter (where status = 'approved')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
      aiUsage: sql<number>`count(*) filter (where source = 'ai_customized')`,
      templateUsage: sql<number>`count(*) filter (where source = 'template')`,
      avgCompletionMs: sql<number | null>`avg(extract(epoch from (completed_at - created_at)) * 1000) filter (where status = 'completed')`,
      pending: sql<number>`count(*) filter (where status = 'draft')`,
    })
    .from(generatedTasksTable)
    .where(and(eq(generatedTasksTable.companyId, companyId), eq(generatedTasksTable.generatedDate, dateStr)));

  const [jobsRow] = await db
    .select({ regenerations: sql<number>`count(*) filter (where triggered_by = 'manager')` })
    .from(taskGenerationJobsTable)
    .where(
      and(
        eq(taskGenerationJobsTable.companyId, companyId),
        eq(taskGenerationJobsTable.runDate, dateStr),
      ),
    );

  const total = Number(todayRow?.total ?? 0);
  const approved = Number(todayRow?.approved ?? 0);
  const rejected = Number(todayRow?.rejected ?? 0);
  const decided = approved + rejected;
  const approvalRate = decided > 0 ? Math.round((approved / decided) * 100) : 0;
  const avgCompletionMs = todayRow?.avgCompletionMs ? Math.round(Number(todayRow.avgCompletionMs)) : null;

  return {
    generatedToday: total,
    completedToday: Number(todayRow?.completed ?? 0),
    approvalRate,
    regenerationCount: Number(jobsRow?.regenerations ?? 0),
    aiUsage: Number(todayRow?.aiUsage ?? 0),
    templateUsage: Number(todayRow?.templateUsage ?? 0),
    averageCompletionTimeMs: avgCompletionMs,
    pendingApproval: Number(todayRow?.pending ?? 0),
    rejectedToday: rejected,
  };
}

export async function getHistoricalTrend(companyId: number, days: number) {
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startStr = start.toISOString().slice(0, 10);

  const rows = await db
    .select({
      date: generatedTasksTable.generatedDate,
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      aiUsage: sql<number>`count(*) filter (where source = 'ai_customized')`,
    })
    .from(generatedTasksTable)
    .where(
      and(
        eq(generatedTasksTable.companyId, companyId),
        gte(generatedTasksTable.generatedDate, startStr),
      ),
    )
    .groupBy(generatedTasksTable.generatedDate)
    .orderBy(generatedTasksTable.generatedDate);

  return rows;
}
