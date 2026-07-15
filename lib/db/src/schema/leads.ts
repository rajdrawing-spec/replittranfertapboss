import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  stage: text("stage").notNull().default("new"), // new|contacted|qualified|proposal|negotiation|won|lost
  source: text("source").notNull().default("website"), // website|whatsapp|referral|ads|cold_call|email|social|other
  value: real("value").notNull().default(0),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  expectedCloseDate: text("expected_close_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("leads_company_id_idx").on(t.companyId),
  index("leads_created_at_idx").on(t.createdAt),
]);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
