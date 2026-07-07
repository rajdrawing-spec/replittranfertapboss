import { Router } from "express";
import { getAuth } from "@clerk/express";
import { usersTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { getOrProvisionLocalUser, getUserPermissions, isSuperAdmin } from "../lib/auth-user";

const router = Router();

function fmtUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    companyIds: u.companyIds as number[],
    avatarUrl: u.avatarUrl,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

// GET /api/auth/me — returns the local profile for the current Clerk session,
// provisioning/activating the account on first sign-in. Public route (mounted
// before requireAuth) so the frontend can distinguish signed-out vs not-invited.
router.get("/auth/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const { userId: clerkUserId } = auth;
    // TEMP DEBUG — remove after diagnosing dev 401s
    const cookieHeader = req.headers.cookie ?? "";
    const cookieNames = cookieHeader
      .split(";")
      .map((c) => c.split("=")[0]?.trim())
      .filter(Boolean);
    req.log.info(
      {
        cookieNames,
        hasSessionCookie: cookieNames.includes("__session"),
        hasAuthHeader: Boolean(req.headers.authorization),
        host: req.headers.host,
        xfHost: req.headers["x-forwarded-host"],
        origin: req.headers.origin,
        authUserId: auth.userId ?? null,
        authSessionId: auth.sessionId ?? null,
        // @ts-expect-error debug-only fields present at runtime
        authReason: (auth as any).reason ?? null,
      },
      "auth/me debug",
    );
    if (!clerkUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { user, error } = await getOrProvisionLocalUser(clerkUserId, req.get("user-agent") ?? undefined);
    if (error === "disabled") {
      res.status(403).json({ error: "disabled", message: "Your account has been disabled." });
      return;
    }
    if (error || !user) {
      res.status(403).json({ error: "not_invited", message: "You have not been invited to this workspace. Contact your administrator." });
      return;
    }
    const permissions = await getUserPermissions(user);
    res.json({ user: { ...fmtUser(user), permissions, isSuperAdmin: isSuperAdmin(user) } });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
export { fmtUser };
