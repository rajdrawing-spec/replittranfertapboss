import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * End-to-end test for the AI meeting-notes → AI task pipeline.
 *
 * Verifies that action items are turned into generated_tasks with the right
 * status (assigned for confident matches, draft for suggestions) and that the
 * note's actionItems are stamped with the created taskId.
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
  sql: (() => ({})) as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

const mocks = vi.hoisted(() => ({
  emitNotification: vi.fn(),
  broadcastTaskEvent: vi.fn(),
}));

vi.mock("../lib/notify", () => ({ emitNotification: mocks.emitNotification }));
vi.mock("../lib/chat/socket-server", () => ({ broadcastTaskEvent: mocks.broadcastTaskEvent, broadcastMeetingRinging: vi.fn() }));

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

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    uploadPrivateObject = vi.fn(async () => "/objects/meeting-audio/fake");
  },
}));

const geminiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));
vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: geminiMocks.generateContent } },
}));

import { processMeetingAudio, getMeetingNote } from "../lib/meetings/meeting-notes.service";

const COMPANY = 1;

function seedEmployee(overrides: Record<string, any>) {
  const id = H.store.employees.length + 1;
  H.store.employees.push({
    id,
    companyId: COMPANY,
    firstName: "Employee",
    lastName: `${id}`,
    email: `emp${id}@example.com`,
    department: "General",
    designation: "Team Member",
    status: "active",
    ...overrides,
  });
  return id;
}

function seedMeetingAndNote(overrides: Record<string, any> = {}) {
  const meetingId = H.store.meetings.length + 1;
  H.store.meetings.push({
    id: meetingId,
    companyId: COMPANY,
    meetingId: `room-${meetingId}`,
    title: "Weekly Sync",
    participants: [],
  });
  const id = H.store.ai_meeting_notes.length + 1;
  H.store.ai_meeting_notes.push({
    id,
    companyId: COMPANY,
    meetingDbId: meetingId,
    meetingId: `room-${meetingId}`,
    title: "Weekly Sync",
    status: "processing",
    actionItems: [],
    ...overrides,
  });
  return { noteId: id, meeting: H.store.meetings[meetingId - 1] };
}

beforeEach(() => {
  H.reset();
  mocks.emitNotification.mockClear();
  mocks.broadcastTaskEvent.mockClear();
  geminiMocks.generateContent.mockReset();
});

describe("processMeetingAudio", () => {
  it("creates assigned tasks for confident name matches and draft suggestions for inferred matches", async () => {
    const alice = seedEmployee({ firstName: "Alice", lastName: "Smith", department: "Engineering", designation: "Senior Engineer" });
    const bob = seedEmployee({ firstName: "Bob", lastName: "Jones", department: "Sales", designation: "Sales Manager" });
    seedEmployee({ firstName: "Carol", lastName: "White", department: "Marketing", designation: "Intern" });

    const { noteId, meeting } = seedMeetingAndNote();

    geminiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        transcript: "",
        summary: "",
        notes: "",
        actionItems: [
          { title: "Fix login bug", assigneeName: "Alice Smith", priority: "high" },
          { title: "Follow up with sales lead", department: "Sales", priority: "medium" },
          { title: "Update documentation", assigneeName: "Unknown Person", priority: "low" },
        ],
      }),
    });

    await processMeetingAudio(noteId, meeting, "fake-audio", "audio/webm");

    const note = await getMeetingNote(noteId, COMPANY);
    expect(note?.status).toBe("done");
    expect(note?.actionItems).toHaveLength(3);

    const tasks = H.store.generated_tasks;
    expect(tasks).toHaveLength(3);

    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle["Fix login bug"].employeeId).toBe(alice);
    expect(byTitle["Fix login bug"].status).toBe("assigned");
    expect(byTitle["Fix login bug"].aiCustomizations.confidence).toBe("high");

    expect(byTitle["Follow up with sales lead"].employeeId).toBe(bob);
    expect(byTitle["Follow up with sales lead"].status).toBe("draft");
    expect(byTitle["Follow up with sales lead"].aiCustomizations.suggested).toBe(true);

    expect(byTitle["Update documentation"].status).toBe("draft");
    expect(byTitle["Update documentation"].aiCustomizations.confidence).toBe("low");

    expect(note?.actionItems.map((a: any) => a.taskId)).toEqual(tasks.map((t) => t.id));
    expect(mocks.broadcastTaskEvent).toHaveBeenCalledTimes(3);
    expect(mocks.emitNotification).toHaveBeenCalledTimes(3);
  });

  it("does not create tasks when no employees exist", async () => {
    const { noteId, meeting } = seedMeetingAndNote();
    geminiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        transcript: "",
        summary: "",
        notes: "",
        actionItems: [{ title: "Do something", assigneeName: "Alice" }],
      }),
    });

    await processMeetingAudio(noteId, meeting, "fake-audio", "audio/webm");

    const note = await getMeetingNote(noteId, COMPANY);
    expect(note?.status).toBe("done");
    expect(H.store.generated_tasks).toHaveLength(0);
  });
});
