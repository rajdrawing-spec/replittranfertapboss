import { Router } from "express";
import { db, usersTable, chatChannelsTable, meetingsTable, generatedTasksTable, taskGenerationJobsTable } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";

const router = Router();

router.get("/admin/metrics", async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [activeUsers] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.status, "active"));
    const [activeChats] = await db.select({ count: sql<number>`count(*)::int` }).from(chatChannelsTable);
    const [activeMeetings] = await db.select({ count: sql<number>`count(*)::int` }).from(meetingsTable).where(eq(meetingsTable.status, "ongoing"));
    const [tasksToday] = await db.select({ count: sql<number>`count(*)::int` }).from(generatedTasksTable).where(gte(generatedTasksTable.createdAt, today));
    const [recentErrors] = await db.select({ count: sql<number>`count(*)::int` }).from(taskGenerationJobsTable).where(and(gte(taskGenerationJobsTable.createdAt, weekAgo), eq(taskGenerationJobsTable.status, "failed")));
    const [recentJobs] = await db.select({ count: sql<number>`count(*)::int` }).from(taskGenerationJobsTable).where(gte(taskGenerationJobsTable.createdAt, dayAgo));
    const latestJob = await db.select({ providerUsed: taskGenerationJobsTable.providerUsed }).from(taskGenerationJobsTable).orderBy(taskGenerationJobsTable.createdAt).limit(1);

    res.json({
      activeUsers: Number(activeUsers?.count ?? 0),
      activeChats: Number(activeChats?.count ?? 0),
      activeMeetings: Number(activeMeetings?.count ?? 0),
      tasksToday: Number(tasksToday?.count ?? 0),
      schedulerStatus: "active",
      aiProviderStatus: latestJob[0]?.providerUsed ?? "gemini",
      recentErrors: Number(recentErrors?.count ?? 0),
      recentJobs: Number(recentJobs?.count ?? 0),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load metrics" });
  }
});

export default router;
