import { db, chatChannelsTable, chatChannelMembersTable, chatMessagesTable, chatMessageReadsTable, usersTable, employeesTable, chatPollsTable, userStatusTable } from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, like, gt } from "drizzle-orm";

/** Returns true if the user has the super_admin role (bypass all company/channel gates). */
async function isUserSuperAdmin(userId: number): Promise<boolean> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.role === "super_admin";
}

export interface CreateChannelInput {
  companyId: number;
  type: "team" | "department" | "direct" | "group";
  name: string;
  department?: string | null;
  iconUrl?: string | null;
  description?: string | null;
  isGroup?: boolean;
  createdBy?: number;
  memberUserIds?: number[];
}

export interface WorkspaceUser {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string | null;
  designation: string | null;
  presence: "online" | "away" | "busy" | "in_meeting" | "offline";
  statusMessage: string | null;
  lastSeenAt: string | null;
}

export interface ChannelWithMeta {
  id: number;
  companyId: number;
  type: string;
  name: string;
  department: string | null;
  iconUrl: string | null;
  description: string | null;
  isGroup: boolean;
  createdBy: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  unread: number;
  lastMessage?: { content: string; displayName: string; createdAt: string } | null;
}

/* ─────────────────── Company channel bootstrap ────────────────────────── */

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

/* ─────────────────── Channel CRUD ─────────────────────────────────────── */

export async function createChannel(input: CreateChannelInput) {
  const [channel] = await db
    .insert(chatChannelsTable)
    .values({
      companyId: input.companyId,
      type: input.type,
      name: input.name,
      department: input.department || null,
      iconUrl: input.iconUrl || null,
      description: input.description || null,
      isGroup: input.isGroup ?? false,
      createdBy: input.createdBy || null,
    })
    .returning();

  if (channel && input.memberUserIds && input.memberUserIds.length > 0) {
    await db.insert(chatChannelMembersTable).values(
      input.memberUserIds.map((userId, i) => ({
        channelId: channel.id,
        userId,
        isAdmin: i === 0 && input.type === "group", // first member is admin for groups
      })),
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

export async function getChannelById(channelId: number) {
  const [channel] = await db
    .select()
    .from(chatChannelsTable)
    .where(eq(chatChannelsTable.id, channelId))
    .limit(1);
  return channel;
}

export async function updateChannelInfo(
  channelId: number,
  updates: { name?: string; iconUrl?: string | null; description?: string | null },
) {
  const [updated] = await db
    .update(chatChannelsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(chatChannelsTable.id, channelId))
    .returning();
  return updated;
}

/* ─────────────────── Workspace-level channel listing ───────────────────── */

export async function listChannels(userId: number): Promise<ChannelWithMeta[]> {
  // Get user's company IDs and role
  const [user] = await db
    .select({ companyIds: usersTable.companyIds, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const isSA = user?.role === "super_admin";
  const companyIds: number[] = (user?.companyIds as number[] | null) ?? [];

  // Bootstrap team/dept channels for each company (idempotent)
  for (const cid of companyIds) {
    await ensureCompanyChannels(cid);
  }

  // Fetch team/department channels for all user companies
  // Super admins see ALL active team/dept channels regardless of company membership
  const teamChannels = isSA
    ? await db
        .select()
        .from(chatChannelsTable)
        .where(and(eq(chatChannelsTable.isActive, true), sql`${chatChannelsTable.type} NOT IN ('direct', 'group')`))
        .orderBy(asc(chatChannelsTable.name))
    : companyIds.length > 0
      ? await db
          .select()
          .from(chatChannelsTable)
          .where(
            and(
              inArray(chatChannelsTable.companyId, companyIds),
              eq(chatChannelsTable.isActive, true),
              sql`${chatChannelsTable.type} NOT IN ('direct', 'group')`,
            ),
          )
          .orderBy(asc(chatChannelsTable.name))
      : [];

  // Fetch channels the user is explicitly a member of (DMs, groups)
  const memberRows = await db
    .select({ channelId: chatChannelMembersTable.channelId })
    .from(chatChannelMembersTable)
    .where(eq(chatChannelMembersTable.userId, userId));

  const memberChannelIds = memberRows.map((r) => r.channelId);

  // Only include DM/group channels from membership rows.
  // Team/dept channels are already covered by teamChannels (company-scoped above);
  // including them here via stale membership rows would expose out-of-scope channels.
  const memberChannels =
    memberChannelIds.length > 0
      ? await db
          .select()
          .from(chatChannelsTable)
          .where(
            and(
              inArray(chatChannelsTable.id, memberChannelIds),
              eq(chatChannelsTable.isActive, true),
              sql`${chatChannelsTable.type} IN ('direct', 'group')`,
            ),
          )
          .orderBy(asc(chatChannelsTable.name))
      : [];

  // Deduplicate
  const seen = new Set<number>();
  const visible = [...teamChannels, ...memberChannels].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  if (visible.length === 0) return [];

  // Batch-fetch last messages using DISTINCT ON
  const channelIds = visible.map((c) => c.id);
  const lastMsgRows = await db.execute(sql`
    SELECT DISTINCT ON (channel_id) channel_id, content, display_name, created_at
    FROM chat_messages
    WHERE channel_id = ANY(${channelIds})
    ORDER BY channel_id, created_at DESC
  `);
  const lastMsgMap = new Map<number, { content: string; displayName: string; createdAt: string }>();
  for (const row of lastMsgRows.rows as any[]) {
    lastMsgMap.set(row.channel_id, {
      content: row.content,
      displayName: row.display_name,
      createdAt: row.created_at,
    });
  }

  // Get unread counts per channel
  const results: ChannelWithMeta[] = [];
  for (const c of visible) {
    const unread = await getUnreadCount(c.id, userId);
    results.push({
      ...c,
      iconUrl: (c as any).iconUrl ?? null,
      description: (c as any).description ?? null,
      isGroup: (c as any).isGroup ?? false,
      unread,
      lastMessage: lastMsgMap.get(c.id) ?? null,
    });
  }

  return results;
}

/* ─────────────────── Membership ───────────────────────────────────────── */

/**
 * Returns true if the user is allowed to access this channel:
 * - Team / department channels: user must belong to the same company.
 * - Direct / group channels: user must be an explicit member.
 */
export async function canAccessChannel(channelId: number, userId: number): Promise<boolean> {
  if (!userId) return false;
  // Super admins have unrestricted chat access
  if (await isUserSuperAdmin(userId)) return true;
  const channel = await getChannelById(channelId);
  if (!channel) return false;
  if (channel.type === "direct" || channel.type === "group" || (channel as any).isGroup) {
    return isChannelMember(channelId, userId);
  }
  // team / department: user must belong to the same company
  const ids = await getUserCompanyIds(userId);
  return ids.includes(channel.companyId);
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

export async function addChannelMember(channelId: number, userId: number, isAdmin = false) {
  try {
    await db.insert(chatChannelMembersTable).values({ channelId, userId, isAdmin });
  } catch {
    // ignore duplicate
  }
}

export async function removeChannelMember(channelId: number, userId: number) {
  await db
    .delete(chatChannelMembersTable)
    .where(
      and(eq(chatChannelMembersTable.channelId, channelId), eq(chatChannelMembersTable.userId, userId)),
    );
}

export async function setChannelMemberAdmin(channelId: number, userId: number, isAdmin: boolean) {
  await db
    .update(chatChannelMembersTable)
    .set({ isAdmin })
    .where(
      and(eq(chatChannelMembersTable.channelId, channelId), eq(chatChannelMembersTable.userId, userId)),
    );
}

export async function isChannelAdmin(channelId: number, userId: number): Promise<boolean> {
  // Super admins are always treated as channel admins
  if (await isUserSuperAdmin(userId)) return true;
  const [row] = await db
    .select({ isAdmin: chatChannelMembersTable.isAdmin })
    .from(chatChannelMembersTable)
    .where(and(eq(chatChannelMembersTable.channelId, channelId), eq(chatChannelMembersTable.userId, userId)))
    .limit(1);
  return row?.isAdmin ?? false;
}

export async function getChannelMembers(channelId: number) {
  const members = await db
    .select({
      userId: chatChannelMembersTable.userId,
      isAdmin: chatChannelMembersTable.isAdmin,
      joinedAt: chatChannelMembersTable.createdAt,
    })
    .from(chatChannelMembersTable)
    .where(eq(chatChannelMembersTable.channelId, channelId));

  if (members.length === 0) return [];

  const userIds = members.map((m) => m.userId);
  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      avatarUrl: usersTable.avatarUrl,
      department: usersTable.department,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

  const userMap = new Map(users.map((u) => [u.id, u]));

  return members.map((m) => ({
    ...m,
    user: userMap.get(m.userId) ?? null,
  }));
}

/* ─────────────────── Read tracking ────────────────────────────────────── */

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

  const messages = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.channelId, channelId));
  if (messages.length > 0) {
    await db
      .insert(chatMessageReadsTable)
      .values(messages.map((m) => ({ messageId: m.id, userId, readAt: new Date() })))
      .onConflictDoNothing();
  }
}

/* ─────────────────── Messages ─────────────────────────────────────────── */

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

export async function getMessageById(messageId: number) {
  const [msg] = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.id, messageId))
    .limit(1);
  return msg;
}

export async function forwardMessage(
  originalMessageId: number,
  targetChannelId: number,
  userId: number,
  displayName: string,
) {
  const original = await getMessageById(originalMessageId);
  if (!original) return null;
  const forwardContent = `↩ Forwarded from ${original.displayName}:\n${original.content}`;
  return createMessage({
    channelId: targetChannelId,
    userId,
    displayName,
    content: forwardContent,
    attachments: (original.attachments as any[]) ?? [],
  });
}

export async function getMessageReads(messageIds: number[]) {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(chatMessageReadsTable)
    .where(inArray(chatMessageReadsTable.messageId, messageIds));
}

/**
 * Returns the company IDs the user belongs to.
 * For super admins, returns an empty array — callers that use this must also
 * check `canAccessChannel`/`isUserSuperAdmin` for the bypass path.
 */
export async function getUserCompanyIds(userId: number): Promise<number[]> {
  const [user] = await db
    .select({ companyIds: usersTable.companyIds, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return (user?.companyIds as number[] | null) ?? [];
}

/**
 * Like getUserCompanyIds but returns true for super admins so callers can
 * skip the .includes(companyId) check without knowing the user's role.
 */
export async function userCanAccessCompany(userId: number, companyId: number): Promise<boolean> {
  const [user] = await db
    .select({ companyIds: usersTable.companyIds, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const ids = (user.companyIds as number[] | null) ?? [];
  return ids.includes(companyId);
}

export async function searchMessages(userId: number, query: string, limit = 20) {
  // Search across channels the user can legitimately access:
  //  - team/department channels in any of the user's companies (or ALL for super admins)
  //  - direct/group channels where the user is an explicit member

  // Super admins search ALL channels
  if (await isUserSuperAdmin(userId)) {
    return db
      .select()
      .from(chatMessagesTable)
      .where(like(chatMessagesTable.content, `%${query}%`))
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(limit);
  }

  const companyIds = await getUserCompanyIds(userId);

  // Only team/dept channels — never DM/group — from user's companies
  const teamChannelIds =
    companyIds.length > 0
      ? (
          await db
            .select({ id: chatChannelsTable.id })
            .from(chatChannelsTable)
            .where(
              and(
                inArray(chatChannelsTable.companyId, companyIds),
                sql`${chatChannelsTable.type} IN ('team', 'department')`,
              ),
            )
        ).map((c) => c.id)
      : [];

  // Explicit membership — restrict to DM/group channels only so that stale
  // membership rows cannot expose team/dept channels the user no longer has access to.
  const memberRows = await db
    .select({ channelId: chatChannelMembersTable.channelId })
    .from(chatChannelMembersTable)
    .innerJoin(chatChannelsTable, eq(chatChannelsTable.id, chatChannelMembersTable.channelId))
    .where(
      and(
        eq(chatChannelMembersTable.userId, userId),
        sql`${chatChannelsTable.type} IN ('direct', 'group')`,
        eq(chatChannelsTable.isActive, true),
      ),
    );
  const memberChannelIds = memberRows.map((r) => r.channelId);

  const allChannelIds = [...new Set([...teamChannelIds, ...memberChannelIds])];
  if (allChannelIds.length === 0) return [];

  return db
    .select()
    .from(chatMessagesTable)
    .where(and(inArray(chatMessagesTable.channelId, allChannelIds), like(chatMessagesTable.content, `%${query}%`)))
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
    .where(and(eq(chatMessagesTable.id, messageId), eq(chatMessagesTable.channelId, channelId)))
    .returning();
  return row;
}

export async function getPinnedMessages(channelId: number) {
  return db
    .select()
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.channelId, channelId), eq(chatMessagesTable.isPinned, true)))
    .orderBy(desc(chatMessagesTable.createdAt));
}

/* ─────────────────── Reactions ────────────────────────────────────────── */

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

/* ─────────────────── Users & presence ─────────────────────────────────── */

export async function getUserDisplayName(userId: number): Promise<string> {
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return "Unknown";
  return user.name?.trim() || "Unknown";
}

/**
 * Returns workspace users visible to the given caller:
 * - Super admins see all active users.
 * - Regular users see only users who share at least one company with them.
 */
export async function getWorkspaceUsersScopedToCompanies(callerId: number, callerCompanyIds: number[], isSuperAdmin: boolean): Promise<WorkspaceUser[]> {
  const all = await getWorkspaceUsers();

  if (isSuperAdmin) return all;

  if (callerCompanyIds.length === 0) {
    // No company membership — can only see self
    return all.filter((u) => u.id === callerId);
  }

  // Fetch companyIds for all users so we can do the overlap check
  const rawUsers = await db.select({ id: usersTable.id, companyIds: usersTable.companyIds }).from(usersTable).where(eq(usersTable.status, "active"));
  const allowedIds = new Set(
    rawUsers
      .filter((u) => {
        if (u.id === callerId) return true; // always include self
        const ids: number[] = (u.companyIds as number[] | null) ?? [];
        return ids.some((id) => callerCompanyIds.includes(id));
      })
      .map((u) => u.id),
  );

  return all.filter((u) => allowedIds.has(u.id));
}

export async function getWorkspaceUsers(): Promise<WorkspaceUser[]> {
  // All active users
  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      avatarUrl: usersTable.avatarUrl,
      department: usersTable.department,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(asc(usersTable.name));

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // Designations from employees — joined by email (employees has no userId FK)
  const userEmails = users.map((u) => u.email).filter(Boolean);
  const empRows =
    userEmails.length > 0
      ? await db
          .select({ email: employeesTable.email, designation: employeesTable.designation })
          .from(employeesTable)
          .where(inArray(employeesTable.email, userEmails))
      : [];
  const designationByEmail = new Map(empRows.map((e) => [e.email, e.designation]));
  const designationMap = new Map(users.map((u) => [u.id, designationByEmail.get(u.email) ?? null]));

  // Statuses
  const statusRows = await db
    .select()
    .from(userStatusTable)
    .where(inArray(userStatusTable.userId, userIds));
  const statusMap = new Map(statusRows.map((s) => [s.userId, s]));

  return users.map((u) => {
    const status = statusMap.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl ?? null,
      department: u.department ?? null,
      designation: designationMap.get(u.id) ?? null,
      presence: (status?.presence as WorkspaceUser["presence"]) ?? "offline",
      statusMessage: status?.statusMessage ?? null,
      lastSeenAt: status?.lastSeenAt?.toISOString() ?? null,
    };
  });
}

/**
 * Returns users belonging to a specific company (filters by companyIds JSON column).
 * When companyId is 0 / falsy, returns all active workspace users.
 */
export async function getCompanyUsers(companyId: number) {
  const all = await db.select().from(usersTable).where(eq(usersTable.status, "active"));
  if (!companyId) return all;
  return all.filter((u) => {
    const ids: number[] = (u.companyIds as number[] | null) ?? [];
    // Super admins are always included in company presence lists
    return u.role === "super_admin" || ids.includes(companyId);
  });
}

/* ─────────────────── Direct channels ──────────────────────────────────── */

export async function ensureDirectChannel(userId: number, otherUserId: number, companyId: number): Promise<number> {
  const [existing] = await db
    .select({ channelId: chatChannelsTable.id })
    .from(chatChannelsTable)
    .where(
      and(
        eq(chatChannelsTable.type, "direct"),
        eq(chatChannelsTable.isActive, true),
        sql`EXISTS (SELECT 1 FROM chat_channel_members a WHERE a.channel_id = ${chatChannelsTable.id} AND a.user_id = ${userId})`,
        sql`EXISTS (SELECT 1 FROM chat_channel_members b WHERE b.channel_id = ${chatChannelsTable.id} AND b.user_id = ${otherUserId})`,
      ),
    )
    .limit(1);

  if (existing) return existing.channelId;

  const nameA = await getUserDisplayName(userId);
  const nameB = await getUserDisplayName(otherUserId);
  const channel = await createChannel({
    companyId,
    type: "direct",
    name: `${nameA} ↔ ${nameB}`,
    memberUserIds: [userId, otherUserId],
  });
  return channel!.id;
}

/* ─────────────────── Group channels ───────────────────────────────────── */

export async function createGroupChannel(input: {
  name: string;
  description?: string;
  iconUrl?: string;
  createdBy: number;
  memberUserIds: number[];
  companyId: number;
}): Promise<typeof chatChannelsTable.$inferSelect> {
  const [channel] = await db
    .insert(chatChannelsTable)
    .values({
      companyId: input.companyId,
      type: "group",
      name: input.name,
      description: input.description || null,
      iconUrl: input.iconUrl || null,
      isGroup: true,
      createdBy: input.createdBy,
    })
    .returning();

  if (input.memberUserIds.length > 0) {
    await db.insert(chatChannelMembersTable).values(
      input.memberUserIds.map((uid) => ({
        channelId: channel.id,
        userId: uid,
        isAdmin: uid === input.createdBy,
      })),
    );
  }
  return channel;
}

/* ─────────────────── Status ────────────────────────────────────────────── */

export async function getUserStatuses(userIds: number[]) {
  if (userIds.length === 0) return [];
  const rows = await db.select().from(userStatusTable).where(inArray(userStatusTable.userId, userIds));
  return rows.map((r) => ({
    userId: r.userId,
    presence: r.presence as "online" | "away" | "busy" | "in_meeting" | "offline",
    statusMessage: r.statusMessage ?? undefined,
    doNotDisturb: r.doNotDisturb,
    lastSeenAt: r.lastSeenAt?.toISOString(),
  }));
}

export async function upsertUserStatus(userId: number, input: {
  presence?: string;
  statusMessage?: string;
  doNotDisturb?: boolean;
  dndUntil?: Date | null;
}) {
  const now = new Date();
  const [existing] = await db.select().from(userStatusTable).where(eq(userStatusTable.userId, userId)).limit(1);
  if (existing) {
    const [updated] = await db
      .update(userStatusTable)
      .set({
        presence: input.presence ?? existing.presence,
        statusMessage: input.statusMessage !== undefined ? input.statusMessage : existing.statusMessage,
        doNotDisturb: input.doNotDisturb ?? existing.doNotDisturb,
        dndUntil: input.dndUntil !== undefined ? input.dndUntil : existing.dndUntil,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(userStatusTable.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(userStatusTable)
    .values({
      userId,
      presence: input.presence ?? "online",
      statusMessage: input.statusMessage ?? null,
      doNotDisturb: input.doNotDisturb ?? false,
      dndUntil: input.dndUntil ?? null,
      lastSeenAt: now,
    })
    .returning();
  return created;
}

/* ─────────────────── Polls ─────────────────────────────────────────────── */

export async function getPolls(channelId: number) {
  return db.select().from(chatPollsTable).where(eq(chatPollsTable.channelId, channelId)).orderBy(desc(chatPollsTable.createdAt));
}

export async function getPollById(pollId: number) {
  const [poll] = await db.select().from(chatPollsTable).where(eq(chatPollsTable.id, pollId)).limit(1);
  return poll ?? null;
}

export async function createPoll(input: {
  channelId: number;
  userId: number;
  question: string;
  options: string[];
  isMultiple?: boolean;
}) {
  const [poll] = await db
    .insert(chatPollsTable)
    .values({
      channelId: input.channelId,
      userId: input.userId,
      question: input.question,
      options: input.options,
      votes: {},
      isMultiple: input.isMultiple ?? false,
    })
    .returning();
  return poll;
}

export async function votePoll(pollId: number, userId: number, optionIndex: number) {
  const [poll] = await db.select().from(chatPollsTable).where(eq(chatPollsTable.id, pollId)).limit(1);
  if (!poll) return null;
  const votes = { ...(poll.votes || {}) } as Record<string, number>;
  votes[String(userId)] = optionIndex;
  const [updated] = await db
    .update(chatPollsTable)
    .set({ votes })
    .where(eq(chatPollsTable.id, pollId))
    .returning();
  return updated;
}

export async function closePoll(pollId: number, userId: number) {
  const [poll] = await db.select().from(chatPollsTable).where(eq(chatPollsTable.id, pollId)).limit(1);
  if (!poll || poll.userId !== userId) return null;
  const [updated] = await db
    .update(chatPollsTable)
    .set({ closed: true })
    .where(eq(chatPollsTable.id, pollId))
    .returning();
  return updated;
}
