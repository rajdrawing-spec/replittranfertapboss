import { Router } from "express";
import { db } from "@workspace/db";
import { companiesTable, insertCompanySchema } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/companies", async (req, res) => {
  try {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.id);
    res.json(companies.map(formatCompany));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list companies" });
  }
});

router.post("/companies", async (req, res) => {
  try {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [c] = await db.insert(companiesTable).values(parsed.data).returning();
    res.status(201).json(formatCompany(c));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create company" });
  }
});

router.get("/companies/:companyId", async (req, res) => {
  try {
    const id = parseInt(req.params.companyId);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatCompany(c));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get company" });
  }
});

router.patch("/companies/:companyId", async (req, res) => {
  try {
    const id = parseInt(req.params.companyId);
    const [c] = await db
      .update(companiesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(companiesTable.id, id))
      .returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatCompany(c));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update company" });
  }
});

function formatCompany(c: typeof companiesTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    type: c.type,
    industry: c.industry,
    ownershipPercent: c.ownershipPercent,
    gstNumber: c.gstNumber,
    panNumber: c.panNumber,
    address: c.address,
    city: c.city,
    state: c.state,
    status: c.status,
    logoUrl: c.logoUrl,
    employeeCount: c.employeeCount,
    totalRevenue: c.totalRevenue,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
