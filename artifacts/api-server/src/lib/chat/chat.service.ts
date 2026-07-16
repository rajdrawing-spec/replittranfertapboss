import { db, chatChannelsTable, chatChannelMembersTable, chatMessagesTable, chatMessageReadsTable, usersTable, employeesTable } from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, like, gt } from "drizzle-orm";

export interface CreateChannelInput {
  companyId: number;
  type: "team" | "department" | "direct";
  name: string;
  department?: string | null;
  createdBy?: number;
  memberUserIds?: number[];
}

export async function ensureCompanyChannels(companyId: number): Promise<void> {
  const [team] = await db
    .select({ id: chatChannelsTable.id })
    .from(chatChannelsTable)
    .where(and(eq(chatChannelsTable.companyId, companyId), eq(chatChannelsTable.type, "team")))
    .limit(1);
  if (!team) {
    await db.insert(chatChannelsTable).values({
      companyId,
      type: "team",
      name: "Team",
      createdBy: null,
    });
  }

  // Department channels based on employees in this company
  const departments = await db
    .select({ department: employeesTable.department })
    .from(employeesTable)
    .where(eq(employeesTable.companyId, companyId));
  const uniqueDepts = [...new Set(departments.map((d) => d.department).filter(Boolean))];
  for (const dept of uniqueDepts) {
    const [existing] = await db
      .select({ id: chatChannelsTable.id })
      .from(chatChannelsTable)
      .where(
        and(
          eq(chatChannelsTable.companyId, companyId),
          eq(chatChannelsTable.type, "department"),
          eq(chatChannelsTable.department, dept),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(chatChannelsTable).values({
        companyId,
        type: "department",
        name: `${dept} Team`,
        department: dept,
        createdBy: null,
      });
    }
  }
}

export async function createChannel(input: CreateChannelInput) {
  const [channel] = await db
    .insert(chatChannelsTable)
    .values({
      companyId: input.companyId,
      type: input.type,
      name: input.name,
      department: input.department || null,
      createdBy: input.createdBy || null,
    })
    .returning();

  if (channel && input.memberUserIds && input.memberUserIds.length > 0) {
    await db.insert(chatChannelMembersTable).values(
      input.memberUserIds.map((userId) => ({ channelId: channel.id, userId })),
    );
  }
  return channel;
}

export async function getChannel(channelId: number, companyId: number) {
  const [channel] = await db
    .select()
    .from(chatChannelsTable)
    .where(and(eq(chatChannelsTable.id, channelId), eq(chatChannelsTable.companyId, companyId)))
    .limit(1);
  return channel;
}

export async function listChannels(companyId: number, userId: number) {
  await ensureCompanyChannels(companyId);

  const channels = await db
    .select()
    .from(chatChannelsTable)
    .where(and(eq(chatChannelsTable.companyId, companyId), eq(chatChannelsTable.isActive, true)))
    .orderBy(asc(chatChannelsTable.name));

  // For direct channels, only include if user is a member
  const visible = [];
  for (const c of channels) {
    if (c.type === "direct") {
      const member = await isChannelMember(c.id, userId);
      if (!member) continue;
    }
    visible.push(c);
  }

  // Unread counts per channel
  const counts: { channelId: number; unread: number }[] = [];
  for (const c of visible) {
    const unread = await getUnreadCount(c.id, userId);
    counts.push({ channelId: c.id, unread });
  }

  return visible.map((c) => ({
    ...c,
    unread: counts.find((x) => x.channelId === c.id)?.unread ?? 0,
  }));
}

export async function isChannelMember(channelId: number, userId: number): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ id: chatChannelMembersTable.id })
    .from(chatChannelMembersTable)
    .where(and(eq(chatChannelMembersTable.channelId, channelId), eq(chatChannelMembersTable.userId, userId)))
    .limit(1);
  return !!row;
}

export async function addChannelMember(channelId: number, userId: number) {
  try {
    await db.insert(chatChannelMembersTable).values({ channelId, userId });
  } catch {
    // ignore duplicate
  }
}

export async function getUnreadCount(channelId: number, userId: number): Promise<number> {
  if (!userId) return 0;
  const [member] = await db
    .select({ lastReadAt: chatChannelMembersTable.lastReadAt })
    .from(chatChannelMembersTable)
    .where(and(eq(chatChannelMembersTable.channelId, channelId), eq(chatChannelMembersTable.userId, userId)))
    .limit(1);
  if (!member) return 0;

  const [row] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.channelId, channelId),
        member.lastReadAt ? gt(chatMessagesTable.createdAt, member.lastReadAt) : undefined,
        sql`${chatMessagesTable.userId} <> ${userId}`,
      ),
    );
  return Number(row?.unread ?? 0);
}

export async function markChannelRead(channelId: number, userId: number) {
  if (!userId) return;
  await db
    .insert(chatChannelMembersTable)
    .values({ channelId, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [chatChannelMembersTable.channelId, chatChannelMembersTable.userId],
      set: { lastReadAt: new Date() },
    });

  // Also mark all messages in this channel as read
  const messages = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.channelId, channelId));
  if (messages.length > 0) {
    await db.insert(chatMessageReadsTable).values(
      messages.map((m) => ({ messageId: m.id, userId, readAt: new Date() })),
    ).onConflictDoNothing();
  }
}

export async function createMessage(input: {
  channelId: number;
  userId: number;
  displayName: string;
  content: string;
  replyToId?: number | null;
  attachments?: Array<{ name: string; objectPath: string; contentType: string; size?: number }>;
  mentions?: number[];
  isAnnouncement?: boolean;
}) {
  const [message] = await db
    .insert(chatMessagesTable)
    .values({
      channelId: input.channelId,
      userId: input.userId,
      displayName: input.displayName,
      content: input.content,
      replyToId: input.replyToId || null,
      attachments: input.attachments || [],
      mentions: input.mentions || [],
      isAnnouncement: input.isAnnouncement || false,
      reactions: {},
    })
    .returning();
  return message;
}

export async function getMessages(channelId: number, limit = 50, beforeId?: number) {
  const conditions = [eq(chatMessagesTable.channelId, channelId)];
  if (beforeId) {
    conditions.push(sql`${chatMessagesTable.id} < ${beforeId}`);
  }
  return db
    .select()
    .from(chatMessagesTable)
    .where(and(...conditions))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);
}

export async function getMessageReads(messageIds: number[]) {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(chatMessageReadsTable)
    .where(inArray(chatMessageReadsTable.messageId, messageIds));
}

export async function searchMessages(companyId: number, query: string, limit = 20) {
  const channels = await db
    .select({ id: chatChannelsTable.id })
    .from(chatChannelsTable)
    .where(eq(chatChannelsTable.companyId, companyId));
  const channelIds = channels.map((c) => c.id);
  if (channelIds.length === 0) return [];

  return db
    .select()
    .from(chatMessagesTable)
    .where(and(inArray(chatMessagesTable.channelId, channelIds), like(chatMessagesTable.content, `%${query}%`)))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);
}

export async function pinMessage(messageId: number, channelId: number, pinned: boolean) {
  const [row] = await db
    .update(chatMessagesTable)
    .set({ isPinned: pinned, editedAt: new Date() })
    .where(and(eq(chatMessagesTable.id, messageId), eq(chatMessagesTable.channelId, channelId)))
    .returning();
  return row;
}

export async function editMessage(messageId: number, channelId: number, content: string) {
  const [row] = await db
    .update(chatMessagesTable)
    .set({ content, editedAt: new Date() })
    .where(and(eq(chatMessagesTable.id, messageId), eq(chatMessagesTable.channelId, channelId)))
    .returning();
  return row;
}

export async function deleteMessage(messageId: number, channelId: number, userId: number) {
  const [row] = await db
    .delete(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.id, messageId),
        eq(chatChannelsTable.id, channelId),
      ),
    )
    .returning();
  return row;
}

export async function addReaction(messageId: number, userId: number, emoji: string) {
  const [message] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, messageId)).limit(1);
  if (!message) return null;

  const reactions = { ...(message.reactions || {}) };
  const list = reactions[emoji] ? [...reactions[emoji]] : [];
  if (!list.includes(userId)) list.push(userId);
  reactions[emoji] = list;

  const [updated] = await db
    .update(chatMessagesTable)
    .set({ reactions })
    .where(eq(chatMessagesTable.id, messageId))
    .returning();
  return updated;
}

export async function removeReaction(messageId: number, userId: number, emoji: string) {
  const [message] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, messageId)).limit(1);
  if (!message) return null;

  const reactions = { ...(message.reactions || {}) };
  reactions[emoji] = (reactions[emoji] || []).filter((id) => id !== userId);
  if (reactions[emoji].length === 0) delete reactions[emoji];

  const [updated] = await db
    .update(chatMessagesTable)
    .set({ reactions })
    .where(eq(chatMessagesTable.id, messageId))
    .returning();
  return updated;
}

export async function getPinnedMessages(channelId: number) {
  return db
    .select()
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.channelId, channelId), eq(chatMessagesTable.isPinned, true)))
    .orderBy(desc(chatMessagesTable.createdAt));
}

export async function getUserDisplayName(userId: number): Promise<string> {
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return "Unknown";
  return user.name?.trim() || "Unknown";
}

export async function ensureDirectChannel(companyId: number, userIdA: number, userIdB: number): Promise<number> {
  const members = await db.select().from(chatChannelMembersTable);
  const channelsA = members.filter((m) => m.userId === userIdA).map((m) => m.channelId);
  const channelsB = members.filter((m) => m.userId === userIdB).map((m) => m.channelId);
  const common = channelsA.find((id) => channelsB.includes(id));
  if (common) {
    const [channel] = await db.select().from(chatChannelsTable).where(eq(chatChannelsTable.id, common)).limit(1);
    if (channel && channel.type === "direct") return channel.id;
  }

  const nameA = await getUserDisplayName(userIdA);
  const nameB = await getUserDisplayName(userIdB);
  const channel = await createChannel({
    companyId,
    type: "direct",
    name: `${nameA} ↔ ${nameB}`,
    memberUserIds: [userIdA, userIdB],
  });
  return channel!.id;
}

export async function getCompanyUsers(companyId: number) {
  const companyUsers = await db.select().from(usersTable);
  return companyUsers.filter((u) => (u.companyIds as number[]).includes(companyId));
}
