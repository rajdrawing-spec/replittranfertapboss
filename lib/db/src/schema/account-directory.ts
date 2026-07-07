import { pgTable, serial, text, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Account Directory — records account METADATA only. It never stores passwords.
 * Lets teams find which account/email/phone belongs to which platform + company.
 */
export const accountDirectoryTable = pgTable("account_directory", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"), // null = group-level
  platform: text("platform").notNull(),
  platformUrl: text("platform_url"),
  loginEmail: text("login_email"),
  recoveryEmail: text("recovery_email"),
  phone: text("phone"),
  recoveryPhone: text("recovery_phone"),
  googleLinked: boolean("google_linked").notNull().default(false),
  microsoftLinked: boolean("microsoft_linked").notNull().default(false),
  accountOwner: text("account_owner"),
  department: text("department"),
  notes: text("notes"),
  lastLoginDate: date("last_login_date", { mode: "string" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAccountDirectorySchema = createInsertSchema(accountDirectoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAccountDirectoryEntry = z.infer<typeof insertAccountDirectorySchema>;
export type AccountDirectoryEntry = typeof accountDirectoryTable.$inferSelect;
