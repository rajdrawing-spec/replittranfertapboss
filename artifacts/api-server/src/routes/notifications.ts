import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, or, inArray, isNull, desc, sql } from "drizzle-orm";
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

/**
 * The set of notifications the caller is allowed to touch: their own companies'
 * alerts plus global (companyId IS NULL) system alerts. Super Admin (scope null)
 * gets `undefined` — no restriction. Mirrors the GET scoping exactly so a caller
 * can only ever mutate what they can see.
 */
function visibleScopeCondition(req: Parameters<typeof companyScope>[0]) {
  const scope = companyScope(req);
  if (scope === null) return undefined; // super admin: no restriction
  if (scope.length === 0) return isNull(notificationsTable.companyId);
  return or(inArray(notificationsTable.companyId, scope), isNull(notificationsTable.companyId));
}

router.patch("/notifications/:notificationId/read", async (req, res) => {
  try {
    const id = parseInt(req.params.notificationId);
    // Scope the UPDATE itself: another company's alert never matches, so it is
    // never flipped and the caller gets a 404 (indistinguishable from missing).
    const [n] = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, id), visibleScopeCondition(req)))
      .returning();
    if (!n) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...n, createdAt: n.createdAt.toISOString() });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.get("/notifications/unread-count", async (req, res) => {
  try {
    const conditions: any[] = [eq(notificationsTable.isRead, false)];
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
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(...conditions))
      .limit(1);
    res.json(row?.count ?? 0);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to count notifications" });
  }
});

router.patch("/notifications/mark-all-read", async (req, res) => {
  try {
    // Only clear unread alerts the caller is allowed to see — never every
    // company's unread notifications at once.
    const scope = visibleScopeCondition(req);
    const where = scope ? and(eq(notificationsTable.isRead, false), scope) : eq(notificationsTable.isRead, false);
    const result = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(where)
      .returning();
    res.json({ affected: result.length });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

export default router;
