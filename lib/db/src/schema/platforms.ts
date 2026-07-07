import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const platformsTable = pgTable("platforms", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(), // Shopify, Amazon, Meta Business, etc.
  category: text("category").notNull().default("marketplace"), // storefront|marketplace|social|ads|payments|shipping|productivity
  status: text("status").notNull().default("connected"), // connected|disconnected|error|pending
  accountOwner: text("account_owner"),
  accountHandle: text("account_handle"), // url / handle / store name
  lastSyncAt: timestamp("last_sync_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlatformSchema = createInsertSchema(platformsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatform = z.infer<typeof insertPlatformSchema>;
export type Platform = typeof platformsTable.$inferSelect;
