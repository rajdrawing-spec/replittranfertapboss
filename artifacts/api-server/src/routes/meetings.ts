import { Router, type IRouter } from "express";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import {
  createMeeting,
  listCompanyMeetings,
  listMyMeetings,
  listUpcomingMeetings,
  getMeeting,
  getMeetingByMeetingId,
  cancelMeeting,
  endMeeting,
  joinMeeting,
  leaveMeeting,
  getOrCreateMeetingSettings,
  updateMeetingSettings,
  acceptInvitation,
  rejectInvitation,
  isLiveKitConfigured,
} from "../lib/meetings/meeting.service";
import { broadcastMeetingRinging } from "../lib/chat/socket-server";
import { claimMeetingNote, processMeetingAudio, listMeetingNotes, getMeetingNote, assignActionItem } from "../lib/meetings/meeting-notes.service";
import { db, chatChannelMembersTable, chatChannelsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router: IRouter = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

// ── LiveKit configuration status ─────────────────────────────────────────────
router.get("/meetings/livekit-status", requirePermission("meetings.read"), (_req, res) => {
  res.json({ configured: isLiveKitConfigured() });
});

// ── LiveKit token endpoint ────────────────────────────────────────────────────
router.get("/meetings/token", requirePermission("meetings.read"), async (req, res) => {
  try {
    const { roomName, companyId: companyIdStr } = req.query;
    const companyId = parseInt(companyIdStr as string);
    const userId = getLocalUserId(req);
    const displayName = (req as any).localUser?.name || "Guest";

    if (!roomName || !companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Resolve the meeting by roomName (meetingId) and enforce tenant boundary
    const meeting = await getMeetingByMeetingId(String(roomName));
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    if (meeting.companyId !== companyId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Meetings that are cancelled or ended no longer accept participants
    if (meeting.status === "cancelled" || meeting.status === "ended") {
      res.status(410).json({ error: "Meeting has ended or been cancelled" });
      return;
    }
    // Group calls: any company member may join a meeting in their workspace.
    // Only users who have explicitly rejected an invitation are blocked.
    const isRejected = meeting.participants.some(
      (p) => p.userId === userId && p.status === "rejected",
    );
    if (isRejected) {
      res.status(403).json({ error: "You are not a participant of this meeting" });
      return;
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const serverUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !serverUrl) {
      res.status(503).json({ error: "LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET." });
      return;
    }

    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: String(userId),
      name: displayName,
      ttl: "4h",
    });
    at.addGrant({
      roomJoin: true,
      room: String(roomName),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    res.json({ token, serverUrl });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// ── Meeting settings ──────────────────────────────────────────────────────────
router.get("/meetings/settings", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const settings = await getOrCreateMeetingSettings(companyId);
    res.json({ ...settings, livekitConfigured: isLiveKitConfigured() });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.patch("/meetings/settings", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { companyId: _, ...values } = req.body;
    const settings = await updateMeetingSettings(companyId, values);
    res.json(settings);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ── Meeting listing ───────────────────────────────────────────────────────────
router.get("/meetings", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await listCompanyMeetings(companyId, userId));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list meetings" });
  }
});

router.get("/meetings/upcoming", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await listUpcomingMeetings(companyId, userId));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list upcoming meetings" });
  }
});

router.get("/meetings/my", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await listMyMeetings(companyId, userId));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list my meetings" });
  }
});

// ── AI Meeting Assistant: notes ───────────────────────────────────────────────
// NOTE: these must be registered before /meetings/:id so "notes" is not
// captured as an :id parameter.
router.get("/meetings/notes", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const channelId = req.query.channelId ? parseInt(String(req.query.channelId), 10) : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json(await listMeetingNotes(companyId, { channelId, q }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list meeting notes" });
  }
});

router.get("/meetings/notes/:id", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const note = await getMeetingNote(parseInt(String(req.params.id), 10), companyId);
    if (!note) { res.status(404).json({ error: "Note not found" }); return; }
    res.json(note);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load meeting note" });
  }
});

// Manually assign an unmatched action item to an employee (creates the task).
router.post("/meetings/notes/:id/action-items/:index/assign", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body?.companyId);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const noteId = parseInt(String(req.params.id), 10);
    const itemIndex = parseInt(String(req.params.index), 10);
    const employeeId = parseInt(req.body?.employeeId);
    if (isNaN(noteId) || isNaN(itemIndex) || itemIndex < 0 || !employeeId) {
      res.status(400).json({ error: "noteId, action item index, and employeeId are required" });
      return;
    }
    const updated = await assignActionItem(noteId, companyId, itemIndex, employeeId);
    res.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to assign action item";
    if (/not found|already has/i.test(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    req.log.error(e);
    res.status(500).json({ error: "Failed to assign action item" });
  }
});

// Upload captured meeting audio → kicks off the async AI notes pipeline.
const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // 30MB decoded (~2h at 32kbps opus)
router.post("/meetings/audio/:meetingId", requirePermission("meetings.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const meeting = await getMeetingByMeetingId(String(req.params.meetingId));
    if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
    if (!canAccessCompany(req, meeting.companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Only actual meeting participants (or the organizer) may submit the
    // recording — company read access alone is not enough.
    const isOrganizer = meeting.organizerId === userId;
    const participant = meeting.participants.find((p) => p.userId === userId);
    if (!isOrganizer && (!participant || participant.status === "rejected")) {
      res.status(403).json({ error: "Only meeting participants can upload the recording" });
      return;
    }

    const audio = req.body?.audio;
    if (typeof audio !== "string" || !audio.startsWith("data:audio/")) {
      res.status(400).json({ error: "Body must include `audio` as a data:audio/* base64 data URL" });
      return;
    }
    const commaIdx = audio.indexOf(",");
    const header = audio.slice(0, commaIdx);
    const base64 = audio.slice(commaIdx + 1);
    if (commaIdx === -1 || !header.includes(";base64")) {
      res.status(400).json({ error: "Audio must be base64-encoded" });
      return;
    }
    const mimeType = header.slice(5, header.indexOf(";"));
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: "Audio exceeds the 30MB limit" });
      return;
    }
    if (approxBytes < 1024) {
      res.status(400).json({ error: "Audio recording is empty" });
      return;
    }

    const note = await claimMeetingNote(meeting, userId);
    if (!note) {
      // Another participant already uploaded this meeting's recording.
      res.status(200).json({ status: "already_processing" });
      return;
    }
    void processMeetingAudio(note.id, meeting, base64, mimeType);
    res.status(202).json({ status: "processing", noteId: note.id });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to process meeting audio" });
  }
});

// ── Create meeting ────────────────────────────────────────────────────────────
router.post("/meetings", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // When a meeting is started from a chat channel without an explicit invite
    // list, invite every channel member so they get the ringing popup.
    let participantIds: number[] | undefined = req.body.participantIds;
    const channelId = req.body.channelId ? parseInt(String(req.body.channelId), 10) : undefined;
    if (channelId && (!participantIds || participantIds.length === 0)) {
      // The channel must belong to the same company the meeting is created in
      // — otherwise a crafted channelId could ring users of another tenant.
      const [channel] = await db
        .select({ id: chatChannelsTable.id })
        .from(chatChannelsTable)
        .where(and(eq(chatChannelsTable.id, channelId), eq(chatChannelsTable.companyId, companyId)))
        .limit(1);
      if (!channel) {
        res.status(403).json({ error: "Channel does not belong to this company" });
        return;
      }
      const members = await db
        .select({ userId: chatChannelMembersTable.userId })
        .from(chatChannelMembersTable)
        .where(eq(chatChannelMembersTable.channelId, channelId));
      participantIds = members.map((m) => m.userId).filter((id) => id !== userId);
    }

    const meeting = await createMeeting({
      companyId,
      channelId: req.body.channelId,
      taskId: req.body.taskId,
      title: req.body.title,
      agenda: req.body.agenda,
      provider: "livekit",
      scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : null,
      duration: req.body.duration,
      organizerId: userId,
      participantIds,
      waitingRoom: req.body.waitingRoom,
      password: req.body.password,
      maxParticipants: req.body.maxParticipants,
      isRecurring: req.body.isRecurring,
      recurrence: req.body.recurrence,
    });

    // Notify invited participants via Socket.IO
    const invitedIds = (participantIds || []).filter((id) => id !== userId);
    if (invitedIds.length > 0) {
      const organizerName = (req as any).localUser?.name || "Someone";
      broadcastMeetingRinging(invitedIds, {
        meetingId: meeting.meetingId,
        title: meeting.title,
        organizerName,
        companyId,
      });
    }

    res.status(201).json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

// ── Single meeting ────────────────────────────────────────────────────────────
router.get("/meetings/:id", requirePermission("meetings.read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const meeting = await getMeeting(id, companyId);
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load meeting" });
  }
});

router.post("/meetings/:id/cancel", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const meeting = await cancelMeeting(id, companyId);
    if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to cancel meeting" });
  }
});

router.post("/meetings/:id/end", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const meeting = await endMeeting(id, companyId);
    if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to end meeting" });
  }
});

// ── Join / Leave ──────────────────────────────────────────────────────────────
router.post("/meetings/join/:meetingId", requirePermission("meetings.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const meeting = await getMeetingByMeetingId(String(req.params.meetingId));
    if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
    if (!canAccessCompany(req, meeting.companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (meeting.status === "cancelled" || meeting.status === "ended") {
      res.status(410).json({ error: "Meeting has ended or been cancelled" });
      return;
    }
    const result = await joinMeeting(String(req.params.meetingId), userId);
    if (!result) { res.status(404).json({ error: "Meeting not found" }); return; }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to join meeting" });
  }
});

router.post("/meetings/leave/:meetingId", requirePermission("meetings.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    const meeting = await leaveMeeting(String(req.params.meetingId), userId);
    if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to leave meeting" });
  }
});

router.post("/meetings/:id/accept", requirePermission("meetings.read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    await acceptInvitation(id, userId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
});

router.post("/meetings/:id/reject", requirePermission("meetings.read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
    await rejectInvitation(id, userId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to reject invitation" });
  }
});

export default router;
