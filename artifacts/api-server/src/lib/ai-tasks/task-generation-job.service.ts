import { db, taskGenerationJobsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import type { NewTaskGenerationJob } from "@workspace/db";

export interface JobUpdate {
  status?: "running" | "completed" | "failed";
  completedAt?: Date;
  providerUsed?: string | null;
  tokensUsed?: number | null;
  promptVersion?: string;
  executionTimeMs?: number;
  batchSize?: number;
  tasksGenerated?: number;
  nextRun?: Date | null;
  retryCount?: number;
  maxRetries?: number;
  error?: string | null;
}

export async function startJob(
  companyId: number,
  runDate: string,
  requesterId: number | undefined,
  triggeredBy: "scheduler" | "manager",
): Promise<{ id: number }> {
  const [job] = await db
    .insert(taskGenerationJobsTable)
    .values({
      companyId,
      runDate,
      status: "running",
      requesterId,
      triggeredBy,
      startedAt: new Date(),
      retryCount: 0,
      maxRetries: 1,
    } as NewTaskGenerationJob)
    .returning({ id: taskGenerationJobsTable.id });
  return job;
}

export async function updateJob(jobId: number, data: JobUpdate): Promise<void> {
  await db
    .update(taskGenerationJobsTable)
    .set(data)
    .where(eq(taskGenerationJobsTable.id, jobId));
}

export async function completeJob(
  jobId: number,
  data: Omit<JobUpdate, "status" | "completedAt">,
): Promise<void> {
  await updateJob(jobId, {
    ...data,
    status: "completed",
    completedAt: new Date(),
  });
}

export async function failJob(jobId: number, error: string): Promise<void> {
  await updateJob(jobId, {
    status: "failed",
    completedAt: new Date(),
    error,
  });
}

export async function getJob(jobId: number) {
  const [job] = await db
    .select()
    .from(taskGenerationJobsTable)
    .where(eq(taskGenerationJobsTable.id, jobId))
    .limit(1);
  return job;
}

export async function listJobs(companyId: number, limit = 20) {
  return db
    .select()
    .from(taskGenerationJobsTable)
    .where(eq(taskGenerationJobsTable.companyId, companyId))
    .orderBy(desc(taskGenerationJobsTable.startedAt))
    .limit(limit);
}

export async function hasRunForDate(companyId: number, runDate: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskGenerationJobsTable)
    .where(
      and(
        eq(taskGenerationJobsTable.companyId, companyId),
        eq(taskGenerationJobsTable.runDate, runDate),
        eq(taskGenerationJobsTable.status, "completed"),
      ),
    )
    .limit(1);
  return Number(row?.count ?? 0) > 0;
}

export async function countRegenerationsToday(companyId: number, runDate: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskGenerationJobsTable)
    .where(
      and(
        eq(taskGenerationJobsTable.companyId, companyId),
        eq(taskGenerationJobsTable.runDate, runDate),
        eq(taskGenerationJobsTable.triggeredBy, "manager"),
      ),
    )
    .limit(1);
  return Number(row?.count ?? 0);
}

export async function setJobRetryCount(jobId: number, retryCount: number): Promise<void> {
  await db
    .update(taskGenerationJobsTable)
    .set({ retryCount })
    .where(eq(taskGenerationJobsTable.id, jobId));
}
