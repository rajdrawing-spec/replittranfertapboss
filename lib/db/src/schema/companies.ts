import { pgTable, serial, text, real, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("subsidiary"), // parent | subsidiary
  industry: text("industry"),
  ownershipPercent: real("ownership_percent").notNull().default(30),
  gstNumber: text("gst_number"),
  panNumber: text("pan_number"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  status: text("status").notNull().default("active"), // active | inactive
  archived: boolean("archived").notNull().default(false),
  logoUrl: text("logo_url"),
  website: text("website"),
  description: text("description"),
  category: text("category"),
  country: text("country"),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone"),
  // AI-task scheduling context (company settings)
  workWeek: jsonb("work_week").$type<number[]>().default([1, 2, 3, 4, 5]), // 0=Sun..6=Sat
  weekendGeneration: boolean("weekend_generation").notNull().default(false), // generate on Sat/Sun?
  generationTime: text("generation_time"), // optional per-company override HH:mm
  brandColor: text("brand_color"),
  employeeCount: integer("employee_count").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
