import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Creative Library — ad creatives / assets, optionally linked to a campaign. */
export const campaignCreativesTable = pgTable("campaign_creatives", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  campaignId: integer("campaign_id"), // nullable: unassigned assets live in the library
  name: text("name").notNull(),
  type: text("type").notNull().default("image"), // image|video|copy|carousel
  format: text("format"), // story|reel|post|banner|email
  url: text("url"), // asset url (object storage path or external)
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("draft"), // draft|approved|live|archived
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Lead Tracking — marketing leads captured from campaigns/channels. */
export const campaignLeadsTable = pgTable("campaign_leads", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  campaignId: integer("campaign_id"), // nullable
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source"), // channel: meta|google|instagram|facebook|whatsapp|email|referral
  status: text("status").notNull().default("new"), // new|contacted|qualified|converted|lost
  value: real("value").notNull().default(0), // estimated / realised value
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCampaignCreativeSchema = createInsertSchema(campaignCreativesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCampaignLeadSchema = createInsertSchema(campaignLeadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CampaignCreative = typeof campaignCreativesTable.$inferSelect;
export type CampaignLead = typeof campaignLeadsTable.$inferSelect;
export type InsertCampaignCreative = z.infer<typeof insertCampaignCreativeSchema>;
export type InsertCampaignLead = z.infer<typeof insertCampaignLeadSchema>;
