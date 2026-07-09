import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * treasury_entries — every inbound capital event for TapasHub.
 *
 * The live treasury balance is computed as:
 *   SUM(approved + not-reversed entries)
 *   − SUM(executed fund_allocations from the parent company)
 *
 * Records are never permanently deleted.  To correct an error, reverse the
 * entry (is_reversed = true) and create a new corrected one.
 */
export const treasuryEntriesTable = pgTable("treasury_entries", {
  id: serial("id").primaryKey(),

  // Funding classification
  fundingSource: text("funding_source").notNull(),
  // shareholder_investment | founder_investment | director_investment |
  // angel_investor | venture_capital | bank_loan | grant | government |
  // donation | revenue | product_sales | service_revenue | interest_income | other

  investorName: text("investor_name"),            // optional — lender / investor name
  amount: real("amount").notNull(),
  date: text("date").notNull(),                   // ISO date YYYY-MM-DD
  currency: text("currency").notNull().default("INR"),
  paymentMethod: text("payment_method"),          // bank_transfer | cash | cheque | upi | neft | rtgs | other
  referenceNumber: text("reference_number"),
  description: text("description").notNull(),
  notes: text("notes"),

  // Lifecycle
  status: text("status").notNull().default("approved"), // pending | approved | rejected

  // Soft-reversal instead of hard delete
  isReversed: boolean("is_reversed").notNull().default(false),
  reversedAt: timestamp("reversed_at"),
  reversedByName: text("reversed_by_name"),
  reversalReason: text("reversal_reason"),

  // Provenance
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name").notNull(),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTreasuryEntrySchema = createInsertSchema(treasuryEntriesTable).omit({
  id: true, createdAt: true, updatedAt: true,
  isReversed: true, reversedAt: true, reversedByName: true, reversalReason: true,
});
export type InsertTreasuryEntry = z.infer<typeof insertTreasuryEntrySchema>;
export type TreasuryEntry = typeof treasuryEntriesTable.$inferSelect;
