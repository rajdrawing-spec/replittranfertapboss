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
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireSuperAdmin } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { isSafeAttachmentUrl } from "../lib/url-safety";

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
    const [p] = await db.insert(marketingProjectsTable).values(parsed.data).returning();
    res.status(201).json(p);
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

export default router;
