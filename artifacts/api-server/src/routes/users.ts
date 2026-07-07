import { Router } from "express";
import { db, usersTable, invitationsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";
import { getUserPermissions, isSuperAdmin } from "../lib/auth-user";
import { SUPER_ADMIN_EMAIL } from "../lib/permissions";
import { writeAudit } from "../lib/audit";
import { fmtUser } from "./auth";

const router = Router();

// GET /users/me — current user profile + resolved permissions.
router.get("/users/me", async (req, res) => {
  try {
    const u = (req as any).localUser as User;
    const permissions = await getUserPermissions(u);
    res.json({ ...fmtUser(u), permissions, isSuperAdmin: isSuperAdmin(u) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get current user" });
  }
});

// GET /users — list all users (Super Admin only).
router.get("/users", requireSuperAdmin, async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const users = await db.select().from(usersTable).orderBy(usersTable.id);
    let result = users.map(fmtUser);
    if (companyId) {
      const cid = parseInt(companyId);
      result = result.filter((u) => u.companyIds.includes(cid));
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// POST /users/invite — invite a user (Super Admin only).
router.post("/users/invite", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const { email, name, role, department, companyIds } = req.body as {
      email?: string; name?: string; role?: string; department?: string; companyIds?: number[];
    };
    const normEmail = (email ?? "").trim().toLowerCase();
    if (!normEmail || !role) {
      res.status(400).json({ error: "Email and role are required" });
      return;
    }
    if (normEmail === SUPER_ADMIN_EMAIL) {
      res.status(400).json({ error: "The Super Admin account cannot be invited" });
      return;
    }
    const existingUser = await db.select().from(usersTable).where(eq(usersTable.email, normEmail)).limit(1);
    if (existingUser[0]) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    // Only a pending invite blocks re-inviting; revoked/accepted history is ignored.
    const existingInvite = await db.select().from(invitationsTable)
      .where(and(eq(invitationsTable.email, normEmail), eq(invitationsTable.status, "pending")))
      .limit(1);
    if (existingInvite[0]) {
      res.status(409).json({ error: "An invitation for this email is already pending" });
      return;
    }
    const [invite] = await db.insert(invitationsTable).values({
      email: normEmail,
      name: name ?? null,
      role,
      department: department ?? null,
      companyIds: Array.isArray(companyIds) ? companyIds : [],
      invitedByUserId: actor.id,
    }).returning();
    await writeAudit({
      userId: actor.id, userEmail: actor.email, action: "user.invited",
      targetType: "invitation", targetId: String(invite.id),
      description: `Invited ${normEmail} as ${role}`,
    });
    res.status(201).json(invite);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to invite user" });
  }
});

// GET /users/invitations — pending invitations (Super Admin only).
router.get("/users/invitations", requireSuperAdmin, async (req, res) => {
  try {
    const invites = await db.select().from(invitationsTable).orderBy(invitationsTable.id);
    res.json(invites.filter((i) => i.status === "pending"));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list invitations" });
  }
});

// POST /users/invitations/:id/revoke — cancel a pending invitation.
router.post("/users/invitations/:id/revoke", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const id = parseInt(String(req.params.id));
    const [invite] = await db.update(invitationsTable)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(invitationsTable.id, id)).returning();
    if (!invite) { res.status(404).json({ error: "Invitation not found" }); return; }
    await writeAudit({
      userId: actor.id, userEmail: actor.email, action: "user.invite_revoked",
      targetType: "invitation", targetId: String(id), description: `Revoked invite for ${invite.email}`,
    });
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to revoke invitation" });
  }
});

// PATCH /users/:id — assign role, enable/disable, update department/companies.
router.patch("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const id = parseInt(String(req.params.id));
    const target = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target[0]) { res.status(404).json({ error: "User not found" }); return; }
    if (target[0].email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      res.status(400).json({ error: "The Super Admin account cannot be modified" });
      return;
    }
    const { name, role, department, companyIds, status } = req.body as {
      name?: string; role?: string; department?: string; companyIds?: number[]; status?: string;
    };
    const patch: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof name === "string") patch.name = name;
    if (typeof role === "string") patch.role = role;
    if (typeof department === "string") patch.department = department;
    if (Array.isArray(companyIds)) patch.companyIds = companyIds;
    if (status === "active" || status === "disabled" || status === "invited") patch.status = status;
    const [updated] = await db.update(usersTable).set(patch).where(eq(usersTable.id, id)).returning();
    const changes = Object.keys(patch).filter((k) => k !== "updatedAt");
    await writeAudit({
      userId: actor.id, userEmail: actor.email,
      action: status && status !== target[0].status ? `user.${status === "disabled" ? "disabled" : "enabled"}` : "user.updated",
      targetType: "user", targetId: String(id),
      description: `Updated ${updated.email} (${changes.join(", ")})`,
      metadata: { changes: patch },
    });
    res.json(fmtUser(updated));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE /users/:id — remove a user (Super Admin only).
router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const id = parseInt(String(req.params.id));
    const target = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!target[0]) { res.status(404).json({ error: "User not found" }); return; }
    if (target[0].email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      res.status(400).json({ error: "The Super Admin account cannot be removed" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    await writeAudit({
      userId: actor.id, userEmail: actor.email, action: "user.removed",
      targetType: "user", targetId: String(id), description: `Removed ${target[0].email}`,
    });
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to remove user" });
  }
});

export default router;
