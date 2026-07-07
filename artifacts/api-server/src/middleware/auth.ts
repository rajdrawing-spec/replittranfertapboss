import type { Request, Response, NextFunction } from "express";

/**
 * requireAuth middleware — enforces that a valid signed cookie is present.
 * Attach to any route that requires authentication.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const uid = (req as any).signedCookies?.tbos_uid;
  if (!uid || isNaN(parseInt(uid))) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // Attach userId to request for downstream use
  (req as any).userId = parseInt(uid);
  next();
}
