import { Router } from "express";
import { z } from "zod";
import { db, productsTable, productAiMetadataTable, productImagesTable, productVariantsTable, productImportJobsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { isAiProductsEnabled } from "../lib/features";
import {
  analyzeProductImage, generateProductContent, generateMarketplaceTemplate,
  computeHealthScore, saveAiMetadata, generateBarcode, ensureUniqueSku,
} from "../lib/product-ai.service";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();

const IdParam = z.object({ productId: z.coerce.number() });
const MarketplaceParam = z.object({ productId: z.coerce.number(), marketplace: z.string() });
function parseParams(params: any) {
  return { productId: String(params.productId), marketplace: params.marketplace ? String(params.marketplace) : undefined };
}

function gate(req: any, res: any) {
  if (!isAiProductsEnabled()) { res.status(404).json({ error: "AI products module is disabled" }); return false; }
  return true;
}

function ensureCompany(req: any, res: any, companyId?: number) {
  if (companyId == null) { res.status(400).json({ error: "Missing companyId" }); return false; }
  if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

router.post("/ai-products/:productId/analyze-image", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const { objectPath } = z.object({ objectPath: z.string() }).parse(req.body);
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;

    const result = await analyzeProductImage(productId, objectPath);
    await saveAiMetadata(productId, {
      attributes: result.attributes,
      aiAnalysis: result as any,
    });
    const image = await db.insert(productImagesTable).values({
      productId, companyId: product.companyId, objectPath: objectPath,
      aiTags: result.tags, isPrimary: false,
    }).returning();
    res.json({ ...result, imageId: image[0]?.id });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Image analysis failed" }); }
});

router.post("/ai-products/:productId/generate-content", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { hint } = z.object({ hint: z.string().optional() }).parse(req.body);
    const result = await generateProductContent(productId, hint);
    res.json(result);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Content generation failed" }); }
});

router.post("/ai-products/:productId/apply-content", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { name, description, seoTitle, seoDescription, keywords, attributes, category, suggestedPrice } = z.object({
      name: z.string().optional(), description: z.string().optional(), seoTitle: z.string().optional(),
      seoDescription: z.string().optional(), keywords: z.array(z.string()).optional(),
      attributes: z.record(z.string(), z.string()).optional(), category: z.string().optional(), suggestedPrice: z.number().nullable().optional(),
    }).parse(req.body);

    await db.update(productsTable).set({
      name: name ?? undefined, description: description ?? undefined, category: category ?? undefined,
      price: suggestedPrice ?? undefined, updatedAt: new Date(),
    }).where(eq(productsTable.id, productId));
    await saveAiMetadata(productId, { seoTitle, seoDescription, keywords, attributes });
    const score = await computeHealthScore(productId);
    await saveAiMetadata(productId, { healthScore: score });
    res.json({ ok: true, healthScore: score });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to apply content" }); }
});

router.post("/ai-products/:productId/generate-sku", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const sku = await ensureUniqueSku(productId, product.name, product.category);
    res.json({ sku });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "SKU generation failed" }); }
});

router.post("/ai-products/:productId/generate-barcode", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    res.json({ barcode: generateBarcode() });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Barcode generation failed" }); }
});

router.post("/ai-products/:productId/marketplace/:marketplace", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId, marketplace } = MarketplaceParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const result = await generateMarketplaceTemplate(productId, marketplace);
    res.json(result);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Marketplace template generation failed" }); }
});

router.post("/ai-products/:productId/health-score", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const score = await computeHealthScore(productId);
    await saveAiMetadata(productId, { healthScore: score });
    res.json({ score });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Health score failed" }); }
});

router.get("/ai-products/:productId/ai-metadata", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const [meta] = await db.select().from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
    const images = await db.select().from(productImagesTable).where(eq(productImagesTable.productId, productId));
    const variants = await db.select().from(productVariantsTable).where(eq(productVariantsTable.productId, productId));
    res.json({ metadata: meta || null, images, variants });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load metadata" }); }
});

router.post("/products/:productId/variants", requirePermission("inventory.write"), async (req, res) => {
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { sku, name, barcode, price, stockQuantity, attributes } = z.object({
      sku: z.string(), name: z.string(), barcode: z.string().optional(), price: z.number(), stockQuantity: z.number(), attributes: z.record(z.string(), z.string()).optional(),
    }).parse(req.body);
    const [v] = await db.insert(productVariantsTable).values({ productId, companyId: product.companyId, sku, name, barcode, price, stockQuantity, attributes }).returning();
    res.status(201).json(v);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create variant" }); }
});

router.delete("/products/:productId/variants/:variantId", requirePermission("inventory.write"), async (req, res) => {
  try {
    const variantId = parseInt(String(req.params.variantId));
    const [variant] = await db.delete(productVariantsTable).where(eq(productVariantsTable.id, variantId)).returning();
    if (!variant) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete variant" }); }
});

router.post("/products/:productId/images", requirePermission("inventory.write"), async (req, res) => {
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { objectPath, altText, isPrimary } = z.object({ objectPath: z.string(), altText: z.string().optional(), isPrimary: z.boolean().default(false) }).parse(req.body);
    if (isPrimary) await db.update(productImagesTable).set({ isPrimary: false }).where(eq(productImagesTable.productId, productId));
    const [img] = await db.insert(productImagesTable).values({ productId, companyId: product.companyId, objectPath, altText, isPrimary }).returning();
    res.status(201).json(img);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to add image" }); }
});

router.delete("/products/:productId/images/:imageId", requirePermission("inventory.write"), async (req, res) => {
  try {
    const imageId = parseInt(String(req.params.imageId));
    const [img] = await db.delete(productImagesTable).where(eq(productImagesTable.id, imageId)).returning();
    if (!img) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete image" }); }
});

router.post("/ai-products/:productId/import-csv", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { objectPath } = z.object({ objectPath: z.string() }).parse(req.body);
    const [job] = await db.insert(productImportJobsTable).values({ companyId: product.companyId, filePath: objectPath, status: "pending" }).returning();
    res.json({ jobId: job.id, status: "pending" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import failed" }); }
});

router.post("/ai-products/import-csv", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { companyId, objectPath } = z.object({ companyId: z.number(), objectPath: z.string() }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;
    const [job] = await db.insert(productImportJobsTable).values({ companyId, filePath: objectPath, status: "pending" }).returning();
    res.json({ jobId: job.id, status: "pending" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import failed" }); }
});

router.post("/ai-products/import-jobs/:jobId/process", requirePermission("inventory.write"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const jobId = parseInt(String(req.params.jobId));
    const [job] = await db.select().from(productImportJobsTable).where(eq(productImportJobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Not found" }); return; }
    if (!ensureCompany(req, res, job.companyId)) return;

    await db.update(productImportJobsTable).set({ status: "running", updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
    const file = await storage.getObjectEntityFile(job.filePath);
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf-8");
    const records = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

    let success = 0, failed = 0;
    const errors: string[] = [];
    for (const row of records) {
      try {
        await db.insert(productsTable).values({
          companyId: job.companyId,
          name: row.name || "Untitled", sku: row.sku || generateBarcode(), category: row.category || "General",
          description: row.description, price: parseFloat(row.price || "0"), costPrice: parseFloat(row.costPrice || "0"),
          stockQuantity: parseInt(row.stockQuantity || "0"), reorderLevel: parseInt(row.reorderLevel || "10"),
          warehouseLocation: row.warehouseLocation, status: row.status || "active",
        });
        success++;
      } catch (err: any) {
        failed++;
        errors.push(`${row.name || "row"}: ${err.message}`);
      }
    }
    await db.update(productImportJobsTable).set({ status: "completed", stats: { total: records.length, success, failed, errors }, updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
    res.json({ total: records.length, success, failed, errors });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import processing failed" }); }
});

router.post("/ai-products/export-csv", requirePermission("inventory.read"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const { companyId } = z.object({ companyId: z.number() }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;
    const items = await db.select().from(productsTable).where(eq(productsTable.companyId, companyId));
    const rows = items.map(p => ({
      name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, description: p.description,
      price: p.price, costPrice: p.costPrice, stockQuantity: p.stockQuantity, reorderLevel: p.reorderLevel,
      warehouseLocation: p.warehouseLocation, status: p.status,
    }));
    const csv = stringify(rows, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products.csv");
    res.send(csv);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Export failed" }); }
});

router.get("/ai-products/import-jobs", requirePermission("inventory.read"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
    if (companyId != null && !ensureCompany(req, res, companyId)) return;
    const where = companyId != null ? eq(productImportJobsTable.companyId, companyId) : undefined;
    const jobs = await db.select().from(productImportJobsTable).where(where).orderBy(desc(productImportJobsTable.createdAt)).limit(50);
    res.json(jobs);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list jobs" }); }
});

export default router;
