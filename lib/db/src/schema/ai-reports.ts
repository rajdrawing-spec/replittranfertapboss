import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

// ── ai_report_schedules: per-company automated report configuration ────────────
export const aiReportSchedulesTable = pgTable("ai_report_schedules", {
  id:              serial("id").primaryKey(),
  companyId:       integer("company_id"),          // null = portfolio-wide report
  type:            text("type").notNull(),          // weekly | monthly | quarterly
  enabled:         boolean("enabled").notNull().default(true),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
  lastRunAt:       timestamp("last_run_at"),
  nextRunAt:       timestamp("next_run_at"),        // pre-computed next delivery time
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

// ── ai_report_history: log of all generated reports ──────────────────────────
export const aiReportHistoryTable = pgTable("ai_report_history", {
  id:             serial("id").primaryKey(),
  scheduleId:     integer("schedule_id"),           // null = manually triggered
  companyId:      integer("company_id"),            // null = portfolio-wide
  type:           text("type").notNull(),           // weekly | monthly | quarterly | manual
  status:         text("status").notNull(),         // generating | sent | failed
  subject:        text("subject").notNull(),
  htmlContent:    text("html_content"),             // full email HTML
  aiSummary:      text("ai_summary"),               // plain-text AI narrative for preview
  recipientCount: integer("recipient_count").default(0),
  errorMessage:   text("error_message"),
  sentAt:         timestamp("sent_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type AiReportSchedule = typeof aiReportSchedulesTable.$inferSelect;
export type AiReportHistory  = typeof aiReportHistoryTable.$inferSelect;
