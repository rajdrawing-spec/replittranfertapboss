import { clerkClient } from "@clerk/express";
import { db, usersTable, invitationsTable, rolesTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { SUPER_ADMIN_EMAIL } from "./permissions";
import { writeAudit } from "./audit";

export type ProvisionError = "unauthenticated" | "disabled" | "not_invited";

export interface LocalUserResult {
  user?: User;
  error?: ProvisionError;
}

/**
 * Resolve the local users row for a Clerk session, provisioning/activating it
 * on first sign-in. Enforces invite-only access: unknown emails without a
 * pending invitation are rejected. The single Super Admin (SUPER_ADMIN_EMAIL)
 * is always bootstrapped.
 */
export async function getOrProvisionLocalUser(clerkUserId: string | null | undefined): Promise<LocalUserResult> {
  if (!clerkUserId) return { error: "unauthenticated" };

  // Fast path — already linked to a Clerk account.
  const linked = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  if (linked[0]) {
    if (linked[0].status === "disabled") return { error: "disabled" };
    return { user: linked[0] };
  }

  // First sign-in: fetch identity from Clerk to bridge by email.
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = (
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    ""
  ).toLowerCase();
  if (!email) return { error: "not_invited" };
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || clerkUser.username || email;
  const avatarUrl = clerkUser.imageUrl ?? null;

  // Super Admin bootstrap.
  if (email === SUPER_ADMIN_EMAIL) {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    let user: User;
    if (existing[0]) {
      [user] = await db.update(usersTable).set({
        clerkUserId, status: "active", role: "super_admin",
        name: existing[0].name || name, avatarUrl: existing[0].avatarUrl ?? avatarUrl,
        lastLoginAt: new Date(), updatedAt: new Date(),
      }).where(eq(usersTable.id, existing[0].id)).returning();
    } else {
      [user] = await db.insert(usersTable).values({
        name, email, clerkUserId, role: "super_admin", status: "active", companyIds: [], avatarUrl, lastLoginAt: new Date(),
      }).returning();
    }
    await writeAudit({ userId: user.id, userEmail: email, action: "user.login", description: "Super Admin signed in" });
    return { user };
  }

  // Existing (pre-provisioned) user row matching this email.
  const byEmail = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (byEmail[0]) {
    if (byEmail[0].status === "disabled") return { error: "disabled" };
    const wasInvited = byEmail[0].status !== "active";
    const [user] = await db.update(usersTable).set({
      clerkUserId, status: "active",
      name: byEmail[0].name || name, avatarUrl: byEmail[0].avatarUrl ?? avatarUrl,
      lastLoginAt: new Date(), updatedAt: new Date(),
    }).where(eq(usersTable.id, byEmail[0].id)).returning();
    await writeAudit({
      userId: user.id, userEmail: email,
      action: wasInvited ? "user.joined" : "user.login",
      description: wasInvited ? "Accepted invitation and joined" : "Signed in",
    });
    return { user };
  }

  // Pending invitation for this email. Resolve deterministically: only pending
  // rows, newest first, so revoke/re-invite history can never surface a stale row.
  const invite = await db.select().from(invitationsTable)
    .where(and(eq(invitationsTable.email, email), eq(invitationsTable.status, "pending")))
    .orderBy(desc(invitationsTable.id))
    .limit(1);
  if (invite[0]) {
    const [user] = await db.insert(usersTable).values({
      name: invite[0].name || name, email, clerkUserId, role: invite[0].role,
      department: invite[0].department ?? null, companyIds: invite[0].companyIds ?? [],
      status: "active", avatarUrl, lastLoginAt: new Date(),
    }).returning();
    await db.update(invitationsTable).set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() }).where(eq(invitationsTable.id, invite[0].id));
    await writeAudit({ userId: user.id, userEmail: email, action: "user.joined", description: "Accepted invitation and joined", targetType: "user", targetId: String(user.id) });
    return { user };
  }

  return { error: "not_invited" };
}

export function isSuperAdmin(user: Pick<User, "role" | "email">): boolean {
  return user.role === "super_admin" || user.email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function hasPermission(perms: string[], perm: string): boolean {
  return perms.includes("*") || perms.includes(perm);
}

export async function getUserPermissions(user: User): Promise<string[]> {
  if (isSuperAdmin(user)) return ["*"];
  const role = await db.select().from(rolesTable).where(eq(rolesTable.key, user.role)).limit(1);
  return role[0]?.permissions ?? [];
}
