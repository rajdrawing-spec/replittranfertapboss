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
} from "../lib/meetings/meeting.service";

const router: IRouter = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

router.get("/meetings/settings", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const settings = await getOrCreateMeetingSettings(companyId);
    res.json(settings);
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

router.get("/meetings", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const meetings = await listCompanyMeetings(companyId, userId);
    res.json(meetings);
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
    const meetings = await listUpcomingMeetings(companyId, userId);
    res.json(meetings);
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
    const meetings = await listMyMeetings(companyId, userId);
    res.json(meetings);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list my meetings" });
  }
});

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
      provider: req.body.provider,
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
    res.status(201).json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

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
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
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
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to end meeting" });
  }
});

router.post("/meetings/join/:meetingId", requirePermission("meetings.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const meeting = await joinMeeting(String(req.params.meetingId), userId);
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json(meeting);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to join meeting" });
  }
});

router.post("/meetings/leave/:meetingId", requirePermission("meetings.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const meeting = await leaveMeeting(String(req.params.meetingId), userId);
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
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
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
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
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await rejectInvitation(id, userId);
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to reject invitation" });
  }
});

export default router;
