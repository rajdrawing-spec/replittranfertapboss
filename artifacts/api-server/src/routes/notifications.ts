import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, or, inArray, isNull, desc } from "drizzle-orm";
import { companyScope } from "../lib/company-scope";

const router = Router();

router.get("/notifications", async (req, res) => {
  try {
    const { unreadOnly = "false", limit = "20" } = req.query as Record<string, string>;
    const limitNum = parseInt(limit);

    const conditions = [];
    if (unreadOnly === "true") conditions.push(eq(notificationsTable.isRead, false));

    // Tenant scoping: Super Admin sees all alerts; scoped staff only see alerts
    // for a company they belong to, plus global (companyId IS NULL) system
    // alerts. They must never see another company's notifications.
    const scope = companyScope(req);
    if (scope !== null) {
      if (scope.length === 0) {
        conditions.push(isNull(notificationsTable.companyId));
      } else {
        conditions.push(
          or(inArray(notificationsTable.companyId, scope), isNull(notificationsTable.companyId)),
        );
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const items = await db
      .select()
      .from(notificationsTable)
      .where(where)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limitNum);
    res.json(items.map(n => ({ ...n, createdAt: n.createdAt.toISOString() })));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

router.patch("/notifications/:notificationId/read", async (req, res) => {
  try {
    const id = parseInt(req.params.notificationId);
    const [n] = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(eq(notificationsTable.id, id))
      .returning();
    if (!n) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...n, createdAt: n.createdAt.toISOString() });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.patch("/notifications/mark-all-read", async (req, res) => {
  try {
    const result = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(eq(notificationsTable.isRead, false))
      .returning();
    res.json({ affected: result.length });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

export default router;
