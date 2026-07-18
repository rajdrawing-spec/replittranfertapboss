import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Regression test for the AI meeting-notes Retry concurrency guarantee.
 *
 * `retryMeetingNote` relies on an atomic
 * `UPDATE ... WHERE id = :id AND status = 'failed'` reclaim so that when two
 * people click Retry at the same time (or a retry races a re-upload), exactly
 * one wins and the AI pipeline runs once. A regression here would silently
 * double-charge AI calls and duplicate action-item tasks.
 *
 * External boundaries are mocked: Postgres (@workspace/db) with an in-memory
 * store + fake drizzle query builder, object storage, Gemini, and Clerk. The
 * fake UPDATE applies its WHERE condition against current row state, so the
 * "only one reclaim wins" semantics of the real conditional update hold.
 */

// ---- In-memory fake of @workspace/db ---------------------------------------
const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const TABLES = ["ai_meeting_notes", "meetings", "employees", "generated_tasks"];
  const store: Record<string, Row[]> = {};
  function reset() {
    for (const t of TABLES) store[t] = [];
  }
  reset();

  function makeTable(name: string) {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "__table") return name;
          return `${name}.${String(prop)}`;
        },
      },
    );
  }
  const tables = Object.fromEntries(TABLES.map((n) => [n, makeTable(n)]));
  const field = (col: string) => String(col).split(".")[1];

  function match(row: Row, cond: any): boolean {
    if (!cond) return true;
    switch (cond.op) {
      case "and":
        return cond.conds.filter(Boolean).every((c: any) => match(row, c));
      case "or":
        return cond.conds.filter(Boolean).some((c: any) => match(row, c));
      case "eq":
        return row[field(cond.col)] === cond.val;
      case "lt":
        return row[field(cond.col)] < cond.val;
      case "isNotNull":
        return row[field(cond.col)] != null;
      default:
        return true;
    }
  }

  class QB {
    op: string | null = null;
    table: string | null = null;
    cols: Record<string, any> | null = null;
    cond: any = null;
    _limit: number | null = null;
    _values: any = null;
    _set: any = null;
    select(cols?: Record<string, any>) { this.op = "select"; this.cols = cols ?? null; return this; }
    insert(t: any) { this.op = "insert"; this.table = t.__table; return this; }
    update(t: any) { this.op = "update"; this.table = t.__table; return this; }
    from(t: any) { this.table = t.__table; return this; }
    values(v: any) { this._values = v; return this; }
    set(v: any) { this._set = v; return this; }
    where(c: any) { this.cond = c; return this; }
    orderBy() { return this; }
    limit(n: number) { this._limit = n; return this; }
    for() { return this; }
    onConflictDoNothing() { return this; }
    returning() { return this; }
    then(resolve: (v: any) => void, reject: (e: any) => void) {
      try { resolve(this._exec()); } catch (e) { reject(e); }
    }
    _exec() {
      const arr = store[this.table!];
      if (this.op === "insert") {
        const rows = Array.isArray(this._values) ? this._values : [this._values];
        return rows.map((v: Row) => {
          const id = arr.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;
          const row = { id, ...v };
          arr.push(row);
          return { ...row };
        });
      }
      if (this.op === "update") {
        // The WHERE is evaluated against CURRENT row state — exactly like the
        // real conditional UPDATE. A second reclaim after the first one flips
        // status to "processing" therefore matches zero rows.
        const affected = arr.filter((r) => match(r, this.cond));
        for (const r of affected) Object.assign(r, this._set);
        return affected.map((r) => ({ ...r }));
      }
      let rows = arr.filter((r) => match(r, this.cond));
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this.cols) {
        return rows.map((r) => {
          const out: Row = {};
          for (const [k, colRef] of Object.entries(this.cols!)) out[k] = r[field(String(colRef))];
          return out;
        });
      }
      return rows.map((r) => ({ ...r }));
    }
  }

  const db = {
    select: (cols?: Record<string, any>) => new QB().select(cols),
    insert: (t: any) => new QB().insert(t),
    update: (t: any) => new QB().update(t),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };

  return { store, reset, db, tables };
});

vi.mock("@workspace/db", () => ({
  db: H.db,
  aiMeetingNotesTable: H.tables.ai_meeting_notes,
  meetingsTable: H.tables.meetings,
  employeesTable: H.tables.employees,
  generatedTasksTable: H.tables.generated_tasks,
  usersTable: {},
  chatChannelMembersTable: {},
  chatChannelsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  or: (...conds: any[]) => ({ op: "or", conds }),
  ilike: (col: string, val: any) => ({ op: "ilike", col, val }),
  desc: (col: string) => ({ op: "desc", col }),
  // The sweep uses sql`${col} < ${cutoff}`; translate that tagged template
  // into a comparable condition descriptor for the fake matcher.
  sql: ((strings: TemplateStringsArray, ...vals: any[]) => {
    if (strings.length === 3 && strings[1]?.trim() === "<") {
      return { op: "lt", col: vals[0], val: vals[1] };
    }
    if (strings[1]?.includes("IS NOT NULL")) {
      return { op: "isNotNull", col: vals[0] };
    }
    return { op: "sql" };
  }) as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("../lib/notify", () => ({ emitNotification: vi.fn() }));
vi.mock("../lib/chat/socket-server", () => ({ broadcastMeetingRinging: vi.fn() }));

// Every method in meeting.service is irrelevant to retry; stub the module so
// its LiveKit/DB imports never load.
vi.mock("../lib/meetings/meeting.service", () => ({
  createMeeting: vi.fn(),
  listCompanyMeetings: vi.fn(),
  listMyMeetings: vi.fn(),
  listUpcomingMeetings: vi.fn(),
  getMeeting: vi.fn(),
  getMeetingByMeetingId: vi.fn(),
  cancelMeeting: vi.fn(),
  endMeeting: vi.fn(),
  joinMeeting: vi.fn(),
  leaveMeeting: vi.fn(),
  getOrCreateMeetingSettings: vi.fn(),
  updateMeetingSettings: vi.fn(),
  acceptInvitation: vi.fn(),
  rejectInvitation: vi.fn(),
  isLiveKitConfigured: vi.fn(() => false),
}));

// Object storage: stored recordings download instantly.
const storageMocks = vi.hoisted(() => ({
  getObjectEntityFile: vi.fn(async () => ({ download: async () => [Buffer.from("fake-audio")] })),
  uploadPrivateObject: vi.fn(async () => "/objects/meeting-audio/fake"),
  deletePrivateObject: vi.fn(async () => {}),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = storageMocks.getObjectEntityFile;
    uploadPrivateObject = storageMocks.uploadPrivateObject;
    deletePrivateObject = storageMocks.deletePrivateObject;
  },
}));

// Gemini: count pipeline invocations; never resolve so notes stay "processing"
// for the duration of the test (the pipeline is fire-and-forget anyway).
const geminiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: geminiMocks.generateContent } },
}));

// Grant every permission so the ONLY rejection paths under test are company
// scoping and note-state validation.
vi.mock("../lib/auth-user", async (importActual) => {
  const actual = await importActual<typeof import("../lib/auth-user")>();
  return {
    ...actual,
    getUserPermissions: vi.fn(async () => ["*"]),
    hasPermission: vi.fn(() => true),
  };
});

import meetingsRouter from "./meetings";
import { sweepStuckMeetingNotes, cleanupMeetingAudio, STUCK_NOTE_ERROR } from "../lib/meetings/meeting-notes.service";

const ALPHA = 1;
const BETA = 2;
const STAFF = { id: 10, name: "Alpha Staff", email: "staff@alpha.example.com", role: "operations_manager", companyIds: [ALPHA] };

let currentUser: any = STAFF;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).localUser = currentUser;
    (req as any).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(meetingsRouter);
  return app;
}
const app = buildApp();

function seedNote(overrides: Record<string, any> = {}) {
  const meetingId = H.store.meetings.length + 1;
  H.store.meetings.push({
    id: meetingId,
    companyId: ALPHA,
    meetingId: `room-${meetingId}`,
    title: "Weekly Sync",
    participants: [],
  });
  const id = H.store.ai_meeting_notes.length + 1;
  H.store.ai_meeting_notes.push({
    id,
    companyId: ALPHA,
    meetingDbId: meetingId,
    meetingId: `room-${meetingId}`,
    title: "Weekly Sync",
    status: "failed",
    error: "boom",
    audioObjectPath: "/objects/meeting-audio/abc",
    audioMimeType: "audio/webm",
    actionItems: [],
    ...overrides,
  });
  return id;
}

const retry = (noteId: number, companyId = ALPHA) =>
  request(app).post(`/meetings/notes/${noteId}/retry`).send({ companyId });

beforeEach(() => {
  H.reset();
  currentUser = STAFF;
  vi.clearAllMocks();
});

describe("POST /meetings/notes/:id/retry", () => {
  it("retries a failed note: 202, row reclaimed to processing, pipeline started once", async () => {
    const noteId = seedNote();
    const res = await retry(noteId);
    expect(res.status).toBe(202);
    const row = H.store.ai_meeting_notes.find((r) => r.id === noteId)!;
    expect(row.status).toBe("processing");
    expect(row.error).toBeNull();
    // Give the fire-and-forget pipeline a tick to reach Gemini.
    await new Promise((r) => setImmediate(r));
    expect(geminiMocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("two concurrent retries: exactly one wins (202), the other gets 409, pipeline runs once", async () => {
    const noteId = seedNote();
    const [a, b] = await Promise.all([retry(noteId), retry(noteId)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);
    await new Promise((r) => setImmediate(r));
    expect(geminiMocks.generateContent).toHaveBeenCalledTimes(1);
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("processing");
  });

  it("a retry after a successful retry gets 409 (note now processing)", async () => {
    const noteId = seedNote();
    expect((await retry(noteId)).status).toBe(202);
    const res = await retry(noteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already being processed/i);
    await new Promise((r) => setImmediate(r));
    expect(geminiMocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects retrying a completed note (409, no pipeline)", async () => {
    const noteId = seedNote({ status: "done", error: null });
    const res = await retry(noteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only failed/i);
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("done");
  });

  it("rejects retrying a processing note (409, no pipeline)", async () => {
    const noteId = seedNote({ status: "processing" });
    const res = await retry(noteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already being processed/i);
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects a failed note without stored audio (409, stays failed, no pipeline)", async () => {
    const noteId = seedNote({ audioObjectPath: null, audioMimeType: null });
    const res = await retry(noteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not stored/i);
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
    // Crucially, the note is still retryable once audio exists — not stuck.
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("failed");
  });

  it("a missing/corrupt stored object rejects BEFORE reclaiming (note stays failed)", async () => {
    storageMocks.getObjectEntityFile.mockRejectedValueOnce(new Error("gone"));
    const noteId = seedNote();
    const res = await retry(noteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/could not be found/i);
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("failed");
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects a companyId outside the caller's scope (403, row untouched)", async () => {
    const noteId = seedNote({ companyId: BETA });
    H.store.meetings[0].companyId = BETA;
    const res = await retry(noteId, BETA);
    expect(res.status).toBe(403);
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("failed");
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
  });

  it("cannot reach another company's note by passing an in-scope companyId (not found, row untouched)", async () => {
    const noteId = seedNote({ companyId: BETA });
    H.store.meetings[0].companyId = BETA;
    // Caller uses their own company id, but the note belongs to BETA.
    const res = await retry(noteId, ALPHA);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not found/i);
    expect(H.store.ai_meeting_notes.find((r) => r.id === noteId)!.status).toBe("failed");
    expect(geminiMocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed note id", async () => {
    seedNote();
    const res = await request(app).post("/meetings/notes/not-a-number/retry").send({ companyId: ALPHA });
    expect(res.status).toBe(400);
  });
});

describe("sweepStuckMeetingNotes", () => {
  it("fails notes stuck in processing past the threshold and leaves fresh/terminal notes alone", async () => {
    const stuckId = seedNote({ status: "processing", updatedAt: new Date(Date.now() - 20 * 60 * 1000) });
    const freshId = seedNote({ status: "processing", updatedAt: new Date() });
    const doneId = seedNote({ status: "done", updatedAt: new Date(Date.now() - 20 * 60 * 1000) });

    const swept = await sweepStuckMeetingNotes();
    expect(swept).toBe(1);

    const byId = (id: number) => H.store.ai_meeting_notes.find((r) => r.id === id)!;
    expect(byId(stuckId).status).toBe("failed");
    expect(byId(stuckId).error).toBe(STUCK_NOTE_ERROR);
    expect(byId(freshId).status).toBe("processing");
    expect(byId(doneId).status).toBe("done");
  });

  it("a swept note becomes retryable again", async () => {
    const stuckId = seedNote({ status: "processing", updatedAt: new Date(Date.now() - 20 * 60 * 1000) });
    await sweepStuckMeetingNotes();
    const res = await retry(stuckId);
    expect(res.status).toBe(202);
    expect(H.store.ai_meeting_notes.find((r) => r.id === stuckId)!.status).toBe("processing");
  });
});

describe("cleanupMeetingAudio", () => {
  const DAYS_8 = 8 * 24 * 60 * 60 * 1000;

  it("deletes stored audio for done notes past retention and clears the columns", async () => {
    const oldDone = seedNote({ status: "done", updatedAt: new Date(Date.now() - DAYS_8) });
    const freshDone = seedNote({ status: "done", updatedAt: new Date() });
    const oldFailed = seedNote({ status: "failed", updatedAt: new Date(Date.now() - DAYS_8) });

    const cleaned = await cleanupMeetingAudio();
    expect(cleaned).toBe(1);
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledTimes(1);
    expect(storageMocks.deletePrivateObject).toHaveBeenCalledWith("/objects/meeting-audio/abc");

    const byId = (id: number) => H.store.ai_meeting_notes.find((r) => r.id === id)!;
    expect(byId(oldDone).audioObjectPath).toBeNull();
    expect(byId(oldDone).audioMimeType).toBeNull();
    // Recent done notes and failed notes (Retry must keep working) are untouched.
    expect(byId(freshDone).audioObjectPath).toBe("/objects/meeting-audio/abc");
    expect(byId(oldFailed).audioObjectPath).toBe("/objects/meeting-audio/abc");
  });

  it("skips notes whose audio is already cleared", async () => {
    seedNote({ status: "done", updatedAt: new Date(Date.now() - DAYS_8), audioObjectPath: null, audioMimeType: null });
    const cleaned = await cleanupMeetingAudio();
    expect(cleaned).toBe(0);
    expect(storageMocks.deletePrivateObject).not.toHaveBeenCalled();
  });

  it("leaves the row untouched when storage deletion fails, so a later run retries", async () => {
    storageMocks.deletePrivateObject.mockRejectedValueOnce(new Error("storage down"));
    const id = seedNote({ status: "done", updatedAt: new Date(Date.now() - DAYS_8) });
    const cleaned = await cleanupMeetingAudio();
    expect(cleaned).toBe(0);
    const row = H.store.ai_meeting_notes.find((r) => r.id === id)!;
    expect(row.audioObjectPath).toBe("/objects/meeting-audio/abc");

    // Next run succeeds and clears it.
    expect(await cleanupMeetingAudio()).toBe(1);
    expect(row.audioObjectPath).toBeNull();
  });

  it("a retried note that succeeds again gets a fresh retention window (updatedAt-based)", async () => {
    const id = seedNote({ status: "done", updatedAt: new Date() });
    expect(await cleanupMeetingAudio()).toBe(0);
    expect(H.store.ai_meeting_notes.find((r) => r.id === id)!.audioObjectPath).toBe("/objects/meeting-audio/abc");
  });
});
