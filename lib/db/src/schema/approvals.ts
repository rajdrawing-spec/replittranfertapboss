import { pgTable, serial, text, real, integer, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface RequiredApprover {
  name: string;
  email: string;
  role: string; // shareholder|director|admin|approver
}

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  type: text("type").notNull(), // payment|purchase|refund|hiring|salary|vendor|leave|expense|fund_allocation
  title: text("title").notNull(),
  description: text("description").notNull(),
  requestedBy: text("requested_by").notNull(),
  currentStep: integer("current_step").notNull().default(1),
  totalSteps: integer("total_steps").notNull().default(3),
  status: text("status").notNull().default("pending"), // pending|approved|rejected|cancelled
  amount: real("amount"),
  approverNote: text("approver_note"),
  dueDate: text("due_date"),
  /** List of people who must vote before the approval resolves. */
  requiredApprovers: json("required_approvers").$type<RequiredApprover[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertApprovalSchema = createInsertSchema(approvalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvalsTable.$inferSelect;
