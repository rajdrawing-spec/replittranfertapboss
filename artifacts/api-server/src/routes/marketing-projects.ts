import { Router } from "express";
import {
  db,
  marketingProjectsTable,
  marketingProjectMembersTable,
  insertMarketingProjectSchema,
  usersTable,
  campaignsTable,
  campaignCreativesTable,
  campaignLeadsTable,
  clientVisibilitySettingsTable,
  clientAiPlansTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireSuperAdmin } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { isSafeAttachmentUrl } from "../lib/url-safety";
import { getClientVisibility, logClientEvent, listClientEvents } from "../lib/client-visibility";

/**
 * Admin management of Client Marketing Portal projects.
 * Super-admin only: creating projects, assigning members, and linking
 * marketing records to a project are platform administration actions.
 */
const router = Router();

router.use("/marketing-projects", requireSuperAdmin);

router.get("/marketing-projects", async (req, res) => {
  try {
    const projects = await db.select().from(marketingProjectsTable).orderBy(desc(marketingProjectsTable.createdAt));
    const members = projects.length
      ? await db.select().from(marketingProjectMembersTable)
          .where(inArray(marketingProjectMembersTable.projectId, projects.map((p) => p.id)))
      : [];
    const userIds = [...new Set(members.map((m) => m.userId))];
    const users = userIds.length
      ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    res.json(projects.map((p) => ({
      ...p,
      members: members.filter((m) => m.projectId === p.id).map((m) => ({
        id: m.id,
        userId: m.userId,
        memberType: m.memberType,
        name: userById.get(m.userId)?.name ?? "Unknown",
        email: userById.get(m.userId)?.email ?? "",
        role: userById.get(m.userId)?.role ?? "",
      })),
    })));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list projects" }); }
});

router.post("/marketing-projects", async (req, res) => {
  try {
    const parsed = insertMarketingProjectSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    if (!canAccessCompany(req, parsed.data.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!isSafeAttachmentUrl(parsed.data.logoUrl ?? undefined)) {
      res.status(400).json({ error: "Unsafe logo URL" }); return;
    }
    // One project per company: order/revenue data has no project link and is
    // scoped by companyId, so two projects on one company would expose the
    // same sales data to different clients. Enforce the invariant here.
    const [existingForCompany] = await db.select().from(marketingProjectsTable)
      .where(eq(marketingProjectsTable.companyId, parsed.data.companyId));
    if (existingForCompany) {
      res.status(409).json({ error: "This company already has a marketing project. Sales data is company-wide, so each company supports one client project." });
      return;
    }
    try {
      const [p] = await db.insert(marketingProjectsTable).values(parsed.data).returning();
      res.status(201).json(p);
    } catch (e: any) {
      // Unique violation on marketing_projects_company_uniq — a concurrent
      // request created a project for this company between check and insert.
      if (e?.code === "23505" || e?.cause?.code === "23505") {
        res.status(409).json({ error: "This company already has a marketing project. Sales data is company-wide, so each company supports one client project." });
        return;
      }
      throw e;
    }
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create project" }); }
});

router.patch("/marketing-projects/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { id: _i, createdAt: _c, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const parsed = insertMarketingProjectSchema.omit({ companyId: true }).partial().safeParse(body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    if (parsed.data.logoUrl !== undefined && !isSafeAttachmentUrl(parsed.data.logoUrl ?? undefined)) {
      res.status(400).json({ error: "Unsafe logo URL" }); return;
    }
    const [p] = await db.update(marketingProjectsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(marketingProjectsTable.id, id)).returning();
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    res.json(p);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update project" }); }
});

router.delete("/marketing-projects/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [p] = await db.delete(marketingProjectsTable).where(eq(marketingProjectsTable.id, id)).returning();
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    // Clean up membership + unlink records (keep the records themselves).
    await db.delete(marketingProjectMembersTable).where(eq(marketingProjectMembersTable.projectId, id));
    await db.update(campaignsTable).set({ projectId: null, clientVisible: false }).where(eq(campaignsTable.projectId, id));
    await db.update(campaignCreativesTable).set({ projectId: null, clientVisible: false }).where(eq(campaignCreativesTable.projectId, id));
    await db.update(campaignLeadsTable).set({ projectId: null, clientVisible: false }).where(eq(campaignLeadsTable.projectId, id));
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete project" }); }
});

/* ------------------------------- Members ------------------------------- */

const memberSchema = z.object({
  userId: z.number().int(),
  memberType: z.enum(["internal", "client"]).default("internal"),
});

router.post("/marketing-projects/:id/members", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [project] = await db.select().from(marketingProjectsTable).where(eq(marketingProjectsTable.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.userId));
    if (!user) { res.status(400).json({ error: "User not found" }); return; }
    const [row] = await db.insert(marketingProjectMembersTable)
      .values({ projectId, userId: parsed.data.userId, memberType: parsed.data.memberType })
      .onConflictDoNothing()
      .returning();
    if (!row) { res.status(409).json({ error: "User is already a member of this project" }); return; }
    res.status(201).json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to add member" }); }
});

router.delete("/marketing-projects/:id/members/:userId", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    const [row] = await db.delete(marketingProjectMembersTable)
      .where(and(eq(marketingProjectMembersTable.projectId, projectId), eq(marketingProjectMembersTable.userId, userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to remove member" }); }
});

/* --------------------------- Record linking ---------------------------- */

const linkSchema = z.object({
  projectId: z.number().int().nullable(),
  clientVisible: z.boolean().optional(),
});

const LINKABLE = {
  campaigns: campaignsTable,
  creatives: campaignCreativesTable,
  leads: campaignLeadsTable,
} as const;

/** Link/unlink a marketing record to a project (and set portal visibility). */
router.patch("/marketing-projects/link/:kind/:recordId", async (req, res) => {
  try {
    const kind = req.params.kind as keyof typeof LINKABLE;
    const table = LINKABLE[kind];
    if (!table) { res.status(400).json({ error: "Invalid record kind" }); return; }
    const recordId = parseInt(req.params.recordId);
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [existing] = await db.select().from(table).where(eq(table.id, recordId));
    if (!existing) { res.status(404).json({ error: "Record not found" }); return; }
    if (parsed.data.projectId !== null) {
      const [project] = await db.select().from(marketingProjectsTable).where(eq(marketingProjectsTable.id, parsed.data.projectId));
      if (!project) { res.status(400).json({ error: "Project not found" }); return; }
      if (project.companyId !== existing.companyId) {
        res.status(400).json({ error: "Project belongs to a different company" }); return;
      }
    }
    const set: Record<string, unknown> = { projectId: parsed.data.projectId, updatedAt: new Date() };
    if (parsed.data.clientVisible !== undefined) set.clientVisible = parsed.data.clientVisible;
    if (parsed.data.projectId === null) set.clientVisible = false;
    const [row] = await db.update(table).set(set).where(eq(table.id, recordId)).returning();
    res.json(row);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to link record" }); }
});

/* ---------------- Client visibility settings (per project) ---------------- */

const visibilitySchema = z.object({
  revenue: z.boolean(), orders: z.boolean(), adSpend: z.boolean(),
  roas: z.boolean(), leads: z.boolean(), cpa: z.boolean(),
  conversion: z.boolean(), campaigns: z.boolean(), creatives: z.boolean(),
  reports: z.boolean(), ai: z.boolean(), aiRequiresReview: z.boolean(),
});

router.get("/marketing-projects/:id/visibility", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    res.json(await getClientVisibility(projectId));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load visibility settings" }); }
});

router.put("/marketing-projects/:id/visibility", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const [project] = await db.select().from(marketingProjectsTable).where(eq(marketingProjectsTable.id, projectId));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    const parsed = visibilitySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const before = await getClientVisibility(projectId);
    const [existing] = await db.select().from(clientVisibilitySettingsTable)
      .where(eq(clientVisibilitySettingsTable.projectId, projectId));
    const user = (req as any).localUser;
    if (existing) {
      await db.update(clientVisibilitySettingsTable)
        .set({ settings: parsed.data, updatedBy: user?.id ?? null, updatedAt: new Date() })
        .where(eq(clientVisibilitySettingsTable.projectId, projectId));
    } else {
      await db.insert(clientVisibilitySettingsTable)
        .values({ projectId, settings: parsed.data, updatedBy: user?.id ?? null });
    }
    const changed = (Object.keys(parsed.data) as (keyof typeof parsed.data)[])
      .filter((k) => before[k] !== parsed.data[k]);
    logClientEvent(req, projectId, "portal.visibility_changed", { changed, settings: parsed.data });
    res.json(parsed.data);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to save visibility settings" }); }
});

/* ------------------- AI plan review (internal workflow) ------------------- */

router.get("/marketing-projects/:id/ai-plans", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const plans = await db.select().from(clientAiPlansTable)
      .where(eq(clientAiPlansTable.projectId, projectId))
      .orderBy(desc(clientAiPlansTable.createdAt))
      .limit(50);
    res.json(plans);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load AI plans" }); }
});

const planReviewSchema = z.object({
  action: z.enum(["approve", "reject", "archive"]),
  reviewNote: z.string().max(2000).optional(),
});

router.patch("/marketing-projects/:id/ai-plans/:planId", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const planId = parseInt(req.params.planId);
    const parsed = planReviewSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [plan] = await db.select().from(clientAiPlansTable)
      .where(and(eq(clientAiPlansTable.id, planId), eq(clientAiPlansTable.projectId, projectId)));
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
    const user = (req as any).localUser;
    const status = parsed.data.action === "approve" ? "published"
      : parsed.data.action === "reject" ? "rejected" : "archived";
    if (status === "published") {
      // Only one client-visible plan at a time.
      await db.update(clientAiPlansTable)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(clientAiPlansTable.projectId, projectId), eq(clientAiPlansTable.status, "published")));
    }
    const [updated] = await db.update(clientAiPlansTable)
      .set({ status, reviewedByUserId: user?.id ?? null, reviewNote: parsed.data.reviewNote ?? null, updatedAt: new Date() })
      .where(eq(clientAiPlansTable.id, planId)).returning();
    logClientEvent(req, projectId, "portal.ai_plan_reviewed", { planId, action: parsed.data.action });
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update AI plan" }); }
});

/* ----------------------- Client access audit viewer ----------------------- */

router.get("/marketing-projects/:id/audit", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
    const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
    res.json(await listClientEvents(projectId, limit, offset));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load audit log" }); }
});

export default router;
