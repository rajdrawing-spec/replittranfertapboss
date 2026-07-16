import { pgTable, serial, integer, text, timestamp, jsonb, boolean, date, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── ai_task_company_settings: AI Tasks scheduling/workday context per company ─────
// Keeps the AI Tasks module self-contained; does not modify the core companies table.
export const aiTaskCompanySettingsTable = pgTable("ai_task_company_settings", {
  companyId: integer("company_id").notNull().primaryKey(),
  timezone: text("timezone").notNull().default("UTC"),
  workWeek: jsonb("work_week").$type<number[]>().notNull().default([1, 2, 3, 4, 5]), // 0=Sun..6=Sat
  weekendGeneration: boolean("weekend_generation").notNull().default(false),
  generationTime: text("generation_time"), // optional per-company override HH:mm
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AiTaskCompanySettings = typeof aiTaskCompanySettingsTable.$inferSelect;
export type NewAiTaskCompanySettings = typeof aiTaskCompanySettingsTable.$inferInsert;

// ── ai_task_company_holidays: company-specific non-working days ────────────────
export const aiTaskCompanyHolidaysTable = pgTable("ai_task_company_holidays", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  name: text("name").notNull(),
  isRecurringYearly: boolean("is_recurring_yearly").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiTaskCompanyHoliday = typeof aiTaskCompanyHolidaysTable.$inferSelect;
export type NewAiTaskCompanyHoliday = typeof aiTaskCompanyHolidaysTable.$inferInsert;

// ── ai_task_projects: projects owned by a company with a priority ───────────────
// Used by the AI task generator to prioritize tasks per employee project assignment.
export const aiTaskProjectsTable = pgTable("ai_task_projects", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  priority: text("priority").notNull().default("medium"), // critical | high | medium | low
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AiTaskProject = typeof aiTaskProjectsTable.$inferSelect;
export type NewAiTaskProject = typeof aiTaskProjectsTable.$inferInsert;

// ── ai_prompts: versioned prompt templates ─────────────────────────────────────
// Admins can edit prompt templates without changing code. The active prompt for a
// given name is used by the generator; historical versions are retained for audit.
export const aiPromptsTable = pgTable("ai_prompts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "task_generation"
  version: text("version").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AiPrompt = typeof aiPromptsTable.$inferSelect;
export type NewAiPrompt = typeof aiPromptsTable.$inferInsert;

// ── scheduler_locks: prevents concurrent scheduler execution per company ────────
export const schedulerLocksTable = pgTable("scheduler_locks", {
  companyId: integer("company_id").notNull().primaryKey(),
  lockedAt: timestamp("locked_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type SchedulerLock = typeof schedulerLocksTable.$inferSelect;
export type NewSchedulerLock = typeof schedulerLocksTable.$inferInsert;

// ── Zod schemas for API validation ─────────────────────────────────────────────
export const insertAiTaskCompanySettingsSchema = createInsertSchema(aiTaskCompanySettingsTable)
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    workWeek: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    timezone: z.string().default("UTC"),
  });

export const updateAiTaskCompanySettingsSchema = insertAiTaskCompanySettingsSchema.partial().omit({ companyId: true });

export const insertAiTaskCompanyHolidaySchema = createInsertSchema(aiTaskCompanyHolidaysTable)
  .omit({ id: true, createdAt: true });

export const insertAiTaskProjectSchema = createInsertSchema(aiTaskProjectsTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  });

export const updateAiTaskProjectSchema = insertAiTaskProjectSchema.partial().omit({ companyId: true });

export const insertAiPromptSchema = createInsertSchema(aiPromptsTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1),
    version: z.string().min(1),
    content: z.string().min(1),
  });
