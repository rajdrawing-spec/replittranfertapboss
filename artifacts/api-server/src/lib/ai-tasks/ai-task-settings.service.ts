import { db, aiTaskCompanySettingsTable, aiTaskCompanyHolidaysTable, aiTaskProjectsTable, companiesTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";

export type { AiTaskCompanySettings, AiTaskCompanyHoliday, AiTaskProject } from "@workspace/db";

export const DEFAULT_WORK_WEEK = [1, 2, 3, 4, 5]; // Mon-Fri

export async function getCompanySettings(companyId: number) {
  const [row] = await db
    .select()
    .from(aiTaskCompanySettingsTable)
    .where(eq(aiTaskCompanySettingsTable.companyId, companyId))
    .limit(1);
  if (row) return row;

  // Seed defaults from companies table if available, otherwise UTC/Mon-Fri.
  const [company] = await db
    .select({ timezone: companiesTable.timezone, generationTime: companiesTable.generationTime })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  const defaults = {
    companyId,
    timezone: company?.timezone || "UTC",
    workWeek: DEFAULT_WORK_WEEK,
    weekendGeneration: false,
    generationTime: company?.generationTime || null,
  };
  await db.insert(aiTaskCompanySettingsTable).values(defaults);
  return defaults;
}

export async function updateCompanySettings(
  companyId: number,
  data: Partial<{
    timezone: string;
    workWeek: number[];
    weekendGeneration: boolean;
    generationTime: string | null;
  }>,
) {
  await db
    .insert(aiTaskCompanySettingsTable)
    .values({
      companyId,
      timezone: data.timezone || "UTC",
      workWeek: data.workWeek || DEFAULT_WORK_WEEK,
      weekendGeneration: data.weekendGeneration ?? false,
      generationTime: data.generationTime || null,
    })
    .onConflictDoUpdate({
      target: aiTaskCompanySettingsTable.companyId,
      set: { ...data, updatedAt: new Date() },
    });
  return getCompanySettings(companyId);
}

export async function listHolidays(companyId: number) {
  return db
    .select()
    .from(aiTaskCompanyHolidaysTable)
    .where(eq(aiTaskCompanyHolidaysTable.companyId, companyId))
    .orderBy(asc(aiTaskCompanyHolidaysTable.date));
}

export async function createHoliday(
  companyId: number,
  data: { date: string; name: string; isRecurringYearly?: boolean },
) {
  const [row] = await db
    .insert(aiTaskCompanyHolidaysTable)
    .values({ companyId, date: data.date, name: data.name, isRecurringYearly: data.isRecurringYearly ?? false })
    .returning();
  return row;
}

export async function deleteHoliday(companyId: number, holidayId: number) {
  const [row] = await db
    .delete(aiTaskCompanyHolidaysTable)
    .where(and(eq(aiTaskCompanyHolidaysTable.id, holidayId), eq(aiTaskCompanyHolidaysTable.companyId, companyId)))
    .returning();
  return !!row;
}

export async function isHoliday(companyId: number, date: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiTaskCompanyHolidaysTable.id })
    .from(aiTaskCompanyHolidaysTable)
    .where(
      and(
        eq(aiTaskCompanyHolidaysTable.companyId, companyId),
        eq(aiTaskCompanyHolidaysTable.date, date),
      ),
    )
    .limit(1);
  if (row) return true;

  // Recurring yearly holidays
  const monthDay = date.slice(5); // MM-DD
  const [recurring] = await db
    .select({ id: aiTaskCompanyHolidaysTable.id })
    .from(aiTaskCompanyHolidaysTable)
    .where(
      and(
        eq(aiTaskCompanyHolidaysTable.companyId, companyId),
        eq(aiTaskCompanyHolidaysTable.isRecurringYearly, true),
      ),
    )
    .limit(1);
  if (!recurring) return false;

  const rows = await db
    .select({ date: aiTaskCompanyHolidaysTable.date })
    .from(aiTaskCompanyHolidaysTable)
    .where(
      and(
        eq(aiTaskCompanyHolidaysTable.companyId, companyId),
        eq(aiTaskCompanyHolidaysTable.isRecurringYearly, true),
      ),
    );
  return rows.some((r) => r.date.slice(5) === monthDay);
}

export async function isWorkingDay(companyId: number, dateStr: string): Promise<boolean> {
  const settings = await getCompanySettings(companyId);
  const date = new Date(dateStr + "T00:00:00"); // interpret as local to avoid shift
  const day = date.getDay();
  if (!settings.weekendGeneration && !settings.workWeek.includes(day)) return false;
  if (await isHoliday(companyId, dateStr)) return false;
  return true;
}

export async function listProjects(companyId: number) {
  return db
    .select()
    .from(aiTaskProjectsTable)
    .where(eq(aiTaskProjectsTable.companyId, companyId))
    .orderBy(asc(aiTaskProjectsTable.name));
}

export async function createProject(companyId: number, data: { name: string; priority: string }) {
  const [row] = await db
    .insert(aiTaskProjectsTable)
    .values({ companyId, name: data.name, priority: data.priority, isActive: true })
    .returning();
  return row;
}

export async function updateProject(
  companyId: number,
  projectId: number,
  data: { name?: string; priority?: string; isActive?: boolean },
) {
  const [row] = await db
    .update(aiTaskProjectsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(aiTaskProjectsTable.id, projectId), eq(aiTaskProjectsTable.companyId, companyId)))
    .returning();
  return row;
}

export async function deleteProject(companyId: number, projectId: number) {
  const [row] = await db
    .delete(aiTaskProjectsTable)
    .where(and(eq(aiTaskProjectsTable.id, projectId), eq(aiTaskProjectsTable.companyId, companyId)))
    .returning();
  return !!row;
}

export async function getProjectPriorities(companyId: number): Promise<Map<string, string>> {
  const projects = await db
    .select({ name: aiTaskProjectsTable.name, priority: aiTaskProjectsTable.priority })
    .from(aiTaskProjectsTable)
    .where(and(eq(aiTaskProjectsTable.companyId, companyId), eq(aiTaskProjectsTable.isActive, true)));
  return new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.priority]));
}

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

export function priorityRank(priority: string): number {
  return PRIORITY_ORDER[priority as keyof typeof PRIORITY_ORDER] ?? 0;
}
