import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"), // gst|trademark|invoice|vendor_agreement|brand_asset|certificate|other
  fileUrl: text("file_url"),
  fileType: text("file_type"), // pdf|image|doc
  issuer: text("issuer"),
  referenceNumber: text("reference_number"),
  expiresAt: timestamp("expires_at"),
  owner: text("owner"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
