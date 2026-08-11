import { Router } from "express";
import type { User } from "@workspace/db";
import {
  db, marketingProjectsTable, marketingProjectMembersTable,
  campaignsTable, campaignCreativesTable, campaignLeadsTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { projectScope, requireProjectAccess } from "../lib/project-scope";

/**
 * Client Marketing Portal API — the ONLY API surface reachable by client-role
 * users (enforced globally by blockClientUsersFromInternalApi). Everything is
 * scoped to the caller's project memberships; no companyId trust anywhere.
 */
const router = Router();

router.use("/client/marketing", requirePermission("client_portal.view"));

/** Portal context: the caller's assigned projects with brand identity. */
router.get("/client/marketing/context", async (req, res) => {
  try {
    const scope = await projectScope(req);
    let projects: (typeof marketingProjectsTable.$inferSelect)[];
    if (scope === null) {
      projects = await db.select().from(marketingProjectsTable).orderBy(desc(marketingProjectsTable.createdAt));
    } else if (scope.length === 0) {
      projects = [];
    } else {
      projects = await db.select().from(marketingProjectsTable)
        .where(inArray(marketingProjectsTable.id, scope))
        .orderBy(desc(marketingProjectsTable.createdAt));
    }
    const u = (req as any).localUser as User;
    // Only expose active projects to clients.
    const visible = projects.filter((p) => p.status === "active");
    const memberRows = visible.length
      ? await db.select().from(marketingProjectMembersTable)
          .where(and(
            eq(marketingProjectMembersTable.userId, u.id),
            inArray(marketingProjectMembersTable.projectId, visible.map((p) => p.id)),
          ))
      : [];
    const memberTypeByProject = new Map(memberRows.map((m) => [m.projectId, m.memberType]));
    res.json({
      user: { id: u.id, name: u.name, email: u.email, role: u.role, avatarUrl: u.avatarUrl },
      projects: visible.map((p) => ({
        id: p.id,
        name: p.name,
        brandName: p.brandName ?? p.name,
        brandColor: p.brandColor,
        logoUrl: p.logoUrl,
        status: p.status,
        memberType: memberTypeByProject.get(p.id) ?? "internal",
      })),
    });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load portal context" }); }
});

// ---- Project-scoped, client-visible marketing data --------------------------
// Every route below resolves :projectId through requireProjectAccess (member
// or super admin only) and filters records by BOTH projectId AND
// clientVisible=true. Records are linked/exposed exclusively via the
// super-admin linking endpoint, so nothing internal can leak here.

router.get("/client/marketing/projects/:projectId/campaigns", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = (req as any).project.id as number;
    const rows = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.clientVisible, true)))
      .orderBy(desc(campaignsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load campaigns" }); }
});

router.get("/client/marketing/projects/:projectId/creatives", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = (req as any).project.id as number;
    const rows = await db.select().from(campaignCreativesTable)
      .where(and(eq(campaignCreativesTable.projectId, projectId), eq(campaignCreativesTable.clientVisible, true)))
      .orderBy(desc(campaignCreativesTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load creatives" }); }
});

router.get("/client/marketing/projects/:projectId/leads", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = (req as any).project.id as number;
    const rows = await db.select().from(campaignLeadsTable)
      .where(and(eq(campaignLeadsTable.projectId, projectId), eq(campaignLeadsTable.clientVisible, true)))
      .orderBy(desc(campaignLeadsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load leads" }); }
});

export default router;
