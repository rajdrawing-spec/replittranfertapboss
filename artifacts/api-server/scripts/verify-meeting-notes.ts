/**
 * End-to-end verification of the AI meeting notes pipeline (Task #18).
 *
 * Creates a temporary meeting + employee, feeds a real speech recording
 * through claimMeetingNote + processMeetingAudio (real Gemini call), verifies
 * the note, the auto-created assigned task, and the notifications, then
 * cleans up all test rows.
 */
import fs from "node:fs";
import { db, meetingsTable, meetingParticipantsTable, employeesTable, aiMeetingNotesTable, generatedTasksTable, notificationsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { claimMeetingNote, processMeetingAudio } from "../src/lib/meetings/meeting-notes.service";

const COMPANY_ID = 2; // HugFAB
const ORGANIZER_ID = 1;

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error("Usage: tsx verify-meeting-notes.ts <audio file>");
  const audioBase64 = fs.readFileSync(audioPath).toString("base64");
  console.log(`Audio: ${audioPath} (${Math.round(audioBase64.length * 0.75 / 1024)} KB)`);

  // 1. Temp employee the action item should match
  const [emp] = await db.insert(employeesTable).values({
    companyId: COMPANY_ID,
    firstName: "Arjun",
    lastName: "Mehta",
    email: "arjun.mehta.e2etest@example.com",
    department: "Sales",
    designation: "Sales Analyst",
    employeeCode: "E2E-TEST-001",
    joinDate: "2026-01-01",
  } as any).returning();
  console.log("Created temp employee:", emp.id);

  // 2. Temp meeting
  const meetingId = `TBOS-E2ETEST-${Date.now()}`;
  const [meeting] = await db.insert(meetingsTable).values({
    companyId: COMPANY_ID,
    meetingId,
    title: "E2E Test — Product Planning",
    provider: "livekit",
    roomUrl: `https://example.test/${meetingId}`,
    status: "ongoing",
    organizerId: ORGANIZER_ID,
  } as any).returning();
  console.log("Created temp meeting:", meeting.id, meetingId);

  const cleanup = async () => {
    const noteRows = await db.select({ id: aiMeetingNotesTable.id }).from(aiMeetingNotesTable).where(eq(aiMeetingNotesTable.meetingDbId, meeting.id));
    await db.delete(aiMeetingNotesTable).where(eq(aiMeetingNotesTable.meetingDbId, meeting.id));
    await db.delete(generatedTasksTable).where(eq(generatedTasksTable.employeeId, emp.id));
    await db.delete(notificationsTable).where(sql`${notificationsTable.message} LIKE '%E2E Test — Product Planning%'`);
    await db.delete(meetingParticipantsTable).where(eq(meetingParticipantsTable.meetingId, meeting.id)).catch?.(() => {});
    await db.delete(meetingsTable).where(eq(meetingsTable.id, meeting.id));
    await db.delete(employeesTable).where(eq(employeesTable.id, emp.id));
    console.log(`Cleaned up test rows (notes: ${noteRows.length}).`);
  };

  try {
    // 3. Claim + process (exactly what the POST /meetings/audio route does)
    const note = await claimMeetingNote(meeting as any, ORGANIZER_ID);
    if (!note) throw new Error("claimMeetingNote returned null");
    console.log("Claimed note row:", note.id, "status:", note.status);

    // Duplicate-claim check (second participant uploading)
    const dup = await claimMeetingNote(meeting as any, ORGANIZER_ID);
    console.log("Duplicate claim correctly returned:", dup === null ? "null (blocked)" : `UNEXPECTED row ${dup.id}`);

    console.log("Running Gemini pipeline (audio transcription)...");
    await processMeetingAudio(note.id, meeting as any, audioBase64, "audio/mpeg");

    // 4. Verify
    const [done] = await db.select().from(aiMeetingNotesTable).where(eq(aiMeetingNotesTable.id, note.id));
    console.log("\n=== NOTE RESULT ===");
    console.log("status:", done.status, "| error:", done.error);
    console.log("transcript chars:", done.transcript?.length ?? 0);
    console.log("summary:", (done.summary ?? "").slice(0, 300));
    console.log("notes (first 300):", (done.notes ?? "").slice(0, 300));
    console.log("actionItems:", JSON.stringify(done.actionItems, null, 2));

    const tasks = await db.select().from(generatedTasksTable).where(eq(generatedTasksTable.employeeId, emp.id));
    console.log("\n=== TASKS for Arjun Mehta ===");
    for (const t of tasks) console.log(`- [${t.priority}] ${t.title} | status=${t.status} | due=${t.dueDate} | source=${t.source}`);

    const notifs = await db.select({ title: notificationsTable.title, message: notificationsTable.message, type: notificationsTable.type })
      .from(notificationsTable)
      .where(sql`${notificationsTable.message} LIKE '%E2E Test — Product Planning%'`);
    console.log("\n=== NOTIFICATIONS ===");
    for (const n of notifs) console.log(`- [${n.type}] ${n.title}: ${n.message}`);

    const items = (done.actionItems ?? []) as any[];
    const pass = done.status === "done"
      && (done.transcript?.length ?? 0) > 50
      && (done.summary?.length ?? 0) > 20
      && items.length > 0
      && items.some((i) => i.taskId)
      && tasks.length > 0
      && notifs.length >= 2; // action-item notif + notes-ready notif
    console.log("\n=== VERDICT:", pass ? "PASS" : "FAIL", "===");
    if (!pass) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
