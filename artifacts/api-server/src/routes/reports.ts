import { Router } from "express";
import { db, aiReportSchedulesTable, aiReportHistoryTable } from "@workspace/db";
import { eq, desc, and, isNull, isNotNull, inArray } from "drizzle-orm";
import { requirePermission, requireSuperAdmin } from "../middleware/authz";
import { canAccessCompany, companyScope } from "../lib/company-scope";
import { generateExecutiveReport, computeNextRunAt, storeReport } from "../lib/report-generator";
import { sendExecutiveReportEmail } from "../lib/email";

const router = Router();

// ── GET /reports/schedules ────────────────────────────────────────────────────
router.get("/reports/schedules", requirePermission("ai.reports"), async (req, res) => {
  try {
    const scope = companyScope(req);
    if (Array.isArray(scope) && scope.length === 0) { res.json([]); return; }

    const rows = await db.select().from(aiReportSchedulesTable)
      .orderBy(desc(aiReportSchedulesTable.createdAt));

    // Super-admin sees all (scope === null).
    // Scoped users only see schedules for their own companies;
    // portfolio schedules (companyId null) are super-admin only.
    const visible = scope === null
      ? rows
      : rows.filter(r => r.companyId != null && scope.includes(r.companyId));

    res.json(visible);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list schedules" });
  }
});

// ── POST /reports/schedules ────────────────────────────────────────────────────
// Super-admin only: controls automated email delivery to external addresses
router.post("/reports/schedules", requireSuperAdmin, async (req, res) => {
  try {
    const { companyId, type, enabled, recipientEmails } = req.body as {
      companyId?: number | null;
      type: string;
      enabled?: boolean;
      recipientEmails?: string[];
    };

    const VALID_TYPES = new Set(["daily", "weekly", "monthly", "quarterly", "annual"]);
    if (!VALID_TYPES.has(type)) { res.status(400).json({ error: `type must be one of: ${[...VALID_TYPES].join(", ")}` }); return; }

    const emails = (recipientEmails ?? []).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const nextRunAt = computeNextRunAt(type);
    const now = new Date();

    const [row] = await db.insert(aiReportSchedulesTable).values({
      companyId: companyId ?? null,
      type,
      enabled: enabled !== false,
      recipientEmails: emails,
      nextRunAt,
      updatedAt: now,
    }).returning();

    res.status(201).json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create schedule" });
  }
});

// ── PATCH /reports/schedules/:id ──────────────────────────────────────────────
router.patch("/reports/schedules/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { type, enabled, recipientEmails } = req.body as {
      type?: string; enabled?: boolean; recipientEmails?: string[];
    };

    const VALID_TYPES = new Set(["daily", "weekly", "monthly", "quarterly", "annual"]);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (type !== undefined) {
      if (!VALID_TYPES.has(type)) { res.status(400).json({ error: "Invalid type" }); return; }
      patch.type = type;
      patch.nextRunAt = computeNextRunAt(type);
    }
    if (enabled !== undefined) patch.enabled = enabled;
    if (recipientEmails !== undefined) {
      patch.recipientEmails = recipientEmails.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    }

    const [row] = await db.update(aiReportSchedulesTable)
      .set(patch)
      .where(eq(aiReportSchedulesTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Schedule not found" }); return; }
    res.json(row);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update schedule" });
  }
});

// ── DELETE /reports/schedules/:id ─────────────────────────────────────────────
router.delete("/reports/schedules/:id", requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.delete(aiReportSchedulesTable).where(eq(aiReportSchedulesTable.id, id));
    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete schedule" });
  }
});

// ── GET /reports/history ───────────────────────────────────────────────────────
router.get("/reports/history", requirePermission("ai.reports"), async (req, res) => {
  try {
    const scope = companyScope(req);
    if (Array.isArray(scope) && scope.length === 0) { res.json([]); return; }

    const cqp = req.query.companyId as string | undefined;
    // Support "null" string to filter for portfolio (companyId IS NULL) records
    const requestedPortfolio = cqp === "null";
    const companyIdFilter: number | null | undefined =
      !cqp ? undefined
      : requestedPortfolio ? null
      : Number.isFinite(parseInt(cqp)) ? parseInt(cqp)
      : undefined;

    // Build WHERE conditions in SQL so LIMIT 50 applies AFTER scoping.
    // Scoped users only see their own companies; portfolio rows (null companyId) are super-admin only.
    const whereClauses = [];

    if (scope !== null) {
      // Non-super-admin: restrict to their company IDs (portfolio rows are excluded)
      whereClauses.push(
        scope.length > 0
          ? and(isNotNull(aiReportHistoryTable.companyId), inArray(aiReportHistoryTable.companyId, scope))
          : eq(aiReportHistoryTable.id, -1) // impossible condition → empty
      );
    }

    if (companyIdFilter !== undefined) {
      if (companyIdFilter === null) {
        whereClauses.push(isNull(aiReportHistoryTable.companyId));
      } else {
        whereClauses.push(eq(aiReportHistoryTable.companyId, companyIdFilter));
      }
    }

    const rows = await db.select({
      id:             aiReportHistoryTable.id,
      companyId:      aiReportHistoryTable.companyId,
      scheduleId:     aiReportHistoryTable.scheduleId,
      type:           aiReportHistoryTable.type,
      periodLabel:    aiReportHistoryTable.periodLabel,
      status:         aiReportHistoryTable.status,
      subject:        aiReportHistoryTable.subject,
      aiSummary:      aiReportHistoryTable.aiSummary,
      contentJson:    aiReportHistoryTable.contentJson,
      recipientCount: aiReportHistoryTable.recipientCount,
      errorMessage:   aiReportHistoryTable.errorMessage,
      sentAt:         aiReportHistoryTable.sentAt,
      createdAt:      aiReportHistoryTable.createdAt,
    }).from(aiReportHistoryTable)
      .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
      .orderBy(desc(aiReportHistoryTable.createdAt))
      .limit(50);

    res.json(rows.map(r => ({
      ...r,
      sentAt:    r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list report history" });
  }
});

// ── GET /reports/history/:id ──────────────────────────────────────────────────
router.get("/reports/history/:id", requirePermission("ai.reports"), async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [row] = await db.select().from(aiReportHistoryTable)
      .where(eq(aiReportHistoryTable.id, id)).limit(1);

    if (!row) { res.status(404).json({ error: "Report not found" }); return; }

    const scope = companyScope(req);
    if (scope !== null) {
      // Portfolio records (companyId null) are super-admin only.
      // Company-scoped records require the caller to have access to that company.
      if (row.companyId == null || !scope.includes(row.companyId)) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    res.json({
      ...row,
      sentAt:    row.sentAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get report" });
  }
});

// ── POST /reports/generate ─────────────────────────────────────────────────────
// Manually trigger report generation + email delivery
router.post("/reports/generate", requirePermission("ai.reports"), async (req, res) => {
  try {
    const { companyId, type, recipientEmails } = req.body as {
      companyId?: number | null;
      type?: string;
      recipientEmails?: string[];
    };

    const cid: number | null = companyId ?? null;
    // Portfolio-level reports (companyId null) are super-admin only
    if (cid == null) {
      const scope = companyScope(req);
      if (scope !== null) { res.status(403).json({ error: "Forbidden: super-admin only for portfolio reports" }); return; }
    } else if (!canAccessCompany(req, cid)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const reportType = type ?? "manual";
    const emails = (recipientEmails ?? []).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    // Insert a "generating" placeholder immediately so the frontend can poll
    const historyId = await storeReport({
      companyId: cid,
      type: reportType,
      status: "generating",
      subject: "Generating…",
    });

    // Generate + send in the background (response returns the history id immediately)
    void (async () => {
      try {
        const report = await generateExecutiveReport({ companyId: cid, type: reportType, recipientEmails: emails });

        let sentCount = 0;
        for (const email of emails) {
          const result = await sendExecutiveReportEmail({ to: email, subject: report.subject, html: report.htmlContent });
          if (result.ok) sentCount++;
        }

        const now = new Date();
        await db.update(aiReportHistoryTable).set({
          status:         sentCount > 0 || emails.length === 0 ? "ready" : "failed",
          subject:        report.subject,
          htmlContent:    report.htmlContent,
          aiSummary:      report.aiSummary,
          contentJson:    report.contentJson as unknown as Record<string, unknown>,
          periodLabel:    report.periodLabel,
          recipientCount: sentCount,
          sentAt:         sentCount > 0 ? now : undefined,
          errorMessage:   sentCount === 0 && emails.length > 0 ? "All deliveries failed" : undefined,
        }).where(eq(aiReportHistoryTable.id, historyId));
      } catch (err) {
        req.log.error({ err, historyId }, "Background report generation failed");
        await db.update(aiReportHistoryTable).set({
          status: "failed",
          subject: "Report generation failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        }).where(eq(aiReportHistoryTable.id, historyId));
      }
    })();

    res.status(202).json({ id: historyId, status: "generating" });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to start report generation" });
  }
});

export default router;
