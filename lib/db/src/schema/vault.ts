import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vaultEntriesTable = pgTable("vault_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"), // null = group-level
  platform: text("platform").notNull(),
  username: text("username"),
  email: text("email"),
  phone: text("phone"),
  password: text("password").notNull(),
  recoveryEmail: text("recovery_email"),
  recoveryPhone: text("recovery_phone"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  owner: text("owner"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVaultEntrySchema = createInsertSchema(vaultEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVaultEntry = z.infer<typeof insertVaultEntrySchema>;
export type VaultEntry = typeof vaultEntriesTable.$inferSelect;
