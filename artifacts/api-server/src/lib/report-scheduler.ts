/**
 * Report Scheduler
 *
 * Runs every 30 minutes, checks ai_report_schedules for due entries,
 * generates reports and emails them.
 */

import { db } from "@workspace/db";
import { aiReportSchedulesTable, usersTable } from "@workspace/db";
import { eq, lte, and, sql } from "drizzle-orm";
import { generateExecutiveReport, computeNextRunAt, storeReport } from "./report-generator";
import { sendExecutiveReportEmail } from "./email";
import { logger as rootLogger } from "./logger";

const log = rootLogger.child({ module: "report-scheduler" });

let _interval: ReturnType<typeof setInterval> | null = null;

async function tick() {
  const now = new Date();
  try {
    // Find all enabled schedules whose nextRunAt is in the past
    const due = await db.select().from(aiReportSchedulesTable)
      .where(
        and(
          eq(aiReportSchedulesTable.enabled, true),
          lte(aiReportSchedulesTable.nextRunAt, now),
        )
      );

    for (const schedule of due) {
      const recipients = schedule.recipientEmails ?? [];
      if (recipients.length === 0) {
        // Advance the schedule even if there are no recipients
        const nextRunAt = computeNextRunAt(schedule.type, now);
        await db.update(aiReportSchedulesTable)
          .set({ lastRunAt: now, nextRunAt, updatedAt: now })
          .where(eq(aiReportSchedulesTable.id, schedule.id));
        continue;
      }

      log.info({ scheduleId: schedule.id, type: schedule.type, companyId: schedule.companyId }, "Generating scheduled report");

      try {
        const report = await generateExecutiveReport({
          companyId:       schedule.companyId,
          type:            schedule.type,
          recipientEmails: recipients,
          scheduleId:      schedule.id,
        });

        // Send to each recipient
        let sentCount = 0;
        for (const email of recipients) {
          const result = await sendExecutiveReportEmail({ to: email, subject: report.subject, html: report.htmlContent });
          if (result.ok) sentCount++;
          else log.warn({ scheduleId: schedule.id, email, err: result.error }, "Report email delivery failed");
        }

        await storeReport({
          companyId:      schedule.companyId,
          scheduleId:     schedule.id,
          type:           schedule.type,
          status:         sentCount > 0 ? "sent" : "failed",
          subject:        report.subject,
          htmlContent:    report.htmlContent,
          aiSummary:      report.aiSummary,
          recipientCount: sentCount,
          sentAt:         sentCount > 0 ? now : undefined,
          errorMessage:   sentCount === 0 ? "All deliveries failed" : undefined,
        });

        // Advance schedule
        const nextRunAt = computeNextRunAt(schedule.type, now);
        await db.update(aiReportSchedulesTable)
          .set({ lastRunAt: now, nextRunAt, updatedAt: now })
          .where(eq(aiReportSchedulesTable.id, schedule.id));

        log.info({ scheduleId: schedule.id, sentCount, nextRunAt }, "Report scheduled delivery complete");
      } catch (err) {
        log.error({ err, scheduleId: schedule.id }, "Report generation failed");
        await storeReport({
          companyId:    schedule.companyId,
          scheduleId:   schedule.id,
          type:         schedule.type,
          status:       "failed",
          subject:      `Report generation failed (schedule #${schedule.id})`,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        // Still advance the schedule so we don't retry every 30 minutes forever
        const nextRunAt = computeNextRunAt(schedule.type, now);
        await db.update(aiReportSchedulesTable)
          .set({ lastRunAt: now, nextRunAt, updatedAt: now })
          .where(eq(aiReportSchedulesTable.id, schedule.id));
      }
    }
  } catch (err) {
    log.error({ err }, "Report scheduler tick failed");
  }
}

export function startReportScheduler() {
  if (_interval) return;
  // Delay first tick by 5 seconds so startup migrations can finish first.
  // Subsequent ticks run every 30 minutes.
  setTimeout(() => { void tick(); }, 5_000);
  _interval = setInterval(() => { void tick(); }, 30 * 60 * 1000);
  log.info("Report scheduler started (30-minute interval)");
}

export function stopReportScheduler() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
