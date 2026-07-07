import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Inter-company fund allocations: the parent (Tapas Hub) moving capital into a
// subsidiary. Executing an allocation records a real pair of finance
// transactions (transfer out of the parent, capital injection into the
// subsidiary) and can optionally adjust the parent's recorded stake.
export const fundAllocationsTable = pgTable("fund_allocations", {
  id: serial("id").primaryKey(),
  fromCompanyId: integer("from_company_id").notNull(), // source (parent)
  toCompanyId: integer("to_company_id").notNull(),     // recipient (subsidiary)
  amount: real("amount").notNull(),
  purpose: text("purpose").notNull(),
  note: text("note"),
  equityChangePercent: real("equity_change_percent"),  // optional stake increase for the parent
  status: text("status").notNull().default("pending_approval"), // pending_approval|executed|rejected|cancelled
  approvalId: integer("approval_id"),                  // linked approvals row when gated
  fromTransactionId: integer("from_transaction_id"),
  toTransactionId: integer("to_transaction_id"),
  requestedById: integer("requested_by_id"),
  requestedByName: text("requested_by_name").notNull(),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFundAllocationSchema = createInsertSchema(fundAllocationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFundAllocation = z.infer<typeof insertFundAllocationSchema>;
export type FundAllocation = typeof fundAllocationsTable.$inferSelect;
