import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  type: text("type").notNull(), // income|expense|transfer
  category: text("category").notNull(),
  amount: real("amount").notNull(),
  description: text("description").notNull(),
  referenceNumber: text("reference_number"),
  paymentMethod: text("payment_method"),
  status: text("status").notNull().default("completed"), // pending|completed|failed|cancelled
  date: text("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("transactions_company_id_idx").on(t.companyId),
  index("transactions_date_idx").on(t.date),
  index("transactions_company_date_idx").on(t.companyId, t.date),
  index("transactions_type_idx").on(t.type),
]);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
