import { pgTable, serial, text, integer, json, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // actor (null for system)
  userEmail: text("user_email"),
  action: text("action").notNull(), // e.g. user.login, user.invited, role.updated, company.deleted
  targetType: text("target_type"), // user | role | company | integration ...
  targetId: text("target_id"),
  description: text("description"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_logs_user_id_idx").on(t.userId),
  index("audit_logs_created_at_idx").on(t.createdAt),
  index("audit_logs_action_idx").on(t.action),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
