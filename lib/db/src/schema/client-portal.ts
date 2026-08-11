import { pgTable, serial, text, integer, boolean, json, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Client Marketing Portal — per-project visibility settings, AI marketing
 * plans, and client access audit log.
 *
 * Visibility settings control which data sections/KPIs a client can see.
 * Sensitive internals (costs, margins, internal notes/strategy, employee
 * info) are NEVER exposed by client endpoints regardless of settings —
 * these toggles only narrow the already-safe surface.
 */

export interface ClientVisibilitySettings {
  revenue: boolean;
  orders: boolean;
  adSpend: boolean;
  roas: boolean;
  leads: boolean;
  cpa: boolean;
  conversion: boolean;
  campaigns: boolean;
  creatives: boolean;
  reports: boolean;
  ai: boolean;
  /** When true, client-generated AI plans need internal approval before the client sees them. */
  aiRequiresReview: boolean;
}

export const DEFAULT_CLIENT_VISIBILITY: ClientVisibilitySettings = {
  revenue: true, orders: true, adSpend: true, roas: true, leads: true,
  cpa: true, conversion: true, campaigns: true, creatives: true,
  reports: true, ai: true, aiRequiresReview: false,
};

export const clientVisibilitySettingsTable = pgTable("client_visibility_settings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  settings: json("settings").$type<ClientVisibilitySettings>().notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("client_visibility_project_uniq").on(t.projectId),
]);

/** AI marketing plans generated for a client project. */
export const clientAiPlansTable = pgTable("client_ai_plans", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  // pending_review → internal team must approve; published → client-visible; archived → hidden
  status: text("status").notNull().default("published"),
  provider: text("provider"),
  insights: json("insights").$type<Record<string, unknown>>(),
  plan7: json("plan7").$type<unknown[]>(),
  plan30: json("plan30").$type<unknown[]>(),
  summary: text("summary"),
  requestedByUserId: integer("requested_by_user_id"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("client_ai_plans_project_idx").on(t.projectId),
]);

/** Client portal access events (viewed dashboard, downloaded report, generated AI plan, permission change). */
export const clientAuditLogsTable = pgTable("client_audit_logs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(), // e.g. portal.overview_viewed, portal.report_viewed, portal.creative_downloaded, portal.ai_plan_generated, portal.visibility_changed
  detail: json("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("client_audit_project_idx").on(t.projectId),
  index("client_audit_created_idx").on(t.createdAt),
]);

export const insertClientAiPlanSchema = createInsertSchema(clientAiPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ClientAiPlan = typeof clientAiPlansTable.$inferSelect;
export type ClientAuditLog = typeof clientAuditLogsTable.$inferSelect;
export type InsertClientAiPlan = z.infer<typeof insertClientAiPlanSchema>;
