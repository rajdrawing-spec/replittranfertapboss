import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Business numbers (Exotel virtual numbers, one per department) ────────────
export const businessNumbersTable = pgTable(
  "business_numbers",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    department: text("department").notNull(),
    displayName: text("display_name").notNull(),
    phoneNumber: text("phone_number").notNull(),
    exotelSid: text("exotel_sid"),
    exotelVirtualNumber: text("exotel_virtual_number"),
    status: text("status").notNull().default("active"), // active | inactive
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("business_numbers_company_id_idx").on(t.companyId)],
);

// ── Call center contacts (company phonebook) ────────────────────────────────
export const callContactsTable = pgTable(
  "call_contacts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    department: text("department"),
    tags: text("tags").array().notNull().default([]),
    favorite: boolean("favorite").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("call_contacts_company_id_idx").on(t.companyId)],
);

// ── Call logs ────────────────────────────────────────────────────────────────
export const callLogsTable = pgTable(
  "call_logs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    callId: text("call_id").notNull(), // provider call SID (mock for now)
    businessNumberId: integer("business_number_id"),
    contactId: integer("contact_id"),
    userId: integer("user_id"), // agent handling the call
    callerName: text("caller_name"),
    callerNumber: text("caller_number").notNull(),
    direction: text("direction").notNull(), // incoming | outgoing
    status: text("status").notNull(), // ringing | active | held | completed | missed | rejected | failed
    duration: integer("duration").notNull().default(0), // seconds
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    notes: text("notes"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    index("call_logs_company_id_idx").on(t.companyId),
    index("call_logs_call_id_idx").on(t.callId),
  ],
);

// ── Per-user permissions on business numbers ────────────────────────────────
export const callNumberPermissionsTable = pgTable(
  "call_number_permissions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: integer("user_id").notNull(),
    businessNumberId: integer("business_number_id").notNull(),
    canMakeCalls: boolean("can_make_calls").notNull().default(true),
    canReceiveCalls: boolean("can_receive_calls").notNull().default(true),
  },
  (t) => [index("call_number_permissions_company_id_idx").on(t.companyId)],
);

export const insertBusinessNumberSchema = createInsertSchema(businessNumbersTable).omit({ id: true, createdAt: true });
export const insertCallContactSchema = createInsertSchema(callContactsTable).omit({ id: true, createdAt: true });

export type BusinessNumber = typeof businessNumbersTable.$inferSelect;
export type CallContact = typeof callContactsTable.$inferSelect;
export type CallLog = typeof callLogsTable.$inferSelect;
export type InsertBusinessNumber = z.infer<typeof insertBusinessNumberSchema>;
export type InsertCallContact = z.infer<typeof insertCallContactSchema>;
