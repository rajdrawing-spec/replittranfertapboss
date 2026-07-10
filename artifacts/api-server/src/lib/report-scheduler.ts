/**
 * Report Scheduler
 *
 * Runs every 30 minutes, checks ai_report_schedules for due entries,
 * generates reports and emails them. Also fires scheduled type-based
 * report generation (daily/weekly/monthly/quarterly/annual) for all companies.
 */

import { db } from "@workspace/db";
import { aiReportSchedulesTable, aiReportHistoryTable, companiesTable } from "@workspace/db";
import { eq, lte, and, isNull } from "drizzle-orm";
import {
  generateExecutiveReport, computeNextRunAt, computePeriodLabel,
  storeReport, pruneReportHistory,
} from "./report-generator";
import { sendExecutiveReportEmail } from "./email";
import { logger as rootLogger } from "./logger";

const log = rootLogger.child({ module: "report-scheduler" });

let _interval: ReturnType<typeof setInterval> | null = null;

// ── Check if a scheduled report type is due ───────────────────────────────────
// Covers the full 02:00–02:59 UTC window (7:30–8:29 IST ≈ 8 AM).
// computeNextRunAt also targets 02:00 UTC, so any 30-min tick inside this
// hour window reliably triggers the due check regardless of startup offset.
function isDue(type: string, now: Date): boolean {
  const h    = now.getUTCHours();
  const day  = now.getDay();   // 0=Sun, 1=Mon
  const date = now.getDate();
  const month = now.getMonth(); // 0-based

  const inMorningWindow = h === 2; // entire 02:xx UTC hour

  switch (type) {
    case "daily":     return inMorningWindow;
    case "weekly":    return inMorningWindow && day === 1; // Monday
    case "monthly":   return inMorningWindow && date === 1;
    case "quarterly":
      return inMorningWindow && date === 1 && [0, 3, 6, 9].includes(month);
    case "annual":
      return inMorningWindow && date === 1 && month === 0;
    default:
      return false;
  }
}

// ── Generate a scheduled type report for all active companies ─────────────────
async function generateTypeReports(type: string, now: Date): Promise<void> {
  const periodLabel = computePeriodLabel(type, now);

  // Fetch all companies
  const companies = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable);

  for (const company of companies) {
    try {
      const report = await generateExecutiveReport({
        companyId:       company.id,
        type,
        recipientEmails: [],
      });

      // ON CONFLICT: if same (companyId, type, periodLabel) already exists, skip
      try {
        await storeReport({
          companyId:   company.id,
          type,
          periodLabel: report.periodLabel,
          status:      "ready",
          subject:     report.subject,
          htmlContent: report.htmlContent,
          aiSummary:   report.aiSummary,
          contentJson: report.contentJson,
        });
        void pruneReportHistory(company.id);
        log.info({ companyId: company.id, type, periodLabel }, "Scheduled report generated");
      } catch (e: unknown) {
        // Unique constraint violation = already generated for this period
        // (catches both ai_report_history_dedup_company and ai_report_history_dedup_portfolio)
        if (e instanceof Error && e.message.includes("ai_report_history_dedup")) {
          log.debug({ companyId: company.id, type, periodLabel }, "Report already exists for period, skipping");
        } else {
          throw e;
        }
      }
    } catch (err) {
      log.error({ err, companyId: company.id, type }, "Scheduled type report generation failed");
    }
  }

  // Also generate a portfolio-level report for annual/quarterly
  if (type === "annual" || type === "quarterly") {
    try {
      const report = await generateExecutiveReport({ companyId: null, type, recipientEmails: [] });
      try {
        await storeReport({
          companyId:   null,
          type,
          periodLabel: report.periodLabel,
          status:      "ready",
          subject:     report.subject,
          htmlContent: report.htmlContent,
          aiSummary:   report.aiSummary,
          contentJson: report.contentJson,
        });
      } catch {
        // Dedup constraint — already exists
      }
    } catch (err) {
      log.error({ err, type }, "Portfolio report generation failed");
    }
  }
}

// ── Process user-configured email schedules ────────────────────────────────────
async function processEmailSchedules(now: Date): Promise<void> {
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
      const nextRunAt = computeNextRunAt(schedule.type, now);
      await db.update(aiReportSchedulesTable)
        .set({ lastRunAt: now, nextRunAt, updatedAt: now })
        .where(eq(aiReportSchedulesTable.id, schedule.id));
      continue;
    }

    log.info({ scheduleId: schedule.id, type: schedule.type, companyId: schedule.companyId }, "Generating scheduled email report");

    try {
      const report = await generateExecutiveReport({
        companyId:       schedule.companyId,
        type:            schedule.type,
        recipientEmails: recipients,
        scheduleId:      schedule.id,
      });

      let sentCount = 0;
      for (const email of recipients) {
        const result = await sendExecutiveReportEmail({ to: email, subject: report.subject, html: report.htmlContent });
        if (result.ok) sentCount++;
        else log.warn({ scheduleId: schedule.id, email, err: result.error }, "Report email delivery failed");
      }

      // Find-or-create: if auto-generation already wrote a record for this period,
      // update it with email delivery details rather than hitting the unique constraint.
      const companyIdCond = schedule.companyId != null
        ? eq(aiReportHistoryTable.companyId, schedule.companyId)
        : isNull(aiReportHistoryTable.companyId);
      const existingRows = report.periodLabel
        ? await db.select({ id: aiReportHistoryTable.id })
            .from(aiReportHistoryTable)
            .where(and(
              companyIdCond,
              eq(aiReportHistoryTable.type, schedule.type),
              eq(aiReportHistoryTable.periodLabel, report.periodLabel),
            )).limit(1)
        : [];

      if (existingRows[0]) {
        await db.update(aiReportHistoryTable).set({
          scheduleId:     schedule.id,
          status:         sentCount > 0 ? "sent" : "failed",
          subject:        report.subject,
          htmlContent:    report.htmlContent,
          aiSummary:      report.aiSummary,
          contentJson:    report.contentJson as unknown as Record<string, unknown>,
          recipientCount: sentCount,
          sentAt:         sentCount > 0 ? now : undefined,
          errorMessage:   sentCount === 0 ? "All deliveries failed" : undefined,
        }).where(eq(aiReportHistoryTable.id, existingRows[0].id));
      } else {
        await storeReport({
          companyId:      schedule.companyId,
          scheduleId:     schedule.id,
          type:           schedule.type,
          periodLabel:    report.periodLabel,
          status:         sentCount > 0 ? "sent" : "failed",
          subject:        report.subject,
          htmlContent:    report.htmlContent,
          aiSummary:      report.aiSummary,
          contentJson:    report.contentJson,
          recipientCount: sentCount,
          sentAt:         sentCount > 0 ? now : undefined,
          errorMessage:   sentCount === 0 ? "All deliveries failed" : undefined,
        });
      }

      const nextRunAt = computeNextRunAt(schedule.type, now);
      await db.update(aiReportSchedulesTable)
        .set({ lastRunAt: now, nextRunAt, updatedAt: now })
        .where(eq(aiReportSchedulesTable.id, schedule.id));

      log.info({ scheduleId: schedule.id, sentCount, nextRunAt }, "Email report delivery complete");
    } catch (err) {
      log.error({ err, scheduleId: schedule.id }, "Email report generation failed");
      await storeReport({
        companyId:    schedule.companyId,
        scheduleId:   schedule.id,
        type:         schedule.type,
        status:       "failed",
        subject:      `Report generation failed (schedule #${schedule.id})`,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      const nextRunAt = computeNextRunAt(schedule.type, now);
      await db.update(aiReportSchedulesTable)
        .set({ lastRunAt: now, nextRunAt, updatedAt: now })
        .where(eq(aiReportSchedulesTable.id, schedule.id));
    }
  }
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick() {
  const now = new Date();
  try {
    // 1. Check if any scheduled report types are due for auto-generation
    for (const type of ["daily", "weekly", "monthly", "quarterly", "annual"]) {
      if (isDue(type, now)) {
        log.info({ type }, "Auto-generating scheduled reports");
        await generateTypeReports(type, now);
      }
    }

    // 2. Process user-configured email delivery schedules
    await processEmailSchedules(now);
  } catch (err) {
    log.error({ err }, "Report scheduler tick failed");
  }
}

export function startReportScheduler() {
  if (_interval) return;
  // Delay first tick by 8 seconds so startup migrations can complete first.
  setTimeout(() => { void tick(); }, 8_000);
  _interval = setInterval(() => { void tick(); }, 30 * 60 * 1000);
  log.info("Report scheduler started (30-minute interval)");
}

export function stopReportScheduler() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
