import { Router } from "express";
import { db } from "@workspace/db";
import { employeesTable, companiesTable, insertEmployeeSchema } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/employees", async (req, res) => {
  try {
    const { companyId, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (companyId) conditions.push(eq(employeesTable.companyId, parseInt(companyId)));
    if (search) conditions.push(ilike(employeesTable.firstName, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(employeesTable).where(where);
    const items = await db
      .select()
      .from(employeesTable)
      .where(where)
      .orderBy(desc(employeesTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

    res.json({
      items: items.map(e => formatEmployee(e, companyMap)),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list employees" });
  }
});

router.post("/employees", async (req, res) => {
  try {
    const nextCode = `EMP${String(Date.now()).slice(-5)}`;
    const parsed = insertEmployeeSchema.safeParse({ ...req.body, employeeCode: nextCode });
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [emp] = await db.insert(employeesTable).values(parsed.data).returning();
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, emp.companyId));
    res.status(201).json(formatEmployee(emp, { [emp.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create employee" });
  }
});

router.delete("/employees/:employeeId", async (req, res) => {
  try {
    const id = parseInt(req.params.employeeId);
    const [e] = await db.delete(employeesTable).where(eq(employeesTable.id, id)).returning();
    if (!e) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete employee" }); }
});

router.get("/employees/attendance-summary", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const condition = companyId ? eq(employeesTable.companyId, parseInt(companyId)) : undefined;

    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where status = 'active')`,
        onLeave: sql<number>`count(*) filter (where status = 'on_leave')`,
      })
      .from(employeesTable)
      .where(condition);

    const total = Number(stats?.total ?? 0);
    const onLeave = Number(stats?.onLeave ?? 0);

    res.json({
      date: new Date().toISOString().slice(0, 10),
      totalEmployees: total,
      // We do not track daily check-in/attendance, so present/absent/late are
      // reported as unavailable instead of being derived from fixed ratios.
      present: null,
      absent: null,
      onLeave,
      late: null,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get attendance summary" });
  }
});

router.get("/employees/:employeeId", async (req, res) => {
  try {
    const id = parseInt(req.params.employeeId);
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
    if (!emp) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, emp.companyId));
    res.json(formatEmployee(emp, { [emp.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get employee" });
  }
});

router.patch("/employees/:employeeId", async (req, res) => {
  try {
    const id = parseInt(req.params.employeeId);
    const [emp] = await db
      .update(employeesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(employeesTable.id, id))
      .returning();
    if (!emp) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, emp.companyId));
    res.json(formatEmployee(emp, { [emp.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update employee" });
  }
});

function formatEmployee(e: typeof employeesTable.$inferSelect, companyMap: Record<number, string>) {
  return {
    id: e.id,
    companyId: e.companyId,
    companyName: companyMap[e.companyId] ?? "Unknown",
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    department: e.department,
    designation: e.designation,
    employeeCode: e.employeeCode,
    status: e.status,
    joinDate: e.joinDate,
    salary: e.salary,
    managerId: e.managerId,
    avatarUrl: e.avatarUrl,
    createdAt: e.createdAt.toISOString(),
  };
}

export default router;
