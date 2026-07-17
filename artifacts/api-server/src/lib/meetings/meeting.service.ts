import { db, meetingsTable, meetingParticipantsTable, meetingSettingsTable, companiesTable, usersTable, notificationsTable, generatedTasksTable, chatChannelsTable } from "@workspace/db";
import { eq, and, or, gte, desc, asc, inArray } from "drizzle-orm";
import { liveKitProvider, isLiveKitConfigured } from "./livekit-provider";
import type { MeetingProvider } from "./meeting-provider";

const providers: Record<string, MeetingProvider> = {
  livekit: liveKitProvider,
};

export function getProvider(providerKey: string): MeetingProvider {
  return providers[providerKey] || liveKitProvider;
}

export interface CreateMeetingInput {
  companyId: number;
  channelId?: number | null;
  taskId?: number | null;
  title: string;
  agenda?: string;
  provider?: string;
  scheduledAt?: Date | null;
  duration?: number;
  organizerId: number;
  participantIds?: number[];
  waitingRoom?: boolean;
  password?: string | null;
  maxParticipants?: number;
  isRecurring?: boolean;
  recurrence?: string | null;
}

export async function getOrCreateMeetingSettings(companyId: number) {
  const [existing] = await db.select().from(meetingSettingsTable).where(eq(meetingSettingsTable.companyId, companyId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(meetingSettingsTable).values({ companyId, defaultProvider: "livekit" }).returning();
  return created;
}

export async function updateMeetingSettings(companyId: number, values: Partial<typeof meetingSettingsTable.$inferInsert>) {
  const [existing] = await db.select().from(meetingSettingsTable).where(eq(meetingSettingsTable.companyId, companyId)).limit(1);
  if (existing) {
    const [updated] = await db.update(meetingSettingsTable).set({ ...values, updatedAt: new Date() }).where(eq(meetingSettingsTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(meetingSettingsTable).values({ ...values, companyId }).returning();
  return created;
}

export async function createMeeting(input: CreateMeetingInput) {
  const settings = await getOrCreateMeetingSettings(input.companyId);
  const [company] = await db.select({ slug: companiesTable.slug }).from(companiesTable).where(eq(companiesTable.id, input.companyId)).limit(1);
  const provider = getProvider(input.provider || settings.defaultProvider || "livekit");

  let department: string | undefined;
  let project: string | undefined;
  if (input.taskId) {
    const [task] = await db.select({ description: generatedTasksTable.description }).from(generatedTasksTable).where(eq(generatedTasksTable.id, input.taskId)).limit(1);
    if (task) project = task.description?.slice(0, 20);
  }
  if (input.channelId) {
    const [channel] = await db.select({ department: chatChannelsTable.department }).from(chatChannelsTable).where(eq(chatChannelsTable.id, input.channelId)).limit(1);
    department = channel?.department || undefined;
  }

  let displayName: string | undefined;
  let email: string | undefined;
  let avatarUrl: string | undefined;
  if (input.organizerId) {
    const [organizer] = await db.select({ name: usersTable.name, email: usersTable.email, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(eq(usersTable.id, input.organizerId)).limit(1);
    if (organizer) {
      displayName = organizer.name;
      email = organizer.email;
      avatarUrl = organizer.avatarUrl ?? undefined;
    }
  }

  const { meetingId, roomUrl } = provider.createRoom({
    companySlug: company?.slug || "TBOS",
    department,
    project,
    date: input.scheduledAt || new Date(),
    displayName,
    email,
    avatarUrl,
    userId: input.organizerId,
  });

  const [meeting] = await db.insert(meetingsTable).values({
    companyId: input.companyId,
    channelId: input.channelId || null,
    taskId: input.taskId || null,
    title: input.title,
    agenda: input.agenda || null,
    meetingId,
    provider: provider.key,
    roomUrl,
    jwt: null,
    password: input.password || null,
    scheduledAt: input.scheduledAt || null,
    duration: input.duration ?? settings.defaultDuration ?? 30,
    organizerId: input.organizerId,
    status: input.scheduledAt && input.scheduledAt > new Date() ? "scheduled" : "ongoing",
    waitingRoom: input.waitingRoom ?? settings.waitingRoomEnabled ?? false,
    maxParticipants: input.maxParticipants ?? settings.maxParticipants ?? 50,
    isRecurring: input.isRecurring || false,
    recurrence: input.recurrence || null,
  }).returning();

  const participants = new Set([input.organizerId, ...(input.participantIds || [])]);
  if (participants.size > 0) {
    await db.insert(meetingParticipantsTable).values(
      [...participants].map((userId) => ({ meetingId: meeting.id, userId, status: userId === input.organizerId ? "accepted" : "invited" })),
    ).onConflictDoNothing();
  }

  await notifyMeetingCreated(meeting, [...participants]);
  return meeting;
}

export async function listCompanyMeetings(companyId: number, userId?: number) {
  const meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.companyId, companyId)).orderBy(desc(meetingsTable.scheduledAt));
  return Promise.all(meetings.map(async (m) => ({
    ...m,
    participants: await getMeetingParticipants(m.id),
    myStatus: userId ? await getParticipantStatus(m.id, userId) : undefined,
  })));
}

export async function listMyMeetings(companyId: number, userId: number) {
  const participantRows = await db.select({ meetingId: meetingParticipantsTable.meetingId }).from(meetingParticipantsTable).where(eq(meetingParticipantsTable.userId, userId));
  const meetingIds = participantRows.map((p) => p.meetingId);
  if (meetingIds.length === 0) return [];
  const meetings = await db.select().from(meetingsTable).where(and(eq(meetingsTable.companyId, companyId), inArray(meetingsTable.id, meetingIds))).orderBy(desc(meetingsTable.scheduledAt));
  return Promise.all(meetings.map(async (m) => ({
    ...m,
    participants: await getMeetingParticipants(m.id),
    myStatus: await getParticipantStatus(m.id, userId),
  })));
}

export async function listUpcomingMeetings(companyId: number, userId?: number) {
  const now = new Date();
  const meetings = await db.select().from(meetingsTable).where(
    and(
      eq(meetingsTable.companyId, companyId),
      or(eq(meetingsTable.status, "scheduled"), eq(meetingsTable.status, "ongoing")),
      gte(meetingsTable.scheduledAt, now),
    ),
  ).orderBy(asc(meetingsTable.scheduledAt));
  return Promise.all(meetings.map(async (m) => ({
    ...m,
    participants: await getMeetingParticipants(m.id),
    myStatus: userId ? await getParticipantStatus(m.id, userId) : undefined,
  })));
}

export async function getMeeting(id: number, companyId: number) {
  const [meeting] = await db.select().from(meetingsTable).where(and(eq(meetingsTable.id, id), eq(meetingsTable.companyId, companyId))).limit(1);
  if (!meeting) return null;
  return { ...meeting, participants: await getMeetingParticipants(meeting.id) };
}

export async function getMeetingByMeetingId(meetingId: string) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.meetingId, meetingId)).limit(1);
  if (!meeting) return null;
  return { ...meeting, participants: await getMeetingParticipants(meeting.id) };
}

export async function getMeetingParticipants(meetingId: number) {
  return db.select().from(meetingParticipantsTable).where(eq(meetingParticipantsTable.meetingId, meetingId));
}

export async function getParticipantStatus(meetingId: number, userId: number): Promise<string | undefined> {
  const [row] = await db.select({ status: meetingParticipantsTable.status }).from(meetingParticipantsTable).where(and(eq(meetingParticipantsTable.meetingId, meetingId), eq(meetingParticipantsTable.userId, userId))).limit(1);
  return row?.status;
}

export async function updateMeetingStatus(id: number, companyId: number, status: string) {
  const [updated] = await db.update(meetingsTable).set({ status, updatedAt: new Date() }).where(and(eq(meetingsTable.id, id), eq(meetingsTable.companyId, companyId))).returning();
  return updated;
}

export async function cancelMeeting(id: number, companyId: number) {
  const meeting = await updateMeetingStatus(id, companyId, "cancelled");
  if (meeting) {
    const participants = await getMeetingParticipants(meeting.id);
    await notifyMeetingCancelled(meeting, participants.map((p) => p.userId));
  }
  return meeting;
}

export async function joinMeeting(meetingId: string, userId: number) {
  const meeting = await getMeetingByMeetingId(meetingId);
  if (!meeting) return null;
  await db.insert(meetingParticipantsTable).values({ meetingId: meeting.id, userId, status: "joined", joinedAt: new Date() }).onConflictDoUpdate({
    target: [meetingParticipantsTable.meetingId, meetingParticipantsTable.userId],
    set: { status: "joined", joinedAt: new Date() },
  });
  await db.update(meetingsTable).set({ status: "ongoing" }).where(eq(meetingsTable.id, meeting.id));
  return meeting;
}

export async function leaveMeeting(meetingId: string, userId: number) {
  const meeting = await getMeetingByMeetingId(meetingId);
  if (!meeting) return null;
  await db.update(meetingParticipantsTable).set({ status: "accepted", leftAt: new Date() }).where(and(eq(meetingParticipantsTable.meetingId, meeting.id), eq(meetingParticipantsTable.userId, userId)));
  return meeting;
}

export async function endMeeting(id: number, companyId: number) {
  return updateMeetingStatus(id, companyId, "ended");
}

export async function notifyMeetingCreated(meeting: typeof meetingsTable.$inferSelect, participantIds: number[]) {
  for (const userId of participantIds) {
    if (userId === meeting.organizerId) continue;
    await db.insert(notificationsTable).values({
      type: "meeting",
      title: "New meeting",
      message: `You were invited to "${meeting.title}"`,
      severity: "info",
      companyId: meeting.companyId,
      companyName: "",
      actionUrl: "/meetings",
      isRead: false,
    });
  }
}

export async function notifyMeetingCancelled(meeting: typeof meetingsTable.$inferSelect, participantIds: number[]) {
  for (const userId of participantIds) {
    if (userId === meeting.organizerId) continue;
    await db.insert(notificationsTable).values({
      type: "meeting",
      title: "Meeting cancelled",
      message: `"${meeting.title}" was cancelled`,
      severity: "warning",
      companyId: meeting.companyId,
      companyName: "",
      actionUrl: "/meetings",
      isRead: false,
    });
  }
}

export async function getUserDisplayName(userId: number): Promise<string> {
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.name?.trim() || "Unknown";
}

export async function acceptInvitation(meetingId: number, userId: number) {
  await db.insert(meetingParticipantsTable).values({ meetingId, userId, status: "accepted" }).onConflictDoUpdate({
    target: [meetingParticipantsTable.meetingId, meetingParticipantsTable.userId],
    set: { status: "accepted" },
  });
}

export async function rejectInvitation(meetingId: number, userId: number) {
  await db.insert(meetingParticipantsTable).values({ meetingId, userId, status: "rejected" }).onConflictDoUpdate({
    target: [meetingParticipantsTable.meetingId, meetingParticipantsTable.userId],
    set: { status: "rejected" },
  });
}

export { isLiveKitConfigured };
