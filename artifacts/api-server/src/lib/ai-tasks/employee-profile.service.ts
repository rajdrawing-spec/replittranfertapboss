import { db, employeesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface EmployeeProfile {
  id: number;
  companyId: number;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  designation: string;
  status: string;
  skillLevel: string | null;
  workingHours: string | null;
  currentProject: string | null;
  managerId: number | null;
}

export interface ProfileUpdate {
  skillLevel?: string | null;
  workingHours?: string | null;
  currentProject?: string | null;
}

export async function listEmployeesForGeneration(companyId: number): Promise<EmployeeProfile[]> {
  const rows = await db
    .select({
      id: employeesTable.id,
      companyId: employeesTable.companyId,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      department: employeesTable.department,
      designation: employeesTable.designation,
      status: employeesTable.status,
      skillLevel: employeesTable.skillLevel,
      workingHours: employeesTable.workingHours,
      currentProject: employeesTable.currentProject,
      managerId: employeesTable.managerId,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.companyId, companyId), eq(employeesTable.status, "active")));
  return rows;
}

export async function updateEmployeeProfile(
  employeeId: number,
  companyId: number,
  data: ProfileUpdate,
): Promise<EmployeeProfile | undefined> {
  const [updated] = await db
    .update(employeesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, companyId)))
    .returning();
  return updated;
}

export async function getEmployeeProfile(employeeId: number, companyId: number): Promise<EmployeeProfile | undefined> {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, companyId)))
    .limit(1);
  return row;
}

/**
 * Sync company users into the employees table so AI Tasks has a complete team
 * roster. Existing employees are matched by email; missing users become new
 * active employees with a generated code.
 */
export async function syncEmployeesFromUsers(companyId: number): Promise<{ created: number; updated: number; unchanged: number }> {
  const allUsers = await db.select().from(usersTable);
  const companyUsers = allUsers.filter((u) => (u.companyIds as number[]).includes(companyId) && u.status === "active");
  const existingEmployees = await db.select().from(employeesTable).where(eq(employeesTable.companyId, companyId));
  const byEmail = new Map(existingEmployees.map((e) => [e.email.toLowerCase(), e]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const user of companyUsers) {
    const parts = (user.name || "").trim().split(/\s+/);
    const firstName = parts[0] || "User";
    const lastName = parts.slice(1).join(" ") || "";
    const email = user.email.toLowerCase();
    const existing = byEmail.get(email);

    if (existing) {
      // Keep existing record but refresh department/avatar if changed.
      const needsUpdate =
        (user.department && existing.department !== user.department) ||
        (user.avatarUrl && existing.avatarUrl !== user.avatarUrl);
      if (needsUpdate) {
        await db
          .update(employeesTable)
          .set({
            department: user.department || existing.department,
            avatarUrl: user.avatarUrl || existing.avatarUrl,
            updatedAt: new Date(),
          })
          .where(eq(employeesTable.id, existing.id));
        updated++;
      } else {
        unchanged++;
      }
      continue;
    }

    const employeeCode = `EMP${Date.now()}-${created}`;
    await db.insert(employeesTable).values({
      companyId,
      firstName,
      lastName,
      email,
      department: user.department || "General",
      designation: user.role ? user.role.replace(/_/g, " ") : "Team Member",
      employeeCode,
      status: "active",
      joinDate: today,
      salary: 0,
      avatarUrl: user.avatarUrl,
    });
    created++;
  }

  return { created, updated, unchanged };
}
