import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A shareholder holds equity in a single company (parent or subsidiary).
// Ownership percentage is stored but always derived from the company's total
// issued shares — it is recomputed whenever any holding for that company changes.
export const shareholdersTable = pgTable("shareholders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  type: text("type").notNull().default("individual"), // individual | entity
  role: text("role").notNull().default("investor"), // founder | investor | employee | advisor | institutional
  shares: integer("shares").notNull().default(0),
  sharePrice: real("share_price").notNull().default(0), // current price per share
  investmentAmount: real("investment_amount").notNull().default(0), // total capital invested
  ownershipPercent: real("ownership_percent").notNull().default(0), // derived from cap table
  status: text("status").notNull().default("active"), // active | exited
  joinedDate: text("joined_date"), // ISO date (YYYY-MM-DD)
  notes: text("notes"),
  invitedAt: timestamp("invited_at"), // last time an invite email was sent to this holder
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Investment history: every share event for a shareholder (money in/out, grants,
// dividends). Positive `shares` add to a holding, negative remove.
export const shareTransactionsTable = pgTable("share_transactions", {
  id: serial("id").primaryKey(),
  shareholderId: integer("shareholder_id").notNull(),
  companyId: integer("company_id").notNull(),
  type: text("type").notNull(), // purchase | sale | grant | dividend | transfer
  shares: integer("shares").notNull().default(0),
  pricePerShare: real("price_per_share").notNull().default(0),
  amount: real("amount").notNull().default(0),
  date: text("date").notNull(), // ISO date (YYYY-MM-DD)
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShareholderSchema = createInsertSchema(shareholdersTable).omit({
  id: true,
  ownershipPercent: true,
  invitedAt: true, // server-controlled: set only when an invite email is sent
  createdAt: true,
  updatedAt: true,
});
export type InsertShareholder = z.infer<typeof insertShareholderSchema>;
export type Shareholder = typeof shareholdersTable.$inferSelect;

export const insertShareTransactionSchema = createInsertSchema(shareTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShareTransaction = z.infer<typeof insertShareTransactionSchema>;
export type ShareTransaction = typeof shareTransactionsTable.$inferSelect;
