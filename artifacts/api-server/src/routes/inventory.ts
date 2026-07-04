import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable, companiesTable, insertProductSchema } from "@workspace/db";
import { eq, and, ilike, lte, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/products", async (req, res) => {
  try {
    const { companyId, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (companyId) conditions.push(eq(productsTable.companyId, parseInt(companyId)));
    if (search) conditions.push(ilike(productsTable.name, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(productsTable).where(where);
    const items = await db
      .select()
      .from(productsTable)
      .where(where)
      .orderBy(desc(productsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

    res.json({
      items: items.map(p => formatProduct(p, companyMap)),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list products" });
  }
});

router.post("/products", async (req, res) => {
  try {
    const parsed = insertProductSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [p] = await db.insert(productsTable).values(parsed.data).returning();
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, p.companyId));
    res.status(201).json(formatProduct(p, { [p.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create product" });
  }
});

router.get("/inventory/low-stock", async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const conditions = [lte(productsTable.stockQuantity, productsTable.reorderLevel)];
    if (companyId) conditions.push(eq(productsTable.companyId, parseInt(companyId)));
    
    const items = await db.select().from(productsTable).where(and(...conditions)).limit(50);
    const companies = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    res.json(items.map(p => formatProduct(p, companyMap)));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get low stock items" });
  }
});

router.get("/inventory/warehouse-summary", async (req, res) => {
  try {
    const companies = await db.select().from(companiesTable).where(eq(companiesTable.status, "active"));
    const summaries = await Promise.all(
      companies.map(async (c) => {
        const [stats] = await db
          .select({
            totalProducts: sql<number>`count(*)`,
            totalStockValue: sql<number>`coalesce(sum(stock_quantity * cost_price), 0)`,
            lowStockCount: sql<number>`count(*) filter (where stock_quantity <= reorder_level and stock_quantity > 0)`,
            outOfStockCount: sql<number>`count(*) filter (where stock_quantity = 0)`,
          })
          .from(productsTable)
          .where(eq(productsTable.companyId, c.id));
        return {
          companyId: c.id,
          companyName: c.name,
          totalProducts: Number(stats?.totalProducts ?? 0),
          totalStockValue: Number(stats?.totalStockValue ?? 0),
          lowStockCount: Number(stats?.lowStockCount ?? 0),
          outOfStockCount: Number(stats?.outOfStockCount ?? 0),
        };
      })
    );
    res.json(summaries);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get warehouse summary" });
  }
});

router.get("/products/:productId", async (req, res) => {
  try {
    const id = parseInt(req.params.productId);
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, p.companyId));
    res.json(formatProduct(p, { [p.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get product" });
  }
});

router.patch("/products/:productId", async (req, res) => {
  try {
    const id = parseInt(req.params.productId);
    const [p] = await db
      .update(productsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(productsTable.id, id))
      .returning();
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    const [c] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, p.companyId));
    res.json(formatProduct(p, { [p.companyId]: c?.name ?? "Unknown" }));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update product" });
  }
});

function formatProduct(p: typeof productsTable.$inferSelect, companyMap: Record<number, string>) {
  return {
    id: p.id,
    companyId: p.companyId,
    companyName: companyMap[p.companyId] ?? "Unknown",
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    description: p.description,
    price: p.price,
    costPrice: p.costPrice,
    stockQuantity: p.stockQuantity,
    reorderLevel: p.reorderLevel,
    warehouseLocation: p.warehouseLocation,
    imageUrl: p.imageUrl,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

export default router;
