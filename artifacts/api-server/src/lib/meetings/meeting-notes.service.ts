import { db, aiMeetingNotesTable, generatedTasksTable, employeesTable, usersTable, meetingsTable, type MeetingActionItem, type Meeting } from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { emitNotification } from "../notify";
import { logger } from "../logger";

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
    model: "gemini-2.5-flash",
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
      createdAt: aiMeetingNotesTable.createdAt,
    })
    .from(aiMeetingNotesTable)
    .where(and(...conditions))
    .orderBy(desc(aiMeetingNotesTable.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function getMeetingNote(id: number, companyId: number) {
  const [note] = await db
    .select()
    .from(aiMeetingNotesTable)
    .where(and(eq(aiMeetingNotesTable.id, id), eq(aiMeetingNotesTable.companyId, companyId)))
    .limit(1);
  return note ?? null;
}
