import type { Request, Response, NextFunction } from "express";
import type { User } from "@workspace/db";
import { db, marketingProjectsTable, marketingProjectMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isSuperAdmin } from "./auth-user";
import { CLIENT_ROLE_KEYS } from "./permissions";

/** True when the user holds a client (external) role — primary or extra. */
export function isClientUser(user: Pick<User, "role" | "email" | "extraRoles">): boolean {
  if (isSuperAdmin(user as User)) return false;
  const roles = [user.role, ...((user.extraRoles as string[] | undefined) ?? [])];
  return roles.some((r) => CLIENT_ROLE_KEYS.includes(r));
}

/**
 * Project IDs the caller may access.
 * - Super Admin -> null (no restriction: all projects)
 * - Everyone else -> the project IDs they are explicitly a member of
 *   (empty array = sees nothing).
 *
 * Never pass the returned array to drizzle `inArray` without checking length.
 */
export async function projectScope(req: Request): Promise<number[] | null> {
  const u = (req as any).localUser as User | undefined;
  if (!u) return [];
  if (isSuperAdmin(u)) return null;
  const rows = await db
    .select({ projectId: marketingProjectMembersTable.projectId })
    .from(marketingProjectMembersTable)
    .where(eq(marketingProjectMembersTable.userId, u.id));
  return rows.map((r) => r.projectId);
}

/** True when the caller may access the given project. */
export async function canAccessProject(req: Request, projectId: number): Promise<boolean> {
  const scope = await projectScope(req);
  return scope === null || scope.includes(projectId);
}

/**
 * Route middleware: resolves `:projectId` (param) and 403s when the caller is
 * not a member of that project (super admin always passes). Attaches the
 * project row to `req` as `req.project`.
 */
export function requireProjectAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = parseInt(String(req.params.projectId));
      if (!Number.isInteger(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }
      if (!(await canAccessProject(req, projectId))) { res.status(403).json({ error: "Forbidden" }); return; }
      const [project] = await db.select().from(marketingProjectsTable).where(eq(marketingProjectsTable.id, projectId));
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      (req as any).project = project;
      next();
    } catch (e) {
      (req as any).log?.error?.(e);
      res.status(500).json({ error: "Failed to resolve project access" });
    }
  };
}

/**
 * Global guard mounted ahead of all internal routers: client-role users may
 * only reach the client portal API surface (`/client/*`) plus the single
 * exact auth endpoint the shell needs (`/auth/me`). Never allowlist a whole
 * prefix like `/auth/` — a future authenticated auth route would silently
 * fall outside the client boundary.
 *
 * NOTE: the auth router is mounted BEFORE requireAuth (public), so it is not
 * behind this guard. It must only ever expose session-introspection routes
 * (/auth/me) that are safe for any authenticated principal, including clients.
 */
const CLIENT_ALLOWED_PREFIXES = ["/client/"];
const CLIENT_ALLOWED_EXACT = ["/client", "/auth/me"];

/**
 * Rejects any client-role user outright. Used as a catch-all inside the
 * (publicly mounted) auth router AFTER its safe routes, so any future
 * authenticated /auth/* endpoint is inside the client boundary even though
 * the router sits ahead of the global guard.
 */
export function rejectClientUsers(req: Request, res: Response, next: NextFunction): void {
  const u = (req as any).localUser as User | undefined;
  if (u && isClientUser(u)) {
    res.status(403).json({ error: "Client accounts can only access the client portal" });
    return;
  }
  next();
}

export function blockClientUsersFromInternalApi(req: Request, res: Response, next: NextFunction): void {
  const u = (req as any).localUser as User | undefined;
  if (!u || !isClientUser(u)) { next(); return; }
  const path = req.path;
  const allowed =
    CLIENT_ALLOWED_EXACT.includes(path) ||
    CLIENT_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
  if (!allowed) {
    res.status(403).json({ error: "Client accounts can only access the client portal" });
    return;
  }
  next();
}
