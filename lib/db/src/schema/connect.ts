import { pgTable, serial, integer, text, timestamp, boolean, jsonb, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── chat_polls: quick polls inside channels ───────────────────────────────────
export const chatPollsTable = pgTable(
  "chat_polls",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull(),
    userId: integer("user_id").notNull(),
    question: text("question").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    votes: jsonb("votes").$type<Record<number, number>>().default({}),
    isMultiple: boolean("is_multiple").notNull().default(false),
    closed: boolean("closed").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    channelIdx: index("chat_polls_channel_id_idx").on(table.channelId),
  }),
);

export type ChatPoll = typeof chatPollsTable.$inferSelect;
export type NewChatPoll = typeof chatPollsTable.$inferInsert;

// ── user_status: presence, DND, custom status ─────────────────────────────────
export const userStatusTable = pgTable(
  "user_status",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().unique(),
    presence: text("presence").notNull().default("offline"), // online | away | offline
    statusMessage: text("status_message"),
    doNotDisturb: boolean("do_not_disturb").notNull().default(false),
    dndUntil: timestamp("dnd_until"),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("user_status_user_id_idx").on(table.userId),
  }),
);

export type UserStatus = typeof userStatusTable.$inferSelect;
export type NewUserStatus = typeof userStatusTable.$inferInsert;

// ── meeting_templates: reusable meeting templates per company ──────────────────
export const meetingTemplatesTable = pgTable(
  "meeting_templates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    agenda: text("agenda"),
    duration: integer("duration").notNull().default(30),
    waitingRoom: boolean("waiting_room").notNull().default(false),
    passwordRequired: boolean("password_required").notNull().default(false),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrence: text("recurrence"),
    defaultParticipantIds: jsonb("default_participant_ids").$type<number[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("meeting_templates_company_id_idx").on(table.companyId),
  }),
);

export type MeetingTemplate = typeof meetingTemplatesTable.$inferSelect;
export type NewMeetingTemplate = typeof meetingTemplatesTable.$inferInsert;

// ── meeting_notes: notes tied to a meeting ─────────────────────────────────────
export const meetingNotesTable = pgTable(
  "meeting_notes",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id").notNull(),
    userId: integer("user_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    meetingIdx: index("meeting_notes_meeting_id_idx").on(table.meetingId),
  }),
);

export type MeetingNote = typeof meetingNotesTable.$inferSelect;
export type NewMeetingNote = typeof meetingNotesTable.$inferInsert;

// ── planner_events: daily/weekly/monthly planner events ───────────────────────
export const plannerEventsTable = pgTable(
  "planner_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(), // task | meeting | deadline | holiday | leave | custom
    title: text("title").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    allDay: boolean("all_day").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("planner_events_user_id_idx").on(table.userId),
    companyIdx: index("planner_events_company_id_idx").on(table.companyId),
    dateIdx: index("planner_events_start_date_idx").on(table.startDate),
  }),
);

export type PlannerEvent = typeof plannerEventsTable.$inferSelect;
export type NewPlannerEvent = typeof plannerEventsTable.$inferInsert;

// ── workload_snapshots: AI workload analysis cache ────────────────────────────
export const workloadSnapshotsTable = pgTable(
  "workload_snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    data: jsonb("data").$type<Record<string, any>>().notNull(),
    aiProvider: text("ai_provider"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyDateIdx: index("workload_snapshots_company_date_idx").on(table.companyId, table.snapshotDate),
  }),
);

export type WorkloadSnapshot = typeof workloadSnapshotsTable.$inferSelect;
export type NewWorkloadSnapshot = typeof workloadSnapshotsTable.$inferInsert;

// ── Zod schemas ───────────────────────────────────────────────────────────────
export const insertChatPollSchema = createInsertSchema(chatPollsTable).pick({ channelId: true, userId: true, question: true, options: true, isMultiple: true });
export const insertUserStatusSchema = createInsertSchema(userStatusTable).pick({ userId: true, presence: true, statusMessage: true, doNotDisturb: true, dndUntil: true, lastSeenAt: true });
export const insertMeetingTemplateSchema = createInsertSchema(meetingTemplatesTable).pick({ companyId: true, name: true, title: true, agenda: true, duration: true, waitingRoom: true, passwordRequired: true, isRecurring: true, recurrence: true, defaultParticipantIds: true });
export const insertMeetingNoteSchema = createInsertSchema(meetingNotesTable).pick({ meetingId: true, userId: true, content: true });
export const insertPlannerEventSchema = createInsertSchema(plannerEventsTable).pick({ companyId: true, userId: true, type: true, title: true, startDate: true, endDate: true, allDay: true, metadata: true });
export const insertWorkloadSnapshotSchema = createInsertSchema(workloadSnapshotsTable).pick({ companyId: true, snapshotDate: true, data: true, aiProvider: true });
