import { schedule, type ScheduledTask } from "node-cron";
import { db, companiesTable, schedulerLocksTable, taskGenerationJobsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { generateDailyTasks } from "./ai-task.service";
import { getAiTasksConfig } from "./config.service";
import { getCompanySettings, isWorkingDay } from "./ai-task-settings.service";
import { logger } from "../logger";

interface CompanyJob {
  companyId: number;
  timezone: string;
  time: string;
  task: ScheduledTask;
}

let companyJobs: CompanyJob[] = [];
let isRunning = false;

function crontabFromTime(time: string): string {
  const [hour, minute] = time.split(":").map((s) => parseInt(s, 10));
  const h = isNaN(hour) ? 8 : hour;
  const m = isNaN(minute) ? 0 : minute;
  return `${m} ${h} * * *`;
}

export async function startAiTaskScheduler(): Promise<void> {
  stopAiTaskScheduler();

  const config = await getAiTasksConfig();
  if (!config.enableScheduler) {
    logger.info("AI task scheduler is disabled");
    return;
  }

  const companies = await db.select().from(companiesTable);
  logger.info({ companyCount: companies.length }, "Scheduling AI task generation per company");

  for (const company of companies) {
    try {
      const settings = await getCompanySettings(company.id);
      const time = company.generationTime || settings.generationTime || config.generationTime || "08:00";
      const timezone = company.timezone || settings.timezone || "UTC";
      const cron = crontabFromTime(time);

      const task = schedule(
        cron,
        async () => {
          try {
            await runScheduledGenerationForCompany(company.id, company.name || "");
          } catch (e) {
            logger.error({ err: e, companyId: company.id }, "Scheduled AI task generation failed");
          }
        },
        { timezone },
      );

      companyJobs.push({ companyId: company.id, timezone, time, task });
      logger.info({ companyId: company.id, cron, timezone, time }, "Scheduled AI task generation for company");
    } catch (e) {
      logger.error({ err: e, companyId: company.id }, "Failed to schedule AI task generation for company");
    }
  }
}

export function stopAiTaskScheduler(): void {
  for (const job of companyJobs) {
    job.task.stop();
  }
  companyJobs = [];
}

export async function runScheduledGenerationForCompany(companyId: number, companyName: string): Promise<void> {
  const runtimeConfig = await getAiTasksConfig();
  if (!runtimeConfig.enableScheduler) {
    logger.info({ companyId }, "AI task scheduler skipped: disabled at runtime");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const settings = await getCompanySettings(companyId);

  if (!(await isWorkingDay(companyId, today))) {
    logger.info({ companyId, today }, "AI task generation skipped: non-working day");
    return;
  }

  if (isRunning) {
    logger.info({ companyId }, "AI task generation already in progress for this process");
  }
  isRunning = true;
  try {
    const lock = await acquireLock(companyId);
    if (!lock) {
      logger.info({ companyId }, "AI task generation skipped: lock held by another process");
      return;
    }

    try {
      const result = await generateDailyTasks(companyId, undefined, "scheduler");
      logger.info({ companyId, ...result }, "Scheduled generation completed for company");
      if (result.status === "failed" && result.jobId) {
        await retryFailedJobOnce(companyId, companyName, result.jobId);
      }
    } finally {
      await releaseLock(companyId);
    }
  } finally {
    isRunning = false;
  }
}

async function acquireLock(companyId: number): Promise<boolean> {
  // Expire stale locks older than 5 minutes
  const now = new Date();
  await db
    .delete(schedulerLocksTable)
    .where(lt(schedulerLocksTable.expiresAt, now));

  try {
    await db.insert(schedulerLocksTable).values({
      companyId,
      lockedAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    });
    return true;
  } catch (e) {
    // Unique constraint violation means lock is held
    return false;
  }
}

async function releaseLock(companyId: number): Promise<void> {
  await db.delete(schedulerLocksTable).where(eq(schedulerLocksTable.companyId, companyId));
}

async function retryFailedJobOnce(companyId: number, companyName: string, jobId: number): Promise<void> {
  const [job] = await db
    .select({ retryCount: taskGenerationJobsTable.retryCount, maxRetries: taskGenerationJobsTable.maxRetries })
    .from(taskGenerationJobsTable)
    .where(eq(taskGenerationJobsTable.id, jobId))
    .limit(1);
  if (!job || job.retryCount >= job.maxRetries) return;

  logger.info({ companyId, jobId }, "Retrying failed AI task generation once");
  try {
    await db
      .update(taskGenerationJobsTable)
      .set({ retryCount: job.retryCount + 1 })
      .where(eq(taskGenerationJobsTable.id, jobId));
    const result = await generateDailyTasks(companyId, undefined, "scheduler", false);
    logger.info({ companyId, retryJobId: jobId, ...result }, "Retry completed for company");
  } catch (e) {
    logger.error({ err: e, companyId, jobId }, "Retry failed for company");
  }
}

