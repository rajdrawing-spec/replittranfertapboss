import { Router, type IRouter } from "express";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import {
  db,
  businessNumbersTable,
  callContactsTable,
  callLogsTable,
  callCenterSettingsTable,
  insertBusinessNumberSchema,
  insertCallContactSchema,
} from "@workspace/db";
import { and, eq, desc, ilike, or, sql, gte, isNull } from "drizzle-orm";
import { getCallProvider } from "../lib/call-center/call.service";
import { hasPermission } from "../lib/auth-user";
import { broadcastCallEvent } from "../lib/chat/socket-server";

const router: IRouter = Router();

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

function companyIdFrom(req: any): number {
  return parseInt((req.method === "GET" ? req.query.companyId : req.body?.companyId) as string);
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
router.get("/call-center/stats", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [today] = await db
      .select({
        total: sql<number>`count(*)`,
        incoming: sql<number>`count(*) filter (where direction = 'incoming')`,
        outgoing: sql<number>`count(*) filter (where direction = 'outgoing')`,
        missed: sql<number>`count(*) filter (where status = 'missed')`,
        avgDuration: sql<number>`coalesce(avg(duration) filter (where duration > 0), 0)`,
      })
      .from(callLogsTable)
      .where(and(eq(callLogsTable.companyId, companyId), gte(callLogsTable.startedAt, startOfDay)));
    const [live] = await db
      .select({
        activeCalls: sql<number>`count(*) filter (where status in ('active','held'))`,
        queue: sql<number>`count(*) filter (where status = 'ringing')`,
        activeAgents: sql<number>`count(distinct user_id) filter (where status in ('active','held') and user_id is not null)`,
      })
      .from(callLogsTable)
      .where(and(eq(callLogsTable.companyId, companyId), isNull(callLogsTable.endedAt)));
    res.json({
      todaysCalls: Number(today.total),
      incoming: Number(today.incoming),
      outgoing: Number(today.outgoing),
      missed: Number(today.missed),
      avgDurationSec: Math.round(Number(today.avgDuration)),
      activeCalls: Number(live.activeCalls),
      liveQueue: Number(live.queue),
      activeAgents: Number(live.activeAgents),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load call center stats" });
  }
});

// ── Business numbers ──────────────────────────────────────────────────────────
router.get("/business-numbers", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const rows = await db
      .select()
      .from(businessNumbersTable)
      .where(eq(businessNumbersTable.companyId, companyId))
      .orderBy(desc(businessNumbersTable.isDefault), businessNumbersTable.department);
    res.json(rows);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list business numbers" });
  }
});

router.post("/business-numbers", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = insertBusinessNumberSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
    if (parsed.data.isDefault) {
      await db.update(businessNumbersTable).set({ isDefault: false }).where(eq(businessNumbersTable.companyId, companyId));
    }
    const [row] = await db.insert(businessNumbersTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create business number" });
  }
});

router.patch("/business-numbers/:id", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const id = parseInt(String(req.params.id), 10);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = insertBusinessNumberSchema.partial().safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
    if (parsed.data.isDefault) {
      await db.update(businessNumbersTable).set({ isDefault: false }).where(eq(businessNumbersTable.companyId, companyId));
    }
    const [row] = await db
      .update(businessNumbersTable)
      .set(parsed.data)
      .where(and(eq(businessNumbersTable.id, id), eq(businessNumbersTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Business number not found" }); return; }
    res.json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update business number" });
  }
});

router.delete("/business-numbers/:id", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const id = parseInt(String(req.params.id), 10);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [row] = await db
      .delete(businessNumbersTable)
      .where(and(eq(businessNumbersTable.id, id), eq(businessNumbersTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Business number not found" }); return; }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete business number" });
  }
});

// ── Contacts ──────────────────────────────────────────────────────────────────
router.get("/call-center/contacts", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const conditions = [eq(callContactsTable.companyId, companyId)];
    if (q) {
      conditions.push(
        or(ilike(callContactsTable.name, `%${q}%`), ilike(callContactsTable.phone, `%${q}%`))!,
      );
    }
    const rows = await db
      .select()
      .from(callContactsTable)
      .where(and(...conditions))
      .orderBy(desc(callContactsTable.favorite), callContactsTable.name);
    res.json(rows);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list contacts" });
  }
});

router.post("/call-center/contacts", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = insertCallContactSchema.safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
    const [row] = await db.insert(callContactsTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create contact" });
  }
});

router.patch("/call-center/contacts/:id", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const id = parseInt(String(req.params.id), 10);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const parsed = insertCallContactSchema.partial().safeParse({ ...req.body, companyId });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" }); return; }
    const [row] = await db
      .update(callContactsTable)
      .set(parsed.data)
      .where(and(eq(callContactsTable.id, id), eq(callContactsTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// ── Call history ──────────────────────────────────────────────────────────────
router.get("/call/history", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const direction = typeof req.query.direction === "string" ? req.query.direction : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));

    const conditions = [eq(callLogsTable.companyId, companyId)];
    // Employees (view-only) see their own calls; managers see everything.
    const perms: string[] = (req as any).resolvedPermissions ?? [];
    const userId = getLocalUserId(req);
    const canManage = hasPermission(perms, "callcenter.manage");
    if (!canManage && userId) conditions.push(eq(callLogsTable.userId, userId));
    if (q) {
      conditions.push(
        or(ilike(callLogsTable.callerName, `%${q}%`), ilike(callLogsTable.callerNumber, `%${q}%`))!,
      );
    }
    if (direction === "incoming" || direction === "outgoing") conditions.push(eq(callLogsTable.direction, direction));
    if (status) conditions.push(eq(callLogsTable.status, status));

    const where = and(...conditions);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(callLogsTable).where(where);
    const items = await db
      .select()
      .from(callLogsTable)
      .where(where)
      .orderBy(desc(callLogsTable.startedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({ items, total: Number(count), page, limit });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load call history" });
  }
});

// ── Active calls ──────────────────────────────────────────────────────────────
router.get("/call/active", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const rows = await db
      .select()
      .from(callLogsTable)
      .where(and(
        eq(callLogsTable.companyId, companyId),
        isNull(callLogsTable.endedAt),
        sql`${callLogsTable.status} in ('ringing','active','held')`,
      ))
      .orderBy(desc(callLogsTable.startedAt));
    res.json(rows);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load active calls" });
  }
});

// ── Call actions (mock until Exotel is connected) ────────────────────────────
router.post("/call/outgoing", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const toNumber = String(req.body?.toNumber || "").trim();
    const businessNumberId = parseInt(req.body?.businessNumberId, 10);
    if (!toNumber || !/^\+?[0-9 ()-]{6,20}$/.test(toNumber)) {
      res.status(400).json({ error: "A valid phone number is required" });
      return;
    }
    const [bn] = await db
      .select()
      .from(businessNumbersTable)
      .where(and(eq(businessNumbersTable.id, businessNumberId || 0), eq(businessNumbersTable.companyId, companyId)))
      .limit(1);
    if (!bn) { res.status(400).json({ error: "Select a business number to call from" }); return; }
    if (bn.status !== "active") { res.status(400).json({ error: "This business number is inactive" }); return; }

    // Look up an existing contact by number for a friendly name.
    const [contact] = await db
      .select()
      .from(callContactsTable)
      .where(and(eq(callContactsTable.companyId, companyId), eq(callContactsTable.phone, toNumber)))
      .limit(1);

    const handle = await getCallProvider().makeCall({ fromNumber: bn.phoneNumber, toNumber, agentUserId: userId });
    const [log] = await db
      .insert(callLogsTable)
      .values({
        companyId,
        callId: handle.callId,
        businessNumberId: bn.id,
        contactId: contact?.id ?? null,
        userId,
        callerName: contact?.name ?? null,
        callerNumber: toNumber,
        direction: "outgoing",
        status: "ringing",
      })
      .returning();
    broadcastCallEvent([userId], "call_started", { callId: handle.callId, logId: log.id, toNumber, from: bn.displayName });
    res.status(201).json({ mock: true, message: "Mock call placed — Exotel not connected yet", call: log });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to place call" });
  }
});

// Simulate an incoming call (later this becomes the Exotel webhook target).
router.post("/call/incoming", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const userId = getLocalUserId(req);
    if (!companyId || !userId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const fromNumber = String(req.body?.fromNumber || "+91 98765 43210").trim();
    const businessNumberId = req.body?.businessNumberId ? parseInt(req.body.businessNumberId, 10) : undefined;
    let bn = null as null | typeof businessNumbersTable.$inferSelect;
    if (businessNumberId) {
      [bn] = await db.select().from(businessNumbersTable)
        .where(and(eq(businessNumbersTable.id, businessNumberId), eq(businessNumbersTable.companyId, companyId))).limit(1);
    }
    const [contact] = await db
      .select()
      .from(callContactsTable)
      .where(and(eq(callContactsTable.companyId, companyId), eq(callContactsTable.phone, fromNumber)))
      .limit(1);
    const callId = `mock_in_${Date.now().toString(36)}`;
    const [log] = await db
      .insert(callLogsTable)
      .values({
        companyId,
        callId,
        businessNumberId: bn?.id ?? null,
        contactId: contact?.id ?? null,
        callerName: contact?.name ?? null,
        callerNumber: fromNumber,
        direction: "incoming",
        status: "ringing",
      })
      .returning();
    broadcastCallEvent([userId], "incoming_call", {
      callId,
      logId: log.id,
      callerName: contact?.name ?? "Unknown caller",
      callerNumber: fromNumber,
      department: bn?.department ?? "General",
    });
    res.status(201).json({ mock: true, call: log });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to simulate incoming call" });
  }
});

/** Shared handler for state transitions on a call log. */
async function transitionCall(
  req: any,
  res: any,
  opts: { status?: string; end?: boolean; event: string },
) {
  const companyId = companyIdFrom(req);
  const userId = getLocalUserId(req);
  if (!companyId || !userId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const callId = String(req.body?.callId || "");
  const [log] = await db
    .select()
    .from(callLogsTable)
    .where(and(eq(callLogsTable.callId, callId), eq(callLogsTable.companyId, companyId)))
    .limit(1);
  if (!log) { res.status(404).json({ error: "Call not found" }); return; }
  // Enforce valid transitions so concurrent requests can't corrupt state
  // (answer only from ringing; hold/resume/end only from live states).
  const allowedFrom: Record<string, string[]> = {
    active: ["ringing", "held"],
    held: ["active"],
    completed: ["ringing", "active", "held"],
    rejected: ["ringing"],
  };
  const fromStates = opts.status ? allowedFrom[opts.status] : ["active", "held"];
  const values: Record<string, unknown> = {};
  if (opts.status) values.status = opts.status;
  if (opts.end) {
    values.endedAt = new Date();
    values.duration = Math.max(0, Math.round((Date.now() - new Date(log.startedAt).getTime()) / 1000));
  }
  if (!log.userId && (opts.status === "active")) values.userId = userId;
  // Conditional update: the status precondition in WHERE makes concurrent
  // transitions last-writer-loses instead of last-writer-wins.
  const [updated] = await db
    .update(callLogsTable)
    .set(values)
    .where(and(
      eq(callLogsTable.id, log.id),
      sql`${callLogsTable.status} in (${sql.join(fromStates.map((s) => sql`${s}`), sql`, `)})`,
    ))
    .returning();
  if (!updated) {
    res.status(409).json({ error: `Call is no longer in a state that allows this action (currently "${log.status}")` });
    return;
  }
  broadcastCallEvent([userId], opts.event, { callId, logId: log.id, status: updated.status });
  res.json({ mock: true, call: updated });
}

router.post("/call/answer", requirePermission("callcenter.view"), async (req, res) => {
  try {
    await getCallProvider().receiveCall(String(req.body?.callId || ""), getLocalUserId(req) ?? 0);
    await transitionCall(req, res, { status: "active", event: "call_answered" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to answer call" }); }
});

router.post("/call/reject", requirePermission("callcenter.view"), async (req, res) => {
  try {
    await transitionCall(req, res, { status: "rejected", end: true, event: "call_rejected" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to reject call" }); }
});

router.post("/call/end", requirePermission("callcenter.view"), async (req, res) => {
  try {
    await getCallProvider().hangup(String(req.body?.callId || ""));
    await transitionCall(req, res, { status: "completed", end: true, event: "call_ended" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to end call" }); }
});

router.post("/call/hold", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const hold = req.body?.hold !== false;
    await getCallProvider().holdCall(String(req.body?.callId || ""), hold);
    await transitionCall(req, res, { status: hold ? "held" : "active", event: hold ? "call_hold" : "call_resume" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to hold call" }); }
});

router.post("/call/transfer", requirePermission("callcenter.view"), async (req, res) => {
  try {
    await getCallProvider().transferCall(String(req.body?.callId || ""), parseInt(req.body?.toUserId, 10) || 0);
    await transitionCall(req, res, { event: "call_transfer" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to transfer call" }); }
});

// Save notes/summary against a call log.
router.patch("/call/logs/:id/notes", requirePermission("callcenter.view"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    const id = parseInt(String(req.params.id), 10);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 5000) : undefined;
    if (notes === undefined) { res.status(400).json({ error: "notes is required" }); return; }
    // Only the agent who handled the call — or a call-center manager — may
    // edit its notes.
    const perms: string[] = (req as any).resolvedPermissions ?? [];
    const userId = getLocalUserId(req);
    const canManage = hasPermission(perms, "callcenter.manage");
    const [existing] = await db
      .select({ id: callLogsTable.id, userId: callLogsTable.userId })
      .from(callLogsTable)
      .where(and(eq(callLogsTable.id, id), eq(callLogsTable.companyId, companyId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Call not found" }); return; }
    if (!canManage && existing.userId !== userId) {
      res.status(403).json({ error: "You can only edit notes on your own calls" });
      return;
    }
    const [row] = await db
      .update(callLogsTable)
      .set({ notes })
      .where(eq(callLogsTable.id, id))
      .returning();
    res.json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to save notes" });
  }
});

// ── Test Exotel connection ────────────────────────────────────────────────────
router.post("/call-center/test-connection", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const { accountSid, apiKey, apiToken } = req.body ?? {};
    if (!accountSid || !apiKey || !apiToken) {
      res.status(400).json({ error: "accountSid, apiKey, and apiToken are required" }); return;
    }
    // Verify by hitting Exotel's calls list endpoint (lightweight, read-only)
    const credentials = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
    const exotelRes = await fetch(
      `https://api.exotel.com/v1/Accounts/${encodeURIComponent(accountSid)}/Calls.json?PageSize=1`,
      { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(8000) }
    );
    if (exotelRes.status === 200 || exotelRes.status === 204) {
      res.json({ ok: true, message: "Connected to Exotel successfully." });
    } else if (exotelRes.status === 401 || exotelRes.status === 403) {
      res.status(200).json({ ok: false, error: "Authentication failed — check your API Key and API Token." });
    } else if (exotelRes.status === 404) {
      res.status(200).json({ ok: false, error: "Account SID not found. Verify your Account SID." });
    } else {
      res.status(200).json({ ok: false, error: `Exotel returned status ${exotelRes.status}. Check credentials.` });
    }
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    res.status(200).json({ ok: false, error: isTimeout ? "Request timed out — check network or credentials." : "Failed to reach Exotel API." });
  }
});

// ── Call-center settings (Exotel credentials + toggles) ───────────────────────
router.get("/call-center/settings", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const [row] = await db
      .select()
      .from(callCenterSettingsTable)
      .where(eq(callCenterSettingsTable.companyId, companyId))
      .limit(1);
    // Return empty defaults if not yet configured
    res.json(row ?? { companyId, accountSid: null, apiKey: null, apiToken: null, webhookUrl: null, callerId: null, callRecording: false, callQueue: false });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load settings" }); }
});

router.patch("/call-center/settings", requirePermission("callcenter.manage"), async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId || !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const { accountSid, apiKey, apiToken, webhookUrl, callerId, callRecording, callQueue } = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof accountSid === "string") patch.accountSid = accountSid.trim() || null;
    if (typeof apiKey     === "string") patch.apiKey     = apiKey.trim()     || null;
    if (typeof apiToken   === "string") patch.apiToken   = apiToken.trim()   || null;
    if (typeof webhookUrl === "string") patch.webhookUrl = webhookUrl.trim()  || null;
    if (typeof callerId   === "string") patch.callerId   = callerId.trim()   || null;
    if (typeof callRecording === "boolean") patch.callRecording = callRecording;
    if (typeof callQueue     === "boolean") patch.callQueue     = callQueue;

    const existing = await db
      .select({ id: callCenterSettingsTable.id })
      .from(callCenterSettingsTable)
      .where(eq(callCenterSettingsTable.companyId, companyId))
      .limit(1);

    let row;
    if (existing.length > 0) {
      [row] = await db
        .update(callCenterSettingsTable)
        .set(patch)
        .where(eq(callCenterSettingsTable.companyId, companyId))
        .returning();
    } else {
      [row] = await db
        .insert(callCenterSettingsTable)
        .values({ companyId, ...patch })
        .returning();
    }
    res.json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to save settings" }); }
});

export default router;
