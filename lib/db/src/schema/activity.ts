import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // order|payment|lead|employee|inventory|approval|customer
  title: text("title").notNull(),
  description: text("description").notNull(),
  companyId: integer("company_id"),
  companyName: text("company_name").notNull(),
  amount: real("amount"),
  status: text("status"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (t) => [
  index("activity_company_id_idx").on(t.companyId),
  index("activity_timestamp_idx").on(t.timestamp),
  index("activity_company_timestamp_idx").on(t.companyId, t.timestamp),
]);

export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;
