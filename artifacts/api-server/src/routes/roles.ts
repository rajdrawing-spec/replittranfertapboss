import { Router } from "express";
import { db, rolesTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";
import { PERMISSIONS } from "../lib/permissions";
import { writeAudit } from "../lib/audit";

const router = Router();

// GET /permissions — the permission catalog (for the roles editor & invite form).
router.get("/permissions", requireSuperAdmin, async (_req, res) => {
  res.json(PERMISSIONS);
});

// GET /roles — list roles (Super Admin only; used by the access-control page).
router.get("/roles", requireSuperAdmin, async (req, res) => {
  try {
    const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
    res.json(roles);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list roles" });
  }
});

// POST /roles — create a custom role (Super Admin only).
router.post("/roles", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const { name, description, permissions } = req.body as { name?: string; description?: string; permissions?: string[] };
    if (!name || !name.trim()) { res.status(400).json({ error: "Role name is required" }); return; }
    const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) { res.status(400).json({ error: "Invalid role name" }); return; }
    const existing = await db.select().from(rolesTable).where(eq(rolesTable.key, key)).limit(1);
    if (existing[0]) { res.status(409).json({ error: "A role with this name already exists" }); return; }
    const [role] = await db.insert(rolesTable).values({
      key, name: name.trim(), description: description ?? null,
      permissions: Array.isArray(permissions) ? permissions : [], isSystem: false,
    }).returning();
    await writeAudit({ userId: actor.id, userEmail: actor.email, action: "role.created", targetType: "role", targetId: String(role.id), description: `Created role ${role.name}` });
    res.status(201).json(role);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create role" });
  }
});

// PATCH /roles/:id — update a role's name/description/permissions (Super Admin only).
router.patch("/roles/:id", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const id = parseInt(String(req.params.id));
    const target = await db.select().from(rolesTable).where(eq(rolesTable.id, id)).limit(1);
    if (!target[0]) { res.status(404).json({ error: "Role not found" }); return; }
    if (target[0].key === "super_admin") { res.status(400).json({ error: "The Super Admin role cannot be modified" }); return; }
    const { name, description, permissions } = req.body as { name?: string; description?: string; permissions?: string[] };
    const patch: Partial<typeof rolesTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof name === "string" && name.trim()) patch.name = name.trim();
    if (typeof description === "string") patch.description = description;
    if (Array.isArray(permissions)) patch.permissions = permissions;
    const [updated] = await db.update(rolesTable).set(patch).where(eq(rolesTable.id, id)).returning();
    await writeAudit({ userId: actor.id, userEmail: actor.email, action: "role.updated", targetType: "role", targetId: String(id), description: `Updated role ${updated.name}` });
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update role" });
  }
});

// DELETE /roles/:id — delete a custom role (Super Admin only).
router.delete("/roles/:id", requireSuperAdmin, async (req, res) => {
  try {
    const actor = (req as any).localUser as User;
    const id = parseInt(String(req.params.id));
    const target = await db.select().from(rolesTable).where(eq(rolesTable.id, id)).limit(1);
    if (!target[0]) { res.status(404).json({ error: "Role not found" }); return; }
    if (target[0].isSystem) { res.status(400).json({ error: "System roles cannot be deleted" }); return; }
    await db.delete(rolesTable).where(eq(rolesTable.id, id));
    await writeAudit({ userId: actor.id, userEmail: actor.email, action: "role.deleted", targetType: "role", targetId: String(id), description: `Deleted role ${target[0].name}` });
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete role" });
  }
});

export default router;
