import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A per-company connection to a catalog platform. Credentials are NEVER stored
 * here — `secretRefs` holds the *names* of Replit secrets / env vars that carry
 * the actual API keys/tokens, which are read from process.env at runtime.
 */
export const integrationConnectionsTable = pgTable("integration_connections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  platformKey: text("platform_key").notNull(), // references the catalog key (e.g. "shopify")
  status: text("status").notNull().default("disconnected"), // connected | disconnected | pending | error
  health: text("health").notNull().default("unknown"), // healthy | degraded | down | unknown
  authType: text("auth_type"), // oauth | api_key | webhook | manual
  accountHandle: text("account_handle"), // store name / handle / account id
  connectedUserId: integer("connected_user_id"),
  connectedUserName: text("connected_user_name"),
  connectedUserEmail: text("connected_user_email"),
  secretRefs: jsonb("secret_refs").$type<string[]>().notNull().default([]), // env var names, not values
  autoSync: boolean("auto_sync").notNull().default(false),
  syncSettings: jsonb("sync_settings").$type<Record<string, boolean>>().notNull().default({}),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // success | failed | skipped
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  companyPlatformUnique: uniqueIndex("integration_conn_company_platform_uq").on(t.companyId, t.platformKey),
}));

/** One row per sync attempt (manual or scheduled) — the audit trail. */
export const integrationSyncHistoryTable = pgTable("integration_sync_history", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  companyId: integer("company_id").notNull(),
  platformKey: text("platform_key").notNull(),
  trigger: text("trigger").notNull().default("manual"), // manual | scheduled
  status: text("status").notNull(), // success | failed | skipped
  recordsSynced: integer("records_synced").notNull().default(0),
  durationMs: integer("duration_ms"),
  message: text("message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Connection-level errors (auth failures, health-check failures, sync errors). */
export const integrationErrorLogsTable = pgTable("integration_error_logs", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  companyId: integer("company_id").notNull(),
  platformKey: text("platform_key").notNull(),
  level: text("level").notNull().default("error"), // error | warning
  message: text("message").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIntegrationConnectionSchema = createInsertSchema(integrationConnectionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertIntegrationConnection = z.infer<typeof insertIntegrationConnectionSchema>;
export type IntegrationConnection = typeof integrationConnectionsTable.$inferSelect;
export type IntegrationSyncHistory = typeof integrationSyncHistoryTable.$inferSelect;
export type IntegrationErrorLog = typeof integrationErrorLogsTable.$inferSelect;
