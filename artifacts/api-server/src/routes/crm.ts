import { Router } from "express";
import { db } from "@workspace/db";
import {
  customersTable, leadsTable, vendorsTable, companiesTable,
  insertCustomerSchema, insertLeadSchema, insertVendorSchema
} from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";

const router = Router();

// ── Customers ──
router.get("/customers", async (req, res) => {
  try {
    const { companyId, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (companyId) conditions.push(eq(customersTable.companyId, parseInt(companyId)));
    if (search) conditions.push(ilike(customersTable.name, `%${search}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(customersTable).where(where);
    const items = await db.select().from(customersTable).where(where).orderBy(desc(customersTable.createdAt)).limit(limitNum).offset(offset);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    res.json({ items: items.map(c => fmtCustomer(c, companyMap)), total: Number(count), page: pageNum, limit: limitNum });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list customers" }); }
});

router.post("/customers", async (req, res) => {
  try {
    const parsed = insertCustomerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [c] = await db.insert(customersTable).values(parsed.data).returning();
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, c.companyId));
    res.status(201).json(fmtCustomer(c, { [c.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create customer" }); }
});

router.get("/customers/:customerId", async (req, res) => {
  try {
    const id = parseInt(req.params.customerId);
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id));
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, c.companyId));
    res.json(fmtCustomer(c, { [c.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to get customer" }); }
});

router.patch("/customers/:customerId", async (req, res) => {
  try {
    const id = parseInt(req.params.customerId);
    const [c] = await db.update(customersTable).set({ ...req.body, updatedAt: new Date() }).where(eq(customersTable.id, id)).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, c.companyId));
    res.json(fmtCustomer(c, { [c.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update customer" }); }
});

router.delete("/customers/:customerId", async (req, res) => {
  try {
    const id = parseInt(req.params.customerId);
    const [c] = await db.delete(customersTable).where(eq(customersTable.id, id)).returning();
    if (!c) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete customer" }); }
});

// ── Leads ──
router.get("/leads", async (req, res) => {
  try {
    const { companyId, stage, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (companyId) conditions.push(eq(leadsTable.companyId, parseInt(companyId)));
    if (stage) conditions.push(eq(leadsTable.stage, stage));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leadsTable).where(where);
    const items = await db.select().from(leadsTable).where(where).orderBy(desc(leadsTable.createdAt)).limit(limitNum).offset(offset);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    res.json({ items: items.map(l => fmtLead(l, companyMap)), total: Number(count), page: pageNum, limit: limitNum });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list leads" }); }
});

router.post("/leads", async (req, res) => {
  try {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [l] = await db.insert(leadsTable).values(parsed.data).returning();
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, l.companyId));
    res.status(201).json(fmtLead(l, { [l.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create lead" }); }
});

router.get("/leads/pipeline-stats", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const conditions = [];
    if (companyId) conditions.push(eq(leadsTable.companyId, parseInt(companyId)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select({ stage: leadsTable.stage, count: sql<number>`count(*)`, value: sql<number>`coalesce(sum(value), 0)` })
      .from(leadsTable)
      .where(where)
      .groupBy(leadsTable.stage);
    const stages = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
    const byStage = Object.fromEntries(rows.map(r => [r.stage, r]));
    res.json(stages.map(s => ({ stage: s, count: Number(byStage[s]?.count ?? 0), value: Number(byStage[s]?.value ?? 0) })));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to get pipeline stats" }); }
});

router.get("/leads/:leadId", async (req, res) => {
  try {
    const id = parseInt(req.params.leadId);
    const [l] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
    if (!l) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, l.companyId));
    res.json(fmtLead(l, { [l.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to get lead" }); }
});

router.patch("/leads/:leadId", async (req, res) => {
  try {
    const id = parseInt(req.params.leadId);
    const [l] = await db.update(leadsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(leadsTable.id, id)).returning();
    if (!l) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, l.companyId));
    res.json(fmtLead(l, { [l.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update lead" }); }
});

router.delete("/leads/:leadId", async (req, res) => {
  try {
    const id = parseInt(req.params.leadId);
    const [l] = await db.delete(leadsTable).where(eq(leadsTable.id, id)).returning();
    if (!l) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete lead" }); }
});

// ── Vendors ──
router.get("/vendors", async (req, res) => {
  try {
    const { companyId, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (companyId) conditions.push(eq(vendorsTable.companyId, parseInt(companyId)));
    if (search) conditions.push(ilike(vendorsTable.name, `%${search}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(vendorsTable).where(where);
    const items = await db.select().from(vendorsTable).where(where).orderBy(desc(vendorsTable.createdAt)).limit(limitNum).offset(offset);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    res.json({ items: items.map(v => fmtVendor(v, companyMap)), total: Number(count), page: pageNum, limit: limitNum });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list vendors" }); }
});

router.post("/vendors", async (req, res) => {
  try {
    const parsed = insertVendorSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [v] = await db.insert(vendorsTable).values(parsed.data).returning();
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, v.companyId));
    res.status(201).json(fmtVendor(v, { [v.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create vendor" }); }
});

router.get("/vendors/:vendorId", async (req, res) => {
  try {
    const id = parseInt(req.params.vendorId);
    const [v] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
    if (!v) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, v.companyId));
    res.json(fmtVendor(v, { [v.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to get vendor" }); }
});

router.patch("/vendors/:vendorId", async (req, res) => {
  try {
    const id = parseInt(req.params.vendorId);
    const [v] = await db.update(vendorsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(vendorsTable.id, id)).returning();
    if (!v) { res.status(404).json({ error: "Not found" }); return; }
    const [co] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, v.companyId));
    res.json(fmtVendor(v, { [v.companyId]: co?.name ?? "Unknown" }));
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update vendor" }); }
});

// formatters
function fmtCustomer(c: typeof customersTable.$inferSelect, m: Record<number, string>) {
  return { ...c, companyName: m[c.companyId] ?? "Unknown", createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}
function fmtLead(l: typeof leadsTable.$inferSelect, m: Record<number, string>) {
  return { ...l, companyName: m[l.companyId] ?? "Unknown", createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() };
}
function fmtVendor(v: typeof vendorsTable.$inferSelect, m: Record<number, string>) {
  return { ...v, companyName: m[v.companyId] ?? "Unknown", createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString() };
}

export default router;
