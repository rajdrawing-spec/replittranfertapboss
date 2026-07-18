import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingProviders = ["livekit", "jitsi", "google_meet", "microsoft_teams", "zoom"] as const;
export type MeetingProvider = (typeof meetingProviders)[number];

export const meetingStatuses = ["scheduled", "ongoing", "ended", "cancelled"] as const;
export type MeetingStatus = (typeof meetingStatuses)[number];

export const participantStatuses = ["invited", "accepted", "rejected", "joined"] as const;
export type ParticipantStatus = (typeof participantStatuses)[number];

// ── meeting_settings: company-level defaults and admin toggles ────────────────
export const meetingSettingsTable = pgTable(
  "meeting_settings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull().unique(),
    defaultProvider: text("default_provider").notNull().default("livekit"),
    jitsiServerUrl: text("jitsi_server_url").notNull().default("https://meet.jit.si"),
    defaultDuration: integer("default_duration").notNull().default(30),
    waitingRoomEnabled: boolean("waiting_room_enabled").notNull().default(false),
    passwordRequired: boolean("password_required").notNull().default(false),
    maxParticipants: integer("max_participants").notNull().default(50),
    screenShareEnabled: boolean("screen_share_enabled").notNull().default(true),
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    lobbyEnabled: boolean("lobby_enabled").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("meeting_settings_company_id_idx").on(table.companyId),
  }),
);

export type MeetingSettings = typeof meetingSettingsTable.$inferSelect;
export type NewMeetingSettings = typeof meetingSettingsTable.$inferInsert;

// ── meetings: scheduled and instant meeting records ───────────────────────────
export const meetingsTable = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    channelId: integer("channel_id"), // optional link to chat channel
    taskId: integer("task_id"), // optional link to AI task
    title: text("title").notNull(),
    agenda: text("agenda"),
    meetingId: text("meeting_id").notNull().unique(),
    provider: text("provider").notNull().default("livekit"),
    roomUrl: text("room_url").notNull(),
    jwt: text("jwt"),
    password: text("password"),
    scheduledAt: timestamp("scheduled_at"),
    duration: integer("duration").notNull().default(30),
    organizerId: integer("organizer_id").notNull(),
    status: text("status").notNull().default("scheduled"),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurrence: text("recurrence"), // e.g. "weekly"
    waitingRoom: boolean("waiting_room").notNull().default(false),
    maxParticipants: integer("max_participants").notNull().default(50),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("meetings_company_id_idx").on(table.companyId),
    statusIdx: index("meetings_status_idx").on(table.status),
    scheduledAtIdx: index("meetings_scheduled_at_idx").on(table.scheduledAt),
  }),
);

export type Meeting = typeof meetingsTable.$inferSelect;
export type NewMeeting = typeof meetingsTable.$inferInsert;

// ── meeting_participants: who was invited and who joined ──────────────────────
export const meetingParticipantsTable = pgTable(
  "meeting_participants",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id").notNull(),
    userId: integer("user_id").notNull(),
    status: text("status").notNull().default("invited"),
    joinedAt: timestamp("joined_at"),
    leftAt: timestamp("left_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    meetingUserIdx: uniqueIndex("meeting_participants_meeting_user_uidx").on(table.meetingId, table.userId),
  }),
);

export type MeetingParticipant = typeof meetingParticipantsTable.$inferSelect;
export type NewMeetingParticipant = typeof meetingParticipantsTable.$inferInsert;

// ── ai_meeting_notes: AI Meeting Assistant output ─────────────────────────────
// One row per meeting. Created when the first participant uploads meeting
// audio; the Gemini pipeline fills in transcript/summary/action items and
// links auto-created tasks.
export interface MeetingActionItem {
  title: string;
  description?: string;
  assigneeName?: string;
  assigneeUserId?: number;
  priority?: "low" | "medium" | "high";
  dueDate?: string; // YYYY-MM-DD
  taskId?: number; // generated_tasks row created from this item
}

export const aiMeetingNotesTable = pgTable(
  "ai_meeting_notes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    meetingDbId: integer("meeting_db_id").notNull().unique(), // meetings.id
    meetingId: text("meeting_room_id").notNull(), // meetings.meeting_id (room name)
    channelId: integer("channel_id"), // chat channel the meeting was started from
    taskId: integer("task_id"), // AI task the meeting was linked to
    title: text("title").notNull(),
    transcript: text("transcript"),
    summary: text("summary"),
    notes: text("notes"),
    actionItems: jsonb("action_items").$type<MeetingActionItem[]>().default([]),
    status: text("status").notNull().default("processing"), // processing | done | failed
    error: text("error"),
    // Original uploaded recording persisted to object storage (/objects/... path)
    // so a failed note can be retried server-side without re-uploading.
    audioObjectPath: text("audio_object_path"),
    audioMimeType: text("audio_mime_type"),
    uploadedBy: integer("uploaded_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("ai_meeting_notes_company_id_idx").on(table.companyId),
    channelIdx: index("ai_meeting_notes_channel_id_idx").on(table.channelId),
  }),
);

export type AiMeetingNote = typeof aiMeetingNotesTable.$inferSelect;
export type NewAiMeetingNote = typeof aiMeetingNotesTable.$inferInsert;

// ── Zod schemas for validation ─────────────────────────────────────────────────
export const insertMeetingSettingsSchema = createInsertSchema(meetingSettingsTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    defaultProvider: z.enum(meetingProviders),
  });

export const insertMeetingSchema = createInsertSchema(meetingsTable)
  .omit({ id: true, meetingId: true, roomUrl: true, createdAt: true, updatedAt: true, status: true })
  .extend({
    provider: z.enum(meetingProviders).default("livekit"),
    participantIds: z.array(z.number()).default([]),
    scheduledAt: z.string().datetime().optional(),
  });
