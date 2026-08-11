import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Client Marketing Portal — a "project" is the unit of client tenancy.
 * Each project belongs to one company and carries its own brand identity
 * shown to client users inside the portal.
 */
export const marketingProjectsTable = pgTable("marketing_projects", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  brandName: text("brand_name"),
  brandColor: text("brand_color"), // hex, e.g. #1d90e8
  logoUrl: text("logo_url"),
  status: text("status").notNull().default("active"), // active | paused | archived
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Project membership: internal team members and client users assigned to a project. */
export const marketingProjectMembersTable = pgTable("marketing_project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  memberType: text("member_type").notNull().default("internal"), // internal | client
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMarketingProjectSchema = createInsertSchema(marketingProjectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMarketingProjectMemberSchema = createInsertSchema(marketingProjectMembersTable).omit({ id: true, createdAt: true });
export type MarketingProject = typeof marketingProjectsTable.$inferSelect;
export type MarketingProjectMember = typeof marketingProjectMembersTable.$inferSelect;
export type InsertMarketingProject = z.infer<typeof insertMarketingProjectSchema>;
export type InsertMarketingProjectMember = z.infer<typeof insertMarketingProjectMemberSchema>;
