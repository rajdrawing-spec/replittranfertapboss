import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";

const router = Router();

// GET /audit-logs — recent audit entries (Super Admin only).
router.get("/audit-logs", requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || "200"), 500);
    const logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.id)).limit(limit);
    res.json(logs);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load audit logs" });
  }
});

export default router;
