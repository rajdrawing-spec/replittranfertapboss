import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { getOrProvisionLocalUser } from "../lib/auth-user";

/**
 * requireAuth — verifies a Clerk session, provisions/activates the local user
 * (invite-only), and attaches `userId` + `localUser` to the request.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { user, error } = await getOrProvisionLocalUser(clerkUserId);
    if (error === "disabled") {
      res.status(403).json({ error: "Your account has been disabled" });
      return;
    }
    if (error || !user) {
      res.status(403).json({ error: "You have not been invited to this workspace" });
      return;
    }
    (req as any).userId = user.id;
    (req as any).localUser = user;
    next();
  } catch (e) {
    req.log?.error(e);
    res.status(401).json({ error: "Authentication failed" });
  }
}
