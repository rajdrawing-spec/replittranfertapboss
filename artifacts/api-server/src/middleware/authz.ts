import type { Request, Response, NextFunction } from "express";
import type { User } from "@workspace/db";
import { isSuperAdmin, getUserPermissions, hasPermission } from "../lib/auth-user";

/** Restrict a route to the single Super Admin. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  const u = (req as any).localUser as User | undefined;
  if (!u || !isSuperAdmin(u)) {
    res.status(403).json({ error: "Super Admin access required" });
    return;
  }
  next();
}

/** Restrict a route to users whose role grants a specific permission.
 *  Attaches the resolved permissions array to req.resolvedPermissions so route
 *  handlers can inspect them without a second DB round-trip. */
export function requirePermission(perm: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const u = (req as any).localUser as User | undefined;
    if (!u) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const perms = await getUserPermissions(u);
    (req as any).resolvedPermissions = perms;
    if (!hasPermission(perms, perm)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
