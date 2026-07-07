import { pgTable, serial, text, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  clerkUserId: text("clerk_user_id").unique(), // linked on first Clerk sign-in
  role: text("role").notNull().default("customer_support"), // role key -> rolesTable.key
  department: text("department"),
  companyIds: json("company_ids").$type<number[]>().notNull().default([]),
  avatarUrl: text("avatar_url"),
  status: text("status").notNull().default("invited"), // invited | active | disabled
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
