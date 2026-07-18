import { db, aiMeetingNotesTable, generatedTasksTable, employeesTable, usersTable, meetingsTable, type MeetingActionItem, type Meeting } from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { emitNotification } from "../notify";
import { logger } from "../logger";
import { ObjectStorageService } from "../objectStorage";

const objectStorage = new ObjectStorageService();

// ── AI Meeting Assistant ──────────────────────────────────────────────────────
// Pipeline: meeting audio (webm/opus captured client-side) → Gemini 2.5 Flash
// (audio understanding) → transcript + summary + notes + action items →
// auto-created assigned tasks + follow-up notifications.

interface AiMeetingAnalysis {
  transcript: string;
  summary: string;
  notes: string;
  actionItems: Array<{
    title: string;
    description?: string;
    assigneeName?: string;
    priority?: "low" | "medium" | "high";
    dueDate?: string;
  }>;
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response contained no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function analyzeAudio(audioBase64: string, mimeType: string, meetingTitle: string, todayIso: string): Promise<AiMeetingAnalysis> {
  const prompt = [
    `You are an AI meeting assistant. The attached audio is a recording of a business meeting titled "${meetingTitle}". Today's date is ${todayIso}.`,
    "1. Transcribe the audio (label speakers Speaker 1, Speaker 2, ... if distinguishable).",
    "2. Write a concise summary (3-6 sentences).",
    "3. Write structured meeting notes as markdown bullet points grouped by topic.",
    "4. Extract action items. For each: a short title, optional description, the assignee's name exactly as spoken (if any), priority (low|medium|high based on urgency expressed), and a due date in YYYY-MM-DD format if a deadline was mentioned (resolve relative dates like 'next Friday' using today's date).",
    "If the audio is silent or contains no meaningful speech, return an empty transcript and empty actionItems.",
    'Respond with ONLY a JSON object: {"transcript": string, "summary": string, "notes": string, "actionItems": [{"title": string, "description": string, "assigneeName": string, "priority": "low"|"medium"|"high", "dueDate": "YYYY-MM-DD"}]}',
  ].join("\n");

  const response = await geminiAi.models.generateContent({
    model: "gemini-flash-latest",
    contents: [
      {
        role: "user" as const,
        parts: [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }],
      },
    ],
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 32768,
      responseMimeType: "application/json",
    },
  });
  const parsed = extractJson(response.text ?? "");
  return {
    transcript: typeof parsed.transcript === "string" ? parsed.transcript : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((a: any) => a && typeof a.title === "string" && a.title.trim()) : [],
  };
}

/** Fuzzy-match a spoken assignee name to a company employee. */
function matchEmployee(
  name: string | undefined,
  employees: Array<{ id: number; firstName: string; lastName: string; email: string }>,
): { id: number; fullName: string } | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  for (const e of employees) {
    const full = `${e.firstName} ${e.lastName}`.trim().toLowerCase();
    if (
      full === needle ||
      e.firstName.toLowerCase() === needle ||
      e.lastName.toLowerCase() === needle ||
      full.includes(needle) ||
      needle.includes(e.firstName.toLowerCase())
    ) {
      return { id: e.id, fullName: `${e.firstName} ${e.lastName}`.trim() };
    }
  }
  return undefined;
}

/**
 * Claim processing for a meeting's audio. Returns the created note row, or
 * null when another upload already claimed this meeting (unique meeting_db_id).
 */
export async function claimMeetingNote(meeting: Meeting, uploadedBy: number) {
  const rows = await db
    .insert(aiMeetingNotesTable)
    .values({
      companyId: meeting.companyId,
      meetingDbId: meeting.id,
      meetingId: meeting.meetingId,
      channelId: meeting.channelId ?? null,
      taskId: meeting.taskId ?? null,
      title: meeting.title,
      status: "processing",
      uploadedBy,
    })
    .onConflictDoNothing({ target: aiMeetingNotesTable.meetingDbId })
    .returning();
  if (rows[0]) return rows[0];

  // Already claimed. If the previous attempt FAILED, atomically reclaim it so
  // a re-upload can retry — a poisoned first upload must not permanently
  // block the meeting's notes.
  const reclaimed = await db
    .update(aiMeetingNotesTable)
    .set({ status: "processing", error: null, uploadedBy, updatedAt: new Date() })
    .where(and(eq(aiMeetingNotesTable.meetingDbId, meeting.id), eq(aiMeetingNotesTable.status, "failed")))
    .returning();
  return reclaimed[0] ?? null;
}

/**
 * Persist the uploaded recording to object storage and stamp its path on the
 * note row so a failed note can be retried server-side later. Best-effort:
 * a storage failure must not block the AI pipeline (retry just won't be
 * available for this note).
 */
export async function storeMeetingAudio(noteId: number, audioBase64: string, mimeType: string): Promise<void> {
  try {
    const buffer = Buffer.from(audioBase64, "base64");
    const objectPath = await objectStorage.uploadPrivateObject(buffer, mimeType, "meeting-audio");
    await db
      .update(aiMeetingNotesTable)
      .set({ audioObjectPath: objectPath, audioMimeType: mimeType, updatedAt: new Date() })
      .where(eq(aiMeetingNotesTable.id, noteId));
  } catch (err) {
    logger.error({ err, noteId }, "Failed to persist meeting audio to object storage");
  }
}

/**
 * Retry a failed note directly from its stored recording. Atomically reclaims
 * the row (status failed → processing) so concurrent retries and re-uploads
 * can't double-run the pipeline. Throws with a user-facing message on
 * invalid states.
 */
export async function retryMeetingNote(noteId: number, companyId: number): Promise<void> {
  const note = await getMeetingNote(noteId, companyId);
  if (!note) throw new Error("Note not found");
  if (note.status === "processing") throw new Error("This note is already being processed");
  if (note.status !== "failed") throw new Error("Only failed notes can be retried");
  if (!note.audioObjectPath || !note.audioMimeType) {
    throw new Error("The original recording is not stored for this note — rejoin the meeting to re-upload it");
  }

  const [meeting] = await db
    .select()
    .from(meetingsTable)
    .where(and(eq(meetingsTable.id, note.meetingDbId), eq(meetingsTable.companyId, companyId)))
    .limit(1);
  if (!meeting) throw new Error("Meeting not found");

  // Download the stored recording BEFORE reclaiming, so a missing/corrupt
  // object doesn't leave the note stuck in "processing".
  const file = await objectStorage.getObjectEntityFile(note.audioObjectPath).catch(() => {
    throw new Error("The stored recording could not be found — rejoin the meeting to re-upload it");
  });
  const [buffer] = await file.download();

  // Atomic reclaim: only one concurrent retry/re-upload wins.
  const reclaimed = await db
    .update(aiMeetingNotesTable)
    .set({ status: "processing", error: null, updatedAt: new Date() })
    .where(and(eq(aiMeetingNotesTable.id, noteId), eq(aiMeetingNotesTable.status, "failed")))
    .returning();
  if (!reclaimed[0]) throw new Error("This note is already being processed");

  void processMeetingAudio(noteId, meeting, buffer.toString("base64"), note.audioMimeType);
}

/**
 * Run the full AI pipeline for an uploaded meeting recording.
 * Fire-and-forget from the route: all failures are recorded on the note row.
 */
export async function processMeetingAudio(noteId: number, meeting: Meeting, audioBase64: string, mimeType: string): Promise<void> {
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const analysis = await analyzeAudio(audioBase64, mimeType, meeting.title, todayIso);

    const employees = await db
      .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, email: employeesTable.email })
      .from(employeesTable)
      .where(eq(employeesTable.companyId, meeting.companyId));

    const actionItems: MeetingActionItem[] = [];
    for (const item of analysis.actionItems) {
      const entry: MeetingActionItem = {
        title: item.title.trim().slice(0, 300),
        description: item.description?.trim() || undefined,
        assigneeName: item.assigneeName?.trim() || undefined,
        priority: item.priority === "low" || item.priority === "high" ? item.priority : "medium",
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate ?? "") ? item.dueDate : undefined,
      };
      const matched = matchEmployee(entry.assigneeName, employees);
      if (matched) {
        entry.assigneeName = matched.fullName;
        try {
          const [task] = await db
            .insert(generatedTasksTable)
            .values({
              companyId: meeting.companyId,
              employeeId: matched.id,
              generatedDate: todayIso,
              title: entry.title,
              description: entry.description || `Action item from meeting "${meeting.title}".`,
              priority: entry.priority ?? "medium",
              status: "assigned",
              source: "ai_customized",
              aiCustomizations: { origin: "meeting_assistant", meetingId: meeting.meetingId },
              dueDate: entry.dueDate ?? null,
            })
            .returning({ id: generatedTasksTable.id });
          if (task) {
            entry.taskId = task.id;
            void emitNotification({
              type: "hr",
              title: `New action item for ${matched.fullName}`,
              message: `"${entry.title}" from meeting "${meeting.title}"${entry.dueDate ? ` — due ${entry.dueDate}` : ""}.`,
              severity: "info",
              companyId: meeting.companyId,
              actionUrl: "/admin/ai-tasks",
            });
          }
        } catch (err) {
          logger.error({ err, noteId }, "Failed to create task from meeting action item");
        }
      }
      actionItems.push(entry);
    }

    await db
      .update(aiMeetingNotesTable)
      .set({
        transcript: analysis.transcript,
        summary: analysis.summary,
        notes: analysis.notes,
        actionItems,
        status: "done",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(aiMeetingNotesTable.id, noteId));

    void emitNotification({
      type: "system",
      title: "Meeting notes ready",
      message: `AI notes for "${meeting.title}" are ready${actionItems.length ? ` with ${actionItems.length} action item${actionItems.length === 1 ? "" : "s"}` : ""}.`,
      severity: "success",
      companyId: meeting.companyId,
      actionUrl: "/chat",
    });
  } catch (err) {
    logger.error({ err, noteId }, "AI meeting notes pipeline failed");
    await db
      .update(aiMeetingNotesTable)
      .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error", updatedAt: new Date() })
      .where(eq(aiMeetingNotesTable.id, noteId))
      .catch(() => {});
    void emitNotification({
      type: "system",
      title: "Meeting notes failed",
      message: `AI notes for "${meeting.title}" could not be generated. Open Team → Meeting Notes to retry.`,
      severity: "error",
      companyId: meeting.companyId,
      actionUrl: "/chat",
    });
  }
}

export async function listMeetingNotes(companyId: number, opts: { channelId?: number; q?: string; limit?: number }) {
  const conditions = [eq(aiMeetingNotesTable.companyId, companyId)];
  if (opts.channelId) conditions.push(eq(aiMeetingNotesTable.channelId, opts.channelId));
  if (opts.q && opts.q.trim()) {
    const pattern = `%${opts.q.trim()}%`;
    conditions.push(
      or(
        ilike(aiMeetingNotesTable.title, pattern),
        ilike(aiMeetingNotesTable.summary, pattern),
        ilike(aiMeetingNotesTable.notes, pattern),
        ilike(aiMeetingNotesTable.transcript, pattern),
      )!,
    );
  }
  return db
    .select({
      id: aiMeetingNotesTable.id,
      meetingDbId: aiMeetingNotesTable.meetingDbId,
      meetingId: aiMeetingNotesTable.meetingId,
      channelId: aiMeetingNotesTable.channelId,
      title: aiMeetingNotesTable.title,
      summary: aiMeetingNotesTable.summary,
      actionItems: aiMeetingNotesTable.actionItems,
      status: aiMeetingNotesTable.status,
      error: aiMeetingNotesTable.error,
      createdAt: aiMeetingNotesTable.createdAt,
    })
    .from(aiMeetingNotesTable)
    .where(and(...conditions))
    .orderBy(desc(aiMeetingNotesTable.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

/**
 * Manually assign an action item that the AI couldn't match to an employee.
 * Creates the generated task + notification and stamps the taskId back into
 * the note's actionItems JSON. Errors with a message on invalid input.
 */
export async function assignActionItem(noteId: number, companyId: number, itemIndex: number, employeeId: number) {
  // Everything runs in one transaction with the note row locked FOR UPDATE:
  // concurrent assigns (same or different items of the same note) serialize,
  // which prevents double-created tasks and lost array updates. The action
  // items array only changes after processing completes, so the row lock is
  // the only concurrency control needed for index-based addressing.
  const { updated, item, fullName } = await db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(aiMeetingNotesTable)
      .where(and(eq(aiMeetingNotesTable.id, noteId), eq(aiMeetingNotesTable.companyId, companyId)))
      .for("update");
    if (!note) throw new Error("Note not found");
    const items = [...(note.actionItems ?? [])];
    const item = items[itemIndex];
    if (!item) throw new Error("Action item not found");
    if (item.taskId) throw new Error("This action item already has a task");

    const [employee] = await tx
      .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, companyId)))
      .limit(1);
    if (!employee) throw new Error("Employee not found in this company");
    const fullName = `${employee.firstName} ${employee.lastName}`.trim();

    const todayIso = new Date().toISOString().slice(0, 10);
    const [task] = await tx
      .insert(generatedTasksTable)
      .values({
        companyId,
        employeeId: employee.id,
        generatedDate: todayIso,
        title: item.title,
        description: item.description || `Action item from meeting "${note.title}".`,
        priority: item.priority ?? "medium",
        status: "assigned",
        source: "ai_customized",
        aiCustomizations: { origin: "meeting_assistant", meetingId: note.meetingId, manualAssignment: true },
        dueDate: item.dueDate ?? null,
      })
      .returning({ id: generatedTasksTable.id });
    if (!task) throw new Error("Failed to create task");

    items[itemIndex] = { ...item, assigneeName: fullName, assigneeUserId: undefined, taskId: task.id };
    const [updated] = await tx
      .update(aiMeetingNotesTable)
      .set({ actionItems: items, updatedAt: new Date() })
      .where(and(eq(aiMeetingNotesTable.id, noteId), eq(aiMeetingNotesTable.companyId, companyId)))
      .returning();
    return { updated, item, fullName };
  });

  const note = updated;
  void emitNotification({
    type: "hr",
    title: `New action item for ${fullName}`,
    message: `"${item.title}" from meeting "${note.title}"${item.dueDate ? ` — due ${item.dueDate}` : ""}.`,
    severity: "info",
    companyId,
    actionUrl: "/admin/ai-tasks",
  });

  return updated;
}

// ── Stuck-note sweep ──────────────────────────────────────────────────────────
// If the server restarts mid-pipeline, a note stays in "processing" forever:
// the claim/retry logic only reclaims "failed" rows, so nothing can retry it
// and the UI polls indefinitely. The sweep fails any note that has been
// processing longer than the threshold, making it reclaimable again.

/** Longest a real pipeline run can plausibly take (Gemini call + task fan-out). */
const STUCK_PROCESSING_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const STUCK_NOTE_ERROR =
  "Processing timed out — likely a server restart interrupted it. Click Retry to run it again.";

/**
 * Fail notes stuck in "processing" for longer than the threshold.
 * Returns the number of notes swept. Uses updated_at (stamped when a note is
 * claimed/reclaimed) so a freshly retried note gets the full window again.
 */
export async function sweepStuckMeetingNotes(olderThanMs: number = STUCK_PROCESSING_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const swept = await db
    .update(aiMeetingNotesTable)
    .set({ status: "failed", error: STUCK_NOTE_ERROR, updatedAt: new Date() })
    .where(and(eq(aiMeetingNotesTable.status, "processing"), sql`${aiMeetingNotesTable.updatedAt} < ${cutoff}`))
    .returning({ id: aiMeetingNotesTable.id, companyId: aiMeetingNotesTable.companyId, title: aiMeetingNotesTable.title });
  if (swept.length > 0) {
    logger.warn({ noteIds: swept.map((n) => n.id) }, "Swept stuck AI meeting notes to failed");
    for (const note of swept) {
      void emitNotification({
        type: "system",
        title: "Meeting notes failed",
        message: `AI notes for "${note.title}" timed out. Open Team → Meeting Notes to retry.`,
        severity: "error",
        companyId: note.companyId,
        actionUrl: "/chat",
      });
    }
  }
  return swept.length;
}

/** Run the stuck-note sweep now and then periodically. Call once at startup. */
export function startStuckNoteSweeper(): void {
  const run = () => sweepStuckMeetingNotes().catch((err) => logger.error({ err }, "Stuck meeting-note sweep failed"));
  void run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export async function getMeetingNote(id: number, companyId: number) {
  const [note] = await db
    .select()
    .from(aiMeetingNotesTable)
    .where(and(eq(aiMeetingNotesTable.id, id), eq(aiMeetingNotesTable.companyId, companyId)))
    .limit(1);
  return note ?? null;
}
