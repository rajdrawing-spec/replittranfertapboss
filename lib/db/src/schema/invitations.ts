import { pgTable, serial, text, json, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invitationsTable = pgTable("invitations", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull(), // role key
  department: text("department"),
  companyIds: json("company_ids").$type<number[]>().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | accepted | revoked
  invitedByUserId: integer("invited_by_user_id"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // At most one pending invitation per email — makes invite-only enforcement
  // deterministic even after revoke/re-invite cycles.
  uniqueIndex("invitations_email_pending_uq").on(t.email).where(sql`${t.status} = 'pending'`),
]);

export const insertInvitationSchema = createInsertSchema(invitationsTable).omit({
  id: true,
  status: true,
  acceptedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitationsTable.$inferSelect;
