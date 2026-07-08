import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-approver vote rows. One row per (approval_id, voter_email) pair.
 * Created with decision="pending" when the approval is created, updated when
 * the voter takes action.
 */
export const approvalVotesTable = pgTable(
  "approval_votes",
  {
    id: serial("id").primaryKey(),
    approvalId: integer("approval_id").notNull(),
    voterName: text("voter_name").notNull(),
    voterEmail: text("voter_email").notNull(),
    voterRole: text("voter_role").notNull().default("approver"), // shareholder|director|admin|approver
    decision: text("decision").notNull().default("pending"),     // pending|approved|rejected
    note: text("note"),
    votedAt: timestamp("voted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("approval_votes_approval_voter_uq").on(t.approvalId, t.voterEmail)],
);

export const insertApprovalVoteSchema = createInsertSchema(approvalVotesTable).omit({ id: true, createdAt: true });
export type InsertApprovalVote = z.infer<typeof insertApprovalVoteSchema>;
export type ApprovalVote = typeof approvalVotesTable.$inferSelect;
