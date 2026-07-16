import { schedule } from "node-cron";
import { db, companiesTable } from "@workspace/db";
import { generateDailyTasks } from "./ai-task.service";
import { getAiTasksConfig } from "./config.service";
import { logger } from "../logger";

let scheduledJob: any = null;

function crontabFromTime(time: string): string {
  // time format HH:mm
  const [hour, minute] = time.split(":").map((s) => parseInt(s, 10));
  const h = isNaN(hour) ? 8 : hour;
  const m = isNaN(minute) ? 0 : minute;
  return `${m} ${h} * * *`;
}

export async function startAiTaskScheduler(): Promise<void> {
  if (scheduledJob) scheduledJob.stop();

  const config = await getAiTasksConfig();
  if (!config.enableScheduler) {
    logger.info("AI task scheduler is disabled");
    return;
  }

  const cron = crontabFromTime(config.generationTime);
  logger.info({ cron }, "Starting AI task scheduler");

  scheduledJob = schedule(cron, async () => {
    try {
      const runtimeConfig = await getAiTasksConfig();
      if (!runtimeConfig.enableScheduler) {
        logger.info("AI task scheduler skipped: disabled at runtime");
        return;
      }
      await runScheduledGeneration();
    } catch (e) {
      logger.error({ err: e }, "Scheduled AI task generation failed");
    }
  }, { timezone: "UTC" });
}

async function runScheduledGeneration(): Promise<void> {
  const companies = await db.select({ id: companiesTable.id }).from(companiesTable);
  logger.info({ companyCount: companies.length }, "Running scheduled AI task generation");

  for (const company of companies) {
    try {
      const result = await generateDailyTasks(company.id, undefined, "scheduler");
      logger.info({ companyId: company.id, ...result }, "Scheduled generation completed for company");
    } catch (e) {
      logger.error({ err: e, companyId: company.id }, "Scheduled generation failed for company");
    }
  }
}
