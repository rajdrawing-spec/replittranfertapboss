import { Router } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(password + salt).digest("hex");
}

function fmtUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    companyIds: u.companyIds as number[],
    avatarUrl: u.avatarUrl,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    // If no password hash set yet, set it now (first login)
    const expectedHash = hashPassword(password, user.email);
    if (!user.passwordHash) {
      // Allow first-time login with default password "Admin@123"
      if (password !== "Admin@123") {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      // Set the password
      await db.update(usersTable).set({ passwordHash: expectedHash, lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    } else {
      if (user.passwordHash !== expectedHash) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    }

    res.cookie("tbos_uid", String(user.id), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ user: fmtUser(user) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (_req, res) => {
  res.clearCookie("tbos_uid");
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/auth/me", async (req, res) => {
  try {
    const uid = req.signedCookies?.tbos_uid;
    if (!uid) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parseInt(uid))).limit(1);
    if (!user) {
      res.clearCookie("tbos_uid");
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json({ user: fmtUser(user) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed" });
  }
});

// POST /api/auth/change-password
router.post("/auth/change-password", async (req, res) => {
  try {
    const uid = req.signedCookies?.tbos_uid;
    if (!uid) { res.status(401).json({ error: "Not authenticated" }); return; }
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parseInt(uid))).limit(1);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    const currentHash = hashPassword(currentPassword, user.email);
    if (user.passwordHash && user.passwordHash !== currentHash) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    const newHash = hashPassword(newPassword, user.email);
    await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
