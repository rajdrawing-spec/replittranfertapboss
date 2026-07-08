import { Router } from "express";
import { db } from "@workspace/db";
import {
  approvalsTable, companiesTable, fundAllocationsTable, insertApprovalSchema,
  approvalVotesTable,
} from "@workspace/db";
import type { User, RequiredApprover } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { executeFundAllocation } from "../lib/fund-allocation";
import { canAccessCompany } from "../lib/company-scope";
import { emitNotification } from "../lib/notify";

const router = Router();

/* ── types ── */

type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
type VoteDecision   = "pending" | "approved" | "rejected";

interface FmtVote {
  id: number;
  voterName: string;
  voterEmail: string;
  voterRole: string;
  decision: VoteDecision;
  note: string | null;
  votedAt: string | null;
}

/* ── helpers ── */

function fmtVote(v: typeof approvalVotesTable.$inferSelect): FmtVote {
  return {
    id: v.id,
    voterName: v.voterName,
    voterEmail: v.voterEmail,
    voterRole: v.voterRole,
    decision: v.decision as VoteDecision,
    note: v.note ?? null,
    votedAt: v.votedAt ? v.votedAt.toISOString() : null,
  };
}

function computeCounts(
  required: RequiredApprover[],
  votes: FmtVote[],
): { approvedCount: number; rejectedCount: number; pendingCount: number } {
  // When a required-approver list exists, counts are scoped to that list only.
  // Non-required votes (e.g. an admin recording a note) are excluded from counts.
  if (required.length > 0) {
    const voteByEmail = new Map(votes.map((v) => [v.voterEmail, v]));
    let approved = 0, rejected = 0, pending = 0;
    for (const ra of required) {
      const v = voteByEmail.get(ra.email);
      if (!v || v.decision === "pending") pending++;
      else if (v.decision === "approved") approved++;
      else rejected++;
    }
    return { approvedCount: approved, rejectedCount: rejected, pendingCount: pending };
  }
  // Legacy approvals with no required list: count all votes
  return {
    approvedCount: votes.filter((v) => v.decision === "approved").length,
    rejectedCount: votes.filter((v) => v.decision === "rejected").length,
    pendingCount:  votes.filter((v) => v.decision === "pending").length,
  };
}

function fmtApproval(
  a: typeof approvalsTable.$inferSelect,
  companyMap: Record<number, string>,
  votes: FmtVote[],
) {
  const required = (a.requiredApprovers ?? []) as RequiredApprover[];
  const { approvedCount, rejectedCount, pendingCount } = computeCounts(required, votes);
  return {
    id: a.id,
    companyId: a.companyId,
    companyName: companyMap[a.companyId] ?? "Unknown",
    type: a.type,
    title: a.title,
    description: a.description,
    requestedBy: a.requestedBy,
    currentStep: a.currentStep,
    totalSteps: a.totalSteps,
    status: a.status as ApprovalStatus,
    amount: a.amount,
    approverNote: a.approverNote,
    dueDate: a.dueDate,
    requiredApprovers: required,
    votes,
    approvedCount,
    rejectedCount,
    pendingCount,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Seed pending vote rows for all required approvers (idempotent). */
async function ensureVoteRows(approvalId: number, required: RequiredApprover[]): Promise<void> {
  if (required.length === 0) return;
  await db.execute(sql`
    INSERT INTO approval_votes (approval_id, voter_name, voter_email, voter_role, decision)
    SELECT ${approvalId}, v.name, v.email, v.role, 'pending'
    FROM jsonb_to_recordset(${JSON.stringify(required)}::jsonb)
      AS v(name text, email text, role text)
    ON CONFLICT (approval_id, voter_email) DO NOTHING
  `);
}

/** Load all votes for a set of approval IDs, grouped by approval. */
async function loadVotes(approvalIds: number[]): Promise<Map<number, FmtVote[]>> {
  if (approvalIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(approvalVotesTable)
    .where(inArray(approvalVotesTable.approvalId, approvalIds))
    .orderBy(approvalVotesTable.createdAt);
  const map = new Map<number, FmtVote[]>();
  for (const row of rows) {
    const list = map.get(row.approvalId) ?? [];
    list.push(fmtVote(row));
    map.set(row.approvalId, list);
  }
  return map;
}

/* ── GET /approvals ── */

router.get("/approvals", async (req, res) => {
  try {
    const { status, companyId, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (status) conditions.push(eq(approvalsTable.status, status));
    if (companyId) conditions.push(eq(approvalsTable.companyId, parseInt(companyId)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(approvalsTable)
      .where(where);
    const items = await db
      .select()
      .from(approvalsTable)
      .where(where)
      .orderBy(desc(approvalsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const companies = await db
      .select({ id: companiesTable.id, name: companiesTable.name })
      .from(companiesTable);
    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const votesMap = await loadVotes(items.map((a) => a.id));

    res.json({
      items: items.map((a) => fmtApproval(a, companyMap, votesMap.get(a.id) ?? [])),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list approvals" });
  }
});

/* ── POST /approvals ── */

router.post("/approvals", async (req, res) => {
  try {
    const parsed = insertApprovalSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [a] = await db.insert(approvalsTable).values(parsed.data).returning();

    await ensureVoteRows(a.id, (a.requiredApprovers ?? []) as RequiredApprover[]);

    const [co] = await db
      .select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, a.companyId));
    const votes = await loadVotes([a.id]);
    res.status(201).json(fmtApproval(a, { [a.companyId]: co?.name ?? "Unknown" }, votes.get(a.id) ?? []));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create approval" });
  }
});

/* ── PATCH /approvals/:approvalId/action ── */

router.patch("/approvals/:approvalId/action", async (req, res) => {
  try {
    const id = parseInt(req.params.approvalId);
    const { action, note } = req.body as { action: "approve" | "reject"; note?: string };
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" }); return;
    }

    const [existing] = await db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status !== "pending") {
      res.status(409).json({ error: `This approval is already ${existing.status}` }); return;
    }

    const u = (req as any).localUser as User | undefined;
    const voterEmail = u?.email ?? "";
    const voterName  = u?.name  ?? "Unknown";
    const voterRole  = u?.role  ?? "approver";
    const isSuperAdmin   = u?.role === "super_admin";
    const isCompanyAdmin = u?.role === "company_admin";

    /* ── Authorization ──
     * 1. The voter must have access to the company this approval belongs to.
     * 2. The voter must either be in the required-approvers list OR be a
     *    super_admin/company_admin (catch-all for legacy approvals with no list,
     *    and for admin overrides on any approval type).
     */
    if (!canAccessCompany(req, existing.companyId)) {
      res.status(403).json({ error: "You do not have access to this company" }); return;
    }

    const required = (existing.requiredApprovers ?? []) as RequiredApprover[];
    const isRequiredApprover = required.length === 0 || required.some((r) => r.email === voterEmail);
    const isAdmin = isSuperAdmin || isCompanyAdmin;

    if (!isRequiredApprover && !isAdmin) {
      res.status(403).json({
        error: "You are not listed as a required approver for this request",
      }); return;
    }

    // Fund allocations additionally require super_admin or company_admin.
    if (existing.type === "fund_allocation" && !isAdmin) {
      res.status(403).json({ error: "Only a Super Admin or Company Admin can approve fund allocations" }); return;
    }

    const decision: VoteDecision = action === "approve" ? "approved" : "rejected";

    // Upsert the voter's individual vote row.
    await db.execute(sql`
      INSERT INTO approval_votes (approval_id, voter_name, voter_email, voter_role, decision, note, voted_at)
      VALUES (
        ${id}, ${voterName}, ${voterEmail}, ${voterRole},
        ${decision}, ${note ?? null}, NOW()
      )
      ON CONFLICT (approval_id, voter_email)
      DO UPDATE SET
        voter_name = ${voterName},
        voter_role = ${voterRole},
        decision   = ${decision},
        note       = COALESCE(${note ?? null}, approval_votes.note),
        voted_at   = NOW()
    `);

    // Determine new overall status, computed against the required-approver set only.
    const allVotes = await db
      .select()
      .from(approvalVotesTable)
      .where(eq(approvalVotesTable.approvalId, id));

    const voteByEmail = new Map(allVotes.map((v) => [v.voterEmail, v.decision as VoteDecision]));

    let newStatus: ApprovalStatus = "pending";
    let newStep = existing.currentStep;

    if (required.length === 0) {
      // Legacy: single-voter approval — the acting voter's decision is final.
      newStatus = decision === "approved" ? "approved" : "rejected";
    } else {
      const anyRequiredRejected = required.some(
        (r) => voteByEmail.get(r.email) === "rejected",
      );
      const allRequiredApproved = required.every(
        (r) => voteByEmail.get(r.email) === "approved",
      );
      if (anyRequiredRejected) {
        newStatus = "rejected";
      } else if (allRequiredApproved) {
        newStatus = "approved";
      } else {
        // Still pending — update step counter to reflect progress.
        const approvedSoFar = required.filter(
          (r) => voteByEmail.get(r.email) === "approved",
        ).length;
        newStep = Math.min(approvedSoFar + 1, existing.totalSteps);
      }
    }

    const [a] = await db
      .update(approvalsTable)
      .set({
        status: newStatus,
        currentStep: newStep,
        approverNote: note ?? existing.approverNote ?? null,
        updatedAt: new Date(),
      })
      .where(eq(approvalsTable.id, id))
      .returning();

    // Propagate to linked fund allocation when resolved.
    if (a.type === "fund_allocation" && (newStatus === "approved" || newStatus === "rejected")) {
      const [alloc] = await db
        .select()
        .from(fundAllocationsTable)
        .where(eq(fundAllocationsTable.approvalId, a.id))
        .limit(1);
      if (alloc && alloc.status === "pending_approval") {
        if (newStatus === "approved") {
          await executeFundAllocation(alloc.id, { id: u?.id ?? null, email: u?.email ?? null });
        } else {
          await db
            .update(fundAllocationsTable)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(eq(fundAllocationsTable.id, alloc.id));
        }
      }
    }

    if (newStatus === "approved" || newStatus === "rejected") {
      void emitNotification({
        type: "approval",
        severity: newStatus === "approved" ? "info" : "warning",
        companyId: a.companyId,
        title: `Approval ${newStatus}`,
        message: `"${a.title}" was ${newStatus} by ${voterName}.`,
        actionUrl: "/approvals",
      });
    }

    const [co] = await db
      .select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, a.companyId));
    const votesMap = await loadVotes([a.id]);
    res.json(fmtApproval(a, { [a.companyId]: co?.name ?? "Unknown" }, votesMap.get(a.id) ?? []));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to process approval" });
  }
});

/* ── GET /approvals/:approvalId/votes ── */

router.get("/approvals/:approvalId/votes", async (req, res) => {
  try {
    const id = parseInt(req.params.approvalId);
    const rows = await db
      .select()
      .from(approvalVotesTable)
      .where(eq(approvalVotesTable.approvalId, id))
      .orderBy(approvalVotesTable.createdAt);
    res.json(rows.map(fmtVote));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load votes" });
  }
});

export default router;
