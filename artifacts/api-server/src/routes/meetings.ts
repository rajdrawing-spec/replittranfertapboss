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

// ── Create meeting ────────────────────────────────────────────────────────────
router.post("/meetings", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
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
      participantIds: req.body.participantIds,
      waitingRoom: req.body.waitingRoom,
      password: req.body.password,
      maxParticipants: req.body.maxParticipants,
      isRecurring: req.body.isRecurring,
      recurrence: req.body.recurrence,
    });

    // Notify invited participants via Socket.IO
    const invitedIds = (req.body.participantIds as number[] | undefined || []).filter((id) => id !== userId);
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
