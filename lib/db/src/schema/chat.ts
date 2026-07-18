import { pgTable, serial, integer, text, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── chat_channels: rooms scoped to a company ─────────────────────────────────
export const chatChannelsTable = pgTable(
  "chat_channels",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    type: text("type").notNull().default("team"), // team | department | direct
    name: text("name").notNull(),
    department: text("department"), // for department channels
    createdBy: integer("created_by"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("chat_channels_company_id_idx").on(table.companyId),
    typeIdx: index("chat_channels_type_idx").on(table.type),
  }),
);

export type ChatChannel = typeof chatChannelsTable.$inferSelect;
export type NewChatChannel = typeof chatChannelsTable.$inferInsert;

// ── chat_channel_members: membership + last read watermark ────────────────────
export const chatChannelMembersTable = pgTable(
  "chat_channel_members",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull(),
    userId: integer("user_id").notNull(),
    lastReadAt: timestamp("last_read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    channelUserIdx: uniqueIndex("chat_channel_members_channel_user_idx").on(table.channelId, table.userId),
  }),
);

export type ChatChannelMember = typeof chatChannelMembersTable.$inferSelect;
export type NewChatChannelMember = typeof chatChannelMembersTable.$inferInsert;

// ── chat_messages: messages, reactions, attachments, mentions, pins ───────────
export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull(),
    userId: integer("user_id").notNull(),
    displayName: text("display_name").notNull(),
    content: text("content").notNull(),
    replyToId: integer("reply_to_id"),
    attachments: jsonb("attachments").$type<Array<{ name: string; objectPath: string; contentType: string; size?: number }>>().default([]),
    reactions: jsonb("reactions").$type<Record<string, number[]>>().default({}), // emoji -> userId[]
    mentions: jsonb("mentions").$type<number[]>().default([]), // userIds
    isAnnouncement: boolean("is_announcement").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    channelIdx: index("chat_messages_channel_id_idx").on(table.channelId),
    createdAtIdx: index("chat_messages_created_at_idx").on(table.createdAt),
  }),
);

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type NewChatMessage = typeof chatMessagesTable.$inferInsert;

// ── chat_message_reads: per-user read receipts ───────────────────────────────
export const chatMessageReadsTable = pgTable(
  "chat_message_reads",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull(),
    userId: integer("user_id").notNull(),
    readAt: timestamp("read_at").notNull().defaultNow(),
  },
  (table) => ({
    messageUserIdx: index("chat_message_reads_message_user_idx").on(table.messageId, table.userId),
  }),
);

export type ChatMessageRead = typeof chatMessageReadsTable.$inferSelect;
export type NewChatMessageRead = typeof chatMessageReadsTable.$inferInsert;

// ── Zod schemas for API validation ─────────────────────────────────────────────
export const insertChatChannelSchema = createInsertSchema(chatChannelsTable)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    type: z.enum(["team", "department", "direct", "project"]).default("team"),
  });

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable)
  .omit({ id: true, createdAt: true, editedAt: true })
  .extend({
    content: z.string().min(1).max(4000),
    reactions: z.record(z.string(), z.array(z.number())).default({}),
    mentions: z.array(z.number()).default([]),
    attachments: z.array(z.object({ name: z.string(), objectPath: z.string(), contentType: z.string(), size: z.number().optional() })).default([]),
  });
