import { db, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SYSTEM_ROLES } from "./permissions";
import { logger } from "./logger";

/**
 * Idempotently ensure the system roles exist. Runs on server boot so the
 * roles/permissions catalog is always available in dev and prod. Updates the
 * permission set of system roles to match the code definition, but never
 * touches custom (non-system) roles.
 */
export async function ensureSystemRoles(): Promise<void> {
  try {
    for (const role of SYSTEM_ROLES) {
      const existing = await db.select().from(rolesTable).where(eq(rolesTable.key, role.key)).limit(1);
      if (existing[0]) {
        await db.update(rolesTable).set({
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isSystem: true,
          updatedAt: new Date(),
        }).where(eq(rolesTable.id, existing[0].id));
      } else {
        await db.insert(rolesTable).values({
          key: role.key,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isSystem: true,
        });
      }
    }
    logger.info("System roles ensured");
  } catch (e) {
    logger.error({ err: e }, "Failed to ensure system roles");
  }
}
