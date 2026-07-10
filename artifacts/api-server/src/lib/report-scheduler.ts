/**
 * Report Scheduler
 *
 * Runs every 30 minutes, checks ai_report_schedules for due entries,
 * generates reports and emails them. Also fires scheduled type-based
 * report generation (daily/weekly/monthly/quarterly/annual) for all companies.
 */

import { db } from "@workspace/db";
import { aiReportSchedulesTable, aiReportHistoryTable, companiesTable } from "@workspace/db";
import { eq, lte, and, isNull, isNotNull } from "drizzle-orm";
import {
  generateExecutiveReport, computeNextRunAt, computePeriodLabel,
  storeReport, pruneReportHistory,
} from "./report-generator";
import { sendExecutiveReportEmail } from "./email";
import { logger as rootLogger } from "./logger";

const log = rootLogger.child({ module: "report-scheduler" });

let _interval: ReturnType<typeof setInterval> | null = null;

// ── Compute period slots to backfill (current + recent missed) ────────────────
//
// Returns { label, asOfDate } pairs in chronological order.
// Bounded so a long outage doesn't trigger an unbounded AI-call flood:
//   daily→7, weekly→4, monthly→3, quarterly→2, annual→1
function periodSlotsToCheck(type: string, now: Date): { label: string; asOfDate: Date }[] {
  const slots: { label: string; asOfDate: Date }[] = [];

  function shiftDate(d: Date, steps: number): Date {
    const result = new Date(d);
    switch (type) {
      case "daily":     result.setUTCDate(result.getUTCDate() - steps);        break;
      case "weekly":    result.setUTCDate(result.getUTCDate() - steps * 7);    break;
      case "monthly":   result.setUTCMonth(result.getUTCMonth() - steps);      break;
      case "quarterly": result.setUTCMonth(result.getUTCMonth() - steps * 3);  break;
      case "annual":    result.setUTCFullYear(result.getUTCFullYear() - steps); break;
    }
    return result;
  }

  const lookback = type === "daily" ? 7 : type === "weekly" ? 4 : type === "monthly" ? 3 : type === "quarterly" ? 2 : 1;
  const seen = new Set<string>();
  for (let i = lookback; i >= 0; i--) {
    const asOfDate = shiftDate(now, i);
    const label = computePeriodLabel(type, asOfDate);
    if (label && !seen.has(label)) {
      seen.add(label);
      slots.push({ label, asOfDate });
    }
  }
  return slots;
}

// ── Catch-up: ensure current + recent missed period reports exist ──────────────
//
// Runs on EVERY tick (every 30 min). For each report type we compute recent
// period slots and generate any missing ones. Each slot carries the correct
// asOfDate so the generated report uses the right period label and data window.
// If the server was down across multiple periods all missed slots are filled
// on the next tick after restart — bounded by `lookback` in periodSlotsToCheck.
// The dedup partial-unique indexes prevent double-writes under races.
async function ensurePeriodReports(type: string, now: Date): Promise<void> {
  const slots = periodSlotsToCheck(type, now);
  if (slots.length === 0) return;

  const companies = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable);

  for (const { label: periodLabel, asOfDate } of slots) {
    for (const company of companies) {
      // Only skip if a successfully completed record (ready or sent) exists.
      // A "failed" or missing record must still be retried.
      const [existing] = await db
        .select({ id: aiReportHistoryTable.id, status: aiReportHistoryTable.status })
        .from(aiReportHistoryTable)
        .where(
          and(
            eq(aiReportHistoryTable.companyId, company.id),
            eq(aiReportHistoryTable.type, type),
            eq(aiReportHistoryTable.periodLabel, periodLabel),
          )
        )
        .limit(1);

      if (existing && (existing.status === "ready" || existing.status === "sent")) continue;

      try {
        // Pass asOfDate so the generator uses the correct period label + data window.
        const report = await generateExecutiveReport({
          companyId:       company.id,
          type,
          recipientEmails: [],
          asOfDate,
        });

        if (existing) {
          // Update the existing failed/generating row in-place — avoids dedup collision.
          await db.update(aiReportHistoryTable).set({
            status:      "ready",
            subject:     report.subject,
            htmlContent: report.htmlContent,
            aiSummary:   report.aiSummary,
            contentJson: report.contentJson as unknown as Record<string, unknown>,
            errorMessage: null,
          }).where(eq(aiReportHistoryTable.id, existing.id));
          void pruneReportHistory(company.id);
          log.info({ companyId: company.id, type, periodLabel, rowId: existing.id }, "Catch-up report repaired (was failed)");
        } else {
          try {
            await storeReport({
              companyId:   company.id,
              type,
              // Use the slot's label (not report.periodLabel) as the authoritative key.
              periodLabel,
              status:      "ready",
              subject:     report.subject,
              htmlContent: report.htmlContent,
              aiSummary:   report.aiSummary,
              contentJson: report.contentJson,
            });
            void pruneReportHistory(company.id);
            log.info({ companyId: company.id, type, periodLabel }, "Catch-up report generated");
          } catch (e: unknown) {
            // Race: another instance inserted first — ignore dedup constraint violations
            // (catches both ai_report_history_dedup_company and ai_report_history_dedup_portfolio)
            if (e instanceof Error && e.message.includes("ai_report_history_dedup")) {
              log.debug({ companyId: company.id, type, periodLabel }, "Report already exists (race), skipping");
            } else {
              throw e;
            }
          }
        }
      } catch (err) {
        log.error({ err, companyId: company.id, type, periodLabel }, "Catch-up report generation failed");
      }
    }

    // Portfolio-level report for annual/quarterly (companyId IS NULL)
    if (type === "annual" || type === "quarterly") {
      const [portfolioExisting] = await db
        .select({ id: aiReportHistoryTable.id, status: aiReportHistoryTable.status })
        .from(aiReportHistoryTable)
        .where(
          and(
            isNull(aiReportHistoryTable.companyId),
            eq(aiReportHistoryTable.type, type),
            eq(aiReportHistoryTable.periodLabel, periodLabel),
          )
        )
        .limit(1);

      if (!portfolioExisting || (portfolioExisting.status !== "ready" && portfolioExisting.status !== "sent")) {
        try {
          const report = await generateExecutiveReport({
            companyId: null, type, recipientEmails: [], asOfDate,
          });

          if (portfolioExisting) {
            // Update the existing failed row in-place — avoids dedup collision.
            await db.update(aiReportHistoryTable).set({
              status:       "ready",
              subject:      report.subject,
              htmlContent:  report.htmlContent,
              aiSummary:    report.aiSummary,
              contentJson:  report.contentJson as unknown as Record<string, unknown>,
              errorMessage: null,
            }).where(eq(aiReportHistoryTable.id, portfolioExisting.id));
            log.info({ type, periodLabel, rowId: portfolioExisting.id }, "Portfolio catch-up report repaired (was failed)");
          } else {
            try {
              await storeReport({
                companyId:   null,
                type,
                periodLabel,
                status:      "ready",
                subject:     report.subject,
                htmlContent: report.htmlContent,
                aiSummary:   report.aiSummary,
                contentJson: report.contentJson,
              });
              log.info({ type, periodLabel }, "Portfolio catch-up report generated");
            } catch {
              // Dedup constraint race — already exists
            }
          }
        } catch (err) {
          log.error({ err, type, periodLabel }, "Portfolio catch-up report generation failed");
        }
      }
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
    // 1. Ensure the current period's report exists for every company.
    //    Catch-up approach: runs every tick; skips companies/periods that already
    //    have a record, so missed windows (server downtime) are filled on resume.
    for (const type of ["daily", "weekly", "monthly", "quarterly", "annual"]) {
      await ensurePeriodReports(type, now);
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
