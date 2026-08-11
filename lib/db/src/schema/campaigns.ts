import { pgTable, serial, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  projectId: integer("project_id"), // nullable: marketing project (client portal tenancy)
  clientVisible: boolean("client_visible").notNull().default(false), // visible in the client portal
  name: text("name").notNull(),
  channel: text("channel").notNull().default("meta"), // meta|google|instagram|facebook|whatsapp|email
  objective: text("objective").default("conversions"), // awareness|traffic|leads|conversions|sales
  status: text("status").notNull().default("active"), // draft|active|paused|completed
  budget: real("budget").notNull().default(0),
  spent: real("spent").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  revenue: real("revenue").notNull().default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
