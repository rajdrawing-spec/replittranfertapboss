import { db, taskTemplatesTable, type NewTaskTemplate, type TaskTemplate } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

export interface TemplateFilters {
  companyId: number;
  department?: string;
  roleKey?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedTemplates {
  items: TaskTemplate[];
  total: number;
  page: number;
  limit: number;
}

export async function listTemplates(filters: TemplateFilters): Promise<PaginatedTemplates> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = (page - 1) * limit;

  const conditions = [eq(taskTemplatesTable.companyId, filters.companyId)];
  if (filters.department) conditions.push(eq(taskTemplatesTable.department, filters.department));
  if (filters.roleKey) conditions.push(eq(taskTemplatesTable.roleKey, filters.roleKey));
  if (filters.isActive !== undefined) conditions.push(eq(taskTemplatesTable.isActive, filters.isActive));
  if (filters.search) {
    conditions.push(
      sql`${taskTemplatesTable.titleTemplate} ILIKE ${`%${filters.search}%`} OR ${taskTemplatesTable.descriptionTemplate} ILIKE ${`%${filters.search}%`}`,
    );
  }

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskTemplatesTable)
    .where(where);

  const items = await db
    .select()
    .from(taskTemplatesTable)
    .where(where)
    .orderBy(desc(taskTemplatesTable.updatedAt))
    .limit(limit)
    .offset(offset);

  return {
    items,
    total: Number(count),
    page,
    limit,
  };
}

export async function getTemplate(id: number, companyId: number): Promise<TaskTemplate | undefined> {
  const [template] = await db
    .select()
    .from(taskTemplatesTable)
    .where(and(eq(taskTemplatesTable.id, id), eq(taskTemplatesTable.companyId, companyId)))
    .limit(1);
  return template;
}

export async function createTemplate(data: NewTaskTemplate): Promise<TaskTemplate> {
  const [template] = await db.insert(taskTemplatesTable).values(data).returning();
  return template;
}

export async function updateTemplate(
  id: number,
  companyId: number,
  data: Partial<NewTaskTemplate>,
): Promise<TaskTemplate | undefined> {
  const [template] = await db
    .update(taskTemplatesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(taskTemplatesTable.id, id), eq(taskTemplatesTable.companyId, companyId)))
    .returning();
  return template;
}

export async function deleteTemplate(id: number, companyId: number): Promise<TaskTemplate | undefined> {
  const [template] = await db
    .delete(taskTemplatesTable)
    .where(and(eq(taskTemplatesTable.id, id), eq(taskTemplatesTable.companyId, companyId)))
    .returning();
  return template;
}

export async function getActiveTemplatesForScope(
  companyId: number,
  department: string,
  roleKey?: string,
): Promise<TaskTemplate[]> {
  const conditions = [
    eq(taskTemplatesTable.companyId, companyId),
    eq(taskTemplatesTable.isActive, true),
    eq(taskTemplatesTable.department, department),
  ];
  if (roleKey) {
    conditions.push(
      sql`(${taskTemplatesTable.roleKey} = ${roleKey} OR ${taskTemplatesTable.roleKey} = '*')`,
    );
  }

  return db
    .select()
    .from(taskTemplatesTable)
    .where(and(...conditions))
    .orderBy(desc(taskTemplatesTable.updatedAt));
}
