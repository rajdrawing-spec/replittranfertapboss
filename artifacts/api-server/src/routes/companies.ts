import { Router } from "express";
import { db } from "@workspace/db";
import {
  companiesTable, insertCompanySchema,
  employeesTable, ordersTable, transactionsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/authz";

const router = Router();

router.get("/companies", async (req, res) => {
  try {
    // Batch all three queries in parallel for speed
    const [companies, empRows, revRows] = await Promise.all([
      db.select().from(companiesTable).orderBy(companiesTable.id),

      // Active employee count per company
      db
        .select({
          companyId: employeesTable.companyId,
          count: sql<number>`count(*)::int`,
        })
        .from(employeesTable)
        .where(eq(employeesTable.status, "active"))
        .groupBy(employeesTable.companyId),

      // Revenue = orders revenue + income transactions, both per company
      db.execute(sql`
        SELECT company_id,
               coalesce(sum(amount), 0)::numeric AS total_revenue
        FROM (
          SELECT company_id, total_amount AS amount FROM orders
          UNION ALL
          SELECT company_id, amount       AS amount FROM transactions WHERE type = 'income'
        ) src
        GROUP BY company_id
      `),
    ]);

    // Build lookup maps
    const empMap = new Map<number, number>(empRows.map((r) => [r.companyId, r.count]));
    const revMap = new Map<number, number>(
      (revRows.rows as { company_id: number; total_revenue: string }[]).map((r) => [
        Number(r.company_id),
        Number(r.total_revenue),
      ])
    );

    res.json(
      companies.map((c) =>
        formatCompany(c, empMap.get(c.id) ?? 0, revMap.get(c.id) ?? 0)
      )
    );
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list companies" });
  }
});

router.post("/companies", requireSuperAdmin, async (req, res) => {
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
    const id = parseInt(String(req.params.companyId));
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatCompany(c));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get company" });
  }
});

// Whitelist of fields a client may update (mirrors the OpenAPI CompanyUpdate
// contract). `slug`, `id`, and timestamps are intentionally immutable.
const UPDATABLE_FIELDS = [
  "name", "type", "industry", "ownershipPercent", "gstNumber", "panNumber",
  "address", "city", "state", "status", "archived", "logoUrl", "website",
  "description", "category", "country", "currency", "timezone", "brandColor",
] as const;

router.patch("/companies/:companyId", requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.companyId));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const f of UPDATABLE_FIELDS) {
      if (f in body && body[f] !== undefined) updates[f] = body[f];
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }
    const [c] = await db
      .update(companiesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companiesTable.id, id))
      .returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatCompany(c));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update company" });
  }
});

router.delete("/companies/:companyId", requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.companyId));
    const [c] = await db.delete(companiesTable).where(eq(companiesTable.id, id)).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete company" });
  }
});

function formatCompany(
  c: typeof companiesTable.$inferSelect,
  employeeCount?: number,
  totalRevenue?: number,
) {
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
    archived: c.archived,
    logoUrl: c.logoUrl,
    website: c.website,
    description: c.description,
    category: c.category,
    country: c.country,
    currency: c.currency,
    timezone: c.timezone,
    brandColor: c.brandColor,
    // Use live-computed values when provided (list endpoint), else fall back
    // to the stored column (single-company GET, create, patch, delete).
    employeeCount: employeeCount ?? c.employeeCount,
    totalRevenue: totalRevenue ?? c.totalRevenue,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
