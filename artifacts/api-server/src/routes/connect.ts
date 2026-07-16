import { Router } from "express";
import { z } from "zod";
import { db, chatChannelsTable, chatMessagesTable, chatPollsTable, userStatusTable, meetingsTable, meetingParticipantsTable, meetingTemplatesTable, meetingNotesTable, plannerEventsTable, workloadSnapshotsTable, generatedTasksTable, employeesTable, aiTaskCompanySettingsTable, aiTaskCompanyHolidaysTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, desc, asc, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { getActiveProvider } from "../lib/ai-provider";
import { emitNotification } from "../lib/notify";
import { isAiTasksEnabled } from "../lib/features";

const router = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

function parseParamId(params: any, key: string): number {
  return parseInt(String(params[key]));
}

function parseBody(body: any) {
  return body;
}

// ── Chat polls ───────────────────────────────────────────────────────────────
router.get("/chat/channels/:id/polls", requirePermission("chat.read"), async (req, res) => {
  try {
    const channelId = parseParamId(req.params, "id");
    const polls = await db.select().from(chatPollsTable).where(eq(chatPollsTable.channelId, channelId)).orderBy(desc(chatPollsTable.createdAt));
    res.json(polls);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load polls" }); }
});

router.post("/chat/channels/:id/polls", requirePermission("chat.write"), async (req, res) => {
  try {
    const channelId = parseParamId(req.params, "id");
    const userId = getLocalUserId(req);
    const { question, options, isMultiple } = z.object({ question: z.string().min(1), options: z.array(z.string()).min(2), isMultiple: z.boolean().default(false) }).parse(req.body);
    const [poll] = await db.insert(chatPollsTable).values({ channelId, userId: userId!, question, options, isMultiple }).returning();
    res.status(201).json(poll);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create poll" }); }
});

router.post("/chat/polls/:pollId/vote", requirePermission("chat.write"), async (req, res) => {
  try {
    const pollId = parseParamId(req.params, "pollId");
    const userId = getLocalUserId(req);
    const { optionIndex } = z.object({ optionIndex: z.number() }).parse(req.body);
    const [poll] = await db.select().from(chatPollsTable).where(eq(chatPollsTable.id, pollId));
    if (!poll) { res.status(404).json({ error: "Poll not found" }); return; }
    const votes = { ...(poll.votes || {}), [userId!]: optionIndex };
    const [updated] = await db.update(chatPollsTable).set({ votes }).where(eq(chatPollsTable.id, pollId)).returning();
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to vote" }); }
});

router.post("/chat/polls/:pollId/close", requirePermission("chat.manage"), async (req, res) => {
  try {
    const pollId = parseParamId(req.params, "pollId");
    const [poll] = await db.update(chatPollsTable).set({ closed: true }).where(eq(chatPollsTable.id, pollId)).returning();
    if (!poll) { res.status(404).json({ error: "Poll not found" }); return; }
    res.json(poll);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to close poll" }); }
});

// ── User status / presence / DND ────────────────────────────────────────────
router.get("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const companyUsers = await db.select({ userId: usersTable.id }).from(usersTable).where(sql`${usersTable.companyIds} @> ${JSON.stringify([companyId])}::jsonb`);
    const userIds = companyUsers.map(u => u.userId);
    if (userIds.length === 0) { res.json([]); return; }
    const statuses = await db.select().from(userStatusTable).where(inArray(userStatusTable.userId, userIds));
    res.json(statuses);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load status" }); }
});

router.post("/users/status", requirePermission("chat.read"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    if (!userId) { res.status(401).json({ error: "Auth required" }); return; }
    const { presence, statusMessage, doNotDisturb, dndUntil } = z.object({
      presence: z.enum(["online", "away", "offline"]).optional(),
      statusMessage: z.string().optional(),
      doNotDisturb: z.boolean().optional(),
      dndUntil: z.string().datetime().optional().nullable(),
    }).parse(req.body);
    const existing = await db.select({ id: userStatusTable.id }).from(userStatusTable).where(eq(userStatusTable.userId, userId));
    const values = {
      presence, statusMessage, doNotDisturb,
      dndUntil: dndUntil ? new Date(dndUntil) : null,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    if (existing.length > 0) {
      const [row] = await db.update(userStatusTable).set(values).where(eq(userStatusTable.userId, userId)).returning();
      res.json(row);
    } else {
      const [row] = await db.insert(userStatusTable).values({ userId, ...values }).returning();
      res.status(201).json(row);
    }
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update status" }); }
});

// ── Meeting templates ───────────────────────────────────────────────────────
router.get("/meetings/templates", requirePermission("meetings.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const templates = await db.select().from(meetingTemplatesTable).where(eq(meetingTemplatesTable.companyId, companyId)).orderBy(desc(meetingTemplatesTable.createdAt));
    res.json(templates);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load templates" }); }
});

router.post("/meetings/templates", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    const { companyId, name, title, agenda, duration, waitingRoom, passwordRequired, isRecurring, recurrence, defaultParticipantIds } = z.object({
      companyId: z.number(), name: z.string(), title: z.string(), agenda: z.string().optional(), duration: z.number().default(30),
      waitingRoom: z.boolean().default(false), passwordRequired: z.boolean().default(false), isRecurring: z.boolean().default(false),
      recurrence: z.string().optional(), defaultParticipantIds: z.array(z.number()).default([]),
    }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [template] = await db.insert(meetingTemplatesTable).values({
      companyId, name, title, agenda, duration, waitingRoom, passwordRequired, isRecurring, recurrence, defaultParticipantIds,
    }).returning();
    res.status(201).json(template);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create template" }); }
});

router.delete("/meetings/templates/:id", requirePermission("meetings.manage"), async (req, res) => {
  try {
    const id = parseParamId(req.params, "id");
    const [template] = await db.delete(meetingTemplatesTable).where(eq(meetingTemplatesTable.id, id)).returning();
    if (!template) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete template" }); }
});

// ── Meeting notes ───────────────────────────────────────────────────────────
router.get("/meetings/:id/notes", requirePermission("meetings.read"), async (req, res) => {
  try {
    const meetingId = parseParamId(req.params, "id");
    const notes = await db.select().from(meetingNotesTable).where(eq(meetingNotesTable.meetingId, meetingId)).orderBy(desc(meetingNotesTable.createdAt));
    res.json(notes);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load notes" }); }
});

router.post("/meetings/:id/notes", requirePermission("meetings.read"), async (req, res) => {
  try {
    const meetingId = parseParamId(req.params, "id");
    const userId = getLocalUserId(req);
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    const [note] = await db.insert(meetingNotesTable).values({ meetingId, userId: userId!, content }).returning();
    res.status(201).json(note);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to save note" }); }
});

// ── Meeting analytics ───────────────────────────────────────────────────────
router.get("/meetings/:id/analytics", requirePermission("meetings.read"), async (req, res) => {
  try {
    const meetingId = parseParamId(req.params, "id");
    const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
    if (!meeting) { res.status(404).json({ error: "Not found" }); return; }
    const participants = await db.select().from(meetingParticipantsTable).where(eq(meetingParticipantsTable.meetingId, meetingId));
    const joined = participants.filter(p => p.joinedAt).length;
    const notes = await db.select({ count: sql<number>`count(*)::int` }).from(meetingNotesTable).where(eq(meetingNotesTable.meetingId, meetingId));
    res.json({
      totalInvited: participants.length,
      joined,
      accepted: participants.filter(p => p.status === "accepted").length,
      rejected: participants.filter(p => p.status === "rejected").length,
      durationMinutes: meeting.duration,
      notesCount: Number(notes[0]?.count ?? 0),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load analytics" }); }
});

// ── Planner events ──────────────────────────────────────────────────────────
router.get("/planner/events", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const userId = parseInt(req.query.userId as string) || getLocalUserId(req);
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!companyId || !userId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    let conditions = [eq(plannerEventsTable.companyId, companyId), eq(plannerEventsTable.userId, userId)];
    if (start) conditions.push(gte(plannerEventsTable.startDate, start));
    if (end) conditions.push(lte(plannerEventsTable.startDate, end));
    const events = await db.select().from(plannerEventsTable).where(and(...conditions)).orderBy(asc(plannerEventsTable.startDate));
    res.json(events);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load planner events" }); }
});

router.post("/planner/events", requirePermission("ai_tasks.write"), async (req, res) => {
  try {
    const userId = getLocalUserId(req);
    const { companyId, type, title, startDate, endDate, allDay, metadata } = z.object({
      companyId: z.number(), type: z.string(), title: z.string(), startDate: z.string(), endDate: z.string().optional(),
      allDay: z.boolean().default(false), metadata: z.record(z.any()).default({}),
    }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [event] = await db.insert(plannerEventsTable).values({ companyId, userId: userId!, type, title, startDate, endDate: endDate || startDate, allDay, metadata }).returning();
    res.status(201).json(event);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create event" }); }
});

router.delete("/planner/events/:id", requirePermission("ai_tasks.write"), async (req, res) => {
  try {
    const id = parseParamId(req.params, "id");
    const [event] = await db.delete(plannerEventsTable).where(eq(plannerEventsTable.id, id)).returning();
    if (!event) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete event" }); }
});

// ── AI planner suggestions ──────────────────────────────────────────────────
router.post("/planner/suggest", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    if (!isAiTasksEnabled()) { res.status(404).json({ error: "AI tasks disabled" }); return; }
    const { companyId, period, focus } = z.object({ companyId: z.number(), period: z.enum(["daily", "weekly", "monthly"]), focus: z.string().optional() }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const today = new Date().toISOString().slice(0, 10);
    const tasks = await db.select().from(generatedTasksTable).where(and(eq(generatedTasksTable.companyId, companyId), eq(generatedTasksTable.generatedDate, today))).limit(50);
    const provider = await getActiveProvider();
    const system = "You are a work planner. Return only valid JSON.";
    const prompt = `Suggest a ${period} plan for a company with ${tasks.length} tasks today. Focus: ${focus || "general"}. Return JSON: { "goals": [string], "events": [{ "title": string, "date": string (YYYY-MM-DD), "allDay": boolean }] }`;
    const text = await provider.chat([{ role: "user", content: prompt }], system);
    let parsed: any = null;
    try { parsed = JSON.parse(text.replace(/```json\s*|\s*```/g, "")); } catch { parsed = { goals: [], events: [] }; }
    res.json(parsed);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "AI planner failed" }); }
});

// ── AI workload analysis ────────────────────────────────────────────────────
router.post("/ai-tasks/workload/analyze", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    if (!isAiTasksEnabled()) { res.status(404).json({ error: "AI tasks disabled" }); return; }
    const { companyId, date } = z.object({ companyId: z.number(), date: z.string() }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const employees = await db.select().from(employeesTable).where(eq(employeesTable.companyId, companyId));
    const tasks = await db.select().from(generatedTasksTable).where(and(eq(generatedTasksTable.companyId, companyId), eq(generatedTasksTable.generatedDate, date)));
    const taskCounts: Record<number, number> = {};
    tasks.forEach(t => taskCounts[t.employeeId] = (taskCounts[t.employeeId] || 0) + 1);
    const byEmployee = employees.map(e => ({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`, taskCount: taskCounts[e.id] || 0, department: e.department }));

    const provider = await getActiveProvider();
    const system = "You are a workforce optimizer. Return only valid JSON.";
    const prompt = `Analyze workload distribution: ${JSON.stringify(byEmployee)}. Return JSON: { "overloaded": [employeeId], "idle": [employeeId], "rebalancing": [{ "fromEmployeeId": number, "toEmployeeId": number, "reason": string }] }`;
    const text = await provider.chat([{ role: "user", content: prompt }], system);
    let parsed: any = null;
    try { parsed = JSON.parse(text.replace(/```json\s*|\s*```/g, "")); } catch { parsed = { overloaded: [], idle: [], rebalancing: [] }; }

    await db.insert(workloadSnapshotsTable).values({ companyId, snapshotDate: date, data: { byEmployee, ...parsed }, aiProvider: provider.name }).onConflictDoUpdate({
      target: [workloadSnapshotsTable.companyId, workloadSnapshotsTable.snapshotDate],
      set: { data: { byEmployee, ...parsed }, aiProvider: provider.name, createdAt: new Date() },
    });
    res.json({ byEmployee, ...parsed });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Workload analysis failed" }); }
});

router.get("/ai-tasks/workload/snapshots", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const snapshots = await db.select().from(workloadSnapshotsTable).where(eq(workloadSnapshotsTable.companyId, companyId)).orderBy(desc(workloadSnapshotsTable.snapshotDate)).limit(30);
    res.json(snapshots);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load snapshots" }); }
});

// ── Manager approval for workload rebalancing ───────────────────────────────
router.post("/ai-tasks/workload/approve", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const { companyId, rebalancing } = z.object({ companyId: z.number(), rebalancing: z.array(z.object({ fromEmployeeId: z.number(), toEmployeeId: z.number(), reason: z.string() })) }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    for (const move of rebalancing) {
      const tasks = await db.select().from(generatedTasksTable).where(and(eq(generatedTasksTable.companyId, companyId), eq(generatedTasksTable.employeeId, move.fromEmployeeId))).limit(1);
      if (tasks.length > 0) {
        await db.update(generatedTasksTable).set({ employeeId: move.toEmployeeId, aiCustomizations: { ...tasks[0].aiCustomizations, rebalancedFrom: move.fromEmployeeId, reason: move.reason } }).where(eq(generatedTasksTable.id, tasks[0].id));
      }
    }
    res.json({ ok: true, moves: rebalancing.length });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Approval failed" }); }
});

// ── Reminders ─────────────────────────────────────────────────────────────────
router.post("/connect/reminders/send", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const { companyId, type } = z.object({ companyId: z.number(), type: z.enum(["meeting", "task", "deadline", "weekly_summary"]) }).parse(req.body);
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const companyUsers = await db.select().from(usersTable).where(sql`${usersTable.companyIds} @> ${JSON.stringify([companyId])}::jsonb`);
    if (type === "weekly_summary") {
      const today = new Date().toISOString().slice(0, 10);
      const tasks = await db.select().from(generatedTasksTable).where(and(eq(generatedTasksTable.companyId, companyId), gte(generatedTasksTable.generatedDate, today))).limit(100);
      const completed = tasks.filter(t => t.status === "completed").length;
      const pending = tasks.filter(t => t.status !== "completed").length;
      for (const u of companyUsers) {
        void emitNotification({ type: "ai_tasks", severity: "info", companyId, title: "Weekly AI Tasks Summary", message: `${completed} completed, ${pending} pending`, actionUrl: "/ai-tasks" });
      }
    } else if (type === "meeting") {
      const upcoming = await db.select().from(meetingsTable).where(and(eq(meetingsTable.companyId, companyId), gte(meetingsTable.scheduledAt, new Date()), lte(meetingsTable.scheduledAt, new Date(Date.now() + 15 * 60 * 1000))));
      for (const m of upcoming) {
        const participants = await db.select({ userId: meetingParticipantsTable.userId }).from(meetingParticipantsTable).where(eq(meetingParticipantsTable.meetingId, m.id));
        for (const p of participants) {
          void emitNotification({ type: "meetings", severity: "info", companyId, title: "Meeting starting soon", message: m.title, actionUrl: `/meetings` });
        }
      }
    } else if (type === "deadline") {
      const today = new Date().toISOString().slice(0, 10);
      const overdue = await db.select().from(generatedTasksTable).where(and(eq(generatedTasksTable.companyId, companyId), lte(generatedTasksTable.dueDate, today), eq(generatedTasksTable.status, "assigned")));
      for (const t of overdue) {
        void emitNotification({ type: "ai_tasks", severity: "warning", companyId, title: "Task deadline", message: t.title, actionUrl: "/ai-tasks" });
      }
    }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Reminders failed" }); }
});

export default router;
