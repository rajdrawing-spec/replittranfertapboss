import { db, employeesTable } from "@workspace/db";
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
