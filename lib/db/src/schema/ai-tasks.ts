import { pgTable, serial, integer, text, timestamp, jsonb, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── task_templates: reusable task patterns by department / role ───────────────
// AI customizes these rather than inventing tasks from scratch. The templates
// are owned by a company and scoped to a department and optional role key.
export const taskTemplatesTable = pgTable("task_templates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  department: text("department").notNull().default("*"),
  roleKey: text("role_key").notNull().default("*"),
  titleTemplate: text("title_template").notNull(),
  descriptionTemplate: text("description_template").notNull(),
  priority: text("priority").notNull().default("medium"), // low | medium | high
  estimatedMinutes: integer("estimated_minutes"),
  recurrence: text("recurrence").notNull().default("daily"), // daily | weekly | once
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TaskTemplate = typeof taskTemplatesTable.$inferSelect;
export type NewTaskTemplate = typeof taskTemplatesTable.$inferInsert;

// ── generated_tasks: daily AI/customized task cache ──────────────────────────
// One logical row per employee per generation date. Acts as the daily cache so
// AI is never called more than once per day unless explicitly requested.
export const generatedTasksTable = pgTable("generated_tasks", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  templateId: integer("template_id"),
  generatedDate: date("generated_date", { mode: "string" }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"), // low | medium | high
  status: text("status").notNull().default("draft"), // draft | approved | rejected | assigned | completed
  source: text("source").notNull().default("template"), // template | ai_customized
  aiCustomizations: jsonb("ai_customizations").$type<Record<string, unknown>>().default({}),
  dueDate: date("due_date", { mode: "string" }),
  completedAt: timestamp("completed_at"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type GeneratedTask = typeof generatedTasksTable.$inferSelect;
export type NewGeneratedTask = typeof generatedTasksTable.$inferInsert;

// ── task_generation_jobs: idempotency guard for daily runs ───────────────────
// Prevents duplicate generation and lets managers poll the status of a run.
// Tracks provider, cost, and execution metadata for audit and cost control.
export const taskGenerationJobsTable = pgTable("task_generation_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  runDate: date("run_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("running"), // running | completed | failed
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  requesterId: integer("requester_id"),
  triggeredBy: text("triggered_by").default("scheduler"), // scheduler | manager
  providerUsed: text("provider_used"),
  tokensUsed: integer("tokens_used"),
  promptVersion: text("prompt_version").default("1.0"),
  executionTimeMs: integer("execution_time_ms"),
  batchSize: integer("batch_size").default(1),
  tasksGenerated: integer("tasks_generated").default(0),
  nextRun: timestamp("next_run"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TaskGenerationJob = typeof taskGenerationJobsTable.$inferSelect;
export type NewTaskGenerationJob = typeof taskGenerationJobsTable.$inferInsert;

// ── chat_messages: persistent team chat history ───────────────────────────────
// Company-scoped chat messages. One room per company. Messages are retained
// permanently in the MVP; a retention policy can be added later via admin settings.
export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  userId: integer("user_id").notNull(), // local TBOS user id mapped from Clerk
  displayName: text("display_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type NewChatMessage = typeof chatMessagesTable.$inferInsert;

// ── Zod schemas for API validation ─────────────────────────────────────────────
export const insertTaskTemplateSchema = createInsertSchema(taskTemplatesTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    recurrence: z.enum(["daily", "weekly", "once"]).default("daily"),
  });

export const updateTaskTemplateSchema = insertTaskTemplateSchema.partial().omit({ companyId: true });

export const insertGeneratedTaskSchema = createInsertSchema(generatedTasksTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export const insertTaskGenerationJobSchema = createInsertSchema(taskGenerationJobsTable)
  .omit({ id: true, createdAt: true });

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable)
  .omit({ id: true, createdAt: true });
